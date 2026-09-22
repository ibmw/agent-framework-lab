"""Public v1 contract for the lab's model connection (ADR 0052).

Four operations. Three of them are about the stored connection — list the providers that can
hold one, read the one a provider holds, and save it — and the fourth asks an endpoint a
question whose answer is true of a moment and is therefore never stored.

**The response carries no fact about the key.** Not the value, not a prefix or a suffix, not a
length, not a hash, not a mask. `key_configured` and `key_added_at`, and nothing else. This is
a deliberate departure from the prototype, which draws a mask, and it is ADR 0044's own
`getLabStatus` rule applied consistently to a key the operator typed instead of one the
environment supplied: a masked key is a fact about a secret, served over an unauthenticated
route, to distinguish two keys that an operator can distinguish by re-saving. The cost is
named rather than hidden — an operator who has forgotten which key is installed cannot tell
from this page, and their path is to save the one they mean.

The key travels *in*, never *out*. `api_key` exists on the two request bodies and on no
response, and leaving it out of a save is how an operator changes a base URL without retyping
a credential the lab will not show them.
"""

from collections.abc import Callable, Generator
from datetime import datetime
from typing import Annotated, Any, Self

from fastapi import APIRouter, Depends, Path
from pydantic import Field

from capability_lab.application.model_connections import (
    HttpStatusClass,
    ModelConnection,
    ModelConnectionService,
    ModelEndpointOutcome,
    ModelEndpointProbeResult,
    ProviderConnection,
)
from capability_lab.domain.model_connection import MAX_BASE_URL_LENGTH
from capability_lab.presentation.base import ErrorResponse, StrictApiModel

__all__ = [
    "ModelConnectionRoutes",
    "ModelConnectionSchema",
    "ModelConnectionTestRequest",
    "ModelConnectionTestResponse",
    "ProviderConnectionListResponse",
    "ProviderConnectionSchema",
    "SaveModelConnectionRequest",
]

ProviderId = Annotated[
    str,
    Path(
        min_length=1,
        max_length=32,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="The provider id the proven-capability tables use, such as `openai`.",
    ),
]


def _refusals(description: str) -> dict[int | str, dict[str, Any]]:
    """One 422 per route, described by what that route can actually refuse.

    Written per operation rather than shared, because a published description that listed
    every refusal the resource has would tell a reader of `getModelConnection` that it can
    refuse a base URL it is never given.
    """
    return {422: {"model": ErrorResponse, "description": description}}


UNKNOWN_PROVIDER = "The provider holds no connection in this lab"
INVALID_CONNECTION = (
    "The provider holds no connection here, the base URL breaks a storage rule, or a key "
    "was supplied with no AGENT_LAB_CREDENTIAL_KEY set"
)
UNTESTABLE_CONNECTION = (
    "The provider holds no connection here, the base URL breaks a storage rule, or the "
    "stored key cannot be read back under the current AGENT_LAB_CREDENTIAL_KEY"
)


class ModelConnectionSchema(StrictApiModel):
    """One saved connection: where the lab points, and *that* a key is installed."""

    provider_id: str
    base_url: str
    """Normalized at the door, so two spellings of one endpoint are one value.

    Safe to serve because of what it is not allowed to contain: a URL carrying userinfo, a
    query or a fragment is refused with 422 before it is stored, which removes the place a
    token could sit rather than hiding the value (ADR 0052).
    """

    key_configured: bool
    """Whether a credential is installed. The whole of what this lab says about the key."""

    key_added_at: datetime | None
    """When the installed key was saved, or `null` when none is.

    A date, not a fingerprint: it distinguishes "I saved one this morning" from "something
    has been here since March" without describing the secret in any way.
    """

    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, connection: ModelConnection) -> Self:
        return cls(
            provider_id=connection.provider_id,
            base_url=connection.base_url,
            key_configured=connection.key_configured,
            key_added_at=connection.key_added_at,
            created_at=connection.created_at,
            updated_at=connection.updated_at,
        )


class ProviderConnectionSchema(StrictApiModel):
    """A provider that can hold a connection, and the one it holds."""

    provider_id: str
    connection: ModelConnectionSchema | None
    """`null` when this lab has not been pointed anywhere for this provider.

    An answer rather than a 404: a lab running on the environment bootstrap alone is a
    supported state, not a missing resource.
    """

    @classmethod
    def of(cls, provider: ProviderConnection) -> Self:
        return cls(
            provider_id=provider.provider_id,
            connection=(
                None
                if provider.connection is None
                else ModelConnectionSchema.of(provider.connection)
            ),
        )


class ProviderConnectionListResponse(StrictApiModel):
    """Every provider this lab can be pointed at, whether or not one is saved."""

    providers: list[ProviderConnectionSchema]


class SaveModelConnectionRequest(StrictApiModel):
    """Where to point the lab, and optionally the key to reach it under."""

    base_url: str = Field(min_length=1, max_length=MAX_BASE_URL_LENGTH)
    api_key: str | None = Field(default=None, min_length=1, max_length=512)
    """Write-only, and absent means *keep the stored key*.

    There is no read route, no mask and no reveal control, so this is the only direction a key
    ever travels. Re-saving is the replacement path and the rotation path both; a lab holding
    one credential does not need a second mechanism to replace it.
    """


