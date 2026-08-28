"""Agent-configuration authoring: the world-aware publish gate and what a publish pins."""

from collections.abc import Generator
from dataclasses import dataclass, replace
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy.orm import Session

from agent_factories import READ_TOOL_NAMES, publishable_configuration
from capability_lab.application.agent_configurations import (
    AgentConfigurationNotFoundError,
    AgentConfigurationNotPublishableError,
    AgentConfigurationService,
)
from capability_lab.application.shops import ShopService
from capability_lab.application.support_identities import (
    SupportIdentityNotFoundError,
    SupportIdentityService,
)
from capability_lab.domain.agent_configuration import AgentConfigurationPayload
from capability_lab.domain.definitions import DefinitionType, DefinitionValidation
from capability_lab.domain.support_identity import SupportPermission
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import shop_repository, support_identity_repository
from definition_factories import publishable_identity, support_role
from shop_factories import identity, publishable_shop
from workspace_factories import AdvancingClock, build_agent_configurations

WRITE_TOOL = "orders.propose_address_change"


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'configurations.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@dataclass(frozen=True, slots=True)
class Lab:
    """A published shop and support identity, and the configuration service beside them."""

    configurations: AgentConfigurationService
    identities: SupportIdentityService
    shops: ShopService
    shop_id: UUID
    identity_id: UUID


def seed_lab(session: Session, *, publish_identity: bool = True) -> Lab:
    shops = ShopService(shop_repository(session), AdvancingClock())
    shop_id = shops.create_shop(identity()).definition.id
    shops.replace_draft(shop_id, publishable_shop())
    shops.publish(shop_id)

    identities = SupportIdentityService(support_identity_repository(session), AdvancingClock())
    identity_id = identities.create_identity(support_role()).definition.id
    identities.replace_draft(identity_id, publishable_identity())
    if publish_identity:
        identities.publish(identity_id)

    return Lab(
        configurations=build_agent_configurations(session),
        identities=identities,
        shops=shops,
        shop_id=shop_id,
        identity_id=identity_id,
    )


@pytest.fixture
def lab(session: Session) -> Lab:
    return seed_lab(session)


def codes(validation: DefinitionValidation) -> set[str]:
    return {issue.code for issue in validation.issues}


def author(lab: Lab, **overrides: object) -> UUID:
    created = lab.configurations.create_configuration("Frontline single agent", lab.identity_id)
    configuration_id = created.definition.id
    lab.configurations.replace_configuration(
        configuration_id,
        publishable_configuration(lab.identity_id, **overrides),
    )
    return configuration_id


# -- creation and references ----------------------------------------------------


def test_a_new_draft_can_read_the_arm_but_never_move_it() -> None:
    """Every read tool on, every write off: the safe starting point for an author."""
    payload = publishable_configuration()

    assert set(READ_TOOL_NAMES) <= set(payload.tools)
    assert WRITE_TOOL not in payload.tools


def test_creating_a_configuration_derives_the_support_identity_reference(lab: Lab) -> None:
    created = lab.configurations.create_configuration("Frontline", lab.identity_id)

    assert set(READ_TOOL_NAMES) == set(created.payload.tools)
    assert [reference.definition_type for reference in created.draft.references] == [
        DefinitionType.SUPPORT_IDENTITY
    ]
    assert created.draft.references[0].id == lab.identity_id
    assert created.draft.shop is None


def test_a_configuration_cannot_name_a_support_identity_that_does_not_exist(lab: Lab) -> None:
    """The refusal names the identity, not the configuration that was never created."""
    with pytest.raises(SupportIdentityNotFoundError, match="support identity"):
        lab.configurations.create_configuration("Frontline", uuid4())


def test_changing_the_identity_moves_the_reference_with_the_payload(lab: Lab) -> None:
    """Unlike a ticket's customer, the identity an agent adopts is an ordinary edit."""
    other_id = lab.identities.create_identity(support_role(name="Nadia")).definition.id
    lab.identities.replace_draft(other_id, publishable_identity())
    configuration_id = author(lab)

    record = lab.configurations.replace_configuration(
        configuration_id, publishable_configuration(other_id)
    )

    assert record.draft.references[0].id == other_id


# -- the world-aware publish gate ----------------------------------------------


def test_a_complete_configuration_publishes(lab: Lab) -> None:
    configuration_id = author(lab)
    preview = lab.configurations.preview_configuration(configuration_id)

    assert preview.draft.validation.publishable

    published = lab.configurations.publish(configuration_id)

    assert published.published.version == 1
    assert published.published.references[0].version == 1
    assert published.published.shop is None


