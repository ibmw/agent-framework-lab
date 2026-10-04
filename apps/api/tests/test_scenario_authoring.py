"""Scenario authoring: shop scoping, derived references, and what a publication pins."""

from collections.abc import Generator
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from block_factories import publishable_objective
from capability_lab.application.scenarios import (
    ScenarioNameExistsError,
    ScenarioNotFoundError,
    ScenarioNotPublishableError,
    ScenarioTicketChangeError,
    ScenarioTicketNotInShopError,
)
from capability_lab.application.shops import ShopNotFoundError
from capability_lab.domain.blocks import ObjectiveSeverity
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.scenario import (
    BoundObjective,
    ContextDocument,
    ScenarioBinding,
    ScenarioEntityKind,
)
from capability_lab.domain.shop import ShopDocumentKind, SupportChannel
from capability_lab.domain.ticket import SuggestedDocument
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from definition_factories import publishable_profile
from shop_factories import identity
from workspace_factories import (
    GUIDELINE_REFERENCE,
    POLICY_REFERENCE,
    Workspace,
    author,
    concurrent_mutation,
    publish_prerequisites,
    publishable_payload,
    read_check,
    seed_workspace,
)


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'scenarios.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def workspace(session: Session) -> Workspace:
    return seed_workspace(session)


# -- creation --------------------------------------------------------------


def test_a_new_scenario_starts_from_the_tickets_suggested_documents(
    workspace: Workspace,
) -> None:
    """A suggestion exists so the author does not have to say it twice (ADR 0018)."""
    created = workspace.scenarios.create_scenario(
        workspace.shop_id, "Wrong shipping address", workspace.ticket_id
    )

    assert created.payload.context_document_keys == frozenset(
        {POLICY_REFERENCE, GUIDELINE_REFERENCE}
    )


def test_a_new_scenario_starts_from_a_suggestion_the_shop_no_longer_holds(
    workspace: Workspace,
) -> None:
    """The ticket's warning says an unresolved suggestion still pre-fills; this is that copy."""
    ticket = workspace.tickets.get_ticket(workspace.shop_id, workspace.ticket_id)
    workspace.tickets.replace_ticket(
        workspace.shop_id,
        workspace.ticket_id,
        replace(
            ticket.payload,
            suggested_documents=(
                *ticket.payload.suggested_documents,
                SuggestedDocument(kind=ShopDocumentKind.POLICY, document_id="address-change"),
            ),
        ),
    )

    created = workspace.scenarios.create_scenario(
        workspace.shop_id, "Wrong shipping address", workspace.ticket_id
    )
    preview = workspace.scenarios.preview_scenario(workspace.shop_id, created.definition.id)

    assert "policy:address-change" in created.payload.context_document_keys
    assert "context_document_missing_from_shop" in {
        issue.code for issue in preview.draft.validation.errors
    }


def test_a_new_scenario_is_saveable_while_it_still_asserts_nothing(
    workspace: Workspace,
) -> None:
    created = workspace.scenarios.create_scenario(
        workspace.shop_id, "Wrong shipping address", workspace.ticket_id
    )

    preview = workspace.scenarios.preview_scenario(workspace.shop_id, created.definition.id)

    assert not preview.draft.validation.publishable
    assert "scenario_without_objective" in {issue.code for issue in preview.draft.validation.errors}


def test_a_scenario_can_only_be_built_on_its_own_shops_ticket(workspace: Workspace) -> None:
    with pytest.raises(ScenarioTicketNotInShopError):
        workspace.scenarios.create_scenario(workspace.shop_id, "Elsewhere", uuid4())


def test_a_second_scenario_cannot_take_a_live_name(workspace: Workspace) -> None:
    workspace.scenarios.create_scenario(workspace.shop_id, "Wrong address", workspace.ticket_id)

    with pytest.raises(ScenarioNameExistsError):
        workspace.scenarios.create_scenario(workspace.shop_id, "Wrong address", workspace.ticket_id)


def test_creating_inside_an_unknown_shop_names_the_shop(workspace: Workspace) -> None:
    with pytest.raises(ShopNotFoundError):
        workspace.scenarios.create_scenario(uuid4(), "Wrong address", workspace.ticket_id)


# -- editing ---------------------------------------------------------------


def test_a_scenario_cannot_be_rebuilt_on_a_different_ticket(workspace: Workspace) -> None:
    scenario_id = author(workspace)
    other = workspace.tickets.create_ticket(
        workspace.shop_id,
        "T-205",
        "Damaged delivery",
        workspace.customer_id,
        SupportChannel.CHAT,
    )

    with pytest.raises(ScenarioTicketChangeError):
        workspace.scenarios.replace_scenario(
            workspace.shop_id,
            scenario_id,
            publishable_payload(workspace, ticket_id=other.definition.id),
        )


