"""The application services the seed writes through, composed over one session.

This is a composition root, and the third one the project has: `presentation/api.py`
composes for HTTP, `tests/workspace_factories.py` composes for the suites, and this one
composes for the command. They are separate on purpose. Composition is where a process
declares which database, which frameworks, which judge providers and which tracer it has
(`docs/architecture.md`), and those answers genuinely differ — the command runs two
scripted frameworks against a file it was pointed at, which is not what either of the
others runs.

What is deliberately *not* separate is anything below composition. Every object here is the
application service an operator's own action reaches, so the seed publishes through the
same gates, resolves through the same pins, and advances an arm through the same runner.
There is no seed-only write path, and nothing in this package touches a repository.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from capability_lab.application.agent_configurations import AgentConfigurationService
from capability_lab.application.agent_runtime import SupportAgentRuntimeRegistry
from capability_lab.application.blocks import MutationBlockService, ObjectiveBlockService
from capability_lab.application.customer_profiles import CustomerProfileService
from capability_lab.application.evaluation import ExperimentEvaluationService
from capability_lab.application.experiment_annotations import ExperimentAnnotationService
from capability_lab.application.experiment_history import ExperimentHistoryService
from capability_lab.application.experiment_runs import ExperimentRunner
from capability_lab.application.experiment_timeline import ExperimentTimelineService
from capability_lab.application.experiment_traces import ExperimentTraceService, RunTracer
from capability_lab.application.experiments import ExperimentService
from capability_lab.application.judge_configurations import JudgeConfigurationService
from capability_lab.application.judge_runs import ExperimentJudgeService
from capability_lab.application.judge_runtime import JudgeRuntimeRegistry
from capability_lab.application.order_fixtures import OrderFixtureService
from capability_lab.application.ports import Clock
from capability_lab.application.sandbox_actions import SandboxActionService
from capability_lab.application.sandbox_materialization import SandboxSnapshotService
from capability_lab.application.sandbox_tools import SandboxToolService
from capability_lab.application.sandboxes import SandboxService
from capability_lab.application.scenario_mutations import ScenarioMutationRuntime
from capability_lab.application.scenarios import ScenarioService
from capability_lab.application.shops import ShopService
from capability_lab.application.support_identities import SupportIdentityService
from capability_lab.application.tickets import TicketService
from capability_lab.infrastructure.repositories import (
    SqlAlchemyAgentTurnRepository,
    SqlAlchemyDefinitionShopAttachmentRepository,
    SqlAlchemyExperimentAnnotationRepository,
    SqlAlchemyExperimentDerivationRepository,
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

__all__ = ["SeedServices", "build_services"]


@dataclass(frozen=True, slots=True)
class SeedServices:
    """Every service the demo story needs, over one session and one clock."""

    shops: ShopService
    profiles: CustomerProfileService
    identities: SupportIdentityService
    orders: OrderFixtureService
    tickets: TicketService
    objectives: ObjectiveBlockService
    mutations: MutationBlockService
    scenarios: ScenarioService
    configurations: AgentConfigurationService
    judges: JudgeConfigurationService
    snapshots: SandboxSnapshotService
    experiments: ExperimentService
    runner: ExperimentRunner
    scoring: ExperimentJudgeService
    annotations: ExperimentAnnotationService
    evaluation: ExperimentEvaluationService
    timeline: ExperimentTimelineService
    traces: ExperimentTraceService
    history: ExperimentHistoryService


def build_services(
    session: Session,
    clock: Clock,
    runtimes: SupportAgentRuntimeRegistry,
    judge_runtimes: JudgeRuntimeRegistry,
    run_tracer: RunTracer,
) -> SeedServices:
    """Compose the whole chain over one session.

    One session for the whole seed, and one clock for the runner and the faults that fire
    into it — the same pairing `presentation/api.py` makes, and for the same reason: a fault
    that read a clock of its own would cost the run it fired into nothing.
    """
    published_versions = SqlAlchemyPublishedVersionDirectory(session)
    attachments = SqlAlchemyDefinitionShopAttachmentRepository(session)
    experiment_repository = SqlAlchemyExperimentRepository(session)
    judgements = SqlAlchemyJudgementRepository(session)

    sandboxes = SandboxService(
        SqlAlchemySandboxRepository(session),
        SqlAlchemySandboxSnapshotRepository(session),
        clock,
    )
    snapshots = SandboxSnapshotService(
        SqlAlchemySandboxSnapshotRepository(session),
        scenario_repository(session),
        shop_repository(session),
        ticket_repository(session),
        SqlAlchemyOrderFixtureRepository(session),
        objective_block_repository(session),
        mutation_block_repository(session),
        published_versions,
        clock,
    )
    scenario_mutations = ScenarioMutationRuntime(
        scenario_repository(session),
        mutation_block_repository(session),
        sandboxes,
        SqlAlchemyMutationEventRepository(session),
        clock,
    )
    tools = SandboxToolService(
        SqlAlchemySandboxRepository(session),
        SqlAlchemySandboxSnapshotRepository(session),
        shop_repository(session),
        ticket_repository(session),
        customer_profile_repository(session),
        support_identity_repository(session),
        SandboxActionService(sandboxes, SqlAlchemySandboxActionProposalRepository(session), clock),
    )
    experiments = ExperimentService(
        experiment_repository,
        SqlAlchemyExperimentRunRepository(session),
        SqlAlchemyParticipantTurnRepository(session),
        SqlAlchemyAgentTurnRepository(session),
        SqlAlchemyToolEventRepository(session),
        SqlAlchemyExperimentDerivationRepository(session),
        snapshots,
        sandboxes,
        scenario_repository(session),
        shop_repository(session),
        ticket_repository(session),
        agent_configuration_repository(session),
        scenario_mutations,
        published_versions,
        clock,
    )
    evaluation = ExperimentEvaluationService(
        experiments, objective_block_repository(session), judgements
    )
    return SeedServices(
        shops=ShopService(shop_repository(session), clock),
        profiles=CustomerProfileService(
            customer_profile_repository(session),
            attachments,
            SqlAlchemyShopDirectory(session),
            clock,
        ),
        identities=SupportIdentityService(support_identity_repository(session), clock),
        orders=OrderFixtureService(
            SqlAlchemyOrderFixtureRepository(session),
            shop_repository(session),
            customer_profile_repository(session),
            attachments,
            clock,
        ),
        tickets=TicketService(
            ticket_repository(session),
            shop_repository(session),
            customer_profile_repository(session),
            SqlAlchemyOrderFixtureRepository(session),
            attachments,
            published_versions,
            clock,
        ),
        objectives=ObjectiveBlockService(objective_block_repository(session), clock),
        mutations=MutationBlockService(mutation_block_repository(session), clock),
        scenarios=ScenarioService(
            scenario_repository(session),
            shop_repository(session),
            ticket_repository(session),
            customer_profile_repository(session),
            SqlAlchemyOrderFixtureRepository(session),
            objective_block_repository(session),
            mutation_block_repository(session),
            attachments,
            published_versions,
            clock,
        ),
        configurations=AgentConfigurationService(
            agent_configuration_repository(session),
            support_identity_repository(session),
            shop_repository(session),
            published_versions,
            clock,
        ),
        judges=JudgeConfigurationService(judge_configuration_repository(session), clock),
        snapshots=snapshots,
        experiments=experiments,
        runner=ExperimentRunner(
            experiment_repository,
            SqlAlchemyExperimentRunRepository(session),
            SqlAlchemyParticipantTurnRepository(session),
            SqlAlchemyAgentTurnRepository(session),
            SqlAlchemyToolEventRepository(session),
            SqlAlchemyRunSpanRepository(session),
            snapshots,
            SqlAlchemySandboxRepository(session),
            scenario_repository(session),
            shop_repository(session),
            support_identity_repository(session),
            agent_configuration_repository(session),
            tools,
            scenario_mutations,
            runtimes,
            run_tracer,
            clock,
        ),
        scoring=ExperimentJudgeService(
            experiments,
            evaluation,
            objective_block_repository(session),
            judge_configuration_repository(session),
            judgements,
            judge_runtimes,
            clock,
        ),
        annotations=ExperimentAnnotationService(
            experiment_repository, SqlAlchemyExperimentAnnotationRepository(session), clock
        ),
        evaluation=evaluation,
        timeline=ExperimentTimelineService(experiments, runtimes),
        traces=ExperimentTraceService(experiments, SqlAlchemyRunSpanRepository(session)),
        history=ExperimentHistoryService(
            experiment_repository,
            experiments,
            evaluation,
            SqlAlchemyExperimentAnnotationRepository(session),
            shop_repository(session),
            scenario_repository(session),
            agent_configuration_repository(session),
        ),
    )
