"""What `make seed` leaves behind, and the two databases it declines to touch.

The seed exists so that a developer who has just migrated an empty file can open every
screen and see something real. That is a claim about the *record* rather than about the
code that wrote it, so the assertions here read the demo back through the same services the
Studio, the bench, the history listing and the results screen read it through — and they
assert content, not counts: the address the arms moved, the objectives that were decided,
the verdict a judge left, and the words an operator wrote on the run.

Two more claims are held here because they are the reasons the command is safe to run. It
refuses rather than merges: a database with anything of its own in it is left exactly as it
was, and told why. And it reaches nothing: the whole story is driven with the network
removed from under it, so "no credential, no provider, no money" is checked rather than
asserted in a docstring.
"""

from __future__ import annotations

import hashlib
import logging
import socket
from collections.abc import Iterator
from importlib import resources
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text

from capability_lab.application.agent_capabilities import (
    OPENAI_AGENTS_FRAMEWORK_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.experiment_history import ExperimentHistoryQuery
from capability_lab.application.judge_runtime import JudgeRuntimeRegistry
from capability_lab.application.sandbox_tool_contracts import (
    ADDRESS_CHANGE_APPLY,
    ADDRESS_CHANGE_PROPOSE,
    TOOL_CONTRACT_VERSIONS,
)
from capability_lab.application.sandbox_tools import ToolOutcome
from capability_lab.application.shop_media import MediaType, media_type_of
from capability_lab.application.shops import ShopService
from capability_lab.domain.agent_turn import AgentTurnOutcome
from capability_lab.domain.blocks import ObjectiveAssessment
from capability_lab.domain.evaluation import ExperimentStatus, ObjectiveOutcome
from capability_lab.domain.experiment import ArmAwaiting, ComparisonDimension
from capability_lab.domain.shop import MediaAssetReference
from capability_lab.infrastructure import models
from capability_lab.infrastructure.agents.scripted import INCIDENT_TOOLS, incident_runtimes
from capability_lab.infrastructure.clock import SystemClock
from capability_lab.infrastructure.config import Settings, get_default_settings
from capability_lab.infrastructure.database import (
    Base,
    create_database_engine,
    create_session_factory,
    session_scope,
)
from capability_lab.infrastructure.judges import ControlJudgeRuntime
from capability_lab.infrastructure.media_store import FilesystemMediaStore
from capability_lab.infrastructure.telemetry import create_run_tracer, create_telemetry
from capability_lab.presentation.seed import content
from capability_lab.presentation.seed.cli import main
from capability_lab.presentation.seed.demo import DemoSeed
from capability_lab.presentation.seed.runner import (
    POC_TABLES,
    SEEDED_TABLES,
    DatabaseNotEmptyError,
    DatabaseNotMigratedError,
    default_alembic_config,
    head_revision,
    occupied_tables,
    run_seed,
)
from capability_lab.presentation.seed.services import SeedServices, build_services

STALE_REVISION = "20260905_0017"
"""A revision this build has moved past, used to prove the head check is a comparison."""


# -- a database in the state `make migrate` leaves it in ------------------------


@pytest.fixture
def alembic_config() -> Path:
    located = default_alembic_config()
    assert located is not None, "the suite runs from a checkout that has apps/api/alembic.ini"
    return located


@pytest.fixture
def migrated(tmp_path: Path, alembic_config: Path) -> str:
    """An empty database with the schema and the stamp `make migrate` would leave.

    Built from the mapped metadata and stamped by hand rather than by running Alembic: what
    this suite is about is what the seed does to an empty database at the head, and
    `test_migrations.py` is what holds the migrations to producing that schema.
    """
    return _database(tmp_path / "migrated.db", stamp=head_revision(alembic_config))


def _database(path: Path, *, stamp: str | None) -> str:
    url = f"sqlite:///{path}"
    engine = create_database_engine(url)
    Base.metadata.create_all(engine)
    if stamp is not None:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
            )
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
                {"revision": stamp},
            )
    engine.dispose()
    return url


