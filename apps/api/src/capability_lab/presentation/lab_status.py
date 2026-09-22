"""What this lab can reach and what it exports, reported and never edited here.

Run mode used to be a property of the process: composed once from `AGENT_LAB_OPENAI_API_KEY`
and unchangeable without a shell and a restart. ADR 0052 moved the connection into the lab's
own database, so it is now **a per-request answer** — a lab can go from offline to
credentialed while an operator is looking at this page, and the only thing that changed for
this route is how long the answer stays true. Trace export is still process composition and
still cannot move while the process runs.

The payload stays as narrow as ADR 0044 made it, and the field added here is narrow in the
same way. It carries a run-mode enum, the name of the model the POC's conversation routes
would reach for, which of the resolution chain's answers is in force, and a boolean:

- no prefix, suffix, length or hash of any credential, because each of those is a fact about
  a secret, and neither the run mode nor the source below is derivable back into one. Which
  *configuration* won is not a fact about what it contains;
- no base URL. The saved connection's endpoint is served by `getModelConnection`, which is
  the resource that owns it; repeating it here would give the same value two owners that can
  disagree, and the environment bootstrap's endpoint is not a fact anybody typed; and
- no OTLP endpoint, even though the documented local one is a `localhost` address. A
  collector URL is a place a deployment can put a token, and a route that serves it is a
  route that serves that token the day somebody does.

The source is served because ADR 0052 requires it: a lab holding both a saved connection and
an environment key otherwise answers in a way neither one explains, and an operator who has
saved a connection the lab cannot decrypt would otherwise read *offline* with no way to tell
it from never having configured anything. It carries **four** answers rather than the two that
decision's sentence names, for the reason its amendment gives: the chain has four states and
two of them are the same run mode.
"""

from collections.abc import Callable, Generator
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, Depends

from capability_lab.application.model_connections import (
    ModelConnectionSource,
    ResolvedConnection,
)
from capability_lab.infrastructure.config import Settings
from capability_lab.presentation.base import StrictApiModel


class LabRunMode(StrEnum):
    """Whether this lab can reach a model provider at all, right now."""

    OFFLINE = "offline"
    """This lab reaches no provider, so only the deterministic control arm can be advanced.

    `create_support_agent_runtimes` registers the two model-backed frameworks together with
    the connection they both reach a provider under, so without one an arm running either is
    refused the moment it is advanced. What an offline lab can still run is the control, and
    any comparison it produces therefore holds both arms' decisions identical by construction
    — as the seeded demo does, by driving one scripted incident through each SDK's own model
    seam. Either way the standing limit is the one ADR 0042 established: such a run
    establishes the evidence model rather than a difference between frameworks, and it is a
    property of this build inherited by every run produced here, including ones an operator
    drove themselves, which carry no label because nobody wrote one.

    This is the answer for a saved connection whose key cannot be read back, too, and that is
    the deliberate reading rather than an omission. `key_configured` reports that a key is
    *present*, which is all the connection resource may say about it; a run mode computed
    from presence would tell an operator the lab is ready while every advance refuses. The
    source below is what tells the two apart.
    """

    CREDENTIALED = "credentialed"
    """This lab reaches a provider, so a model-backed arm can actually be run.

    Including a saved connection with no key at all: a local endpoint needs none, and running
    an arm against a local model with no credential leaving the machine is the case ADR 0052
    exists for.
    """


class LabStatusResponse(StrictApiModel):
    """Four facts about what this lab can reach, and deliberately no fifth."""

    run_mode: LabRunMode
    connection_source: ModelConnectionSource
    """Which answer of the resolution chain is in force for the model provider.

    A fact about *which configuration won*, never about what it contains. `saved_unreadable`
    is the one member that is not merely informational: it is an offline lab holding a
    connection whose key will not decrypt, and its remedy — save the key again — is different
    from every other offline lab's.
    """

    model_id: str
    """The model this process is configured for. A name, not a credential.

    What an *experiment* ran is the model its published configuration named (ADR 0024), and
    what a *connection* points at carries no model at all (ADR 0052); this is only what the
    POC's conversation routes would reach for, where the environment still decides.
    """

    trace_export_configured: bool
    """Whether an exporter is actually installed — never the endpoint it sends to.

    Read the way `create_telemetry` reads the same setting, which is truthily rather than
    against `None`: a blanked `.env` line or a compose file passing an unset variable through
    yields an empty string, and an empty string installs no exporter. A page that reported
    one anyway would be describing an export that is not happening.
    """


def read_lab_status(settings: Settings, connection: ResolvedConnection) -> LabStatusResponse:
    """The reading, from the resolution this request made and the process's own composition.

    Run mode follows `reaches_provider` and nothing else, which is the same question
    `create_support_agent_runtimes` answers when it decides whether to register a
    model-backed framework. One question asked in one way: a page that said credentialed
    while an advance refused would be describing a different lab.
    """
    return LabStatusResponse(
        run_mode=LabRunMode.CREDENTIALED if connection.reaches_provider else LabRunMode.OFFLINE,
        connection_source=connection.source,
        model_id=settings.openai_model,
        trace_export_configured=bool(settings.otel_exporter_otlp_endpoint),
    )


class LabStatusRoutes:
    """The one read-only route the lab-level settings surface needs.

    Bound to the composed settings *and* to a per-request resolution, which is the change
    ADR 0052 made: the model name and the exporter are process composition and cannot move
    while it runs, while where the lab is pointed is a row an operator can save from the page
    this route serves.
    """

    def __init__(
        self,
        settings: Settings,
        connection: Callable[[], Generator[ResolvedConnection, None, None]],
    ) -> None:
        self._settings = settings
        self._connection = connection

    def register(self, router: APIRouter) -> None:
        settings = self._settings
        # No `from __future__ import annotations` in this module, deliberately: the route
        # below annotates its dependency with a local name, and a postponed annotation is a
        # string FastAPI resolves against module globals — where a local is not. The symptom
        # is a 422 naming a query parameter nobody declared, which is `presentation/
        # model_connections.py`'s arrangement exactly, and it has no such import either.
        dependency = Depends(self._connection)

        def get_lab_status(
            connection: Annotated[ResolvedConnection, dependency],
        ) -> LabStatusResponse:
            return read_lab_status(settings, connection)

        router.add_api_route(
            "/lab-status",
            get_lab_status,
            methods=["GET"],
            response_model=LabStatusResponse,
            operation_id="getLabStatus",
            summary="Report what this lab can reach and what it exports",
            description=(
                "Whether this lab can reach a model provider right now, which of four "
                "answers is in force for the model connection — a saved connection, a saved "
                "connection whose key cannot be decrypted, the environment bootstrap, or "
                "neither — the model name the POC's conversation routes would reach for, and "
                "whether traces are exported anywhere. Answered per request, so a connection "
                "saved from the settings page changes it without a restart. Reports no fact "
                "about any credential beyond the run mode and the source, and never the "
                "exporter endpoint."
            ),
        )


__all__ = ["LabRunMode", "LabStatusResponse", "LabStatusRoutes", "read_lab_status"]
