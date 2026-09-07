"""Public contract for experiment-first history: every run this lab made, narrowed."""

from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from api_factories import (
    SHOP_IDENTITY,
    api_client,
    make_customer,
    make_order,
    make_shop,
    make_ticket,
    publish_prerequisites,
    publish_ticket,
    seed_lab,
)
from test_experiment_api import (
    advance,
    control_arm,
    published_scenario,
    start,
    start_body,
)

HISTORY = "/api/v1/experiments"


@pytest.fixture
async def client(tmp_path: Path) -> AsyncGenerator[AsyncClient, None]:
    async with api_client(tmp_path, "experiment-history.db") as active:
        yield active


@pytest.fixture
async def lab(client: AsyncClient) -> dict[str, str]:
    return await seed_lab(client)


async def history(client: AsyncClient, **params: Any) -> dict[str, Any]:
    response = await client.get(HISTORY, params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def control_run(
    client: AsyncClient, lab: dict[str, str], label: str = "Framework comparison", **overrides: Any
) -> dict[str, Any]:
    """One started experiment whose single arm the offline lab can actually run."""
    scenario = await published_scenario(client, lab, **overrides)
    return await start(client, lab, start_body(scenario, await control_arm(client), label=label))


async def second_shop(client: AsyncClient, lab: dict[str, str], name: str) -> dict[str, str]:
    """A second shop with its own incident, over the block libraries the first one published.

    The libraries are cross-shop and their names are unique, so a second workspace reuses
    them rather than seeding its own — which is exactly how a lab with two shops works.
    """
    shop_id = await make_shop(
        client, {**SHOP_IDENTITY, "name": name, "slug": name.lower().replace(" ", "-")}
    )
    profile_id = await make_customer(client, shop_id)
    order_id = await make_order(client, shop_id, profile_id)
    ticket_id = await make_ticket(client, shop_id, profile_id)
    await publish_prerequisites(client, shop_id, profile_id)
    await publish_ticket(client, shop_id, ticket_id, order_id)
    return {
        "shop_id": shop_id,
        "profile_id": profile_id,
        "order_id": order_id,
        "ticket_id": ticket_id,
        "objective_block_id": lab["objective_block_id"],
        "mutation_block_id": lab["mutation_block_id"],
    }


# -- the row -------------------------------------------------------------------


async def test_a_started_experiment_is_one_row_naming_its_shop_scenario_and_arms(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_run(client, lab, label="Prompt A against prompt B")

    body = await history(client)

    assert body["total"] == 1
    row = body["experiments"][0]
    assert row["experiment_id"] == experiment["experiment_id"]
    assert row["label"] == "Prompt A against prompt B"
    assert row["shop_name"] == "Northstar Outfitters"
    assert row["scenario_name"] == "Wrong shipping address"
    assert row["scenario_version"] == 1
    assert row["scenario_superseded"] is False
    assert row["sandbox_fingerprint"] == experiment["sandbox_fingerprint"]
    arm = row["arms"][0]
    assert arm["label"] == "Arm A"
    assert arm["agent_configuration_name"] == "Frontline single agent"
    assert arm["agent_configuration_version"] == 1
    assert arm["framework_label"] == "Deterministic fake"


async def test_a_row_says_where_each_arm_stands_and_counts_only_what_was_decided(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """Nothing has decided this arm's read-check yet, so its denominator is zero, not one."""
    await control_run(client, lab)

    row = (await history(client))["experiments"][0]

    assert row["status"] == "running"
    assert row["arms"][0]["awaiting"] == "agent"
    assert row["arms"][0]["decided"] == 0
    assert row["arms"][0]["met"] == 0
    assert row["arms"][0]["failed"] is False


async def test_an_arm_driven_past_its_cap_is_a_finished_run_that_failed(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The control arm never opens the policy, so the cap turns a pending row into a miss."""
    experiment = await control_run(
        client,
        lab,
        completion={"statement": "The order ships to the confirmed address.", "max_turns": 1},
    )
    await advance(client, lab, experiment)
    delivered = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
        "/participant-turns",
        json={"run_ids": [experiment["runs"][0]["run_id"]], "message": "Any update?"},
    )
    assert delivered.status_code == 201, delivered.text
    await advance(client, lab, experiment)

    row = (await history(client))["experiments"][0]

    assert row["status"] == "failed"
    assert row["arms"][0]["awaiting"] == "completed"
    assert row["arms"][0]["decided"] == 1
    assert row["arms"][0]["met"] == 0
    assert row["arms"][0]["failed"] is True


async def test_a_newer_published_recipe_marks_the_row_it_did_not_run(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The row keeps the version it pinned and says the recipe has moved on since."""
    experiment = await control_run(client, lab)

    republished = await client.post(
        f"/api/v1/shops/{lab['shop_id']}/scenarios/{experiment['scenario_id']}/versions"
    )
    assert republished.status_code == 201, republished.text

    row = (await history(client))["experiments"][0]

    assert row["scenario_version"] == 1
    assert row["scenario_superseded"] is True


# -- narrowing -----------------------------------------------------------------


async def test_history_is_cross_shop_and_narrows_to_one_shop_without_losing_the_others(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    here = await control_run(client, lab, label="Northstar comparison")
    elsewhere = await second_shop(client, lab, "Southline Supply")
    there = await control_run(client, elsewhere, label="Second shop comparison")

    everything = await history(client)
    narrowed = await history(client, shop_id=elsewhere["shop_id"])

    assert {row["experiment_id"] for row in everything["experiments"]} == {
        here["experiment_id"],
        there["experiment_id"],
    }
    assert [row["experiment_id"] for row in narrowed["experiments"]] == [there["experiment_id"]]
    assert narrowed["experiments"][0]["shop_name"] == "Southline Supply"
    # Choosing one shop must not remove the other from the filter that chose it.
    assert [facet["label"] for facet in narrowed["shops"]] == [
        "Northstar Outfitters",
        "Southline Supply",
    ]


async def test_history_narrows_by_scenario_framework_outcome_and_text(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_run(client, lab, label="Beacon against atlas")
    scenario_id = experiment["scenario_id"]

    assert (await history(client, scenario_id=scenario_id))["total"] == 1
    assert (await history(client, framework_id="fake"))["total"] == 1
    assert (await history(client, framework_id="pydantic-ai"))["total"] == 0
    # Nothing has been decided, so the arm's only objective is pending and nothing is met.
    assert (await history(client, outcome="pending"))["total"] == 1
    assert (await history(client, outcome="met"))["total"] == 0
    assert (await history(client, q="beacon"))["total"] == 1
    assert (await history(client, q="atlas"))["total"] == 1
    assert (await history(client, q="never written"))["total"] == 0


async def test_history_narrows_by_status_and_by_when_a_run_started(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_run(client, lab)

    assert (await history(client, status="running"))["total"] == 1
    assert (await history(client, status="completed"))["total"] == 0
    assert (await history(client, started_after=experiment["created_at"]))["total"] == 1
    assert (await history(client, started_before="2020-01-01T00:00:00Z"))["total"] == 0
    # A moment written without an offset is read as UTC rather than crashing the listing:
    # every timestamp this lab records is UTC, so there is no second reading to guess at.
    assert (await history(client, started_before="2020-01-01T00:00:00"))["total"] == 0
    assert (await history(client, started_after="2020-01-01T00:00:00"))["total"] == 1


async def test_the_filter_options_are_read_from_the_runs_themselves(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    await control_run(client, lab)

    body = await history(client)

    assert [facet["label"] for facet in body["shops"]] == ["Northstar Outfitters"]
    assert [facet["label"] for facet in body["scenarios"]] == ["Wrong shipping address"]
    assert [facet["id"] for facet in body["frameworks"]] == ["fake"]


# -- paging --------------------------------------------------------------------


async def test_history_pages_by_number_over_the_whole_matching_set(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = await control_arm(client)
    started = [
        (await start(client, lab, start_body(scenario, arm, label=f"Run {index}")))["experiment_id"]
        for index in range(3)
    ]

    first = await history(client, page=1, page_size=2)
    second = await history(client, page=2, page_size=2)

    assert first["total"] == second["total"] == 3
    assert len(first["experiments"]) == 2
    assert len(second["experiments"]) == 1
    listed = [row["experiment_id"] for row in (*first["experiments"], *second["experiments"])]
    # Newest first, and every experiment on exactly one page.
    assert listed == list(reversed(started))


async def test_history_refuses_a_page_size_beyond_its_bound(client: AsyncClient) -> None:
    assert (await client.get(HISTORY, params={"page_size": 101})).status_code == 422
    assert (await client.get(HISTORY, params={"page": 0})).status_code == 422


async def test_an_empty_lab_has_a_history_with_no_rows_and_no_options(
    client: AsyncClient,
) -> None:
    body = await history(client)

    assert body == {
        "experiments": [],
        "page": 1,
        "page_size": 50,
        "total": 0,
        "shops": [],
        "scenarios": [],
        "frameworks": [],
        "tags": [],
    }


async def test_the_removed_persona_first_listings_are_gone(client: AsyncClient) -> None:
    """Experiment history replaces them; nothing lists conversations or personas any more."""
    assert (await client.get("/api/v1/conversations")).status_code == 405
    assert (await client.get("/api/v1/scenarios/generations")).status_code == 404


async def test_a_configuration_renamed_after_a_run_does_not_rename_the_run(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = await control_arm(client, name="Frontline v1")
    await start(client, lab, start_body(scenario, arm))
    draft = await client.get(f"/api/v1/agent-configurations/{arm['configuration_id']}/draft")
    renamed = await client.put(
        f"/api/v1/agent-configurations/{arm['configuration_id']}/draft",
        json={"payload": {**draft.json()["content"], "name": "Frontline v2"}},
    )
    assert renamed.status_code == 200, renamed.text
    republished = await client.post(
        f"/api/v1/agent-configurations/{arm['configuration_id']}/versions"
    )
    assert republished.status_code == 201, republished.text

    row = (await history(client))["experiments"][0]

    assert row["arms"][0]["agent_configuration_name"] == "Frontline v1"
    assert row["arms"][0]["agent_configuration_version"] == 1


# -- what an operator wrote ----------------------------------------------------


async def annotate(
    client: AsyncClient,
    lab: dict[str, str],
    experiment: dict[str, Any],
    *,
    tags: list[str] | None = None,
    note: str | None = None,
) -> None:
    base = f"/api/v1/shops/{lab['shop_id']}/experiments/{experiment['experiment_id']}"
    if tags is not None:
        filed = await client.put(f"{base}/tags", json={"tags": tags})
        assert filed.status_code == 200, filed.text
    if note is not None:
        written = await client.post(f"{base}/notes", json={"body": note})
        assert written.status_code == 201, written.text


async def test_a_row_shows_the_tags_it_is_filed_under_and_how_many_notes_it_carries(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """The count rather than the words: a note reads as itself beside the evidence."""
    experiment = await control_run(client, lab)
    await annotate(
        client,
        lab,
        experiment,
        tags=["two-arm", "read-check-gap"],
        note="Beacon acts before reading the policy.",
    )

    row = (await history(client))["experiments"][0]

    assert row["tags"] == ["read-check-gap", "two-arm"]
    assert row["note_count"] == 1


async def test_history_narrows_to_the_runs_filed_under_one_tag(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = await control_arm(client)
    tagged = await start(client, lab, start_body(scenario, arm, label="Tagged run"))
    await start(client, lab, start_body(scenario, arm, label="Untagged run"))
    await annotate(client, lab, tagged, tags=["read-check-gap"])

    body = await history(client, tag="read-check-gap")

    assert [row["label"] for row in body["experiments"]] == ["Tagged run"]


async def test_a_tag_no_run_carries_narrows_to_nothing_rather_than_refusing(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """A shared link must not become an error page when the last run under it is refiled."""
    await control_run(client, lab)

    body = await history(client, tag="never-used")

    assert body["total"] == 0


@pytest.mark.parametrize(
    "asked", ["READ-CHECK-GAP", "Read check gap", "read_check_gap", "  read - check - gap  "]
)
async def test_the_tag_filter_matches_however_the_shelf_was_typed(
    client: AsyncClient, lab: dict[str, str], asked: str
) -> None:
    """The filter normalizes through the same step a write folds through.

    A link is typed by hand as often as it is clicked, and one that only matched the exact
    spelling the dropdown emits would find nothing while the identical tag sat on a row."""
    experiment = await control_run(client, lab)
    await annotate(client, lab, experiment, tags=["Read check gap"])

    body = await history(client, tag=asked)

    assert body["total"] == 1


async def test_the_search_box_finds_a_run_by_what_was_written_on_it(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    scenario = await published_scenario(client, lab)
    arm = await control_arm(client)
    annotated = await start(client, lab, start_body(scenario, arm, label="Run 1"))
    await start(client, lab, start_body(scenario, arm, label="Run 2"))
    await annotate(
        client, lab, annotated, tags=["read-check-gap"], note="Its prompt under-specifies the tool."
    )

    by_note = await history(client, q="under-specifies")
    by_tag = await history(client, q="read-check")

    assert [row["label"] for row in by_note["experiments"]] == ["Run 1"]
    assert [row["label"] for row in by_tag["experiments"]] == ["Run 1"]


async def test_the_tag_options_are_the_shelves_runs_are_actually_on(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    experiment = await control_run(client, lab)
    await annotate(client, lab, experiment, tags=["two-arm", "read-check-gap"])

    body = await history(client)

    assert [facet["id"] for facet in body["tags"]] == ["read-check-gap", "two-arm"]
    assert [facet["label"] for facet in body["tags"]] == ["read-check-gap", "two-arm"]


async def test_the_tag_options_stay_the_whole_labs_even_when_one_is_chosen(
    client: AsyncClient, lab: dict[str, str]
) -> None:
    """An operator who has narrowed to one shelf must still be able to choose another."""
    scenario = await published_scenario(client, lab)
    arm = await control_arm(client)
    first = await start(client, lab, start_body(scenario, arm, label="Run 1"))
    second = await start(client, lab, start_body(scenario, arm, label="Run 2"))
    await annotate(client, lab, first, tags=["read-check-gap"])
    await annotate(client, lab, second, tags=["two-arm"])

    body = await history(client, tag="two-arm")

    assert body["total"] == 1
    assert [facet["id"] for facet in body["tags"]] == ["read-check-gap", "two-arm"]
