from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.orm import Mapped, mapped_column

from capability_lab.infrastructure.database import Base
from capability_lab.infrastructure.sql_types import UtcDateTime


class CustomerModel(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ProductModel(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sku: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(200))
    price_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3))


class OrderModel(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_orders_version_positive"),
        CheckConstraint(
            "status IN ('pending', 'paid', 'cancelled')",
            name="ck_orders_status_valid",
        ),
        Index("ix_orders_customer_id", "customer_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    status: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ConversationSessionModel(Base):
    __tablename__ = "conversation_sessions"
    __table_args__ = (Index("ix_conversation_sessions_customer_id", "customer_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    seed: Mapped[int] = mapped_column(BigInteger)
    scenario_id: Mapped[str] = mapped_column(String(64), server_default="retail-profile")
    scenario_version: Mapped[str] = mapped_column(String(64))
    framework_id: Mapped[str] = mapped_column(String(64), server_default="fake")
    initial_state_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ConversationTurnModel(Base):
    __tablename__ = "conversation_turns"
    __table_args__ = (
        UniqueConstraint("session_id", "ordinal", name="uq_conversation_turns_ordinal"),
        Index("ix_conversation_turns_session_id", "session_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("conversation_sessions.id"))
    ordinal: Mapped[int] = mapped_column(Integer)
    request_message: Mapped[str] = mapped_column(String(4000))
    response_message: Mapped[str] = mapped_column(String(8000))
    structured_result: Mapped[dict[str, object]] = mapped_column(JSON)
    tool_activity: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    trace_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class MemoryRecordModel(Base):
    __tablename__ = "memory_records"
    __table_args__ = (Index("ix_memory_records_session_id", "session_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("conversation_sessions.id"))
    namespace: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict[str, object]] = mapped_column(MutableDict.as_mutable(JSON))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class IdempotencyRecordModel(Base):
    __tablename__ = "idempotency_records"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    operation: Mapped[str] = mapped_column(String(100), primary_key=True)
    response: Mapped[dict[str, object]] = mapped_column(MutableDict.as_mutable(JSON))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class PersonaModel(Base):
    __tablename__ = "personas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320))
    locale: Mapped[str] = mapped_column(String(32))
    support_traits: Mapped[list[str]] = mapped_column(JSON)


class GeneratedScenarioModel(Base):
    __tablename__ = "generated_scenarios"
    __table_args__ = (
        CheckConstraint("seed >= 0 AND seed <= 4294967295", name="ck_generated_seed_range"),
        UniqueConstraint(
            "scenario_id",
            "scenario_version",
            "seed",
            name="uq_generated_scenarios_reference",
        ),
    )

    initial_state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(64))
    scenario_version: Mapped[str] = mapped_column(String(64))
    policy_set_version: Mapped[str] = mapped_column(String(64))
    canonical_schema_version: Mapped[str] = mapped_column(String(64))
    seed: Mapped[int] = mapped_column(BigInteger)
    persona_id: Mapped[str] = mapped_column(ForeignKey("personas.id"))
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class GeneratedScenarioProductModel(Base):
    __tablename__ = "generated_scenario_products"

    initial_state_hash: Mapped[str] = mapped_column(
        ForeignKey("generated_scenarios.initial_state_hash"), primary_key=True
    )
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), primary_key=True)


class GeneratedScenarioOrderModel(Base):
    __tablename__ = "generated_scenario_orders"

    initial_state_hash: Mapped[str] = mapped_column(
        ForeignKey("generated_scenarios.initial_state_hash"), primary_key=True
    )
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ActionProposalModel(Base):
    __tablename__ = "action_proposals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('proposed', 'confirmed', 'cancelled', 'executed')",
            name="ck_action_proposals_status_valid",
        ),
        Index("ix_action_proposals_session_id", "session_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("conversation_sessions.id"))
    action_type: Mapped[str] = mapped_column(String(64))
    tool_name: Mapped[str] = mapped_column(String(100))
    tool_version: Mapped[str] = mapped_column(String(64))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"))
    expected_version: Mapped[int] = mapped_column(Integer)
    summary: Mapped[str] = mapped_column(String(1000))
    confirmation_token: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32))
    attempts: Mapped[int] = mapped_column(Integer)
    result_order_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    result_order_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


class DefinitionDraftModel(Base):
    """The single mutable draft of one authorable definition."""

    __tablename__ = "definition_drafts"
    __table_args__ = (
        CheckConstraint(
            "definition_type IN ("
            "'shop', 'customer_profile', 'support_identity', 'ticket', 'scenario', "
            "'objective_block', 'mutation_block', 'agent_configuration', "
            "'judge_configuration')",
            name="ck_definition_drafts_type_valid",
        ),
        Index("ix_definition_drafts_shop_id", "shop_id"),
    )

    definition_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    definition_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    references: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime())


class DefinitionVersionModel(Base):
    """An immutable published version; the primary key forbids overwriting one."""

    __tablename__ = "definition_versions"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_definition_versions_version_positive"),
        CheckConstraint(
            "shop_version IS NULL OR shop_version >= 1",
            name="ck_definition_versions_shop_version_positive",
        ),
        CheckConstraint(
            "definition_type IN ("
            "'shop', 'customer_profile', 'support_identity', 'ticket', 'scenario', "
            "'objective_block', 'mutation_block', 'agent_configuration', "
            "'judge_configuration')",
            name="ck_definition_versions_type_valid",
        ),
        Index("ix_definition_versions_definition", "definition_type", "definition_id"),
    )

    definition_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    definition_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    content_fingerprint: Mapped[str] = mapped_column(String(64))
    shop_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    shop_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    references: Mapped[list[dict[str, object]]] = mapped_column(JSON)
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    published_at: Mapped[datetime] = mapped_column(UtcDateTime())


