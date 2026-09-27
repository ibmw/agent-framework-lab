"""Ticket authoring: shop scoping, the derived customer reference, and what a publish pins."""

from collections.abc import Generator
from dataclasses import dataclass, replace
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from capability_lab.application.customer_profiles import CustomerProfileService
from capability_lab.application.order_fixtures import (
    OrderFixtureService,
)
from capability_lab.application.shop_documents import ShopDocumentOption
from capability_lab.application.shops import ShopNotFoundError, ShopService
from capability_lab.application.tickets import (
    TicketCustomerChangeError,
    TicketCustomerNotInShopError,
    TicketNotFoundError,
    TicketNotPublishableError,
    TicketProductOption,
    TicketReferenceExistsError,
    TicketService,
)
from capability_lab.domain.definitions import DefinitionType, DefinitionValidation
from capability_lab.domain.shop import FaqEntry, ShopDocumentKind, SupportChannel
from capability_lab.domain.ticket import (
    SuggestedDocument,
    SuggestedDocumentKind,
    TicketOrigin,
    TicketOriginKind,
    TicketPayload,
    TicketStatus,
)
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    shop_repository,
)
from definition_factories import customer_identity
from shop_factories import identity, product, publishable_shop
from ticket_factories import message, prior_history
from workspace_factories import (
    AdvancingClock,
    build_orders,
    build_profiles,
    build_tickets,
    profile_with_two_addresses,
    seed_order,
)


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'tickets.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@dataclass(frozen=True, slots=True)
class Workspace:
    """A shop with a catalog, one attached customer with an order, and the ticket service."""

    tickets: TicketService
    shops: ShopService
    profiles: CustomerProfileService
    orders: OrderFixtureService
    shop_id: UUID
    customer_id: UUID
    order_id: UUID


def seed_workspace(session: Session) -> Workspace:
    shops = ShopService(shop_repository(session), AdvancingClock())
    shop_id = shops.create_shop(identity()).definition.id
    shops.replace_draft(shop_id, publishable_shop())
    profiles = build_profiles(session)
    profile = profiles.create_profile(customer_identity(), "2024-03-14", shop_id=shop_id)
    profiles.replace_draft(profile.definition.id, profile_with_two_addresses())
    orders = build_orders(session)
    order_id = seed_order(orders, shop_id, profile.definition.id)
    return Workspace(
        tickets=build_tickets(session),
        shops=shops,
        profiles=profiles,
        orders=orders,
        shop_id=shop_id,
        customer_id=profile.definition.id,
        order_id=order_id,
    )


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


def codes(validation: DefinitionValidation) -> set[str]:
    return {issue.code for issue in validation.issues}


def create_ticket(workspace: Workspace, reference: str = "T-204") -> UUID:
    return workspace.tickets.create_ticket(
        workspace.shop_id,
        reference,
        "Wrong address concern",
        workspace.customer_id,
        SupportChannel.CHAT,
    ).definition.id


def wrong_address_ticket(workspace: Workspace, **overrides: object) -> TicketPayload:
    """The complete incident: opened from the order page, linking the stale-address order."""
    fields: dict[str, object] = {
        "reference": "T-204",
        "subject": "Wrong address concern",
        "customer_profile_id": workspace.customer_id,
        "channel": SupportChannel.CHAT,
        "status": TicketStatus.OPEN,
        "origin": TicketOrigin(kind=TicketOriginKind.ORDER_PAGE, order_id=workspace.order_id),
        "tags": ("address-change",),
        "history": prior_history(),
        "trigger": message(),
        "linked_order_ids": (workspace.order_id,),
        "suggested_documents": (
            SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id="shipping"),
        ),
    }
    fields.update(overrides)
    return TicketPayload(**fields)  # type: ignore[arg-type]


def publish_shop_and_customer(workspace: Workspace) -> None:
    workspace.shops.publish(workspace.shop_id)
    workspace.profiles.publish(workspace.customer_id)


# -- creation and scoping -----------------------------------------------------


