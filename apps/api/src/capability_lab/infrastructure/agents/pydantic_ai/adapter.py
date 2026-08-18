from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import (
    ModelAPIError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
    UserError,
)
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.models import Model

from capability_lab.application.conversations import (
    AgentFrameworkError,
    AgentProviderError,
    AgentTransientError,
    AgentValidationError,
)
from capability_lab.application.order_actions import (
    ACTION_TOOL_VERSION,
    CANCEL_ORDER_TOOL_NAME,
    ActionProposalDraft,
    OrderActionRequest,
)
from capability_lab.application.ports import (
    AgentAdapter,
    AgentCapability,
    AgentRequest,
    AgentResponse,
    StructuredSupportResult,
    ToolActivity,
)
from capability_lab.application.support_tools import RetailSupportTools

PROVEN_CAPABILITIES = frozenset(
    {
        AgentCapability.TOOL_CALLS,
        AgentCapability.CONVERSATION_MEMORY,
        AgentCapability.SESSION_RESUME,
        AgentCapability.STRUCTURED_OUTPUT,
    }
)


class _SupportOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str
    summary: str


@dataclass(slots=True)
class _AgentDependencies:
    tools: RetailSupportTools
    activities: list[ToolActivity] = field(default_factory=lambda: list[ToolActivity]())


class PydanticAiAgentAdapter(AgentAdapter):
    """Map the common adapter contract to Pydantic AI without leaking SDK types."""

    def __init__(self, model: Model, *, retries: int = 2) -> None:
        self._agent = Agent(
            model,
            deps_type=_AgentDependencies,
            output_type=_SupportOutput,
            retries=retries,
            instructions=(
                "You are a read-only retail support agent. Use every supplied retail lookup tool "
                "before answering. Never claim to modify customer or order state. Return a concise "
                "message and summary grounded only in tool results."
            ),
            tools=[self._read_customer, self._list_products, self._list_orders],
        )

    @classmethod
    def for_test(cls) -> PydanticAiAgentAdapter:
        from pydantic_ai.models.test import TestModel

        return cls(TestModel())

    @property
    def framework_id(self) -> str:
        return "pydantic-ai"

    def capabilities(self) -> frozenset[AgentCapability]:
        return PROVEN_CAPABILITIES

    async def run(self, request: AgentRequest) -> AgentResponse:
        dependencies = _AgentDependencies(tools=RetailSupportTools(request.support_context))
        try:
            result = await self._agent.run(
                request.message,
                deps=dependencies,
                message_history=_message_history(request),
            )
        except UsageLimitExceeded as error:
            raise AgentTransientError("the model execution limit was reached") from error
        except ModelAPIError as error:
            status_code = getattr(error, "status_code", None)
            if status_code == 429 or (isinstance(status_code, int) and status_code >= 500):
                raise AgentTransientError(
                    "the model provider is temporarily unavailable"
                ) from error
            raise AgentProviderError("the model provider rejected the request") from error
        except UnexpectedModelBehavior as error:
            raise AgentValidationError("the model returned an invalid support response") from error
        except UserError as error:
            raise AgentFrameworkError(
                "the agent framework could not execute the request"
            ) from error

        output = result.output
        if not dependencies.activities and not request.history:
            raise AgentValidationError("the model returned without using a retail support tool")
        return AgentResponse(
            message=output.message,
            structured_result=StructuredSupportResult(
                summary=output.summary,
                customer_id=request.customer_id,
                product_ids=tuple(product.id for product in request.support_context.products),
                order_ids=tuple(order.id for order in request.support_context.orders),
            ),
            tool_activity=tuple(dependencies.activities),
        )

    async def propose_action(self, request: OrderActionRequest) -> ActionProposalDraft:
        # The application owns confirmation and execution. The adapter maps the framework-neutral
        # action request without granting the model authority to mutate business state.
        return ActionProposalDraft(
            action_type=request.action_type,
            tool_name=CANCEL_ORDER_TOOL_NAME,
            tool_version=ACTION_TOOL_VERSION,
            order_id=request.order.id,
            expected_version=request.expected_version,
            summary=(
                f"Cancel paid order {request.order.id} at version {request.expected_version}."
            ),
        )

    @staticmethod
    def _read_customer(ctx: RunContext[_AgentDependencies]) -> dict[str, object]:
        """Read the customer profile scoped to this conversation (tool contract v1)."""
        activity = ctx.deps.tools.read_customer_v1()
        ctx.deps.activities.append(activity)
        return activity.result

    @staticmethod
    def _list_products(ctx: RunContext[_AgentDependencies]) -> dict[str, object]:
        """List products in the generated retail sandbox (tool contract v1)."""
        activity = ctx.deps.tools.list_products_v1()
        ctx.deps.activities.append(activity)
        return activity.result

    @staticmethod
    def _list_orders(ctx: RunContext[_AgentDependencies]) -> dict[str, object]:
        """List the scoped customer's orders (tool contract v1)."""
        activity = ctx.deps.tools.list_customer_orders_v1()
        ctx.deps.activities.append(activity)
        return activity.result


def _message_history(request: AgentRequest) -> list[ModelRequest | ModelResponse]:
    history: list[ModelRequest | ModelResponse] = []
    for turn in request.history:
        history.append(ModelRequest(parts=[UserPromptPart(content=turn.request_message)]))
        history.append(ModelResponse(parts=[TextPart(content=turn.response.message)]))
    return history


def create_openai_model(model_id: str, api_key: str) -> Model:
    """Build the credentialed provider model inside the Pydantic AI adapter boundary."""
    from pydantic_ai.models.openai import OpenAIResponsesModel
    from pydantic_ai.providers.openai import OpenAIProvider

    return OpenAIResponsesModel(model_id, provider=OpenAIProvider(api_key=api_key))