def test_publication_refuses_a_framework_the_lab_cannot_run(lab: Lab) -> None:
    configuration_id = author(lab, framework_id="langgraph")

    with pytest.raises(AgentConfigurationNotPublishableError) as refused:
        lab.configurations.publish(configuration_id)

    assert "framework_not_proven" in codes(refused.value.validation)


def test_publication_refuses_a_tool_the_lab_does_not_publish(lab: Lab) -> None:
    configuration_id = author(lab, tools=("orders.refund_everything",))

    assert "tool_not_published" in codes(
        lab.configurations.preview_configuration(configuration_id).draft.validation
    )


def test_publication_refuses_a_write_the_identity_may_never_use(session: Session) -> None:
    """A tool an agent would be refused at its first call is a configuration error now."""
    lab = seed_lab(session)
    read_only = publishable_identity(
        permissions=(SupportPermission.READ_ORDERS, SupportPermission.READ_POLICIES)
    )
    lab.identities.replace_draft(lab.identity_id, read_only)
    lab.identities.publish(lab.identity_id)
    configuration_id = author(lab, tools=(*READ_TOOL_NAMES, WRITE_TOOL))

    with pytest.raises(AgentConfigurationNotPublishableError) as refused:
        lab.configurations.publish(configuration_id)

    issue = next(
        issue
        for issue in refused.value.validation.errors
        if issue.code == "tool_without_permission"
    )
    assert SupportPermission.CHANGE_SHIPPING_ADDRESS.value in issue.message


def test_an_identity_that_may_write_without_a_tool_that_could_is_only_a_warning(lab: Lab) -> None:
    """One warning per uncovered permission, so a half-covered identity still warns."""
    validation = lab.configurations.preview_configuration(author(lab)).draft.validation
    warnings = [issue for issue in validation.warnings if issue.code == "permission_without_tool"]

    assert validation.publishable
    assert len(warnings) == 1
    assert SupportPermission.CHANGE_SHIPPING_ADDRESS.value in warnings[0].message


def test_enabling_the_tool_a_granted_permission_pays_for_silences_the_warning(
    session: Session,
) -> None:
    lab = seed_lab(session)
    configuration_id = author(lab, tools=(*READ_TOOL_NAMES, WRITE_TOOL))
    validation = lab.configurations.preview_configuration(configuration_id).draft.validation

    assert validation.publishable
    assert "permission_without_tool" not in {issue.code for issue in validation.issues}


def test_publication_refuses_an_identity_with_no_published_version(session: Session) -> None:
    lab = seed_lab(session, publish_identity=False)
    configuration_id = author(lab)

    with pytest.raises(AgentConfigurationNotPublishableError) as refused:
        lab.configurations.publish(configuration_id)

    assert "support_identity_unpublished" in codes(refused.value.validation)


# -- preview resolution ---------------------------------------------------------


def resolved(lab: Lab, configuration_id: UUID) -> dict[str, str | None]:
    resolution = lab.configurations.preview_configuration(
        configuration_id, preview_shop_id=lab.shop_id
    ).resolution
    return {entry.variable.name: entry.value for entry in resolution.variables}


def test_the_preview_resolves_every_variable_against_the_chosen_shop(lab: Lab) -> None:
    configuration_id = author(lab)
    values = resolved(lab, configuration_id)

    assert values["shop.name"] == publishable_shop().identity.name
    assert values["shop.tone_of_voice"] == publishable_shop().tone_of_voice_guidelines[0].name
    assert values["support_identity.role"] == publishable_identity().role.title


def test_a_published_identity_with_no_guidance_resolves_to_empty_text_not_to_nothing(
    session: Session,
) -> None:
    """`None` has to keep meaning "the source is missing"; a run resolves the same way."""
    lab = seed_lab(session)
    lab.identities.replace_draft(lab.identity_id, publishable_identity(guidance=()))
    lab.identities.publish(lab.identity_id)
    values = resolved(lab, author(lab))

    assert values["support_identity.guidance"] == ""
    assert values["support_identity.role"] is not None


def test_a_fact_an_agent_must_discover_resolves_to_nothing_even_in_a_preview(lab: Lab) -> None:
    values = resolved(lab, author(lab))

    assert values["customer.name"] is None
    assert values["order.id"] is None


