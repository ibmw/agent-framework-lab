"""The wrong-address incident, declared once and run offline by every framework.

Two modules that must stay apart. `incident` says what the agent decides and imports no
SDK; `runtimes` says how each framework's own provider-neutral seam is told. Keeping the
declaration free of both SDKs is what makes "the two arms followed the same script" a
structural fact rather than a claim about two files that happen to agree.

This is infrastructure and composition alone selects it, which is where the lab already
keeps its deterministic doubles: the declared control policy beside it in
`agents/fake`, the scripted participant driver, and the control judge. Nothing here
reaches a provider, so a lab with no credential can still take a two-arm comparison from
the trigger to the evidence — which is what `test_framework_comparison.py` asserts and
what the demo seed populates a cold database with.
"""

from capability_lab.infrastructure.agents.scripted.incident import (
    INCIDENT_REPLY,
    INCIDENT_SCRIPT,
    INCIDENT_TOOLS,
    IncidentDriver,
    IncidentStep,
    parse_result,
    wire_name,
)
from capability_lab.infrastructure.agents.scripted.runtimes import (
    INCIDENT_RUNTIMES,
    incident_runtimes,
)

__all__ = [
    "INCIDENT_REPLY",
    "INCIDENT_RUNTIMES",
    "INCIDENT_SCRIPT",
    "INCIDENT_TOOLS",
    "IncidentDriver",
    "IncidentStep",
    "incident_runtimes",
    "parse_result",
    "wire_name",
]
