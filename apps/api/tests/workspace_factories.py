"""Service-level workspace builders shared by the suites that need a seeded shop.

A ticket suite, a scenario suite, a snapshot suite, and anything after them all need the same
starting point: a shop with a catalog, one attached customer with an address book, a paid
order shipping to the stale address, and the published recipe built on top of them. They share
it through this module rather than by importing one another, so no suite depends on another
suite's internals.
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from opentelemetry.sdk.trace import TracerProvider
from sqlalchemy.orm import Session

from agent_factories import publishable_configuration
from block_factories import publishable_mutation, publishable_objective
from capability_lab.application.agent_configurations import AgentConfigurationService
from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.blocks import MutationBlockService, ObjectiveBlockService
from capability_lab.application.customer_profiles import CustomerProfileService
from capability_lab.application.evaluation import ExperimentEvaluationService
from capability_lab.application.experiment_annotations import ExperimentAnnotationService
from capability_lab.application.experiment_replays import ExperimentReplayService
from capability_lab.application.experiment_runs import ExperimentRunner
from capability_lab.application.experiment_traces import ExperimentTraceService, RunTracer
from capability_lab.application.experiments import ArmSelection, ExperimentService
from capability_lab.application.judge_configurations import JudgeConfigurationService
from capability_lab.application.judge_runs import ExperimentJudgeService
from capability_lab.application.judge_runtime import JudgeRuntimeRegistry
from capability_lab.application.order_fixtures import (
    OrderEdit,
    OrderEventDraft,
    OrderFixtureService,
    OrderLineSelection,
)
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_actions import SandboxActionService, ToolActor
from capability_lab.application.sandbox_materialization import (
    SandboxSnapshotRecord,
    SandboxSnapshotService,
)
from capability_lab.application.sandbox_tools import SandboxToolService, ToolHandler
from capability_lab.application.sandboxes import SandboxRecord, SandboxService
from capability_lab.application.scenario_mutations import ScenarioMutationRuntime
from capability_lab.application.scenarios import ScenarioService
from capability_lab.application.shops import ShopService
from capability_lab.application.support_identities import SupportIdentityService
from capability_lab.application.tickets import TicketService
from capability_lab.domain.blocks import ObjectiveSeverity
from capability_lab.domain.customer_profile import CustomerProfilePayload
from capability_lab.domain.judge import JudgeConfigurationPayload
from capability_lab.domain.order_fixture import FulfilmentStatus, PaymentStatus
from capability_lab.domain.scenario import (
    BoundMutation,
    BoundObjective,
    CompletionConditions,
    ContextDocument,
    ScenarioBinding,
    ScenarioPayload,
)
from capability_lab.domain.shop import ShopDocumentKind, SupportChannel
from capability_lab.domain.support_identity import SupportIdentityPayload
from capability_lab.domain.ticket import SuggestedDocument
from capability_lab.infrastructure.agents.fake import FakeSupportAgentRuntime
from capability_lab.infrastructure.judges import ControlJudgeRuntime
from capability_lab.infrastructure.participants.scripted import ScriptedParticipantDriver
from capability_lab.infrastructure.repositories import (
    SqlAlchemyAgentTurnRepository,
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyExperimentAnnotationRepository,
    SqlAlchemyExperimentReplayRepository,
    SqlAlchemyExperimentRepository,
    SqlAlchemyExperimentRunRepository,
    SqlAlchemyJudgementRepository,
    SqlAlchemyMutationEventRepository,
    SqlAlchemyOrderFixtureRepository,
    SqlAlchemyParticipantTurnRepository,
    SqlAlchemyPublishedVersionDirectory,
    SqlAlchemyRunSpanRepository,
    SqlAlchemySandboxActionProposalRepository,
    SqlAlchemySandboxRepository,
    SqlAlchemySandboxSnapshotRepository,
    SqlAlchemyShopDirectory,
    SqlAlchemyToolEventRepository,
    agent_configuration_repository,
    customer_profile_repository,
    judge_configuration_repository,
    mutation_block_repository,
    objective_block_repository,
    scenario_repository,
    shop_repository,
    support_identity_repository,
    ticket_repository,
)
from capability_lab.infrastructure.telemetry import Telemetry, create_run_tracer
from definition_factories import (
    address,
    customer_identity,
    publishable_identity,
    publishable_profile,
    support_role,
)
from judge_factories import publishable_judge
from shop_factories import identity, publishable_shop
from ticket_factories import message

SEED = 20260825

POLICY_REFERENCE = "policy:shipping"
GUIDELINE_REFERENCE = "support_guideline:escalation"

PLACED_AT = "2026-08-20T14:55:00.000000Z"
CAPTURED_AT = "2026-08-21T13:12:00.000000Z"


@dataclass(slots=True)
class AdvancingClock:
    value: datetime = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)

    def now(self) -> datetime:
        self.value += timedelta(seconds=1)
        return self.value


def build_profiles(session: Session) -> CustomerProfileService:
    return CustomerProfileService(
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyShopDirectory(session),
        AdvancingClock(),
    )


def build_orders(session: Session) -> OrderFixtureService:
    return OrderFixtureService(
        SqlAlchemyOrderFixtureRepository(session),
        shop_repository(session),
        customer_profile_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        AdvancingClock(),
    )


def build_agent_configurations(session: Session) -> AgentConfigurationService:
    return AgentConfigurationService(
        agent_configuration_repository(session),
        support_identity_repository(session),
        shop_repository(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )


def build_tickets(session: Session) -> TicketService:
    return TicketService(
        ticket_repository(session),
        shop_repository(session),
        customer_profile_repository(session),
        SqlAlchemyOrderFixtureRepository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )


def build_snapshots(session: Session) -> SandboxSnapshotService:
    return SandboxSnapshotService(
        SqlAlchemySandboxSnapshotRepository(session),
        scenario_repository(session),
        shop_repository(session),
        ticket_repository(session),
        SqlAlchemyOrderFixtureRepository(session),
        objective_block_repository(session),
        mutation_block_repository(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )


def build_sandboxes(session: Session) -> SandboxService:
    return SandboxService(
        SqlAlchemySandboxRepository(session),
        SqlAlchemySandboxSnapshotRepository(session),
        AdvancingClock(),
    )


def build_actions(session: Session) -> SandboxActionService:
    return SandboxActionService(
        build_sandboxes(session),
        SqlAlchemySandboxActionProposalRepository(session),
        AdvancingClock(),
    )


def build_tools(
    session: Session, handlers: Mapping[str, ToolHandler] | None = None
) -> SandboxToolService:
    return SandboxToolService(
        SqlAlchemySandboxRepository(session),
        SqlAlchemySandboxSnapshotRepository(session),
        shop_repository(session),
        ticket_repository(session),
        customer_profile_repository(session),
        support_identity_repository(session),
        build_actions(session),
        handlers,
    )


def build_scenario_mutations(
    session: Session, clock: Clock | None = None
) -> ScenarioMutationRuntime:
    """The fault schedule an experiment carries, over the arm it fires into.

    Takes the caller's clock so a runner and the faults firing into it share one, as
    composition gives them (`presentation/api.py`). A separate clock here would make a
    firing cost the runner nothing, which is exactly the thing a duration test has to be
    able to see.
    """
    return ScenarioMutationRuntime(
        scenario_repository(session),
        mutation_block_repository(session),
        build_sandboxes(session),
        SqlAlchemyMutationEventRepository(session),
        clock or AdvancingClock(),
    )


def build_experiments(session: Session) -> ExperimentService:
    return ExperimentService(
        SqlAlchemyExperimentRepository(session),
        SqlAlchemyExperimentRunRepository(session),
        SqlAlchemyParticipantTurnRepository(session),
        SqlAlchemyAgentTurnRepository(session),
        SqlAlchemyToolEventRepository(session),
        SqlAlchemyExperimentReplayRepository(session),
        build_snapshots(session),
        build_sandboxes(session),
        scenario_repository(session),
        shop_repository(session),
        ticket_repository(session),
        agent_configuration_repository(session),
        build_scenario_mutations(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )


def build_replays(
    session: Session,
    runtimes: SupportAgentRuntimeRegistry | None = None,
    handlers: Mapping[str, ToolHandler] | None = None,
) -> ExperimentReplayService:
    """Deriving one experiment from another, over the runner every suite advances with.

    The runtimes and handlers travel through to that runner, so a suite that wants a replay
    whose arms fail supplies them here rather than reaching inside the service.
    """
    return ExperimentReplayService(
        build_experiments(session),
        build_runner(session, runtimes, handlers),
        SqlAlchemyExperimentReplayRepository(session),
        ScriptedParticipantDriver,
        AdvancingClock(),
    )


def build_annotations(session: Session) -> ExperimentAnnotationService:
    """The notes and tags one run carries, over the experiment row that scopes them."""
    return ExperimentAnnotationService(
        SqlAlchemyExperimentRepository(session),
        SqlAlchemyExperimentAnnotationRepository(session),
        AdvancingClock(),
    )


def build_evaluation(session: Session) -> ExperimentEvaluationService:
    """The projection every suite reads an arm's objectives through."""
    return ExperimentEvaluationService(
        build_experiments(session),
        objective_block_repository(session),
        SqlAlchemyJudgementRepository(session),
    )


