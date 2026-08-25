"""Public contract for the shared block libraries: authoring, validation, and publication."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
)
from capability_lab.presentation.api import create_app

DOC_PARAMETER: dict[str, Any] = {
    "name": "doc_ref",
    "kind": "document_reference",
    "description": "The shop document the arm has to read.",
    "required": True,
    "default": None,
}

SEVERITY_PARAMETER: dict[str, Any] = {
    "name": "severity",
    "kind": "severity",
    "description": "Whether missing the read fails the objective or only warns.",
    "required": True,
    "default": "required",
}

TIMING_PARAMETER: dict[str, Any] = {
    "name": "timing",
    "kind": "timing",
    "description": "When the runtime injects the mutation.",
    "required": True,
    "default": "after_first_read",
}

OBJECTIVE: dict[str, Any] = {
    "name": "read-required-document",
    "statement": "Read document",
    "description": "Passes when the arm reads the bound document through its tool.",
    "assessment": "deterministic",
    "evidence": "event",
    "parameters": [DOC_PARAMETER, SEVERITY_PARAMETER],
}

MUTATION: dict[str, Any] = {
    "name": "concurrent-entity-mutation",
    "statement": "Concurrent mutation of",
    "description": "Mutates the bound entity out of band so the next write conflicts.",
    "effect": "entity_mutation",
    "parameters": [
        {
            "name": "entity_ref",
            "kind": "entity_reference",
            "description": "The order or customer that moves under the arm.",
            "required": True,
            "default": None,
        },
        TIMING_PARAMETER,
    ],
}


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    engine = create_database_engine(f"sqlite:///{tmp_path / 'block-api.db'}")
    Base.metadata.create_all(engine)
    application = create_app(session_factory=create_session_factory(engine))
    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://lab.test"
    ) as active:
        yield active


async def create_objective(client: AsyncClient, name: str = "read-required-document") -> str:
    response = await client.post("/api/v1/objective-blocks", json={"name": name})
    assert response.status_code == 201
    return str(response.json()["block_id"])


async def create_mutation(client: AsyncClient, name: str = "concurrent-entity-mutation") -> str:
    response = await client.post("/api/v1/mutation-blocks", json={"name": name})
    assert response.status_code == 201
    return str(response.json()["block_id"])


async def test_creating_a_block_returns_an_incomplete_draft(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/objective-blocks", json={"name": "read-required-document"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["lifecycle_state"] == "draft"
    assert body["content"]["name"] == "read-required-document"
    assert body["content"]["statement"] == ""
    assert body["content"]["parameters"] == []
    assert body["content"]["assessment"] == "deterministic"


async def test_a_block_is_created_with_its_name_only(client: AsyncClient) -> None:
    """Everything else is decided in the editor, so there is no field to smuggle it in."""
    response = await client.post(
        "/api/v1/objective-blocks",
        json={"name": "identify-entity", "assessment": "judge"},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_a_name_that_is_not_a_slug_is_refused_by_the_contract(client: AsyncClient) -> None:
    response = await client.post("/api/v1/objective-blocks", json={"name": "Read Document"})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_a_duplicate_name_is_a_conflict(client: AsyncClient) -> None:
    await create_objective(client)

    response = await client.post(
        "/api/v1/objective-blocks", json={"name": "read-required-document"}
    )

    assert response.status_code == 409
    assert response.json()["code"] == "block_name_exists"


async def test_the_two_libraries_do_not_share_a_namespace(client: AsyncClient) -> None:
    await create_objective(client, "clock-advance")

    response = await client.post("/api/v1/mutation-blocks", json={"name": "clock-advance"})

    assert response.status_code == 201


async def test_an_unsupported_parameter_kind_is_refused_by_the_contract(
    client: AsyncClient,
) -> None:
    """Kinds are a closed enumeration; the runtime resolves a binding by kind."""
    block_id = await create_objective(client)

    response = await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={
            "payload": {
                **OBJECTIVE,
                "parameters": [{**DOC_PARAMETER, "kind": "shop_reference"}],
            }
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_a_parameter_name_that_is_not_an_identifier_is_refused(
    client: AsyncClient,
) -> None:
    block_id = await create_objective(client)

    response = await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={"payload": {**OBJECTIVE, "parameters": [{**DOC_PARAMETER, "name": "doc-ref"}]}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_the_parameter_cap_is_declared_by_the_contract(client: AsyncClient) -> None:
    """A consumer can read the limit off the schema instead of discovering it by refusal."""
    block_id = await create_objective(client)

    response = await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={
            "payload": {
                **OBJECTIVE,
                "parameters": [{**DOC_PARAMETER, "name": f"ref_{index}"} for index in range(9)],
            }
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    schema = (await client.get("/openapi.json")).json()["components"]["schemas"]
    assert schema["ObjectiveBlockPayloadSchema"]["properties"]["parameters"]["maxItems"] == 8


async def test_duplicate_parameter_names_answer_the_domain_code(client: AsyncClient) -> None:
    block_id = await create_objective(client)

    response = await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={"payload": {**OBJECTIVE, "parameters": [DOC_PARAMETER, DOC_PARAMETER]}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "block_configuration_error"


async def test_the_response_derives_the_shop_binding_rule_from_the_kind(
    client: AsyncClient,
) -> None:
    """`shop_bound` is the rule a scenario editor offers a same-shop picker for."""
    block_id = await create_objective(client)

    response = await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft", json={"payload": OBJECTIVE}
    )

    assert response.status_code == 200
    parameters = response.json()["content"]["parameters"]
    assert [parameter["shop_bound"] for parameter in parameters] == [True, False]


async def test_a_client_cannot_author_the_shop_binding_rule(client: AsyncClient) -> None:
    """It is decided by the kind, so a contradictory value would author a rule it does not own."""
    block_id = await create_objective(client)

    response = await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={
            "payload": {
                **OBJECTIVE,
                "parameters": [{**SEVERITY_PARAMETER, "shop_bound": True}],
            }
        },
    )

    assert response.status_code == 200
    assert response.json()["content"]["parameters"][0]["shop_bound"] is False


async def test_a_refused_publish_carries_its_findings(client: AsyncClient) -> None:
    block_id = await create_mutation(client)
    await client.put(
        f"/api/v1/mutation-blocks/{block_id}/draft",
        json={"payload": {**MUTATION, "parameters": [MUTATION["parameters"][0]]}},
    )

    response = await client.post(f"/api/v1/mutation-blocks/{block_id}/versions")

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "mutation_block_not_publishable"
    assert "mutation_without_timing" in {issue["code"] for issue in body["issues"]}


async def test_the_preview_reports_the_same_gate_the_publish_enforces(
    client: AsyncClient,
) -> None:
    block_id = await create_objective(client)
    await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={"payload": {**OBJECTIVE, "evidence": "dimension"}},
    )

    preview = await client.get(f"/api/v1/objective-blocks/{block_id}/draft/preview")
    publish = await client.post(f"/api/v1/objective-blocks/{block_id}/versions")

    assert preview.status_code == 200
    assert preview.json()["publishable"] is False
    assert {issue["code"] for issue in preview.json()["issues"]} == {
        issue["code"] for issue in publish.json()["issues"]
    }


async def test_publishing_freezes_the_template_while_the_draft_moves_on(
    client: AsyncClient,
) -> None:
    block_id = await create_objective(client)
    await client.put(f"/api/v1/objective-blocks/{block_id}/draft", json={"payload": OBJECTIVE})

    published = await client.post(f"/api/v1/objective-blocks/{block_id}/versions")
    assert published.status_code == 201
    assert published.json()["version"] == 1
    assert published.json()["lifecycle_state"] == "published"

    await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={"payload": {**OBJECTIVE, "evidence": "state"}},
    )

    frozen = await client.get(f"/api/v1/objective-blocks/{block_id}/versions/1")
    draft = await client.get(f"/api/v1/objective-blocks/{block_id}/draft")

    assert frozen.json()["content"]["evidence"] == "event"
    assert draft.json()["content"]["evidence"] == "state"


async def test_a_published_version_carries_its_content_fingerprint(client: AsyncClient) -> None:
    block_id = await create_mutation(client)
    await client.put(f"/api/v1/mutation-blocks/{block_id}/draft", json={"payload": MUTATION})

    published = await client.post(f"/api/v1/mutation-blocks/{block_id}/versions")

    fingerprint = published.json()["content_fingerprint"]
    assert len(fingerprint) == 64
    versions = await client.get(f"/api/v1/mutation-blocks/{block_id}/versions")
    assert versions.json()["versions"][0]["content_fingerprint"] == fingerprint


async def test_the_index_carries_the_type_axis_and_the_bindings_to_resolve(
    client: AsyncClient,
) -> None:
    block_id = await create_objective(client)
    await client.put(f"/api/v1/objective-blocks/{block_id}/draft", json={"payload": OBJECTIVE})

    response = await client.get("/api/v1/objective-blocks")

    (row,) = response.json()["blocks"]
    assert row["name"] == "read-required-document"
    assert row["type_label"] == "deterministic · event"
    assert row["parameter_count"] == 2
    assert row["shop_bound_parameter_count"] == 1
    assert row["latest_published_version"] is None


async def test_a_mutation_block_is_not_reachable_through_the_objective_library(
    client: AsyncClient,
) -> None:
    block_id = await create_mutation(client)

    response = await client.get(f"/api/v1/objective-blocks/{block_id}/draft")

    assert response.status_code == 404
    assert response.json()["code"] == "objective_block_not_found"


async def test_unknown_blocks_and_versions_answer_their_own_not_found_codes(
    client: AsyncClient,
) -> None:
    unknown = uuid4()

    objective = await client.get(f"/api/v1/objective-blocks/{unknown}/draft")
    mutation = await client.get(f"/api/v1/mutation-blocks/{unknown}/draft")
    block_id = await create_objective(client)
    version = await client.get(f"/api/v1/objective-blocks/{block_id}/versions/3")

    assert objective.json()["code"] == "objective_block_not_found"
    assert mutation.json()["code"] == "mutation_block_not_found"
    assert version.status_code == 404
    assert version.json()["code"] == "objective_block_version_not_found"


async def test_an_unknown_field_is_refused_rather_than_ignored(client: AsyncClient) -> None:
    block_id = await create_objective(client)

    response = await client.put(
        f"/api/v1/objective-blocks/{block_id}/draft",
        json={"payload": {**OBJECTIVE, "shop_id": str(uuid4())}},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
