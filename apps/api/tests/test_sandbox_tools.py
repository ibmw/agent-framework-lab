"""The versioned read tools an arm interrogates its sandbox through (ADR 0021)."""

import logging
from collections.abc import Generator, Mapping
from dataclasses import replace
from pathlib import Path
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from capability_lab.application.canonical_json import CanonicalValue, canonical_json_bytes
from capability_lab.application.sandbox_tool_contracts import (
    CATALOG_PRODUCT,
    CATALOG_SEARCH,
    CUSTOMER_PROFILE,
    INTERACTION_CONTEXT,
    ORDER_DETAIL,
    ORDER_LIST,
    READ_TOOL_CONTRACTS,
    SUPPORT_DOCUMENT,
    SUPPORT_SEARCH,
    TOOL_RESULT_CANONICAL_SCHEMA_VERSION,
    TOOL_VERSION,
)
from capability_lab.application.sandbox_tools import (
    SandboxToolContext,
    ToolCall,
    ToolNotFoundError,
    ToolOutcome,
    ToolRefusalCode,
    ToolResult,
)
from capability_lab.application.sandboxes import SandboxNotFoundError, SandboxRecord
from capability_lab.domain.order_fixture import FrozenShippingAddress, OrderFixturePayload
from capability_lab.domain.shop import PolicyDocument, PolicyKind
from capability_lab.domain.ticket import TicketOrigin, TicketOriginKind
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.presentation.tools import ToolCallResponse
from definition_factories import persona
from shop_factories import publishable_shop
from workspace_factories import (
    Workspace,
    build_sandboxes,
    build_tools,
    cloned_arm,
    frozen_starting_state,
    profile_with_two_addresses,
    seed_workspace,
)

PRODUCT_HANDLE = "alpine-shell-jacket"
ORDER_REFERENCE = "NS-10482"


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'tools.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


@pytest.fixture
def arm(session: Session, workspace: Workspace) -> SandboxRecord:
    return cloned_arm(session, workspace)


def call(
    session: Session,
    arm: SandboxRecord,
    tool: str,
    **arguments: str | None,
) -> ToolResult:
    execution = build_tools(session).execute(
        arm.shop_id,
        arm.sandbox_id,
        ToolCall(tool=tool, version=TOOL_VERSION, arguments=arguments),
    )
    return execution.result


def data(result: ToolResult) -> dict[str, CanonicalValue]:
    assert result.outcome is ToolOutcome.SUCCESS, result.refusal
    assert result.data is not None
    return result.data


def entries(result: ToolResult, key: str) -> list[dict[str, CanonicalValue]]:
    return cast("list[dict[str, CanonicalValue]]", data(result)[key])


# -- the interaction --------------------------------------------------------


def test_the_interaction_context_carries_the_thread_and_resolves_the_orders_it_names(
    session: Session, arm: SandboxRecord
) -> None:
    context = data(call(session, arm, INTERACTION_CONTEXT))

    assert context["ticket_reference"] == "T-204"
    assert context["subject"] == "Wrong address concern"
    assert context["channel"] == "chat"
    # The whole helpdesk thread the incident opens on, trigger last.
    thread = cast("list[dict[str, CanonicalValue]]", context["thread"])
    assert [message["author"] for message in thread] == ["customer"]
    # A linked order arrives as the identifier the ticket froze *and* the reference the
    # customer would quote, so "this order" needs one further call and no prompt copy.
    assert context["linked_orders"] == [
        {"order_id": str(arm.content.state.orders[0].order_id), "order_reference": ORDER_REFERENCE}
    ]