def media_root_for(url: str) -> Path:
    """The media root beside a suite database, under the test's own temporary directory.

    Beside the file as `var/media` sits beside `var/agent-lab.db`, so a test seeds one lab
    and never the checkout's `var/media`.
    """
    return Path(url.removeprefix("sqlite:///")).parent / "seed-media"


def settings_for(url: str) -> Settings:
    """Declared defaults with the database and the media root moved, so no `.env` reaches
    this suite and nothing it seeds lands in the checkout."""
    return get_default_settings().model_copy(
        update={"database_url": url, "media_root": media_root_for(url)}
    )


@pytest.fixture
async def seeded(migrated: str, alembic_config: Path) -> DemoSeed:
    result, _url = await run_seed(settings_for(migrated), alembic_config=alembic_config)
    return result


def read(url: str) -> Iterator[SeedServices]:
    """The demo read back through the services every screen reads it through."""
    engine = create_database_engine(url)
    control = ControlJudgeRuntime()
    with session_scope(create_session_factory(engine)) as session:
        yield build_services(
            session,
            SystemClock(),
            SupportAgentRuntimeRegistry(
                {runtime.framework_id: runtime for runtime in incident_runtimes()}
            ),
            JudgeRuntimeRegistry({control.provider: control}),
            create_run_tracer(create_telemetry(get_default_settings())),
            FilesystemMediaStore(media_root_for(url)),
            media_max_bytes=get_default_settings().media_max_bytes,
        )
    engine.dispose()


@pytest.fixture
def services(migrated: str, seeded: DemoSeed) -> Iterator[SeedServices]:
    assert seeded.experiment_id
    yield from read(migrated)


# -- what a cold open sees -----------------------------------------------------