class ModelConnectionTestRequest(StrictApiModel):
    """The connection to test, which need not be the one that is saved."""

    base_url: str = Field(min_length=1, max_length=MAX_BASE_URL_LENGTH)
    api_key: str | None = Field(default=None, min_length=1, max_length=512)
    """Falls back to the saved key when it is left out, so an operator can check a base URL
    they have just typed without retyping a credential the lab will not show them."""


class ModelConnectionTestResponse(StrictApiModel):
    """What one throwaway call established, and the whole of what it may report."""

    outcome: ModelEndpointOutcome
    latency_ms: int
    """The round trip, which is the only quantity a reachability answer carries."""

    status_class: HttpStatusClass | None
    """The class of the status that came back, or `null` when nothing answered.

    A class and never the body. A provider's error text is a string this lab did not write and
    cannot promise the contents of — it may hold the credential that was sent, or content from
    another tenant's request — so it is classified rather than quoted, which is the same rule
    a tool result follows when it refuses to describe a failure in the provider's words.
    """

    @classmethod
    def of(cls, result: ModelEndpointProbeResult) -> Self:
        return cls(
            outcome=result.outcome,
            latency_ms=result.latency_ms,
            status_class=result.status_class,
        )


class ModelConnectionRoutes:
    """The lab's connection resource: read, saved, and asked a question about a moment."""

    def __init__(self, service: Callable[[], Generator[ModelConnectionService, None, None]]):
        self._service = service

    def register(self, router: APIRouter) -> None:
        dependency = Depends(self._service)

        def list_model_connections(
            service: Annotated[ModelConnectionService, dependency],
        ) -> ProviderConnectionListResponse:
            return ProviderConnectionListResponse(
                providers=[
                    ProviderConnectionSchema.of(provider) for provider in service.list_providers()
                ]
            )

        def get_model_connection(
            provider_id: ProviderId,
            service: Annotated[ModelConnectionService, dependency],
        ) -> ProviderConnectionSchema:
            return ProviderConnectionSchema.of(service.get(provider_id))

        def save_model_connection(
            provider_id: ProviderId,
            command: SaveModelConnectionRequest,
            service: Annotated[ModelConnectionService, dependency],
        ) -> ProviderConnectionSchema:
            return ProviderConnectionSchema.of(
                service.save(
                    provider_id,
                    base_url=command.base_url,
                    api_key=command.api_key,
                )
            )

        async def test_model_connection(
            provider_id: ProviderId,
            command: ModelConnectionTestRequest,
            service: Annotated[ModelConnectionService, dependency],
        ) -> ModelConnectionTestResponse:
            return ModelConnectionTestResponse.of(
                await service.test(
                    provider_id,
                    base_url=command.base_url,
                    api_key=command.api_key,
                )
            )

        router.add_api_route(
            "/model-connections",
            list_model_connections,
            methods=["GET"],
            response_model=ProviderConnectionListResponse,
            operation_id="listModelConnections",
            summary="List the providers this lab can be pointed at",
            description=(
                "Every provider the lab has proven it can reach, with the connection it "
                "holds or `null`. Reports no fact about a stored key beyond whether one is "
                "installed and when it was saved."
            ),
        )
        router.add_api_route(
            "/model-connections/{provider_id}",
            get_model_connection,
            methods=["GET"],
            response_model=ProviderConnectionSchema,
            operation_id="getModelConnection",
            summary="Read the connection this lab holds for one provider",
            description=(
                "Answers with `connection: null` when nothing is saved, because a lab running "
                "on the environment bootstrap alone is a supported state rather than a "
                "missing resource. Reports no fact about the stored key."
            ),
            responses=_refusals(UNKNOWN_PROVIDER),
        )
        router.add_api_route(
            "/model-connections/{provider_id}",
            save_model_connection,
            methods=["PUT"],
            response_model=ProviderConnectionSchema,
            operation_id="saveModelConnection",
            summary="Point this lab at one endpoint for one provider",
            description=(
                "Replaces this provider's connection whole, so saving the same values twice "
                "leaves one row saying the same thing. The base URL is validated and "
                "normalized before it is stored: http or https only, no userinfo, query or "
                "fragment, and http only for a loopback or private host. Leaving `api_key` "
                "out keeps the stored key; supplying one replaces it, and the key is stored "
                "encrypted under AGENT_LAB_CREDENTIAL_KEY. With that variable unset the save "
                "is refused with 422 rather than storing a key this lab cannot protect. The "
                "connection holds no model: what an experiment runs is its published "
                "configuration's model, never this process's."
            ),
            responses=_refusals(INVALID_CONNECTION),
        )
        router.add_api_route(
            "/model-connections/{provider_id}/test",
            test_model_connection,
            methods=["POST"],
            response_model=ModelConnectionTestResponse,
            operation_id="testModelConnection",
            summary="Ask one endpoint whether it is reachable, right now",
            description=(
                "Makes one cheap call under a short timeout to the connection in the body — "
                "falling back to the saved key when none is supplied — and answers "
                "`reachable`, `refused` or `unreachable` with the round trip in "
                "milliseconds. Stores nothing: a reachability result is true of a moment, and "
                "a stored green tick would be read as a promise the lab cannot keep. Never "
                "includes the upstream response body, only the class of the status it "
                "answered with."
            ),
            responses=_refusals(UNTESTABLE_CONNECTION),
        )