def test_a_new_ticket_starts_incomplete_and_scoped_to_its_shop(workspace: Workspace) -> None:
    record = workspace.tickets.create_ticket(
        workspace.shop_id,
        "T-204",
        "Wrong address concern",
        workspace.customer_id,
        SupportChannel.CHAT,
    )

    assert record.payload.trigger is None
    assert record.draft.shop is not None
    assert record.draft.shop.id == workspace.shop_id
    preview = workspace.tickets.preview_ticket(workspace.shop_id, record.definition.id)
    assert not preview.validation.publishable
    assert "ticket_without_trigger" in {issue.code for issue in preview.validation.issues}


def test_the_customer_becomes_a_pinned_reference_on_the_draft(workspace: Workspace) -> None:
    """The reference is derived from the payload, so there is one truth about the customer."""
    record = workspace.tickets.get_ticket(workspace.shop_id, create_ticket(workspace))

    assert [target.definition_type for target in record.draft.references] == [
        DefinitionType.CUSTOMER_PROFILE
    ]
    assert record.draft.references[0].id == workspace.customer_id


def test_a_ticket_can_only_be_opened_for_a_customer_this_shop_uses(
    workspace: Workspace, session: Session
) -> None:
    stranger = build_profiles(session).create_profile(customer_identity(), "2024-01-01")

    with pytest.raises(TicketCustomerNotInShopError, match="not attached to shop"):
        workspace.tickets.create_ticket(
            workspace.shop_id, "T-999", "Other", stranger.definition.id, SupportChannel.CHAT
        )


def test_a_reference_names_one_ticket_per_shop(workspace: Workspace) -> None:
    create_ticket(workspace)

    with pytest.raises(TicketReferenceExistsError, match="already uses the reference T-204"):
        create_ticket(workspace)


def test_two_shops_may_each_have_a_ticket_named_the_same(
    workspace: Workspace, session: Session
) -> None:
    create_ticket(workspace)
    other = seed_workspace(session)

    assert create_ticket(other) is not None
    assert [summary.reference for summary in workspace.tickets.list_tickets(workspace.shop_id)] == [
        "T-204"
    ]


def test_a_ticket_of_another_shop_is_not_found_here(workspace: Workspace, session: Session) -> None:
    other = seed_workspace(session)
    ticket_id = create_ticket(other)

    with pytest.raises(TicketNotFoundError, match="has no ticket"):
        workspace.tickets.get_ticket(workspace.shop_id, ticket_id)


def test_an_unknown_shop_is_refused_before_any_ticket_is_looked_for(
    workspace: Workspace,
) -> None:
    with pytest.raises(ShopNotFoundError):
        workspace.tickets.list_tickets(uuid4())


# -- editing ------------------------------------------------------------------


def test_the_whole_draft_is_replaced_and_survives_a_new_session(
    tmp_path: Path,
) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'durable.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as first:
        workspace = seed_workspace(first)
        ticket_id = create_ticket(workspace)
        workspace.tickets.replace_ticket(
            workspace.shop_id, ticket_id, wrong_address_ticket(workspace)
        )
        shop_id = workspace.shop_id

    with session_scope(factory) as second:
        reloaded = build_tickets(second).get_ticket(shop_id, ticket_id)

    assert reloaded.payload.trigger is not None
    assert reloaded.payload.trigger.id == "trigger"
    assert reloaded.payload.linked_order_ids != ()


def test_a_ticket_cannot_be_moved_to_another_customer(
    workspace: Workspace, session: Session
) -> None:
    ticket_id = create_ticket(workspace)
    other = build_profiles(session).create_profile(
        customer_identity(email="other@example.org"), "2024-01-01", shop_id=workspace.shop_id
    )

    with pytest.raises(TicketCustomerChangeError, match="cannot be changed"):
        workspace.tickets.replace_ticket(
            workspace.shop_id,
            ticket_id,
            wrong_address_ticket(workspace, customer_profile_id=other.definition.id),
        )


def test_renaming_a_ticket_to_a_taken_reference_is_refused(workspace: Workspace) -> None:
    ticket_id = create_ticket(workspace)
    create_ticket(workspace, "T-187")

    with pytest.raises(TicketReferenceExistsError):
        workspace.tickets.replace_ticket(
            workspace.shop_id, ticket_id, wrong_address_ticket(workspace, reference="T-187")
        )