def build_judge_service(
    session: Session, runtimes: JudgeRuntimeRegistry | None = None
) -> ExperimentJudgeService:
    """The scoring pass, over the deterministic control judge by default.

    Composition selects which providers can score, so a test that wants a failing or
    model-backed judge hands its own registry in rather than reaching inside the service.
    """
    control = ControlJudgeRuntime()
    return ExperimentJudgeService(
        build_experiments(session),
        build_evaluation(session),
        objective_block_repository(session),
        judge_configuration_repository(session),
        SqlAlchemyJudgementRepository(session),
        runtimes or JudgeRuntimeRegistry({control.provider: control}),
        AdvancingClock(),
    )


def published_judge(session: Session, payload: JudgeConfigurationPayload | None = None) -> UUID:
    """One published judge, ready to score an experiment."""
    judges = JudgeConfigurationService(judge_configuration_repository(session), AdvancingClock())
    created = judges.create_judge("Resolution quality")
    judge_id = created.definition.id
    judges.replace_judge(judge_id, publishable_judge() if payload is None else payload)
    judges.publish(judge_id)
    return judge_id


def build_runner(
    session: Session,
    runtimes: SupportAgentRuntimeRegistry | None = None,
    handlers: Mapping[str, ToolHandler] | None = None,
    clock: Clock | None = None,
) -> ExperimentRunner:
    """The runner that advances one arm, over the deterministic control runtime by default.

    Composition selects which frameworks can run an arm, so a test that wants a failing or
    model-backed arm hands its own registry in rather than reaching inside the runner. The
    same goes for a handler that breaks: a tool failure is the lab's own, and a test that
    needs one supplies it here, and for the clock a run is measured on: an operational clock
    that steps backwards is something the runner has to survive rather than trust.
    """
    control = FakeSupportAgentRuntime()
    ticking = clock or AdvancingClock()
    return ExperimentRunner(
        SqlAlchemyExperimentRepository(session),
        SqlAlchemyExperimentRunRepository(session),
        SqlAlchemyParticipantTurnRepository(session),
        SqlAlchemyAgentTurnRepository(session),
        SqlAlchemyToolEventRepository(session),
        SqlAlchemyRunSpanRepository(session),
        build_snapshots(session),
        SqlAlchemySandboxRepository(session),
        scenario_repository(session),
        shop_repository(session),
        support_identity_repository(session),
        agent_configuration_repository(session),
        build_tools(session, handlers),
        build_scenario_mutations(session, ticking),
        runtimes or SupportAgentRuntimeRegistry({control.framework_id: control}),
        build_run_tracer(),
        ticking,
    )


