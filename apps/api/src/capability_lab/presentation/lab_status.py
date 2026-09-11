"""What this process was composed to do, reported and never edited.

Run mode and trace export are read from the environment when the application is composed and
cannot change while it runs, so this route reports them rather than offering a control. A
settings form for `AGENT_LAB_OPENAI_API_KEY` would mean this application storing a provider
secret in its own database, which `docs/observability.md` forbids it from so much as recording
(ADR 0044).

The payload is deliberately narrow. It carries a run-mode enum, the non-secret model name, and
a boolean, and it is the whole of what a reader is entitled to learn about composition from
over the wire:

- no prefix, suffix, length or hash of the API key, because each of those is a fact about a
  secret and the enum below already answers the only question a viewer has — whether a
  comparison produced here can be about how two frameworks actually choose; and
- no OTLP endpoint, even though the documented local one is a `localhost` address. A collector
  URL is a place a deployment can put a token, and a route that serves it is a route that
  serves that token the day somebody does.
"""

from __future__ import annotations

from enum import StrEnum

from fastapi import APIRouter

from capability_lab.infrastructure.config import Settings
from capability_lab.presentation.base import StrictApiModel


class LabRunMode(StrEnum):
    """Whether this build can reach a model provider at all."""

    OFFLINE = "offline"
    """No credential is configured, so only the deterministic control arm can be advanced.

    `create_support_agent_runtimes` registers the two model-backed frameworks together with
    the credential they both reach a provider under, so without one an arm running either is
    refused the moment it is advanced. What an offline lab can still run is the control, and
    any comparison it produces therefore holds both arms' decisions identical by construction
    — as the seeded demo does, by driving one scripted incident through each SDK's own model
    seam. Either way the standing limit is the one ADR 0042 established: such a run
    establishes the evidence model rather than a difference between frameworks, and it is a
    property of this build inherited by every run produced here, including ones an operator
    drove themselves, which carry no label because nobody wrote one.
    """

    CREDENTIALED = "credentialed"
    """A provider credential is configured, so a model-backed arm can actually be run."""


class LabStatusResponse(StrictApiModel):
    """Three facts about composition, and deliberately no fourth."""

    run_mode: LabRunMode
    model_id: str
    """The model this process is configured for. A name, not a credential.

    What an *experiment* ran is the model its published configuration named (ADR 0024); this
    is only what the process would reach for where the environment still decides.
    """

    trace_export_configured: bool
    """Whether an exporter is actually installed — never the endpoint it sends to.

    Read the way `create_telemetry` reads the same setting, which is truthily rather than
    against `None`: a blanked `.env` line or a compose file passing an unset variable through
    yields an empty string, and an empty string installs no exporter. A page that reported
    one anyway would be describing an export that is not happening.
    """


def read_lab_status(settings: Settings) -> LabStatusResponse:
    return LabStatusResponse(
        run_mode=LabRunMode.OFFLINE if settings.openai_api_key is None else LabRunMode.CREDENTIALED,
        model_id=settings.openai_model,
        trace_export_configured=bool(settings.otel_exporter_otlp_endpoint),
    )


class LabStatusRoutes:
    """The one read-only route the lab-level settings surface needs.

    Bound to the composed settings rather than to a request-scoped service: there is no
    database behind this answer, and nothing here changes between two requests to one process.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def register(self, router: APIRouter) -> None:
        settings = self._settings

        def get_lab_status() -> LabStatusResponse:
            return read_lab_status(settings)

        router.add_api_route(
            "/lab-status",
            get_lab_status,
            methods=["GET"],
            response_model=LabStatusResponse,
            operation_id="getLabStatus",
            summary="Report how this process is composed to run",
            description=(
                "Whether a provider credential is configured, the model name this process "
                "would reach for, and whether traces are exported anywhere. Reports no fact "
                "about the credential beyond the run mode, and never the exporter endpoint."
            ),
        )


__all__ = ["LabRunMode", "LabStatusResponse", "LabStatusRoutes", "read_lab_status"]