class DefinitionShopAttachmentModel(Base):
    """Which shops use a shop-independent definition.

    An attachment scopes the Studio's per-shop lists; it pins no version and never enters
    a content or sandbox fingerprint, so it is deliberately not an ADR 0012 reference.
    """

    __tablename__ = "definition_shop_attachments"
    __table_args__ = (
        CheckConstraint(
            "definition_type IN ('customer_profile', 'support_identity')",
            name="ck_definition_shop_attachments_type_valid",
        ),
        Index("ix_definition_shop_attachments_shop", "definition_type", "shop_id"),
    )

    definition_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    definition_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    attached_at: Mapped[datetime] = mapped_column(UtcDateTime())


class OrderFixtureModel(Base):
    """One authored order fixture, stored as its canonical `order-fixture-v1` document.

    Orders are not definitions (ADR 0012 fixes the definition types), so they live in their
    own table rather than in `definition_drafts`. `reference` and `customer_profile_id` are
    written from the document by the repository: they exist as columns so the shop-unique
    reference can be a constraint and a shop's orders can be found for one customer, never
    as a second source of truth.
    """

    __tablename__ = "shop_order_fixtures"
    __table_args__ = (
        UniqueConstraint("shop_id", "reference", name="uq_shop_order_fixtures_reference"),
        Index("ix_shop_order_fixtures_customer", "shop_id", "customer_profile_id"),
    )

    shop_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    reference: Mapped[str] = mapped_column(String(64))
    customer_profile_id: Mapped[str] = mapped_column(String(36))
    content_fingerprint: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime())