def test_the_seed_leaves_one_finished_experiment_on_the_history_screen(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """Frame 10's listing, which is the first screen a cold open lands on.

    Everything asserted here is a column of that row: the shop and scenario it names, that
    it is over rather than waiting, that both arms finished, that every objective was
    decided and met, and that it is filed and annotated. A demo that produced a row saying
    "awaiting the agent" would be a bench to finish rather than a result to read.
    """
    page = services.history.history(ExperimentHistoryQuery())

    assert page.total == 1
    entry = page.entries[0]
    assert entry.record.label == content.EXPERIMENT_LABEL
    assert entry.shop_name == content.SHOP_NAME
    assert entry.scenario_name == content.SCENARIO_NAME
    assert entry.status is ExperimentStatus.COMPLETED
    assert entry.scenario_superseded is False
    assert [arm.framework_id for arm in entry.arms] == [
        PYDANTIC_AI_FRAMEWORK_ID,
        OPENAI_AGENTS_FRAMEWORK_ID,
    ]
    for arm in entry.arms:
        assert arm.awaiting is ArmAwaiting.COMPLETED
        assert arm.failed is False
        assert arm.met == arm.decided == 3


def test_the_history_filters_offer_the_facets_the_seeded_run_fills(
    services: SeedServices,
) -> None:
    """Frame 10's filter rail, read off the one run in the lab (ADR 0034).

    Empty facets are the failure this catches: a shelf with nothing on it, a framework
    filter with no framework in it, and a tag filter that cannot be demonstrated.
    """
    page = services.history.history(ExperimentHistoryQuery())

    assert [facet.label for facet in page.shops] == [content.SHOP_NAME]
    assert [facet.label for facet in page.scenarios] == [content.SCENARIO_NAME]
    assert sorted(facet.id for facet in page.frameworks) == sorted(
        [OPENAI_AGENTS_FRAMEWORK_ID, PYDANTIC_AI_FRAMEWORK_ID]
    )
    assert sorted(facet.id for facet in page.tags) == sorted(content.DEMO_TAGS)


def test_the_seeded_arms_differ_in_the_framework_and_nothing_else(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """ADR 0025's matrix, which is what makes the demo worth looking at.

    The whole matrix rather than the one row, because a seed that also moved the model or
    the adopted identity would be demonstrating an experiment nothing can be attributed to.
    """
    detail = services.experiments.get_experiment(seeded.shop_id, seeded.experiment_id)

    differing = [variable for variable in detail.comparison if variable.differs]

    assert [variable.dimension for variable in differing] == [ComparisonDimension.FRAMEWORK]
    assert differing[0].values == (PYDANTIC_AI_FRAMEWORK_ID, OPENAI_AGENTS_FRAMEWORK_ID)
    assert {variable.dimension for variable in detail.comparison} == set(ComparisonDimension)


def test_both_seeded_arms_resolved_the_incident_through_the_published_tools(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """The evidence the execution timeline and the trace viewer are drawn over.

    The address change is asserted as the pair ADR 0022 published it as, in both arms: a
    demo whose write appeared without a proposal in front of it would be showing the safety
    model being bypassed.
    """
    detail = services.experiments.get_experiment(seeded.shop_id, seeded.experiment_id)

    for run_id in seeded.run_ids:
        made = [
            (entry.event.tool, entry.event.version, entry.event.outcome)
            for entry in detail.tool_events
            if entry.run_id == run_id
        ]
        first = made[: len(INCIDENT_TOOLS)]
        assert [tool for tool, _version, _outcome in first] == list(INCIDENT_TOOLS)
        assert [outcome for _tool, _version, outcome in first] == [ToolOutcome.SUCCESS] * len(
            INCIDENT_TOOLS
        )
        for tool, version, _outcome in made:
            assert version == TOOL_CONTRACT_VERSIONS[tool]

    applied = [
        entry
        for entry in detail.tool_events
        if entry.event.tool == ADDRESS_CHANGE_APPLY and entry.event.outcome is ToolOutcome.SUCCESS
    ]
    proposed = [
        entry
        for entry in detail.tool_events
        if entry.event.tool == ADDRESS_CHANGE_PROPOSE and entry.event.outcome is ToolOutcome.SUCCESS
    ]
    assert {entry.run_id for entry in applied} == set(seeded.run_ids)
    assert {entry.run_id for entry in proposed} == set(seeded.run_ids)
    assert {turn.turn.outcome for turn in detail.agent_turns} == {AgentTurnOutcome.ANSWERED}


def test_the_seeded_fault_fired_once_into_each_arm(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """ADR 0028's schedule, so frame 8's timeline has a fault entry to show."""
    detail = services.experiments.get_experiment(seeded.shop_id, seeded.experiment_id)

    for run_id in seeded.run_ids:
        fired = [entry.event for entry in detail.mutation_events if entry.run_id == run_id]
        assert [event.mutation_id for event in fired] == [content.FAULT]
        assert fired[0].revision_after > fired[0].revision_before


def test_the_seeded_state_diff_shows_the_order_moving_to_the_current_address(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """ADR 0035's card, with the values that make the story legible rather than only paths.

    The redirect and the fault are both in it: the address the arm changed, and the
    fulfilment the scenario advanced under it while the arm was still reading.
    """
    detail = services.experiments.get_experiment(seeded.shop_id, seeded.experiment_id)

    for diff in detail.state_diffs:
        assert [entry.reference for entry in diff.orders] == [content.ORDER_REFERENCE]
        moved = {(change.path, change.before, change.after) for change in diff.orders[0].changes}
        assert ("shipping_address.city", "Bordeaux", "Lyon") in moved
        assert (
            "shipping_address.source_address_id",
            content.STALE_ADDRESS_ID,
            content.CURRENT_ADDRESS_ID,
        ) in moved
        assert ("fulfilment.status", "unfulfilled", "partially_fulfilled") in moved


def test_the_seeded_cost_cards_are_measured_for_both_arms_and_zero_for_neither(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """ADR 0032's reading, and the distinction it exists to keep.

    That distinction is measured against unmeasured against zero. An arm that reported
    nothing would read as unmeasured and an arm that reported zeros would read as one that
    called no provider at all, so a demo whose cost cards were either would demonstrate the
    wrong thing.

    What is deliberately *not* asserted is that the two arms differ. They do, because two
    offline doubles invent their own figures — one estimates from message length and the
    other reports a flat count per call — and that difference is an artefact of the doubles
    rather than anything either framework did. Requiring it here would enshrine the artefact
    as a property the demo has to keep, and the run's own label, tag and notes exist to tell
    a reader not to read it as one.
    """
    detail = services.experiments.get_experiment(seeded.shop_id, seeded.experiment_id)

    for metrics in detail.metrics:
        assert metrics.usage is not None
        assert metrics.usage.input_tokens > 0
        assert metrics.usage.output_tokens > 0
        assert metrics.estimated_cost is not None and metrics.estimated_cost.amount > 0
        assert metrics.duration_ms is not None and metrics.duration_ms > 0
        assert metrics.tool_writes == 1


def test_the_seeded_evaluation_holds_a_judge_verdict_beside_the_rule_decided_rows(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """Frame 9's matrix, with both kinds of row filled in.

    The judge row is the reason a judge configuration is seeded at all: a demo whose
    objectives were all deterministic would leave the scoring pass, the rubric and the
    verdict column with nothing to show.
    """
    evaluation = services.evaluation.evaluate(seeded.shop_id, seeded.experiment_id)

    assert len(evaluation.arms) == 2
    for arm in evaluation.arms:
        decided = {result.objective_id: result.outcome for result in arm.results}
        assert decided == {
            content.READ_POLICY_OBJECTIVE: ObjectiveOutcome.MET,
            content.REDIRECT_OBJECTIVE: ObjectiveOutcome.MET,
            content.EXPLAINED_OBJECTIVE: ObjectiveOutcome.MET,
        }
        judged = [
            result for result in arm.results if result.assessment is ObjectiveAssessment.JUDGE
        ]
        assert [result.objective_id for result in judged] == [content.EXPLAINED_OBJECTIVE]
        assert judged[0].judgement is not None


def test_the_seeded_run_carries_the_note_and_the_tags_an_operator_would_have_written(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """ADR 0036's annotation strip and tag chips, which are empty on a bare run."""
    annotations = services.annotations.get(seeded.shop_id, seeded.experiment_id)

    assert annotations.tags == tuple(sorted(content.DEMO_TAGS))
    assert [note.body for note in annotations.notes] == list(content.DEMO_NOTES)


def test_the_seeded_run_says_on_its_own_surfaces_that_its_figures_are_a_doubles(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """The qualification, on the three surfaces a viewer reads rather than in a docstring.

    Both arms walked one scripted incident against a double at each SDK's model seam, so the
    tokens, the provider-call counts and the money the results screen prices them at are
    figures the doubles invented. Shown without a word beside them they read as a framework
    finding — precisely the global claim this product refuses to compute, off numbers ADR
    0032 requires never to be mistakable for ones a provider billed.

    Three places, because each reaches a different reader: the label is rendered on the
    history row, the bench header and the results header that carries the cost card; the tag
    is a chip on the run before anybody opens it; and the note is the sentence that says
    what the numbers actually are. The label is asserted through the reading the screens
    take rather than through the constant, so a demo that qualified only its source fails.
    """
    entry = services.history.history(ExperimentHistoryQuery()).entries[0]
    detail = services.experiments.get_experiment(seeded.shop_id, seeded.experiment_id)
    annotations = services.annotations.get(seeded.shop_id, seeded.experiment_id)

    assert "offline demo" in entry.record.label.lower()
    assert entry.record.label == detail.record.label
    assert "offline-scripted" in entry.tags

    qualification = annotations.notes[0].body.lower()
    for word in ("offline", "test model", "cost", "live run"):
        assert word in qualification


def test_the_seeded_run_recorded_a_span_tree_and_a_timeline_for_every_arm(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """The two readings of a run that are not the thread: ADR 0037 and ADR 0027."""
    traces = services.traces.traces(seeded.shop_id, seeded.experiment_id)
    timeline = services.timeline.timeline(seeded.shop_id, seeded.experiment_id)

    for run_id in seeded.run_ids:
        recorded = [trace for trace in traces.traces if trace.run_id == run_id]
        assert len(recorded) == 2
        assert all(trace.traced and trace.spans for trace in recorded)
        assert [entry for entry in timeline.entries if run_id in entry.run_ids]


def test_every_definition_the_seed_authored_reached_a_published_version(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """The gates were passed rather than stepped around.

    An experiment cannot start on unpublished inputs, so the chain up to the scenario is
    already implied by the run existing. The judge is not — it is chosen at scoring time
    and pinned by nothing (ADR 0031) — so an unpublished one would be a real hole, and the
    library templates are asserted through the scenario version that pins them.
    """
    published: list[tuple[str, tuple[object, ...]]] = [
        ("shop", services.shops.list_versions(seeded.shop_id)),
        ("customer", services.profiles.list_versions(seeded.customer_id)),
        ("support identity", services.identities.list_versions(seeded.support_identity_id)),
        ("ticket", services.tickets.list_versions(seeded.ticket_id)),
        ("scenario", services.scenarios.list_versions(seeded.scenario_id)),
        ("judge", services.judges.list_versions(seeded.judge_id)),
        *(
            ("agent configuration", services.configurations.list_versions(configuration_id))
            for configuration_id in seeded.configuration_ids
        ),
    ]

    assert [name for name, versions in published if not versions] == []

    version = services.scenarios.get_version(seeded.scenario_id, seeded.scenario_version)
    assert {objective.id for objective in version.payload.objectives} == {
        content.READ_POLICY_OBJECTIVE,
        content.REDIRECT_OBJECTIVE,
        content.EXPLAINED_OBJECTIVE,
    }
    assert [mutation.id for mutation in version.payload.mutations] == [content.FAULT]


def test_the_seeded_shop_carries_the_content_the_studio_screens_read(
    services: SeedServices, seeded: DemoSeed
) -> None:
    """Frames 2 and 3, which read a catalog, a policy library and a voice.

    Named documents rather than counts, because the incident depends on them: the arms read
    the shipping policy by ID, and the recipe puts it in context.
    """
    shop = services.shops.get_version(seeded.shop_id, 1).payload

    assert len(shop.products) >= 3
    assert all(product.variants for product in shop.products)
    # Every product carries its images, each named by the file it shipped as and the words
    # it was written with, in the order the Media card lists them.
    assert {
        product.handle: [
            (
                services.media.open(seeded.shop_id, _hash_of(entry.reference)).asset.file_name,
                entry.alt_text,
            )
            for entry in product.media
        ]
        for product in shop.products
    } == {
        handle: [(image.file_name, image.alt_text) for image in images]
        for handle, images in content.PRODUCT_IMAGES.items()
    }
    # And each reference is an image the shop holds whose bytes hash to it: the very file
    # the package ships, stored as the type its first bytes say.
    for product in shop.products:
        for entry in product.media:
            held = services.media.open(seeded.shop_id, _hash_of(entry.reference))
            assert hashlib.sha256(held.content).hexdigest() == held.asset.sha256
            assert held.asset.reference == entry.reference
            image = _shipped(held.asset.file_name)
            assert held.content == content.image_bytes(image)
            assert held.asset.content_type is _type_named_by(image.file_name)
    assert {asset.file_name for asset in services.media.list(seeded.shop_id)} == {
        image.file_name for image in content.product_images()
    }
    assert content.SHIPPING_POLICY_ID in {policy.id for policy in shop.policies}
    assert len(shop.faq) >= 3
    assert len(shop.support_guidelines) >= 2
    assert shop.default_tone_of_voice is not None

    customer = services.profiles.get_version(seeded.customer_id, 1).payload
    addresses = {entry.id: entry for entry in customer.addresses}
    assert addresses[content.CURRENT_ADDRESS_ID].is_default
    assert addresses[content.CURRENT_ADDRESS_ID].city == "Lyon"
    assert addresses[content.STALE_ADDRESS_ID].city == "Bordeaux"


def _hash_of(reference: str) -> str:
    parsed = MediaAssetReference.of(reference)
    assert parsed is not None, f"{reference} is not an image the shop holds"
    return parsed.sha256


def _shipped(file_name: str) -> content.ProductImage:
    [image] = [image for image in content.product_images() if image.file_name == file_name]
    return image


_EXTENSION_TYPES = {".jpg": MediaType.JPEG, ".png": MediaType.PNG, ".webp": MediaType.WEBP}


def _type_named_by(file_name: str) -> MediaType:
    return _EXTENSION_TYPES[Path(file_name).suffix]


SEED_IMAGE_LIMIT = 16 * 1024
"""What one of the seed's images may weigh: small enough to commit, by the slice's rule."""


def test_the_images_the_package_ships_are_the_ones_the_seed_names_and_each_is_storable() -> None:
    """Read through `importlib.resources`, as an installed seed reads them.

    The directory is enumerated rather than the names, so a file added without being named,
    or named without being shipped, fails here; and each is held to the lab's own rule —
    its first bytes a PNG, a JPEG or a WebP agreeing with its extension — and to the size a
    committed image may have. Between them the four cover every type the lab stores.
    """
    shipped = resources.files("capability_lab.presentation.seed").joinpath("images")
    files = {entry.name: entry.read_bytes() for entry in shipped.iterdir() if entry.is_file()}

    assert set(files) == {image.file_name for image in content.product_images()}
    for name, data in files.items():
        assert len(data) < SEED_IMAGE_LIMIT, f"{name} is {len(data)} bytes"
        assert media_type_of(data) is _type_named_by(name), name
    assert {media_type_of(data) for data in files.values()} == set(MediaType)


# -- what it refuses -----------------------------------------------------------


async def test_the_seed_refuses_a_database_that_already_holds_one(
    migrated: str, alembic_config: Path, seeded: DemoSeed
) -> None:
    """The refusal this command exists to make, and the state it leaves behind.

    It names what is in the way and changes nothing: the experiment that was already there
    is still the only one, still with its own identifier.
    """
    stored_before = _files_under(media_root_for(migrated))
    assert len(stored_before) == len(content.product_images())

    with pytest.raises(DatabaseNotEmptyError) as refusal:
        await run_seed(settings_for(migrated), alembic_config=alembic_config)

    # Nothing was uploaded a second time: the same files, and only those.
    assert _files_under(media_root_for(migrated)) == stored_before

    occupied = dict(refusal.value.occupied)
    assert occupied["experiments"] == 1
    assert occupied["definition_versions"] > 0
    assert occupied["shop_media_assets"] == len(content.product_images())
    assert "delete the database file" in str(refusal.value)
    # The media root goes with the database, so the refusal names it beside the file.
    assert f"the media root {media_root_for(migrated)}" in str(refusal.value)

    for services in read(migrated):
        page = services.history.history(ExperimentHistoryQuery())
        assert page.total == 1
        assert page.entries[0].record.experiment_id == seeded.experiment_id


async def test_a_seed_that_fails_after_its_uploads_leaves_neither_rows_nor_images(
    migrated: str, alembic_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rollback takes the rows, and the seed takes the images it wrote with them.

    The next run mints another shop, so a directory the failed run left would never be
    reclaimed: the seed removes it before the failure reaches the operator, and a rerun
    holds the seeded shop's directory and nothing else.
    """

    def refuse(self: ShopService, definition_id: UUID) -> Any:
        raise RuntimeError("publishing failed")

    with monkeypatch.context() as patched:
        patched.setattr(ShopService, "publish", refuse)
        with pytest.raises(RuntimeError, match="publishing failed"):
            await run_seed(settings_for(migrated), alembic_config=alembic_config)

    engine = create_database_engine(migrated)
    with session_scope(create_session_factory(engine)) as session:
        assert occupied_tables(session) == ()
    engine.dispose()
    shops = media_root_for(migrated) / "shops"
    assert not shops.exists() or list(shops.iterdir()) == []

    seeded, _url = await run_seed(settings_for(migrated), alembic_config=alembic_config)

    assert [path.name for path in shops.iterdir()] == [str(seeded.shop_id)]


def test_the_tables_the_seed_guards_are_derived_from_the_mapped_schema() -> None:
    """The emptiness check looks at every table but the prototype's, and keeps doing so.

    A hand-kept list is the failure this replaces: the day a new evidence table lands, both
    the emptiness check and the schema check would silently stop looking at it and a seed
    would happily write beside somebody's run. Asserted as a partition of the mapped
    metadata, and the prototype's half is asserted to still *be* mapped, so a renamed POC
    table shows up here rather than being counted as authored state.
    """
    mapped = set(models.CustomerModel.metadata.tables)

    assert mapped >= POC_TABLES
    assert set(SEEDED_TABLES) == mapped - POC_TABLES
    assert {"definition_drafts", "definition_versions", "experiments"} <= set(SEEDED_TABLES)
    assert set(SEEDED_TABLES).isdisjoint(POC_TABLES)


async def test_a_database_holding_only_prototype_rows_is_still_empty(
    tmp_path: Path, alembic_config: Path
) -> None:
    """Rows the seed does not write are not rows it would be overwriting.

    The persona-first prototype's tables are the one thing a stale development database is
    likely to hold that this command has no opinion about (ADR 0043).
    """
    url = _database(tmp_path / "poc.db", stamp=head_revision(alembic_config))
    engine = create_database_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO customers (id, email, display_name, created_at) "
                "VALUES ('11111111-1111-1111-1111-111111111111', 'poc@example.org', "
                "'Prototype customer', '2026-01-01T00:00:00')"
            )
        )
    engine.dispose()

    seeded, _url = await run_seed(settings_for(url), alembic_config=alembic_config)

    assert len(seeded.run_ids) == 2


async def test_a_head_check_that_cannot_be_made_is_announced_rather_than_skipped(
    migrated: str, caplog: pytest.LogCaptureFixture
) -> None:
    """A check that quietly does not happen is worse than one that does not exist.

    The package can legitimately be installed without the migration tree beside it, so the
    head comparison is not a refusal in that case — but the operator asked for it, and what
    stays unverified is narrow enough to be worth naming out loud.
    """
    with caplog.at_level(logging.WARNING):
        seeded, _url = await run_seed(settings_for(migrated), alembic_config=None)

    assert len(seeded.run_ids) == 2
    assert [record.message for record in caplog.records if "alembic.ini" in record.message]


async def test_the_seed_refuses_a_database_with_no_schema(
    tmp_path: Path, alembic_config: Path
) -> None:
    url = f"sqlite:///{tmp_path / 'blank.db'}"

    with pytest.raises(DatabaseNotMigratedError, match="make migrate"):
        await run_seed(settings_for(url), alembic_config=alembic_config)


async def test_the_seed_refuses_a_database_behind_this_builds_migration_head(
    tmp_path: Path, alembic_config: Path
) -> None:
    """Stale is refused rather than seeded into, which is the failure that motivated this.

    The tables happen to be present here — the schema is built from today's metadata — so
    the only thing that can catch it is the stamp, which is exactly the case a seed run
    against a database four migrations behind would have hit.
    """
    url = _database(tmp_path / "stale.db", stamp=STALE_REVISION)

    with pytest.raises(DatabaseNotMigratedError) as refusal:
        await run_seed(settings_for(url), alembic_config=alembic_config)

    expected = head_revision(alembic_config)
    assert expected is not None
    assert STALE_REVISION in str(refusal.value)
    assert expected in str(refusal.value)


# -- what it never reaches -----------------------------------------------------


async def test_the_seed_runs_the_whole_story_with_the_network_removed(
    migrated: str, alembic_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No credential, no provider, no money — checked rather than claimed.

    Two things at once, and the first is the sharper of them. The settings are the declared
    defaults rather than the process's, so no key reaches this run: a seed composed against
    the ordinary framework registry would find neither model-backed framework available
    without one and would be refused the moment an arm was advanced. Completing without a
    credential is therefore a statement about which runtimes composition chose.

    Sockets are then taken away for the duration, so anything that did try to reach a
    provider fails loudly here instead of quietly succeeding on a developer's machine and
    failing on a locked-down one.
    """

    def refuse(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("the demo seed opened a socket")

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)

    settings = settings_for(migrated)
    assert settings.openai_api_key is None
    seeded, url = await run_seed(settings, alembic_config=alembic_config)

    assert url == migrated
    assert len(seeded.run_ids) == 2
    # The images went to the temporary media root this run was given, and nowhere else.
    stored = media_root_for(migrated) / "shops" / str(seeded.shop_id)
    assert sorted(path.name for path in stored.iterdir()) == sorted(
        hashlib.sha256(content.image_bytes(image)).hexdigest() for image in content.product_images()
    )
    # Both arms answered, which is what makes this a test rather than a formality. The
    # runner records an unrecognized exception from a runtime as a failed attempt and moves
    # on (ADR 0026), and a turn counts as delivered whether or not it was ever answered — so
    # an arm that had reached for a socket would still have produced a run identifier here.
    for services in read(migrated):
        entry = services.history.history(ExperimentHistoryQuery()).entries[0]
        assert [arm.awaiting for arm in entry.arms] == [ArmAwaiting.COMPLETED] * 2
        assert [arm.failed for arm in entry.arms] == [False, False]
        detail = services.experiments.get_experiment(seeded.shop_id, seeded.experiment_id)
        assert len(detail.agent_turns) == 4
        assert {turn.turn.outcome for turn in detail.agent_turns} == {AgentTurnOutcome.ANSWERED}


# -- the command itself --------------------------------------------------------


def test_the_command_reports_every_identifier_it_wrote(
    migrated: str, alembic_config: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The one thing the operator needs afterwards: what to open, and where it is."""
    code = main(["--database-url", migrated, "--alembic-config", str(alembic_config)])

    printed = capsys.readouterr().out
    assert code == 0
    assert migrated in printed
    for label in ("shop", "ticket", "scenario", "snapshot", "judge", "experiment", "run"):
        assert label in printed
    # Thirteen distinct identifiers: the shop, the customer, the support identity, the
    # order, the ticket, the scenario, the snapshot, the judge, the two agent
    # configurations, the experiment, and one per arm. Everything the demo made, and
    # nothing reported twice.
    identifiers = [word for line in printed.splitlines() for word in line.split() if _is_uuid(word)]
    assert len(identifiers) == len(set(identifiers)) == 13


def test_the_command_says_why_it_refused_and_answers_with_a_failure(
    migrated: str, alembic_config: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """A refusal is an exit code, not a traceback: the operator has something to do."""
    assert main(["--database-url", migrated, "--alembic-config", str(alembic_config)]) == 0
    capsys.readouterr()

    code = main(["--database-url", migrated, "--alembic-config", str(alembic_config)])

    captured = capsys.readouterr()
    assert code == 1
    assert captured.out == ""
    assert "Refusing to seed" in captured.err
    assert "already holds seeded data" in captured.err


def _files_under(root: Path) -> dict[str, str]:
    """Every file under a media root, by its path below the root, with its bytes' hash."""
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


def _is_uuid(word: str) -> bool:
    try:
        UUID(word)
    except ValueError:
        return False
    return True