def test_keeping_its_own_reference_is_not_a_conflict(workspace: Workspace) -> None:
    ticket_id = create_ticket(workspace)

    record = workspace.tickets.replace_ticket(
        workspace.shop_id, ticket_id, wrong_address_ticket(workspace)
    )

    assert record.payload.reference == "T-204"


# -- the shop-aware publish gate ----------------------------------------------


def test_the_preview_judges_the_draft_against_its_own_shop(workspace: Workspace) -> None:
    publish_shop_and_customer(workspace)
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))

    preview = workspace.tickets.preview_ticket(workspace.shop_id, ticket_id)

    assert preview.validation.publishable
    assert preview.next_version == 1


def test_a_channel_the_shop_stopped_offering_blocks_publication(workspace: Workspace) -> None:
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(
        workspace.shop_id,
        ticket_id,
        wrong_address_ticket(workspace, channel=SupportChannel.EMAIL),
    )

    preview = workspace.tickets.preview_ticket(workspace.shop_id, ticket_id)

    assert "channel_not_offered_by_shop" in {issue.code for issue in preview.validation.issues}


def test_deleting_the_linked_order_turns_the_ticket_into_an_error(
    workspace: Workspace,
) -> None:
    """A ticket holds an identifier, not a frozen copy, so a dangling link cannot be published."""
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))
    workspace.orders.delete_order(workspace.shop_id, workspace.order_id)

    preview = workspace.tickets.preview_ticket(workspace.shop_id, ticket_id)

    assert "linked_order_missing_from_shop" in {issue.code for issue in preview.validation.issues}
    assert not preview.validation.publishable


def test_an_order_of_another_customer_cannot_be_linked(
    workspace: Workspace, session: Session
) -> None:
    other = build_profiles(session).create_profile(
        customer_identity(email="other@example.org"), "2024-01-01", shop_id=workspace.shop_id
    )
    build_profiles(session).replace_draft(other.definition.id, profile_with_two_addresses())
    foreign_order = seed_order(workspace.orders, workspace.shop_id, other.definition.id, "NS-20001")
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(
        workspace.shop_id,
        ticket_id,
        wrong_address_ticket(workspace, linked_order_ids=(workspace.order_id, foreign_order)),
    )

    preview = workspace.tickets.preview_ticket(workspace.shop_id, ticket_id)

    assert "linked_order_of_another_customer" in {issue.code for issue in preview.validation.issues}


def test_publication_is_refused_while_the_gate_has_errors(workspace: Workspace) -> None:
    publish_shop_and_customer(workspace)
    ticket_id = create_ticket(workspace)

    with pytest.raises(TicketNotPublishableError):
        workspace.tickets.publish_ticket(workspace.shop_id, ticket_id)


# -- what publishing pins -----------------------------------------------------


def test_publishing_pins_the_shop_and_customer_versions(workspace: Workspace) -> None:
    workspace.shops.publish(workspace.shop_id)
    workspace.profiles.publish(workspace.customer_id)
    workspace.profiles.publish(workspace.customer_id)
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))

    published = workspace.tickets.publish_ticket(workspace.shop_id, ticket_id).published

    assert published.version == 1
    assert published.shop is not None
    assert published.shop.id == workspace.shop_id
    assert published.shop_version == 1
    # The latest published customer version at publish time, never a newer one later.
    assert [reference.version for reference in published.references] == [2]


def test_an_unpublished_shop_is_a_finding_before_it_is_a_refusal(workspace: Workspace) -> None:
    """The author reads why the freeze cannot happen instead of clicking into a refusal."""
    workspace.profiles.publish(workspace.customer_id)
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))

    preview = workspace.tickets.preview_ticket(workspace.shop_id, ticket_id)

    assert "shop_unpublished" in codes(preview.validation)
    assert not preview.validation.publishable
    with pytest.raises(TicketNotPublishableError):
        workspace.tickets.publish_ticket(workspace.shop_id, ticket_id)