def test_a_product_page_question_resolves_this_product_through_the_catalog(
    session: Session, workspace: Workspace
) -> None:
    """The milestone's acceptance criterion, stated as two tool calls.

    The starting state names the product with a handle and nothing else; the agent reads the
    product itself from the catalog rather than from an initial prompt that embedded it.
    """
    ticket = workspace.tickets.get_ticket(workspace.shop_id, workspace.ticket_id)
    workspace.tickets.replace_ticket(
        workspace.shop_id,
        workspace.ticket_id,
        replace(
            ticket.payload,
            origin=TicketOrigin(kind=TicketOriginKind.PRODUCT_PAGE, product_handle=PRODUCT_HANDLE),
        ),
    )
    arm = cloned_arm(session, workspace)

    context = data(call(session, arm, INTERACTION_CONTEXT))
    origin = cast("dict[str, CanonicalValue]", context["origin"])
    assert origin == {
        "kind": "product_page",
        "product_handle": PRODUCT_HANDLE,
        "order_id": None,
        "order_reference": None,
    }

    product = data(call(session, arm, CATALOG_PRODUCT, handle=str(origin["product_handle"])))
    assert product["title"] == "Alpine Shell Jacket"
    assert product["price_from"] == {"amount": "249.00", "currency": "EUR"}
    variants = cast("list[dict[str, CanonicalValue]]", product["variants"])
    assert [variant["sku"] for variant in variants] == ["NS-ASJ-OB-M"]


# -- the catalog ------------------------------------------------------------


def test_searching_the_catalog_matches_a_handle_a_title_or_a_category(
    session: Session, arm: SandboxRecord
) -> None:
    assert entries(call(session, arm, CATALOG_SEARCH, query="jackets"), "products") == [
        {
            "handle": PRODUCT_HANDLE,
            "title": "Alpine Shell Jacket",
            "category": "Jackets",
            "status": "active",
            "price_from": {"amount": "249.00", "currency": "EUR"},
            "in_stock": True,
        }
    ]
    # An omitted query lists the catalog rather than matching nothing.
    assert data(call(session, arm, CATALOG_SEARCH))["match_count"] == 1
    assert data(call(session, arm, CATALOG_SEARCH, query="kayak"))["match_count"] == 0


def test_reading_an_unknown_product_is_refused_rather_than_raised(
    session: Session, arm: SandboxRecord
) -> None:
    result = call(session, arm, CATALOG_PRODUCT, handle="no-such-product")

    assert result.outcome is ToolOutcome.REFUSED
    assert result.refusal is not None
    assert result.refusal.code is ToolRefusalCode.NOT_FOUND


# -- the customer -----------------------------------------------------------


def test_the_customer_tool_serves_the_address_book_but_never_the_simulation_side(
    session: Session, arm: SandboxRecord
) -> None:
    """The one visibility rule these tools have, proved on the payload that carries both.

    A `SENSITIVE` field is synthetic personal data that must stay out of logs and traces —
    serving it to the support agent is the point of the simulation. A `CUSTOMER_ONLY` field
    is what drives the simulated customer, and the support agent must never see it.
    """
    profile = data(call(session, arm, CUSTOMER_PROFILE))
    addresses = cast("list[dict[str, CanonicalValue]]", profile["addresses"])

    assert cast("dict[str, CanonicalValue]", profile["identity"])["email"] == (
        "maya.laurent@example.org"
    )
    assert [address["id"] for address in addresses] == ["home", "bordeaux-previous-flat"]
    assert [address["is_default"] for address in addresses] == [True, False]
    assert "persona" not in profile
    assert "hidden_facts" not in profile


def test_no_read_tool_discloses_a_customer_only_value(
    session: Session, workspace: Workspace
) -> None:
    """Swept across every tool, against the exact strings the classification forbids."""
    workspace.profiles.replace_draft(
        workspace.customer_id,
        replace(
            profile_with_two_addresses(),
            persona=persona(summary="SIMULATION-ONLY SUMMARY", traits=("SIMULATION-ONLY TRAIT",)),
        ),
    )
    arm = cloned_arm(session, workspace)
    forbidden = (
        "SIMULATION-ONLY SUMMARY",
        "SIMULATION-ONLY TRAIT",
        # The profile's hidden facts, authored by `publishable_profile`.
        "She believes the order already ships to Lyon",
        "The agent reads the shipping address back to her.",
    )

    served = b"".join(
        canonical_json_bytes(result.document)
        for result in (
            call(session, arm, INTERACTION_CONTEXT),
            call(session, arm, CATALOG_SEARCH),
            call(session, arm, CATALOG_PRODUCT, handle=PRODUCT_HANDLE),
            call(session, arm, CUSTOMER_PROFILE),
            call(session, arm, ORDER_LIST),
            call(session, arm, ORDER_DETAIL, order_reference=ORDER_REFERENCE),
            call(session, arm, SUPPORT_SEARCH),
            call(session, arm, SUPPORT_DOCUMENT, kind="policy", document_id="shipping"),
        )
    )

    for value in forbidden:
        assert value.encode() not in served


