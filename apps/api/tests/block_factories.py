"""Shared objective- and mutation-block fixtures for the block-library test modules.

Each factory returns something with no publish-gate errors, so a test breaks exactly one
rule at a time and the finding it asserts is the only one it could have caused.
"""

from capability_lab.domain.blocks import (
    BlockParameter,
    BlockParameterKind,
    MutationBlockPayload,
    MutationEffect,
    ObjectiveAssessment,
    ObjectiveBlockPayload,
    ObjectiveEvidence,
)


def parameter(name: str = "doc_ref", **overrides: object) -> BlockParameter:
    fields: dict[str, object] = {
        "name": name,
        "kind": BlockParameterKind.DOCUMENT_REFERENCE,
        "description": "The shop document the arm has to read.",
        "required": True,
        "default": None,
    }
    fields.update(overrides)
    return BlockParameter(**fields)  # type: ignore[arg-type]


def severity_parameter(name: str = "severity", **overrides: object) -> BlockParameter:
    """The read-check's second parameter: a literal, so it may carry a default."""
    fields: dict[str, object] = {
        "kind": BlockParameterKind.SEVERITY,
        "description": "Whether missing the read fails the objective or only warns.",
        "default": "required",
    }
    fields.update(overrides)
    return parameter(name, **fields)


def timing_parameter(name: str = "timing", **overrides: object) -> BlockParameter:
    fields: dict[str, object] = {
        "kind": BlockParameterKind.TIMING,
        "description": "When the runtime injects the mutation.",
        "default": "after_first_read",
    }
    fields.update(overrides)
    return parameter(name, **fields)


def publishable_objective(**overrides: object) -> ObjectiveBlockPayload:
    """The read-required-document template from frame 4a."""
    fields: dict[str, object] = {
        "name": "read-required-document",
        "statement": "Read document",
        "description": (
            "Passes when the arm reads the bound document through its tool before the run "
            "completes. The evidence is the recorded tool event whose result carries the "
            "document reference; nothing is inferred from the conversation text."
        ),
        "assessment": ObjectiveAssessment.DETERMINISTIC,
        "evidence": ObjectiveEvidence.EVENT,
        "parameters": (parameter(), severity_parameter()),
    }
    fields.update(overrides)
    return ObjectiveBlockPayload(**fields)  # type: ignore[arg-type]


def publishable_mutation(**overrides: object) -> MutationBlockPayload:
    """The concurrent-entity-mutation template from frame 4b."""
    fields: dict[str, object] = {
        "name": "concurrent-entity-mutation",
        "statement": "Concurrent mutation of",
        "description": (
            "Mutates the bound entity out of band at the bound moment, bumping its version "
            "so the arm's next write hits an optimistic-concurrency conflict."
        ),
        "effect": MutationEffect.ENTITY_MUTATION,
        "parameters": (
            parameter(
                "entity_ref",
                kind=BlockParameterKind.ENTITY_REFERENCE,
                description="The order or customer that moves under the arm.",
            ),
            timing_parameter(),
        ),
    }
    fields.update(overrides)
    return MutationBlockPayload(**fields)  # type: ignore[arg-type]