def build_run_tracer() -> RunTracer:
    """A real tracer over a provider with no exporter, which is the local default.

    Real rather than a double on purpose: a span id and a trace id are what a stored trace
    is, and a fake that minted counters would let a suite pass while the thing an operator
    correlates with Phoenix was never produced.
    """
    return create_run_tracer(
        Telemetry(
            tracer=TracerProvider().get_tracer("capability_lab.test", "1.0.0"),
            hash_salt=b"test-salt",
        )
    )


def build_traces(session: Session) -> ExperimentTraceService:
    """The recorded spans read back beside the record that explains them."""
    return ExperimentTraceService(build_experiments(session), SqlAlchemyRunSpanRepository(session))


def published_configuration(
    session: Session, actor: ToolActor | None = None, **overrides: object
) -> ArmSelection:
    """One published agent configuration, ready to be selected as an arm.

    Publishes its own support identity unless one is handed in. Two arms that must differ in
    exactly one dimension have to share theirs, because the identity a configuration adopts
    is itself a comparison variable.
    """
    adopted = published_identity(session) if actor is None else actor
    configurations = build_agent_configurations(session)
    created = configurations.create_configuration(
        "Frontline single agent", adopted.support_identity_id
    )
    configuration_id = created.definition.id
    configurations.replace_configuration(
        configuration_id, publishable_configuration(adopted.support_identity_id, **overrides)
    )
    published = configurations.publish(configuration_id)
    return ArmSelection(configuration_id=configuration_id, version=published.published.version)