# -- the orders -------------------------------------------------------------


def test_an_order_is_read_by_the_reference_the_customer_quotes(
    session: Session, arm: SandboxRecord
) -> None:
    order = data(call(session, arm, ORDER_DETAIL, order_reference=ORDER_REFERENCE))

    assert order["payment_status"] == "paid"
    assert order["fulfilment_status"] == "unfulfilled"
    assert order["total"] == {"amount": "249.00", "currency": "EUR"}
    address = cast("dict[str, CanonicalValue]", order["shipping_address"])
    assert address["city"] == "Bordeaux"
    events = cast("list[dict[str, CanonicalValue]]", order["events"])
    assert [event["kind"] for event in events] == ["placed", "payment_captured"]


def test_an_order_is_read_by_the_identifier_the_interaction_carries(
    session: Session, arm: SandboxRecord
) -> None:
    order_id = arm.content.state.orders[0].order_id

    assert data(call(session, arm, ORDER_DETAIL, order_id=str(order_id)))["order_id"] == str(
        order_id
    )


def test_listing_orders_answers_with_the_customers_whole_order_set(
    session: Session, arm: SandboxRecord
) -> None:
    assert [order["reference"] for order in entries(call(session, arm, ORDER_LIST), "orders")] == [
        ORDER_REFERENCE
    ]


@pytest.mark.parametrize(
    ("arguments", "code"),
    [
        ({}, ToolRefusalCode.INVALID_ARGUMENTS),
        (
            {"order_reference": ORDER_REFERENCE, "order_id": str(uuid4())},
            ToolRefusalCode.INVALID_ARGUMENTS,
        ),
        ({"order_id": "not-an-identifier"}, ToolRefusalCode.INVALID_ARGUMENTS),
        ({"order_reference": "NS-00000"}, ToolRefusalCode.NOT_FOUND),
        ({"order_id": str(uuid4())}, ToolRefusalCode.NOT_FOUND),
    ],
)
def test_a_call_the_arm_cannot_answer_comes_back_as_a_refusal(
    session: Session,
    arm: SandboxRecord,
    arguments: Mapping[str, str],
    code: ToolRefusalCode,
) -> None:
    """Model output is refused, never raised: an agent has to be able to try again."""
    result = call(session, arm, ORDER_DETAIL, **arguments)

    assert result.outcome is ToolOutcome.REFUSED
    assert result.refusal is not None
    assert result.refusal.code is code


def test_an_argument_the_contract_does_not_declare_is_refused(
    session: Session, arm: SandboxRecord
) -> None:
    result = call(session, arm, ORDER_LIST, status="paid")

    assert result.outcome is ToolOutcome.REFUSED
    assert result.refusal is not None
    assert result.refusal.code is ToolRefusalCode.INVALID_ARGUMENTS
    assert "status" in result.refusal.message


def test_a_blank_argument_is_read_as_an_unanswered_one(
    session: Session, arm: SandboxRecord
) -> None:
    """An empty string is a model declining to fill an argument, not a value to look up."""
    result = call(session, arm, ORDER_DETAIL, order_reference=ORDER_REFERENCE, order_id="  ")

    assert result.outcome is ToolOutcome.SUCCESS
    assert result.arguments == {"order_reference": ORDER_REFERENCE}


# -- the support knowledge --------------------------------------------------