class SandboxSnapshotModel(Base):
    """One immutable sandbox snapshot, stored as its canonical `sandbox-v2` document.

    Written once and never updated: the document *is* the snapshot, and the columns beside
    it exist so a shop's snapshots can be found by scenario or recognized by fingerprint.
    They are written from the document by the repository, never as a second source of truth.

    The fingerprint is unique per shop rather than globally: identical starting state in two
    shops is two snapshots, because each belongs to the shop whose objects it froze.
    """

    __tablename__ = "sandbox_snapshots"
    __table_args__ = (
        CheckConstraint("scenario_version >= 1", name="ck_sandbox_snapshots_version_positive"),
        CheckConstraint("seed >= 0", name="ck_sandbox_snapshots_seed_non_negative"),
        UniqueConstraint("shop_id", "sandbox_fingerprint", name="uq_sandbox_snapshots_fingerprint"),
        Index("ix_sandbox_snapshots_scenario", "shop_id", "scenario_id", "scenario_version"),
    )

    snapshot_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[str] = mapped_column(String(36))
    scenario_id: Mapped[str] = mapped_column(String(36))
    scenario_version: Mapped[int] = mapped_column(Integer)
    seed: Mapped[int] = mapped_column(BigInteger)
    sandbox_fingerprint: Mapped[str] = mapped_column(String(64))
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class SandboxModel(Base):
    """One arm's mutable clone of a snapshot, stored as its `sandbox-state-v1` document.

    Every clone owns its row and its own copy of the state: the isolation between two arms
    is this table having two rows rather than one shared one. `snapshot_fingerprint` and
    `state_fingerprint` are written from the document — the first read out of it, the second
    the hash of it — never as a second source of truth.

    There is deliberately **no** unique constraint over `state_fingerprint`: two arms of one
    experiment start from the same bytes on purpose, which is the opposite of the rule
    `sandbox_snapshots` holds. `revision` is the optimistic-concurrency token an update
    predicates on.
    """

    __tablename__ = "sandboxes"
    __table_args__ = (
        CheckConstraint("revision >= 0", name="ck_sandboxes_revision_non_negative"),
        Index("ix_sandboxes_snapshot", "shop_id", "snapshot_id"),
    )

    sandbox_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[str] = mapped_column(String(36))
    snapshot_id: Mapped[str] = mapped_column(String(36))
    label: Mapped[str] = mapped_column(String(200))
    revision: Mapped[int] = mapped_column(Integer)
    snapshot_fingerprint: Mapped[str] = mapped_column(String(64))
    state_fingerprint: Mapped[str] = mapped_column(String(64))
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime())


class SandboxActionProposalModel(Base):
    """One proposed change to one arm, and the single result of applying it.

    The primary key is the arm plus the confirmation, and both halves are load-bearing. The
    confirmation is the hash of the change, so two arms proposing the same change against the
    same state mint the same name — comparable evidence, deliberately. Keying it by arm as
    well is what keeps them isolated all the same: a name minted in one arm is not a proposal
    in the arm beside it.

    `applied_at`, `applied_revision`, and `result` are written together or not at all: a row
    is open or closed, never half of each. The check constraint says so rather than leaving it
    to the one code path that writes them.
    """

    __tablename__ = "sandbox_action_proposals"
    __table_args__ = (
        CheckConstraint(
            "expected_revision >= 0", name="ck_sandbox_action_proposals_revision_non_negative"
        ),
        CheckConstraint(
            "(applied_at IS NULL) = (result IS NULL) "
            "AND (applied_at IS NULL) = (applied_revision IS NULL)",
            name="ck_sandbox_action_proposals_applied_together",
        ),
        Index("ix_sandbox_action_proposals_sandbox", "sandbox_id", "created_at"),
    )

    sandbox_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    confirmation: Mapped[str] = mapped_column(String(64), primary_key=True)
    shop_id: Mapped[str] = mapped_column(String(36))
    tool: Mapped[str] = mapped_column(String(120))
    version: Mapped[str] = mapped_column(String(20))
    order_id: Mapped[str] = mapped_column(String(36))
    address_id: Mapped[str] = mapped_column(String(64))
    expected_revision: Mapped[int] = mapped_column(Integer)
    proposal: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
    applied_at: Mapped[datetime | None] = mapped_column(UtcDateTime(), nullable=True)
    applied_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)