def test_the_references_follow_the_payload_rather_than_being_tracked_beside_it(
    workspace: Workspace,
) -> None:
    """Dropping the last instance of a template stops referencing it."""
    scenario_id = author(workspace, mutations=(concurrent_mutation(workspace),))
    with_mutation = workspace.scenarios.get_scenario(workspace.shop_id, scenario_id)
    assert {reference.definition_type for reference in with_mutation.draft.references} == {
        DefinitionType.TICKET,
        DefinitionType.OBJECTIVE_BLOCK,
        DefinitionType.MUTATION_BLOCK,
    }

    without_mutation = workspace.scenarios.replace_scenario(
        workspace.shop_id, scenario_id, publishable_payload(workspace)
    )

    assert {reference.definition_type for reference in without_mutation.draft.references} == {
        DefinitionType.TICKET,
        DefinitionType.OBJECTIVE_BLOCK,
    }


def test_a_draft_edit_never_touches_a_published_version(workspace: Workspace) -> None:
    publish_prerequisites(workspace)
    scenario_id = author(workspace)
    published = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)

    workspace.scenarios.replace_scenario(
        workspace.shop_id,
        scenario_id,
        publishable_payload(workspace, hidden_facts="Maya volunteers nothing at all."),
    )

    frozen = workspace.scenarios.get_scenario_version(workspace.shop_id, scenario_id, 1)
    assert frozen.payload == published.payload
    assert (
        workspace.scenarios.get_scenario(workspace.shop_id, scenario_id).payload.hidden_facts
        == "Maya volunteers nothing at all."
    )


# -- publishing ------------------------------------------------------------


def test_publishing_pins_the_shop_the_ticket_and_every_template_it_composed(
    workspace: Workspace,
) -> None:
    publish_prerequisites(workspace)
    scenario_id = author(workspace, mutations=(concurrent_mutation(workspace),))

    published = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id).published

    assert published.version == 1
    assert published.shop_version == 1
    assert {
        reference.definition.definition_type: reference.version
        for reference in published.references
    } == {
        DefinitionType.TICKET: 1,
        DefinitionType.OBJECTIVE_BLOCK: 1,
        DefinitionType.MUTATION_BLOCK: 1,
    }


def test_one_template_bound_twice_is_pinned_once(workspace: Workspace) -> None:
    publish_prerequisites(workspace)
    scenario_id = author(
        workspace,
        context_documents=(
            ContextDocument(kind=ShopDocumentKind.POLICY, document_id="shipping"),
            ContextDocument(kind=ShopDocumentKind.SUPPORT_GUIDELINE, document_id="escalation"),
        ),
        objectives=(
            read_check(workspace),
            read_check(
                workspace,
                "read-the-escalation-guideline",
                GUIDELINE_REFERENCE,
                ObjectiveSeverity.EXPECTED,
            ),
        ),
    )

    published = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id).published

    assert len(published.references) == 2


def test_a_template_with_no_published_version_stops_the_publication(
    workspace: Workspace,
) -> None:
    workspace.shops.publish(workspace.shop_id)
    workspace.profiles.publish(workspace.customer_id)
    workspace.tickets.publish_ticket(workspace.shop_id, workspace.ticket_id)
    scenario_id = author(workspace)

    # The gate reports it, so an author never reads a clean preview and then a refusal.
    preview = workspace.scenarios.preview_scenario(workspace.shop_id, scenario_id)
    assert "objective_block_unpublished" in {
        issue.code for issue in preview.draft.validation.errors
    }
    with pytest.raises(ScenarioNotPublishableError):
        workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)


def test_an_unpublished_ticket_is_reported_before_the_pin_step_refuses_it(
    workspace: Workspace,
) -> None:
    workspace.shops.publish(workspace.shop_id)
    workspace.objectives.publish(workspace.read_block_id)
    scenario_id = author(workspace)

    with pytest.raises(ScenarioNotPublishableError) as refusal:
        workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)

    assert "ticket_unpublished" in {issue.code for issue in refusal.value.validation.errors}