def test_the_knowledge_tools_search_and_read_the_shops_three_collections(
    session: Session, arm: SandboxRecord
) -> None:
    found = entries(call(session, arm, SUPPORT_SEARCH, query="address"), "documents")
    assert [document["reference"] for document in found] == ["policy:shipping"]

    # The same reference grammar a read-check objective binds, so evidence and lookup agree.
    document = data(call(session, arm, SUPPORT_DOCUMENT, kind="policy", document_id="shipping"))
    assert document["title"] == "Shipping policy"
    assert document["body"] == "Addresses can change before dispatch."

    # An FAQ entry's question and answer are the same two ideas under different names.
    faq = data(call(session, arm, SUPPORT_DOCUMENT, kind="faq_entry", document_id="delivery"))
    assert faq["title"] == "When does it ship?"
    assert faq["body"] == "Two days."


def test_a_knowledge_search_can_be_restricted_to_one_collection(
    session: Session, arm: SandboxRecord
) -> None:
    guidelines = entries(call(session, arm, SUPPORT_SEARCH, kind="support_guideline"), "documents")

    assert [document["reference"] for document in guidelines] == ["support_guideline:escalation"]


def test_a_kind_outside_the_contracts_choices_is_refused(
    session: Session, arm: SandboxRecord
) -> None:
    result = call(session, arm, SUPPORT_DOCUMENT, kind="tone_of_voice", document_id="warm")

    assert result.outcome is ToolOutcome.REFUSED
    assert result.refusal is not None
    assert result.refusal.code is ToolRefusalCode.INVALID_ARGUMENTS


# -- what a tool reads ------------------------------------------------------


def test_a_tool_reads_the_arm_it_was_given_and_never_the_arm_beside_it(
    session: Session, workspace: Workspace
) -> None:
    """The isolation claim of ADR 0020, made visible through the tools that will use it."""
    snapshot = frozen_starting_state(session, workspace)
    sandboxes = build_sandboxes(session)
    left = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm A")
    right = sandboxes.clone(workspace.shop_id, snapshot.snapshot_id, "Arm B")
    order = left.content.state.orders[0]
    sandboxes.apply_order_change(
        workspace.shop_id,
        left.sandbox_id,
        order.order_id,
        moved_to_lyon(order.payload),
        expected_revision=left.revision,
    )

    def city(arm: SandboxRecord) -> CanonicalValue:
        order = data(call(session, arm, ORDER_DETAIL, order_reference=ORDER_REFERENCE))
        return cast("dict[str, CanonicalValue]", order["shipping_address"])["city"]

    assert city(left) == "Lyon"
    assert city(right) == "Bordeaux"


def test_a_tool_reads_the_version_the_snapshot_pinned_not_the_draft_that_moved_on(
    session: Session, workspace: Workspace
) -> None:
    arm = cloned_arm(session, workspace)
    workspace.shops.replace_draft(
        workspace.shop_id,
        replace(
            publishable_shop(),
            policies=(
                PolicyDocument(
                    id="shipping",
                    title="Shipping policy",
                    kind=PolicyKind.SHIPPING,
                    body="Addresses can no longer change after checkout.",
                ),
            ),
        ),
    )
    workspace.shops.publish(workspace.shop_id)

    document = data(call(session, arm, SUPPORT_DOCUMENT, kind="policy", document_id="shipping"))

    assert document["body"] == "Addresses can change before dispatch."


def test_reading_a_sandbox_of_another_shop_is_not_found(
    session: Session, arm: SandboxRecord
) -> None:
    with pytest.raises(SandboxNotFoundError):
        build_tools(session).execute(
            uuid4(),
            arm.sandbox_id,
            ToolCall(tool=ORDER_LIST, version=TOOL_VERSION),
        )


# -- the contract itself ----------------------------------------------------


