"""Shared scenario builders for the domain, payload, service, and API tests.

Each factory returns something with no publish-gate errors, so a test breaks exactly one rule
at a time and the finding it asserts is the only one it could have caused.
"""

from uuid import UUID

from block_factories import publishable_mutation, publishable_objective
from capability_lab.domain.blocks import ObjectiveSeverity
from capability_lab.domain.scenario import (
    BlockTemplate,
    BoundMutation,
    BoundObjective,
    CompletionConditions,
    ContextDocument,
    ScenarioAuthoringContext,
    ScenarioBinding,
    ScenarioPayload,
)
from capability_lab.domain.shop import ShopDocumentKind

TICKET_ID = UUID("6b0f9c1e-49d1-4c9f-8b0c-1f6d1c2f9a01")
CUSTOMER_ID = UUID("0a1a1e1c-6f4c-4a1b-9a5d-6f5b4f2ac101")
ORDER_ID = UUID("2f8c2b60-9d3d-4a77-9f31-1c7f0f3c9a42")
READ_BLOCK_ID = UUID("a1c31b6e-5f0d-4f1e-9b5a-2c4e6f8a0b11")
MUTATION_BLOCK_ID = UUID("b2d42c7f-6a1e-4a2f-8c6b-3d5f7a9b1c22")

POLICY_REFERENCE = "policy:address-change"
GUIDELINE_REFERENCE = "support_guideline:shipping-and-fulfilment"
ORDER_REFERENCE = f"order:{ORDER_ID}"


def binding(parameter: str, value: str) -> ScenarioBinding:
    return ScenarioBinding(parameter=parameter, value=value)


def read_check(
    objective_id: str = "read-address-change-policy",
    document: str = POLICY_REFERENCE,
    severity: ObjectiveSeverity = ObjectiveSeverity.REQUIRED,
) -> BoundObjective:
    """One `read-required-document` instance, bound to a shop document."""
    return BoundObjective(
        id=objective_id,
        block_id=READ_BLOCK_ID,
        severity=severity,
        bindings=(binding("doc_ref", document),),
    )


def concurrent_mutation(mutation_id: str = "order-moves-under-the-arm") -> BoundMutation:
    """The frame-4 mutation: the order changes out of band after the first read."""
    return BoundMutation(
        id=mutation_id,
        block_id=MUTATION_BLOCK_ID,
        bindings=(
            binding("entity_ref", ORDER_REFERENCE),
            binding("timing", "after_first_read"),
        ),
    )


def publishable_scenario(**overrides: object) -> ScenarioPayload:
    """The wrong-address recipe from frame 4, reduced to what this slice authors."""
    fields: dict[str, object] = {
        "name": "Wrong shipping address",
        "ticket_id": TICKET_ID,
        "context_documents": (
            ContextDocument(kind=ShopDocumentKind.POLICY, document_id="address-change"),
            ContextDocument(
                kind=ShopDocumentKind.SUPPORT_GUIDELINE,
                document_id="shipping-and-fulfilment",
            ),
        ),
        "objectives": (
            read_check(),
            read_check(
                "read-shipping-guidelines",
                GUIDELINE_REFERENCE,
                ObjectiveSeverity.EXPECTED,
            ),
        ),
        "mutations": (concurrent_mutation(),),
        "hidden_facts": (
            "Maya does not remember which address the order used. She confirms the Lyon "
            "address if asked, and never volunteers it."
        ),
        "completion": CompletionConditions(
            statement=(
                "The order ships to the confirmed address and the customer acknowledges it."
            ),
            max_turns=12,
        ),
    }
    fields.update(overrides)
    return ScenarioPayload(**fields)  # type: ignore[arg-type]


def objective_template(**overrides: object) -> BlockTemplate:
    """`read-required-document` as the scenario's publish gate sees it."""
    payload = publishable_objective()
    fields: dict[str, object] = {
        "name": payload.name,
        "parameters": payload.parameters,
        "published": True,
    }
    fields.update(overrides)
    return BlockTemplate(**fields)  # type: ignore[arg-type]


def mutation_template(**overrides: object) -> BlockTemplate:
    """`concurrent-entity-mutation` as the scenario's publish gate sees it."""
    payload = publishable_mutation()
    fields: dict[str, object] = {
        "name": payload.name,
        "parameters": payload.parameters,
        "published": True,
    }
    fields.update(overrides)
    return BlockTemplate(**fields)  # type: ignore[arg-type]


def context(**overrides: object) -> ScenarioAuthoringContext:
    """The shop, ticket, and libraries as they currently stand around the scenario."""
    fields: dict[str, object] = {
        "ticket_in_shop": True,
        "ticket_published": True,
        "shop_published": True,
        "ticket_customer_profile_id": CUSTOMER_ID,
        "document_ids": {
            ShopDocumentKind.POLICY: frozenset({"address-change", "returns"}),
            ShopDocumentKind.SUPPORT_GUIDELINE: frozenset({"shipping-and-fulfilment"}),
            ShopDocumentKind.FAQ_ENTRY: frozenset({"delivery-times"}),
        },
        "product_handles": frozenset({"alpine-shell-jacket"}),
        "shop_order_ids": frozenset({ORDER_ID}),
        "customer_order_ids": frozenset({ORDER_ID}),
        "shop_customer_profile_ids": frozenset({CUSTOMER_ID}),
        "objective_blocks": {READ_BLOCK_ID: objective_template()},
        "mutation_blocks": {MUTATION_BLOCK_ID: mutation_template()},
    }
    fields.update(overrides)
    return ScenarioAuthoringContext(**fields)  # type: ignore[arg-type]
