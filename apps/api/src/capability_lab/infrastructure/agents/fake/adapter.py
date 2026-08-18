from __future__ import annotations

from capability_lab.application.ports import (
    AgentAdapter,
    AgentCapability,
    AgentRequest,
    AgentResponse,
    StructuredSupportResult,
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


class FakeAgentAdapter(AgentAdapter):
    """Deterministic offline adapter used by required tests and local exploration."""

    @property
    def framework_id(self) -> str:
        return "fake"

    def capabilities(self) -> frozenset[AgentCapability]:
        return PROVEN_CAPABILITIES

    async def run(self, request: AgentRequest) -> AgentResponse:
        tools = RetailSupportTools(request.support_context)
        customer = tools.read_customer_v1()
        products = tools.list_products_v1()
        orders = tools.list_customer_orders_v1()
        activities = (customer, products, orders)
        previous_turns = len(request.history)
        customer_name = request.support_context.customer.display_name
        order_count = len(request.support_context.orders)
        product_count = len(request.support_context.products)
        return AgentResponse(
            message=(
                f"I found {order_count} order and {product_count} products for {customer_name}. "
                f"This conversation has {previous_turns} earlier support turn"
                f"{'s' if previous_turns != 1 else ''}."
            ),
            structured_result=StructuredSupportResult(
                summary="Customer profile, product catalog, and order history retrieved.",
                customer_id=request.customer_id,
                product_ids=tuple(product.id for product in request.support_context.products),
                order_ids=tuple(order.id for order in request.support_context.orders),
            ),
            tool_activity=activities,
        )