def test_a_result_is_canonical_and_the_same_call_answers_with_the_same_bytes(
    session: Session, arm: SandboxRecord
) -> None:
    """What Milestone 5's evidence rests on: one call, one document, one set of bytes."""
    first = call(session, arm, ORDER_DETAIL, order_reference=ORDER_REFERENCE)
    second = call(session, arm, ORDER_DETAIL, order_reference=ORDER_REFERENCE)

    assert canonical_json_bytes(first.document) == canonical_json_bytes(second.document)
    assert first.document["canonical_schema_version"] == TOOL_RESULT_CANONICAL_SCHEMA_VERSION
    assert first.document["outcome"] == "success"
    assert first.document["refusal"] is None
    assert first.document["arguments"] == {"order_reference": ORDER_REFERENCE}


def test_the_execution_reports_where_the_arm_stood_when_it_answered(
    session: Session, arm: SandboxRecord
) -> None:
    execution = build_tools(session).execute(
        arm.shop_id, arm.sandbox_id, ToolCall(tool=ORDER_LIST, version=TOOL_VERSION)
    )

    assert execution.revision == 0
    assert execution.state_fingerprint == arm.state_fingerprint


@pytest.mark.parametrize(
    ("tool", "version"),
    [("orders.read_everything", TOOL_VERSION), (ORDER_LIST, "v99")],
)
def test_an_unpublished_tool_or_version_is_a_contract_error_not_a_refusal(
    session: Session, arm: SandboxRecord, tool: str, version: str
) -> None:
    """A name nothing publishes is a client reading a contract that no longer says that."""
    with pytest.raises(ToolNotFoundError):
        build_tools(session).execute(
            arm.shop_id, arm.sandbox_id, ToolCall(tool=tool, version=version)
        )


def test_a_broken_handler_fails_the_call_without_describing_itself(
    session: Session, arm: SandboxRecord, caplog: pytest.LogCaptureFixture
) -> None:
    """A bug in the lab must not end a run, and must not leak into a transcript either.

    The operator is not left with nothing, though: the log says which tool broke and which
    exception type broke it. What it never says is what the exception said — the same
    discipline the sanitized spans keep, where an error is `error.type` and never its text.
    """

    def broken(
        context: SandboxToolContext, arguments: Mapping[str, str]
    ) -> dict[str, CanonicalValue]:
        raise RuntimeError("connection string postgres://secret@host/db")

    service = build_tools(
        session, handlers={contract.name: broken for contract in READ_TOOL_CONTRACTS}
    )

    with caplog.at_level(logging.ERROR):
        result = service.execute(
            arm.shop_id, arm.sandbox_id, ToolCall(tool=ORDER_LIST, version=TOOL_VERSION)
        ).result

    assert result.outcome is ToolOutcome.FAILED
    assert result.refusal is None
    assert b"secret" not in canonical_json_bytes(result.document)

    assert ORDER_LIST in caplog.text
    assert "RuntimeError" in caplog.text
    assert "secret" not in caplog.text


def test_the_response_envelope_is_the_canonical_document_plus_its_provenance(
    session: Session, arm: SandboxRecord
) -> None:
    """The two renderings of one result must not drift apart.

    `ToolResult.document` is what Milestone 5 will hash; `ToolCallResponse` is what a client
    reads. They describe the same answer, so a field added to one and forgotten in the other
    is a silent divergence between the evidence and the contract — this is the test that
    fails when that happens.
    """
    execution = build_tools(session).execute(
        arm.shop_id,
        arm.sandbox_id,
        ToolCall(
            tool=ORDER_DETAIL,
            version=TOOL_VERSION,
            arguments={"order_reference": ORDER_REFERENCE},
        ),
    )

    assert ToolCallResponse.from_execution(execution).model_dump(mode="json") == {
        **execution.result.document,
        "sandbox_revision": execution.revision,
        "state_fingerprint": execution.state_fingerprint,
    }


def moved_to_lyon(order: OrderFixturePayload) -> OrderFixturePayload:
    return replace(
        order,
        shipping_address=FrozenShippingAddress(
            source_address_id="home",
            source_label="Home",
            selected_at="2026-08-22T09:15:00.000000Z",
            recipient="Maya Laurent",
            line1="18 rue des Écoles",
            postal_code="69005",
            city="Lyon",
            country="FR",
        ),
    )