def published_identity(
    session: Session, payload: SupportIdentityPayload | None = None
) -> ToolActor:
    """A published support identity a write tool can run under.

    Support identities are shop-independent (ADR 0014), so this needs no workspace: what a
    write authorizes against is the identity's granted permissions, not where it was authored.
    """
    identities = SupportIdentityService(support_identity_repository(session), AdvancingClock())
    created = identities.create_identity(support_role())
    identity_id = created.definition.id
    identities.replace_draft(identity_id, publishable_identity() if payload is None else payload)
    published = identities.publish(identity_id)
    return ToolActor(support_identity_id=identity_id, version=published.published.version)


def profile_with_two_addresses() -> CustomerProfilePayload:
    return publishable_profile(
        addresses=(
            address(),
            address(
                "bordeaux-previous-flat",
                label="Bordeaux — previous flat",
                is_default=False,
                city="Bordeaux",
            ),
        )
    )


def seed_order(
    orders: OrderFixtureService,
    shop_id: UUID,
    customer_id: UUID,
    reference: str = "NS-10482",
) -> UUID:
    """The paid, unfulfilled order shipping to the stale address."""
    order_id = orders.create_order(shop_id, reference, customer_id, PLACED_AT).order_id
    orders.replace_order(
        shop_id,
        order_id,
        OrderEdit(
            reference=reference,
            placed_at=PLACED_AT,
            lines=(OrderLineSelection(sku="NS-ASJ-OB-M", quantity=1),),
            payment_status=PaymentStatus.PAID,
            payment_method_id="visa",
            paid_at=CAPTURED_AT,
            fulfilment_status=FulfilmentStatus.UNFULFILLED,
            fulfilment_method_id="standard",
            shipped_at=None,
            shipping_fee_amount="0.00",
            shipping_address_id="bordeaux-previous-flat",
            events=(
                OrderEventDraft(
                    id="order-created",
                    kind="placed",
                    occurred_at=PLACED_AT,
                    summary="Order created — checkout, order page",
                ),
                OrderEventDraft(
                    id="payment-captured",
                    kind="payment_captured",
                    occurred_at=CAPTURED_AT,
                    summary="Payment captured — order marked paid",
                ),
            ),
        ),
    )
    return order_id


@dataclass(frozen=True, slots=True)
class Workspace:
    """A publishable shop, customer, order, ticket, and one template in each library."""

    scenarios: ScenarioService
    shops: ShopService
    profiles: CustomerProfileService
    tickets: TicketService
    objectives: ObjectiveBlockService
    mutations: MutationBlockService
    shop_id: UUID
    customer_id: UUID
    order_id: UUID
    ticket_id: UUID
    read_block_id: UUID
    mutation_block_id: UUID


def build_scenarios(session: Session) -> ScenarioService:
    return ScenarioService(
        scenario_repository(session),
        shop_repository(session),
        ticket_repository(session),
        customer_profile_repository(session),
        SqlAlchemyOrderFixtureRepository(session),
        objective_block_repository(session),
        mutation_block_repository(session),
        SqlAlchemyDefinitionShopAttachmentRepository(session),
        SqlAlchemyPublishedVersionDirectory(session),
        AdvancingClock(),
    )