def test_republishing_an_unchanged_draft_repins_the_newest_template_version(
    workspace: Workspace,
) -> None:
    """The pins move with the library; the content fingerprint does not (ADR 0018)."""
    publish_prerequisites(workspace)
    scenario_id = author(workspace)
    first = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id).published

    workspace.objectives.replace_block(
        workspace.read_block_id, publishable_objective(statement="Read the document")
    )
    workspace.objectives.publish(workspace.read_block_id)
    second = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id).published

    assert second.version == 2
    assert second.content_fingerprint == first.content_fingerprint
    assert [reference.version for reference in second.references] == [1, 2]


def test_publishing_an_unknown_scenario_names_the_scenario(workspace: Workspace) -> None:
    with pytest.raises(ScenarioNotFoundError):
        workspace.scenarios.publish_scenario(workspace.shop_id, uuid4())


# -- shop isolation --------------------------------------------------------


def test_another_shops_scenario_is_simply_not_found(session: Session) -> None:
    first = seed_workspace(session)
    scenario_id = author(first)
    other_shop = first.shops.create_shop(
        identity(name="Second Shop", slug="second-shop")
    ).definition.id

    with pytest.raises(ScenarioNotFoundError):
        first.scenarios.get_scenario(other_shop, scenario_id)


# -- the resolved-state preview --------------------------------------------


def test_the_resolved_preview_names_every_version_a_publication_would_pin(
    workspace: Workspace,
) -> None:
    publish_prerequisites(workspace)
    scenario_id = author(workspace, mutations=(concurrent_mutation(workspace),))

    resolution = workspace.scenarios.preview_scenario(workspace.shop_id, scenario_id).resolution

    assert resolution.shop_version == 1
    assert resolution.ticket_version == 1
    assert resolution.ticket_reference == "T-204"
    assert resolution.customer_profile_id == workspace.customer_id
    assert {template.name: template.version for template in resolution.templates} == {
        "read-required-document": 1,
        "concurrent-entity-mutation": 1,
    }
    assert [document.title for document in resolution.documents] == ["Shipping policy"]
    order = next(
        entity for entity in resolution.entities if entity.kind is ScenarioEntityKind.ORDER
    )
    assert order.resolved
    assert order.label == "NS-10482"


def test_an_unpublished_target_resolves_to_no_version_rather_than_a_guess(
    workspace: Workspace,
) -> None:
    created = workspace.scenarios.create_scenario(
        workspace.shop_id, "Wrong shipping address", workspace.ticket_id
    )

    resolution = workspace.scenarios.preview_scenario(
        workspace.shop_id, created.definition.id
    ).resolution

    assert resolution.shop_version is None
    assert resolution.ticket_version is None
    assert resolution.customer_profile_version is None


def test_an_unresolvable_reference_never_raises_while_reading(workspace: Workspace) -> None:
    """A gone target is a publish-gate finding, not a crash in the workspace."""
    scenario_id = author(
        workspace,
        objectives=(
            BoundObjective(
                id="orphan",
                block_id=uuid4(),
                bindings=(ScenarioBinding(parameter="doc_ref", value=POLICY_REFERENCE),),
            ),
        ),
    )

    preview = workspace.scenarios.preview_scenario(workspace.shop_id, scenario_id)

    assert "objective_block_missing" in {issue.code for issue in preview.draft.validation.errors}
    assert preview.resolution.templates[0].name == "Unknown template"


# -- the editor's pickers and the index ------------------------------------


def test_the_pickers_offer_only_what_the_publish_gate_would_accept(
    workspace: Workspace,
) -> None:
    scenario_id = author(workspace)

    resources = workspace.scenarios.scenario_resources(workspace.shop_id, scenario_id)

    assert [order.order_id for order in resources.orders] == [workspace.order_id]
    assert [customer.profile_id for customer in resources.customers] == [workspace.customer_id]
    assert {
        f"{document.kind.value}:{document.document_id}" for document in resources.documents
    } == {POLICY_REFERENCE, GUIDELINE_REFERENCE, "faq_entry:delivery"}
    read_option = next(
        option for option in resources.objective_blocks if option.name == "read-required-document"
    )
    # The parameters travel with the option: binding is the editor's whole job.
    assert [parameter.name for parameter in read_option.parameters] == ["doc_ref", "severity"]
    assert read_option.latest_published_version is None


def test_listing_shows_the_ticket_and_customer_behind_each_recipe(
    workspace: Workspace,
) -> None:
    author(workspace)

    (summary,) = workspace.scenarios.list_scenarios(workspace.shop_id)

    assert summary.ticket_reference == "T-204"
    assert summary.customer_display_name == publishable_profile().identity.display_name
    assert summary.objective_count == 1
    assert summary.latest_published_version is None
