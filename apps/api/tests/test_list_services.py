from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import Mock
from uuid import uuid4

import pytest

from capability_lab.application.conversations import (
    ConversationListFilter,
    ConversationNotFoundError,
    ConversationService,
    ConversationSummary,
)
from capability_lab.application.ports import GeneratedScenarioRepository, SessionRepository
from capability_lab.application.scenario_generation import (
    GeneratedScenarioNotFoundError,
    GeneratedScenarioSummary,
    PersonaLibraryFilter,
    ScenarioGenerationService,
)

_BASE = datetime(2026, 8, 19, 12, 0, tzinfo=UTC)


def _persona_summary(index: int) -> GeneratedScenarioSummary:
    return GeneratedScenarioSummary(
        scenario_id="retail-profile",
        scenario_version="v1",
        seed=index,
        display_name=f"Persona {index}",
        locale="en-US",
        initial_state_hash=f"hash-{index}",
        created_at=_BASE,
        last_activity_at=_BASE + timedelta(minutes=index),
        conversation_count=index,
    )


def _conversation_summary(index: int) -> ConversationSummary:
    return ConversationSummary(
        id=uuid4(),
        scenario_id="retail-profile",
        scenario_version="v1",
        seed=1,
        framework_id="fake",
        created_at=_BASE,
        last_activity_at=_BASE + timedelta(minutes=index),
        turn_count=index,
    )


class _FakeGeneratedScenarioRepository:
    def __init__(
        self,
        rows: list[GeneratedScenarioSummary],
        *,
        exists: bool = True,
    ) -> None:
        self._rows = rows
        self._exists = exists
        self.captured_limit: int | None = None
        self.captured_offset: int | None = None
        self.captured_filters: PersonaLibraryFilter | None = None
        self.deleted: tuple[str, str, int, datetime] | None = None

    def was_deleted(self, _scenario_id: str, _scenario_version: str, _seed: int) -> bool:
        return False

    def delete(
        self,
        scenario_id: str,
        scenario_version: str,
        seed: int,
        *,
        deleted_at: datetime,
    ) -> bool:
        self.deleted = (scenario_id, scenario_version, seed, deleted_at)
        return self._exists

    def list_summaries(
        self,
        *,
        limit: int,
        offset: int,
        filters: PersonaLibraryFilter,
    ) -> tuple[list[GeneratedScenarioSummary], int]:
        self.captured_limit = limit
        self.captured_offset = offset
        self.captured_filters = filters
        return self._rows[offset : offset + limit], len(self._rows)


class _FakeSessionRepository:
    def __init__(self, rows: list[ConversationSummary], *, exists: bool = True) -> None:
        self._rows = rows
        self._exists = exists
        self.captured_limit: int | None = None
        self.captured_offset: int | None = None
        self.captured_filters: ConversationListFilter | None = None
        self.deleted: list[str] = []

    def was_deleted(self, _session_id: object) -> bool:
        return False

    def delete(self, session_id: object, *, deleted_at: datetime) -> bool:
        assert deleted_at == _BASE
        self.deleted.append(str(session_id))
        return self._exists

    def list_summaries(
        self,
        *,
        limit: int,
        offset: int,
        filters: ConversationListFilter,
    ) -> tuple[list[ConversationSummary], int]:
        self.captured_filters = filters
        self.captured_limit = limit
        self.captured_offset = offset
        return self._rows[offset : offset + limit], len(self._rows)


def _generation_service(repo: _FakeGeneratedScenarioRepository) -> ScenarioGenerationService:
    clock = Mock()
    clock.now.return_value = _BASE
    return ScenarioGenerationService(Mock(), cast(GeneratedScenarioRepository, repo), Mock(), clock)


def _conversation_service(repo: _FakeSessionRepository) -> ConversationService:
    clock = Mock()
    clock.now.return_value = _BASE
    return ConversationService(cast(SessionRepository, repo), Mock(), Mock(), Mock(), clock, Mock())


def test_generation_list_translates_page_to_offset_and_returns_total() -> None:
    rows = [_persona_summary(index) for index in (3, 2, 1)]
    repo = _FakeGeneratedScenarioRepository(rows)

    page, total = _generation_service(repo).list_summaries(limit=2, page=2)

    assert repo.captured_limit == 2
    assert repo.captured_offset == 2  # (page 2 - 1) * limit 2
    assert [item.seed for item in page] == [1]
    assert total == 3


def test_generation_list_first_page_starts_at_offset_zero() -> None:
    repo = _FakeGeneratedScenarioRepository([_persona_summary(2), _persona_summary(1)])

    page, total = _generation_service(repo).list_summaries(limit=5, page=1)

    assert repo.captured_offset == 0
    assert len(page) == 2
    assert total == 2


def test_generation_list_forwards_filters() -> None:
    repo = _FakeGeneratedScenarioRepository([_persona_summary(1)])
    filters = PersonaLibraryFilter(scenario_id="retail-profile", framework_id="fake")

    _generation_service(repo).list_summaries(limit=2, page=1, filters=filters)

    assert repo.captured_filters == filters


def test_generation_list_defaults_to_empty_filters() -> None:
    repo = _FakeGeneratedScenarioRepository([_persona_summary(1)])

    _generation_service(repo).list_summaries(limit=2, page=1)

    assert repo.captured_filters == PersonaLibraryFilter()


def test_generation_delete_forwards_reference_and_command_time() -> None:
    repo = _FakeGeneratedScenarioRepository([])

    _generation_service(repo).delete("retail-profile", "v1", 42)

    assert repo.deleted == ("retail-profile", "v1", 42, _BASE)


def test_generation_delete_missing_raises_not_found() -> None:
    repo = _FakeGeneratedScenarioRepository([], exists=False)

    with pytest.raises(GeneratedScenarioNotFoundError):
        _generation_service(repo).delete("retail-profile", "v1", 42)


def test_conversation_list_translates_page_and_forwards_filters() -> None:
    rows = [_conversation_summary(index) for index in (3, 2, 1)]
    repo = _FakeSessionRepository(rows)
    filters = ConversationListFilter(
        scenario_id="retail-profile", scenario_version="v1", seed=1, framework_id="fake"
    )

    page, total = _conversation_service(repo).list(limit=2, page=2, filters=filters)

    assert repo.captured_filters == filters
    assert repo.captured_offset == 2
    assert repo.captured_limit == 2
    assert [item.turn_count for item in page] == [1]
    assert total == 3


def test_conversation_delete_forwards_to_repository() -> None:
    repo = _FakeSessionRepository([])
    session_id = uuid4()

    _conversation_service(repo).delete(session_id)

    assert repo.deleted == [str(session_id)]


def test_conversation_delete_missing_raises_not_found() -> None:
    repo = _FakeSessionRepository([], exists=False)

    with pytest.raises(ConversationNotFoundError):
        _conversation_service(repo).delete(uuid4())