def seed_workspace(session: Session) -> Workspace:
    shops = ShopService(shop_repository(session), AdvancingClock())
    shop_id = shops.create_shop(identity()).definition.id
    shops.replace_draft(shop_id, publishable_shop())

    profiles = build_profiles(session)
    profile = profiles.create_profile(customer_identity(), "2024-03-14", shop_id=shop_id)
    customer_id = profile.definition.id
    profiles.replace_draft(customer_id, profile_with_two_addresses())

    order_id = seed_order(build_orders(session), shop_id, customer_id)

    tickets = build_tickets(session)
    ticket = tickets.create_ticket(
        shop_id, "T-204", "Wrong address concern", customer_id, SupportChannel.CHAT
    )
    ticket_id = ticket.definition.id
    tickets.replace_ticket(
        shop_id,
        ticket_id,
        replace(
            ticket.payload,
            trigger=message(),
            linked_order_ids=(order_id,),
            # The documents a scenario built on this ticket should start from.
            suggested_documents=(
                SuggestedDocument(kind=ShopDocumentKind.POLICY, document_id="shipping"),
                SuggestedDocument(
                    kind=ShopDocumentKind.SUPPORT_GUIDELINE, document_id="escalation"
                ),
            ),
        ),
    )

    objectives = ObjectiveBlockService(objective_block_repository(session), AdvancingClock())
    read_block = objectives.create_block("read-required-document")
    objectives.replace_block(read_block.definition.id, publishable_objective())

    mutations = MutationBlockService(mutation_block_repository(session), AdvancingClock())
    mutation_block = mutations.create_block("concurrent-entity-mutation")
    mutations.replace_block(mutation_block.definition.id, publishable_mutation())

    return Workspace(
        scenarios=build_scenarios(session),
        shops=shops,
        profiles=profiles,
        tickets=tickets,
        objectives=objectives,
        mutations=mutations,
        shop_id=shop_id,
        customer_id=customer_id,
        order_id=order_id,
        ticket_id=ticket_id,
        read_block_id=read_block.definition.id,
        mutation_block_id=mutation_block.definition.id,
    )


def read_check(
    workspace: Workspace,
    objective_id: str = "read-shipping-policy",
    document: str = POLICY_REFERENCE,
    severity: ObjectiveSeverity = ObjectiveSeverity.REQUIRED,
) -> BoundObjective:
    return BoundObjective(
        id=objective_id,
        block_id=workspace.read_block_id,
        severity=severity,
        bindings=(ScenarioBinding(parameter="doc_ref", value=document),),
    )


def concurrent_mutation(workspace: Workspace) -> BoundMutation:
    return BoundMutation(
        id="order-moves-under-the-arm",
        block_id=workspace.mutation_block_id,
        bindings=(
            ScenarioBinding(parameter="entity_ref", value=f"order:{workspace.order_id}"),
            ScenarioBinding(parameter="timing", value="after_first_read"),
        ),
    )


def publishable_payload(workspace: Workspace, **overrides: object) -> ScenarioPayload:
    """The wrong-address recipe, bound to this workspace's real shop objects."""
    fields: dict[str, object] = {
        "name": "Wrong shipping address",
        "ticket_id": workspace.ticket_id,
        "context_documents": (
            ContextDocument(kind=ShopDocumentKind.POLICY, document_id="shipping"),
        ),
        "objectives": (read_check(workspace),),
        "mutations": (),
        "hidden_facts": "Maya confirms the Lyon address only if asked.",
        "completion": CompletionConditions(
            statement="The order ships to the confirmed address.", max_turns=12
        ),
    }
    fields.update(overrides)
    return ScenarioPayload(**fields)  # type: ignore[arg-type]


def publish_prerequisites(workspace: Workspace) -> None:
    """Everything a scenario publication has to pin, published in dependency order."""
    workspace.shops.publish(workspace.shop_id)
    workspace.profiles.publish(workspace.customer_id)
    workspace.tickets.publish_ticket(workspace.shop_id, workspace.ticket_id)
    workspace.objectives.publish(workspace.read_block_id)
    workspace.mutations.publish(workspace.mutation_block_id)


def author(workspace: Workspace, **overrides: object) -> UUID:
    """Create the scenario and put a publishable draft on it."""
    created = workspace.scenarios.create_scenario(
        workspace.shop_id, "Wrong shipping address", workspace.ticket_id
    )
    scenario_id = created.definition.id
    workspace.scenarios.replace_scenario(
        workspace.shop_id, scenario_id, publishable_payload(workspace, **overrides)
    )
    return scenario_id


def frozen_starting_state(session: Session, workspace: Workspace) -> SandboxSnapshotRecord:
    """Publish the wrong-address recipe and freeze it, as the snapshot slice does."""
    publish_prerequisites(workspace)
    scenario_id = author(workspace)
    version = workspace.scenarios.publish_scenario(workspace.shop_id, scenario_id)
    return build_snapshots(session).materialize(
        workspace.shop_id, scenario_id, version.published.version, seed=SEED
    )


def cloned_arm(session: Session, workspace: Workspace, label: str = "Arm A") -> SandboxRecord:
    """One arm of the frozen wrong-address starting state."""
    snapshot = frozen_starting_state(session, workspace)
    return build_sandboxes(session).clone(workspace.shop_id, snapshot.snapshot_id, label)