def test_an_unpublished_customer_is_a_finding_before_it_is_a_refusal(
    workspace: Workspace,
) -> None:
    workspace.shops.publish(workspace.shop_id)
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))

    preview = workspace.tickets.preview_ticket(workspace.shop_id, ticket_id)

    assert "customer_profile_unpublished" in codes(preview.validation)
    with pytest.raises(TicketNotPublishableError):
        workspace.tickets.publish_ticket(workspace.shop_id, ticket_id)


def test_a_published_version_stays_frozen_while_the_draft_moves_on(
    workspace: Workspace,
) -> None:
    publish_shop_and_customer(workspace)
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))
    frozen = workspace.tickets.publish_ticket(workspace.shop_id, ticket_id)

    workspace.tickets.replace_ticket(
        workspace.shop_id,
        ticket_id,
        wrong_address_ticket(workspace, subject="Something else entirely"),
    )
    reread = workspace.tickets.get_ticket_version(workspace.shop_id, ticket_id, 1)

    assert reread.payload.subject == "Wrong address concern"
    assert reread.published.content_fingerprint == frozen.published.content_fingerprint


def test_republishing_records_the_next_version(workspace: Workspace) -> None:
    publish_shop_and_customer(workspace)
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))
    workspace.tickets.publish_ticket(workspace.shop_id, ticket_id)
    workspace.tickets.replace_ticket(
        workspace.shop_id, ticket_id, wrong_address_ticket(workspace, status=TicketStatus.RESOLVED)
    )

    second = workspace.tickets.publish_ticket(workspace.shop_id, ticket_id)

    assert second.published.version == 2
    assert [
        version.version
        for version in workspace.tickets.list_ticket_versions(workspace.shop_id, ticket_id)
    ] == [2, 1]


# -- the workspace context ----------------------------------------------------


def test_the_context_carries_the_customer_the_linked_orders_and_the_pickers(
    workspace: Workspace,
) -> None:
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))

    context = workspace.tickets.ticket_context(workspace.shop_id, ticket_id)

    assert context.customer.display_name == "Maya Laurent"
    assert context.customer.order_count == 1
    assert [order.reference for order in context.linked_orders] == ["NS-10482"]
    assert context.linked_orders[0].shipping_label == "Bordeaux — previous flat"
    assert context.resources.products == (
        TicketProductOption(handle="alpine-shell-jacket", title="Alpine Shell Jacket"),
    )
    assert context.resources.channels == (SupportChannel.CHAT,)


def test_the_context_names_every_document_by_its_title_and_an_faq_entry_by_its_question(
    workspace: Workspace,
) -> None:
    ticket_id = create_ticket(workspace)

    context = workspace.tickets.ticket_context(workspace.shop_id, ticket_id)

    assert context.resources.documents == (
        ShopDocumentOption(ShopDocumentKind.POLICY, "shipping", "Shipping policy"),
        ShopDocumentOption(ShopDocumentKind.SUPPORT_GUIDELINE, "escalation", "Escalation"),
        ShopDocumentOption(ShopDocumentKind.FAQ_ENTRY, "delivery", "When does it ship?"),
    )


def test_the_titles_are_the_shop_drafts_not_its_published_version(
    workspace: Workspace,
) -> None:
    # The pickers offer what the publish gate accepts, and the gate reads the shop draft; a
    # title from the published version would name a product the draft has since renamed.
    publish_shop_and_customer(workspace)
    workspace.shops.replace_draft(
        workspace.shop_id,
        publishable_shop(
            products=(product(title="Alpine Shell Jacket II"),),
            faq=(FaqEntry(id="delivery", question="How fast is delivery?", answer="Two days."),),
        ),
    )
    ticket_id = create_ticket(workspace)

    resources = workspace.tickets.ticket_context(workspace.shop_id, ticket_id).resources

    assert [option.title for option in resources.products] == ["Alpine Shell Jacket II"]
    assert resources.documents[-1].title == "How fast is delivery?"