def test_the_preview_says_which_variables_the_prompt_actually_names(lab: Lab) -> None:
    configuration_id = author(lab, prompt="Answer for {{shop.name}}.")
    resolution = lab.configurations.preview_configuration(
        configuration_id, preview_shop_id=lab.shop_id
    ).resolution
    used = {entry.variable.name for entry in resolution.variables if entry.used}

    assert used == {"shop.name"}


def test_the_preview_reports_the_versions_a_publication_would_pin(lab: Lab) -> None:
    resolution = lab.configurations.preview_configuration(
        author(lab), preview_shop_id=lab.shop_id
    ).resolution

    assert resolution.shop_version == 1
    assert resolution.support_identity_version == 1
    assert resolution.framework_label == "Pydantic AI"


def test_without_a_preview_shop_the_shop_variables_resolve_to_nothing(lab: Lab) -> None:
    resolution = lab.configurations.preview_configuration(author(lab)).resolution
    values = {entry.variable.name: entry.value for entry in resolution.variables}

    assert values["shop.name"] is None
    assert values["support_identity.role"] is not None
    assert resolution.tone_of_voice_resolved is False


def test_the_preview_marks_a_write_tool_the_identity_could_not_use(session: Session) -> None:
    lab = seed_lab(session)
    lab.identities.replace_draft(
        lab.identity_id,
        publishable_identity(
            permissions=(SupportPermission.READ_ORDERS, SupportPermission.READ_POLICIES)
        ),
    )
    lab.identities.publish(lab.identity_id)
    resolution = lab.configurations.preview_configuration(author(lab)).resolution
    binding = next(entry for entry in resolution.tools if entry.contract.name == WRITE_TOOL)

    assert binding.permitted is False
    assert binding.enabled is False


# -- immutability and the index -------------------------------------------------


def test_a_published_version_keeps_what_it_froze_while_the_draft_moves_on(lab: Lab) -> None:
    configuration_id = author(lab)
    published = lab.configurations.publish(configuration_id)
    lab.configurations.replace_configuration(
        configuration_id,
        replace(publishable_configuration(lab.identity_id), prompt="Rewritten for {{shop.name}}."),
    )

    frozen = lab.configurations.get_version(configuration_id, 1)

    assert frozen.payload == published.payload
    assert lab.configurations.get_draft(configuration_id).payload.prompt.startswith("Rewritten")


def test_a_published_version_keeps_the_identity_version_it_pinned(lab: Lab) -> None:
    """The identity beside it can move; what the run adopts is the version frozen here."""
    configuration_id = author(lab)
    lab.configurations.publish(configuration_id)
    lab.identities.replace_draft(
        lab.identity_id, publishable_identity(role=support_role(title="Senior associate"))
    )
    lab.identities.publish(lab.identity_id)

    pinned = lab.configurations.get_version(configuration_id, 1).published.references[0]

    assert pinned.version == 1
    assert {version.version for version in lab.identities.list_versions(lab.identity_id)} == {1, 2}


def test_the_index_row_carries_what_the_studio_table_shows(lab: Lab) -> None:
    configuration_id = author(lab)
    lab.configurations.publish(configuration_id)
    row = lab.configurations.list_configurations()[0]

    assert row.configuration_id == configuration_id
    assert row.framework_label == "Pydantic AI"
    assert row.model_id == "gpt-5-mini"
    assert row.tool_count == len(READ_TOOL_NAMES)
    assert row.latest_published_version == 1


def test_the_resources_offer_only_what_a_configuration_may_name(lab: Lab) -> None:
    resources = lab.configurations.resources()

    assert [option.identity_id for option in resources.support_identities] == [lab.identity_id]
    assert [option.shop_id for option in resources.preview_shops] == [lab.shop_id]
    assert {framework.framework_id for framework in resources.frameworks} == {
        "pydantic-ai",
        "fake",
    }
    assert WRITE_TOOL in {contract.name for contract in resources.tools}


def test_reading_a_configuration_that_was_never_created_is_refused(lab: Lab) -> None:
    with pytest.raises(AgentConfigurationNotFoundError):
        lab.configurations.get_draft(uuid4())


def test_a_stored_draft_round_trips_through_the_database(lab: Lab) -> None:
    configuration_id = author(lab)
    stored = lab.configurations.get_draft(configuration_id).payload

    assert stored == publishable_configuration(lab.identity_id)
    assert isinstance(stored, AgentConfigurationPayload)