class ExperimentModel(Base):
    """One immutable experiment, stored as its canonical `experiment-v1` document.

    Written once and never updated: an experiment's inputs are what explain its result, so
    there is no path that could edit them after a run has begun. The columns beside the
    document exist so a shop's experiments can be listed and recognized by fingerprint, and
    are written from the document by the repository rather than as a second source of truth.

    There is deliberately **no** uniqueness over `resolution_fingerprint`: running the same
    scenario against the same arms twice is two experiments, for the reason cloning a
    snapshot twice is two arms (ADR 0020). Recognizing a repeat is what the fingerprint is
    for; collapsing one would delete the second result.

    `snapshot_id` carries no foreign key, deliberately. The snapshot is provenance recorded
    inside the fingerprinted document; the column beside it exists so an experiment's arms can
    be found without decoding, and `sandbox_snapshots` is already write-once, so a constraint
    would guard a row nothing can delete. The same rule as `shop_id`, which no table
    references either.
    """

    __tablename__ = "experiments"
    __table_args__ = (
        CheckConstraint("scenario_version >= 1", name="ck_experiments_version_positive"),
        CheckConstraint("seed >= 0", name="ck_experiments_seed_non_negative"),
        CheckConstraint(
            "participant_driver IN ('human', 'llm', 'scripted')",
            name="ck_experiments_participant_driver_valid",
        ),
        Index("ix_experiments_shop", "shop_id", "created_at"),
    )

    experiment_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    shop_id: Mapped[str] = mapped_column(String(36))
    label: Mapped[str] = mapped_column(String(200))
    scenario_id: Mapped[str] = mapped_column(String(36))
    scenario_version: Mapped[int] = mapped_column(Integer)
    seed: Mapped[int] = mapped_column(BigInteger)
    snapshot_id: Mapped[str] = mapped_column(String(36))
    sandbox_fingerprint: Mapped[str] = mapped_column(String(64))
    resolution_fingerprint: Mapped[str] = mapped_column(String(64))
    participant_driver: Mapped[str] = mapped_column(String(16))
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ExperimentRunModel(Base):
    """One arm of one experiment, bound to the sandbox it works in.

    The sandbox is referenced, not embedded: an arm's isolation is its own row in
    `sandboxes` (ADR 0020), and duplicating any of that state here would give a run a second
    world that could disagree with the one its tools move.

    `position` is unique inside an experiment, so "arm A" means one arm however the rows are
    ordered on the way out.
    """

    __tablename__ = "experiment_runs"
    __table_args__ = (
        CheckConstraint("position >= 0", name="ck_experiment_runs_position_non_negative"),
        CheckConstraint(
            "agent_configuration_version >= 1",
            name="ck_experiment_runs_configuration_version_positive",
        ),
        UniqueConstraint("experiment_id", "position", name="uq_experiment_runs_position"),
        UniqueConstraint("sandbox_id", name="uq_experiment_runs_sandbox"),
        Index("ix_experiment_runs_experiment", "experiment_id", "position"),
    )

    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.experiment_id"))
    shop_id: Mapped[str] = mapped_column(String(36))
    position: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(200))
    agent_configuration_id: Mapped[str] = mapped_column(String(36))
    agent_configuration_version: Mapped[int] = mapped_column(Integer)
    sandbox_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ParticipantTurnModel(Base):
    """One customer turn as one run received it.

    The primary key is the run plus the ordinal, which is what makes the stream append-only:
    a turn cannot be renumbered onto another position and a run cannot receive two turns at
    the same depth. `turn_id` is deliberately *not* unique — it is the composition the turn
    belongs to, and a message the operator sent to both arms is one composition in two rows.
    That is the divergence record: a `turn_id` held by one arm alone was written for that arm
    alone.

    `body` is synthetic customer content. It is stored, as the order fixtures beside it are,
    and it is never logged or traced (`AGENTS.md`).

    `experiment_id` is a query column rather than a second owner: the turn belongs to its run,
    which is what the foreign key says, and this is how a whole experiment's threads are read
    in one statement. The driver-matches-source constraint is written as a boolean equality,
    which SQLite and PostgreSQL both accept; a third dialect would want `CASE`.
    """

    __tablename__ = "experiment_participant_turns"
    __table_args__ = (
        CheckConstraint("ordinal >= 0", name="ck_participant_turns_ordinal_non_negative"),
        CheckConstraint(
            "source IN ('trigger', 'participant')", name="ck_participant_turns_source_valid"
        ),
        CheckConstraint(
            "(source = 'trigger') = (driver IS NULL)",
            name="ck_participant_turns_driver_matches_source",
        ),
        Index("ix_participant_turns_experiment", "experiment_id", "created_at"),
        Index("ix_participant_turns_composition", "experiment_id", "turn_id"),
    )

    run_id: Mapped[str] = mapped_column(ForeignKey("experiment_runs.run_id"), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(String(36))
    turn_id: Mapped[str] = mapped_column(String(36))
    source: Mapped[str] = mapped_column(String(16))
    driver: Mapped[str | None] = mapped_column(String(16), nullable=True)
    body: Mapped[str] = mapped_column(String(4000))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class AgentTurnModel(Base):
    """One attempt at one arm's reply to one customer turn.

    The primary key is the run, the customer turn being answered, and the attempt number.
    That is what makes the stream append-only in the two ways it has to be: an arm can hold
    only one answer per question, and a retry after a failure is a new row rather than an
    overwrite of the evidence it is retrying.

    The driver-matches-source shape of the participant table has an analogue here, written
    the same way: an answered turn carries words and no failure code, a failed one carries a
    code and no words. A failed attempt deliberately stores nothing the framework said —
    nothing can promise an arbitrary exception's text is free of customer content.

    `body` is synthetic content in a support thread. It is stored, as the participant turns
    beside it are, and it is never logged or traced (`AGENTS.md`).

    The four measurement columns are nullable because "the lab did not measure this" is a
    real state: rows written before the lab measured have no duration, and a framework that
    does not meter itself reports no usage (ADR 0032). Nullable rather than defaulted to
    zero, because a zero would be counted into a total a comparison reads.
    """

    __tablename__ = "experiment_agent_turns"
    __table_args__ = (
        CheckConstraint("ordinal >= 0", name="ck_agent_turns_ordinal_non_negative"),
        CheckConstraint("attempt >= 1", name="ck_agent_turns_attempt_positive"),
        CheckConstraint("outcome IN ('answered', 'failed')", name="ck_agent_turns_outcome_valid"),
        CheckConstraint(
            "(outcome = 'failed') = (failure IS NOT NULL)",
            name="ck_agent_turns_failure_matches_outcome",
        ),
        CheckConstraint(
            "(outcome = 'answered') = (length(body) > 0)",
            name="ck_agent_turns_body_matches_outcome",
        ),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0", name="ck_agent_turns_duration_non_negative"
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="ck_agent_turns_input_tokens_non_negative",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="ck_agent_turns_output_tokens_non_negative",
        ),
        CheckConstraint(
            "model_requests IS NULL OR model_requests >= 0",
            name="ck_agent_turns_model_requests_non_negative",
        ),
        # Usage is one reading or none of it: an attempt cannot know its input tokens and
        # not its output tokens, and a half-filled row would total as if the other half
        # were zero.
        CheckConstraint(
            "(input_tokens IS NULL) = (model_requests IS NULL) "
            "AND (output_tokens IS NULL) = (model_requests IS NULL)",
            name="ck_agent_turns_usage_is_whole",
        ),
        # And the rule `ModelUsage` itself refuses: tokens spent with no request that spent
        # them. The value object would raise on the way out, which turns one hand-written
        # row into an experiment nobody can read at all — so the table refuses it on the way
        # in, where the mistake still belongs to whoever made it.
        CheckConstraint(
            "model_requests IS NULL OR model_requests > 0 "
            "OR (input_tokens = 0 AND output_tokens = 0)",
            name="ck_agent_turns_usage_has_a_request",
        ),
        Index("ix_agent_turns_experiment", "experiment_id", "created_at"),
    )

    run_id: Mapped[str] = mapped_column(ForeignKey("experiment_runs.run_id"), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(String(36))
    outcome: Mapped[str] = mapped_column(String(16))
    failure: Mapped[str | None] = mapped_column(String(32), nullable=True)
    body: Mapped[str] = mapped_column(String(4000))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_requests: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ToolEventModel(Base):
    """One tool call one attempt made, and what it did to the arm.

    Keyed by the attempt that made it plus the sequence the agent asked in, so tool
    selection and ordering are evidence rather than something reconstructed from timestamps
    — two calls made inside one attempt share a moment.

    `document` is the `tool-result-v1` envelope the tool answered with, stored whole and
    authoritative; `tool`, `version`, and `outcome` are read out of it so a run's calls can
    be listed and counted without decoding every row, exactly as an experiment's provenance
    columns are read out of its document.

    The two revisions are the state change, and they are the reason no separate state-change
    table exists: a read leaves them equal, a write moves the arm by one, and the
    confirmation that authorized the write is inside the document already.
    """

    __tablename__ = "experiment_tool_events"
    __table_args__ = (
        CheckConstraint("ordinal >= 0", name="ck_tool_events_ordinal_non_negative"),
        CheckConstraint("attempt >= 1", name="ck_tool_events_attempt_positive"),
        CheckConstraint("sequence >= 0", name="ck_tool_events_sequence_non_negative"),
        CheckConstraint(
            "outcome IN ('success', 'refused', 'failed')", name="ck_tool_events_outcome_valid"
        ),
        CheckConstraint(
            "revision_after >= revision_before", name="ck_tool_events_revision_forward"
        ),
        CheckConstraint(
            "duration_ms IS NULL OR duration_ms >= 0", name="ck_tool_events_duration_non_negative"
        ),
        Index("ix_tool_events_experiment", "experiment_id", "created_at"),
        Index("ix_tool_events_attempt", "run_id", "ordinal", "attempt", "sequence"),
    )

    run_id: Mapped[str] = mapped_column(ForeignKey("experiment_runs.run_id"), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt: Mapped[int] = mapped_column(Integer, primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(String(36))
    tool: Mapped[str] = mapped_column(String(80))
    version: Mapped[str] = mapped_column(String(16))
    outcome: Mapped[str] = mapped_column(String(16))
    document: Mapped[dict[str, object]] = mapped_column(JSON)
    revision_before: Mapped[int] = mapped_column(Integer)
    revision_after: Mapped[int] = mapped_column(Integer)
    state_fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class RunSpanModel(Base):
    """One span of one attempt: where it sat in the trace, and when inside the attempt it ran.

    Stored rather than projected because the record cannot answer for it. An attempt and
    every call it made are timestamped from one reading of the clock (ADR 0027), so the
    record says how long a call took and never *when* in the attempt it took it — and the
    gaps between the calls, which are the framework's own time, are exactly what a waterfall
    is read for.

    There is deliberately no attribute column. Which tool this span timed, what it answered,
    and which revisions it moved are joined from `experiment_tool_events` through
    `(run_id, ordinal, attempt, sequence)`; a free-form attribute map on an evidence row is
    the back door around the `CUSTOMER_ONLY` rule ADR 0021 enforces on tools, and a table
    whose every column is a hex identifier, a small integer, or a closed enum cannot be one.

    `started_offset_ms` is relative to the start of the attempt rather than absolute, for the
    same reason: an absolute timestamp would be a second answer to what `created_at` already
    says, taken from a clock the runner reads once.
    """

    __tablename__ = "experiment_run_spans"
    __table_args__ = (
        CheckConstraint("ordinal >= 0", name="ck_run_spans_ordinal_non_negative"),
        CheckConstraint("attempt >= 1", name="ck_run_spans_attempt_positive"),
        CheckConstraint("kind IN ('attempt', 'runtime', 'tool')", name="ck_run_spans_kind_valid"),
        CheckConstraint("started_offset_ms >= 0", name="ck_run_spans_started_offset_non_negative"),
        CheckConstraint("duration_ms >= 0", name="ck_run_spans_duration_non_negative"),
        # The coordinate is the join, so it has to mean one thing: exactly a tool span
        # carries the sequence of the call it timed, and exactly the attempt span is a root.
        CheckConstraint(
            "(kind = 'tool') = (sequence IS NOT NULL)", name="ck_run_spans_sequence_matches_kind"
        ),
        CheckConstraint(
            "sequence IS NULL OR sequence >= 0", name="ck_run_spans_sequence_non_negative"
        ),
        CheckConstraint(
            "(kind = 'attempt') = (parent_span_id IS NULL)", name="ck_run_spans_one_root"
        ),
        Index("ix_run_spans_experiment", "experiment_id", "created_at"),
        # Narrows to one attempt's spans, which is the only way this table is ever read. The
        # offset is the trailing column so a scan comes back in a stable order; it is not the
        # order the spans are listed in, which the projection decides from their coordinates.
        Index("ix_run_spans_attempt", "run_id", "ordinal", "attempt", "started_offset_ms"),
    )

    run_id: Mapped[str] = mapped_column(ForeignKey("experiment_runs.run_id"), primary_key=True)
    span_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(String(36))
    trace_id: Mapped[str] = mapped_column(String(32))
    parent_span_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    kind: Mapped[str] = mapped_column(String(16))
    ordinal: Mapped[int] = mapped_column(Integer)
    attempt: Mapped[int] = mapped_column(Integer)
    sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_offset_ms: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class MutationEventModel(Base):
    """One scenario fault firing into one arm, and what it did to that arm.

    Keyed by the arm and the bound mutation, which is the whole of the once-per-arm rule:
    a fault that has happened to a world cannot happen to it again, and the store says so
    rather than the runtime remembering to check (ADR 0028).

    `after_calls` is how many calls the attempt had already made when the fault fired, so a
    firing sits *between* two of the agent's calls rather than merely inside the same turn.
    That is what makes the concurrency refusal readable: the agent proposed against a world,
    the fault moved it, and the write no longer applied.

    The two revisions are the state change, recorded exactly as a tool event records one. No
    copy of the order and no description of the change: the arm's own state document is the
    world afterwards, and a second description could disagree with it.
    """

    __tablename__ = "experiment_mutation_events"
    __table_args__ = (
        CheckConstraint("ordinal >= 0", name="ck_mutation_events_ordinal_non_negative"),
        CheckConstraint("attempt >= 1", name="ck_mutation_events_attempt_positive"),
        CheckConstraint("after_calls >= 0", name="ck_mutation_events_after_calls_non_negative"),
        CheckConstraint("block_version >= 1", name="ck_mutation_events_block_version_positive"),
        # A fault that left the arm where it was is not a firing, so it is never written.
        CheckConstraint(
            "revision_after > revision_before", name="ck_mutation_events_revision_forward"
        ),
        Index("ix_mutation_events_experiment", "experiment_id", "created_at"),
        Index("ix_mutation_events_arm", "run_id", "ordinal", "attempt", "after_calls"),
    )

    run_id: Mapped[str] = mapped_column(ForeignKey("experiment_runs.run_id"), primary_key=True)
    mutation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(String(36))
    block_id: Mapped[str] = mapped_column(String(36))
    block_version: Mapped[int] = mapped_column(Integer)
    effect: Mapped[str] = mapped_column(String(32))
    timing: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(128))
    ordinal: Mapped[int] = mapped_column(Integer)
    attempt: Mapped[int] = mapped_column(Integer)
    after_calls: Mapped[int] = mapped_column(Integer)
    revision_before: Mapped[int] = mapped_column(Integer)
    revision_after: Mapped[int] = mapped_column(Integer)
    state_fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class JudgementModel(Base):
    """One judge execution against one objective of one arm.

    Keyed by the arm, the objective, and the attempt: scoring a row again writes attempt
    *n+1* beside the last verdict rather than over it, because "the judge said something
    else when we reran it" is exactly the kind of thing a rerunnable evaluator exists to
    make visible (ADR 0031).

    The judge and its version, the provider and model that ran, and the fingerprint of the
    anonymized brief are columns rather than a document: a verdict has to be explainable
    from the row an operator is reading, and a judge published again afterwards must not
    change what a recorded execution says it read.

    A scored execution carries an outcome and may carry a rationale; a failed one carries a
    code and no words, for the reason a failed agent turn carries no body — nothing can
    promise a provider's error text is free of the synthetic customer content the brief
    holds.
    """

    __tablename__ = "experiment_judgements"
    __table_args__ = (
        CheckConstraint("attempt >= 1", name="ck_judgements_attempt_positive"),
        CheckConstraint("judge_version >= 1", name="ck_judgements_judge_version_positive"),
        CheckConstraint(
            "outcome IS NULL OR outcome IN ('met', 'missed', 'unclear')",
            name="ck_judgements_outcome_valid",
        ),
        CheckConstraint(
            "(outcome IS NULL) = (failure IS NOT NULL)",
            name="ck_judgements_failure_matches_outcome",
        ),
        CheckConstraint(
            "failure IS NULL OR length(rationale) = 0",
            name="ck_judgements_failure_has_no_rationale",
        ),
        Index("ix_judgements_experiment", "experiment_id", "created_at"),
    )

    run_id: Mapped[str] = mapped_column(ForeignKey("experiment_runs.run_id"), primary_key=True)
    objective_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempt: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(String(36))
    judge_id: Mapped[str] = mapped_column(String(36))
    judge_version: Mapped[int] = mapped_column(Integer)
    provider: Mapped[str] = mapped_column(String(32))
    model_id: Mapped[str] = mapped_column(String(200))
    brief_fingerprint: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    failure: Mapped[str | None] = mapped_column(String(32), nullable=True)
    rationale: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ExperimentDerivationModel(Base):
    """That one experiment was derived from another, and in which of the two ways.

    Beside the experiments rather than a column on them: `experiments` holds the canonical
    document plus the columns read *out of* it, and where a run came from is not one of its
    inputs — a derived run would run identically without knowing. It is also a runtime
    identifier, which ADR 0012 keeps out of fingerprinted bytes, so it could not have gone
    into the envelope either.

    One table with a `kind` rather than one table per operation. A replay and a fork are the
    same row — a derived experiment, the run it came from, and when — and every reader of
    that row asks the same question of it. What differs is one word, and that word is what a
    reader has to show: "replay of" and "fork of" are not the same sentence.

    The derived experiment is the primary key: an experiment is derived once, by the act
    that created it, and a second row would be a second story about where it came from. Both
    ends are foreign keys because neither experiment can be deleted.

    There is deliberately no index on the source. A derived run names what it came from and
    nothing asks the question from the other end yet; an index for a read that does not exist
    is the speculative structure this codebase keeps refusing to add ahead of its caller.
    """

    __tablename__ = "experiment_derivations"
    __table_args__ = (
        CheckConstraint(
            "experiment_id <> source_experiment_id", name="ck_experiment_derivations_distinct"
        ),
        # Held to its closed vocabulary as every other one here is: a stray value would raise
        # on the way back to a `DerivationKind` and take out both the run's own screen and the
        # cross-shop listing that projects every run through it.
        CheckConstraint("kind IN ('replay', 'fork')", name="ck_experiment_derivations_kind_valid"),
    )

    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.experiment_id"), primary_key=True
    )
    source_experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.experiment_id"))
    kind: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ExperimentNoteModel(Base):
    """One thing an operator wrote about a run, in its own row beside the experiment.

    Beside rather than inside, deliberately: `experiments` is written once because its
    document is what explains the result, and an annotation table is what lets a run be
    written *about* without the record it is fingerprinted from ever moving.

    Append-only, like every other evidence stream here: there is no update path, so a note
    is what a reviewer thought when they read the run rather than what they would rather
    have said later.

    `body` may quote what a synthetic customer said. It is stored as the participant turns
    beside it are, and it is never logged or traced (`AGENTS.md`).
    """

    __tablename__ = "experiment_notes"
    __table_args__ = (Index("ix_experiment_notes_experiment", "experiment_id", "created_at"),)

    note_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.experiment_id"))
    body: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime())


class ExperimentTagModel(Base):
    """One shelf a run is filed on.

    The primary key is the run and the tag, which is what makes the set a set: filing a run
    twice under one tag cannot produce two chips, and a history facet built from these rows
    can never offer one shelf twice. The stored value is already folded (`fold_tag`), so
    comparison is equality rather than a rule the reader has to remember.

    Rows are deleted and rewritten when the set is replaced, unlike everything else stored
    about an experiment. That is the point: how a run is filed is a current classification,
    not a record of what happened to it — which is also why there is no timestamp here. A
    written-at column would survive a replacement as a fiction, and a rewritten one would
    report every shelf as filed the last time any of them changed.
    """

    __tablename__ = "experiment_tags"
    __table_args__ = (Index("ix_experiment_tags_tag", "tag"),)

    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.experiment_id"), primary_key=True
    )
    tag: Mapped[str] = mapped_column(String(64), primary_key=True)