def test_a_reference_the_shop_draft_no_longer_holds_is_absent_from_the_titled_lists(
    workspace: Workspace,
) -> None:
    # The ticket keeps its reference — it is the author's to remove — and the context offers
    # no title for it, which is how the editor tells a resolved reference from a stale one.
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(
        workspace.shop_id,
        ticket_id,
        wrong_address_ticket(
            workspace,
            origin=TicketOrigin(
                kind=TicketOriginKind.PRODUCT_PAGE, product_handle="alpine-shell-jacket"
            ),
            suggested_documents=(
                SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id="shipping"),
                SuggestedDocument(kind=SuggestedDocumentKind.FAQ_ENTRY, document_id="delivery"),
            ),
        ),
    )
    workspace.shops.replace_draft(
        workspace.shop_id,
        publishable_shop(
            products=(product(handle="trailhead-cap", title="Trailhead Cap"),), faq=()
        ),
    )

    context = workspace.tickets.ticket_context(workspace.shop_id, ticket_id)
    ticket = workspace.tickets.get_ticket(workspace.shop_id, ticket_id).payload

    assert ticket.origin.product_handle == "alpine-shell-jacket"
    assert [option.handle for option in context.resources.products] == ["trailhead-cap"]
    assert [(entry.kind, entry.document_id) for entry in context.resources.documents] == [
        (ShopDocumentKind.POLICY, "shipping"),
        (ShopDocumentKind.SUPPORT_GUIDELINE, "escalation"),
    ]


def test_the_pickers_only_offer_this_customers_orders(
    workspace: Workspace, session: Session
) -> None:
    other = build_profiles(session).create_profile(
        customer_identity(email="other@example.org"), "2024-01-01", shop_id=workspace.shop_id
    )
    build_profiles(session).replace_draft(other.definition.id, profile_with_two_addresses())
    seed_order(workspace.orders, workspace.shop_id, other.definition.id, "NS-20001")
    ticket_id = create_ticket(workspace)

    context = workspace.tickets.ticket_context(workspace.shop_id, ticket_id)

    assert [order.order_id for order in context.resources.orders] == [workspace.order_id]


def test_the_context_lists_this_customers_other_tickets(workspace: Workspace) -> None:
    ticket_id = create_ticket(workspace)
    other_id = create_ticket(workspace, "T-187")

    context = workspace.tickets.ticket_context(workspace.shop_id, ticket_id)

    assert [summary.ticket_id for summary in context.other_tickets] == [other_id]


def test_a_dropped_link_leaves_the_panel_empty_rather_than_half_rendered(
    workspace: Workspace,
) -> None:
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))
    workspace.orders.delete_order(workspace.shop_id, workspace.order_id)

    context = workspace.tickets.ticket_context(workspace.shop_id, ticket_id)

    assert context.linked_orders == ()


# -- the index ----------------------------------------------------------------


def test_the_index_shows_the_thread_preview_and_the_customer(workspace: Workspace) -> None:
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))

    summary = workspace.tickets.list_tickets(workspace.shop_id)[0]

    assert summary.customer_display_name == "Maya Laurent"
    assert summary.preview.startswith("I just noticed this is going to my old address")
    assert summary.message_count == 3
    assert summary.opened_at == "2026-08-21T13:40:00.000000Z"


def test_a_ticket_without_a_first_message_says_so_in_the_index(workspace: Workspace) -> None:
    create_ticket(workspace)

    assert workspace.tickets.list_tickets(workspace.shop_id)[0].preview == "No first message yet"


def test_the_index_reports_publication_provenance(workspace: Workspace) -> None:
    publish_shop_and_customer(workspace)
    ticket_id = create_ticket(workspace)
    workspace.tickets.replace_ticket(workspace.shop_id, ticket_id, wrong_address_ticket(workspace))
    workspace.tickets.publish_ticket(workspace.shop_id, ticket_id)

    summary = workspace.tickets.list_tickets(workspace.shop_id)[0]

    assert summary.latest_published_version == 1
    assert summary.published_version_count == 1


def test_replacing_a_draft_never_touches_the_record_it_was_created_at(
    workspace: Workspace,
) -> None:
    ticket_id = create_ticket(workspace)
    created = workspace.tickets.get_ticket(workspace.shop_id, ticket_id)

    updated = workspace.tickets.replace_ticket(
        workspace.shop_id, ticket_id, wrong_address_ticket(workspace)
    )

    assert updated.created_at == created.created_at
    assert updated.updated_at > created.updated_at
    assert replace(updated, updated_at=created.updated_at).created_at == created.created_at
