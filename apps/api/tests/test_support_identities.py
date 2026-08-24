"""Support-identity service and storage: immutability, versions, and the publish gate."""

from collections.abc import Generator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from capability_lab.application.definition_resolution import PublishedVersionExistsError
from capability_lab.application.support_identities import (
    SupportIdentityNotFoundError,
    SupportIdentityNotPublishableError,
    SupportIdentityService,
    SupportIdentityVersionNotFoundError,
    SupportIdentityVersionRecord,
)
from capability_lab.application.support_identity_payload import (
    support_identity_content_fingerprint,
)
from capability_lab.domain.definitions import DefinitionType
from capability_lab.domain.support_identity import SupportPermission
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.repositories import (
    PersistedDefinitionIntegrityError,
    support_identity_repository,
)
from definition_factories import publishable_identity, support_role


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 8, 23, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


@pytest.fixture
def session(tmp_path: Path) -> Generator[Session, None, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'identities.db'}")
    Base.metadata.create_all(engine)
    with session_scope(create_session_factory(engine)) as active:
        yield active


@pytest.fixture
def service(session: Session) -> SupportIdentityService:
    return SupportIdentityService(support_identity_repository(session), AdvancingClock())


def test_a_new_identity_starts_as_one_incomplete_draft(service: SupportIdentityService) -> None:
    record = service.create_identity(support_role())

    assert record.definition.definition_type is DefinitionType.SUPPORT_IDENTITY
    assert record.payload.role == support_role()
    assert record.payload.permissions == ()


def test_an_identity_without_permissions_saves_but_refuses_to_publish(
    service: SupportIdentityService,
) -> None:
    record = service.create_identity(support_role())

    with pytest.raises(SupportIdentityNotPublishableError) as raised:
        service.publish(record.definition.id)

    assert {issue.code for issue in raised.value.validation.errors} == {
        "identity_without_permission"
    }


def test_publishing_freezes_the_granted_permissions(service: SupportIdentityService) -> None:
    record = service.create_identity(support_role())
    identity_id = record.definition.id
    service.replace_draft(identity_id, publishable_identity())
    published = service.publish(identity_id)

    service.replace_draft(
        identity_id,
        replace(publishable_identity(), permissions=(SupportPermission.READ_CATALOG,)),
    )

    frozen = service.get_version(identity_id, 1)
    assert frozen.payload == publishable_identity()
    assert published.published.content_fingerprint == support_identity_content_fingerprint(
        publishable_identity()
    )


def test_versions_increase_monotonically(service: SupportIdentityService) -> None:
    record = service.create_identity(support_role())
    identity_id = record.definition.id
    service.replace_draft(identity_id, publishable_identity())
    service.publish(identity_id)
    service.replace_draft(
        identity_id,
        replace(
            publishable_identity(),
            permissions=(
                SupportPermission.READ_ORDERS,
                SupportPermission.READ_POLICIES,
                SupportPermission.CANCEL_ORDER,
            ),
        ),
    )
    service.publish(identity_id)

    assert [published.version for published in service.list_versions(identity_id)] == [2, 1]


def test_a_preview_reports_the_permission_changes_publishing_would_freeze(
    service: SupportIdentityService,
) -> None:
    record = service.create_identity(support_role())
    identity_id = record.definition.id
    service.replace_draft(identity_id, publishable_identity())
    service.publish(identity_id)

    assert service.preview_draft(identity_id).matches_latest_published

    service.replace_draft(
        identity_id,
        replace(
            publishable_identity(),
            permissions=(*publishable_identity().permissions, SupportPermission.ISSUE_REFUND),
        ),
    )
    preview = service.preview_draft(identity_id)

    assert not preview.matches_latest_published
    assert "permissions.issue_refund" in {change.path for change in preview.changes}


def test_listing_projects_the_role_and_published_provenance(
    service: SupportIdentityService,
) -> None:
    record = service.create_identity(support_role())
    service.replace_draft(record.definition.id, publishable_identity())
    service.publish(record.definition.id)
    service.create_identity(support_role(name="Northstar tier 2"))

    rows = {row.name: row for row in service.list_identities()}

    assert rows["Northstar tier 1"].latest_published_version == 1
    assert rows["Northstar tier 1"].permission_count == 3
    assert rows["Northstar tier 1"].guidance_count == 1
    assert rows["Northstar tier 2"].latest_published_version is None


def test_an_unknown_identity_and_version_are_reported_separately(
    service: SupportIdentityService,
) -> None:
    with pytest.raises(SupportIdentityNotFoundError):
        service.get_draft(uuid4())
    with pytest.raises(SupportIdentityNotFoundError):
        service.publish(uuid4())

    record = service.create_identity(support_role())
    with pytest.raises(SupportIdentityVersionNotFoundError):
        service.get_version(record.definition.id, 2)


def test_published_content_survives_a_new_session(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'durable.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)

    with session_scope(factory) as writing:
        service = SupportIdentityService(support_identity_repository(writing), AdvancingClock())
        record = service.create_identity(support_role())
        identity_id = record.definition.id
        service.replace_draft(identity_id, publishable_identity())
        service.publish(identity_id)

    with session_scope(factory) as reading:
        reloaded = SupportIdentityService(
            support_identity_repository(reading), AdvancingClock()
        ).get_version(identity_id, 1)

    assert reloaded.payload == publishable_identity()


def test_the_storage_boundary_refuses_to_overwrite_a_published_version(tmp_path: Path) -> None:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'overwrite.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = SupportIdentityService(support_identity_repository(writing), AdvancingClock())
        record = service.create_identity(support_role())
        identity_id = record.definition.id
        service.replace_draft(identity_id, publishable_identity())
        published = service.publish(identity_id)

    with pytest.raises(PublishedVersionExistsError), session_scope(factory) as overwriting:
        support_identity_repository(overwriting).save_version(
            SupportIdentityVersionRecord(
                published=published.published,
                payload=replace(
                    publishable_identity(), permissions=(SupportPermission.READ_CATALOG,)
                ),
            )
        )

    with session_scope(factory) as reading:
        stored = SupportIdentityService(
            support_identity_repository(reading), AdvancingClock()
        ).get_version(identity_id, 1)
    assert stored.payload == publishable_identity()


def test_a_published_version_whose_stored_content_drifted_is_refused(tmp_path: Path) -> None:
    """The shared repository guards every type; prove it for this payload too."""
    engine = create_database_engine(f"sqlite:///{tmp_path / 'tampered.db'}")
    Base.metadata.create_all(engine)
    factory = create_session_factory(engine)
    with session_scope(factory) as writing:
        service = SupportIdentityService(support_identity_repository(writing), AdvancingClock())
        record = service.create_identity(support_role())
        identity_id = record.definition.id
        service.replace_draft(identity_id, publishable_identity())
        service.publish(identity_id)

    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE definition_versions SET payload = json_set(payload, "
                "'$.role.name', 'Rewritten') WHERE definition_type = 'support_identity'"
            )
        )

    with pytest.raises(PersistedDefinitionIntegrityError), session_scope(factory) as reading:
        SupportIdentityService(support_identity_repository(reading), AdvancingClock()).get_version(
            identity_id, 1
        )
