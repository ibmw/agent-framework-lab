"""The demo story, authored and then run, in the order an operator would do it.

Read top to bottom this is the product's own path: author a shop, attach a customer, write
the order the incident is about, open the ticket that reports it, compose a recipe out of
the block library, publish two agents that differ in one thing, start the experiment, drive
both arms, score what no rule decides, and write down what you concluded. Every step is a
call an operator's own click makes, so a gate that would refuse them refuses this.

Nothing here decides *where* it is writing or *what* can run an arm. The session, the
clock, the framework registry and the judge registry all arrive from composition, which is
what lets the command run two scripted frameworks offline while the API runs whatever the
process is configured for.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from uuid import UUID

from capability_lab.application.agent_capabilities import (
    OPENAI_AGENTS_FRAMEWORK_ID,
    PYDANTIC_AI_FRAMEWORK_ID,
)
from capability_lab.application.experiments import ArmSelection, StartExperiment
from capability_lab.application.order_fixtures import OrderEdit
from capability_lab.domain.agent_configuration import AgentConfigurationPayload
from capability_lab.domain.blocks import ObjectiveBlockPayload, ObjectiveSeverity
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
from capability_lab.infrastructure.agents.scripted import INCIDENT_TOOLS
from capability_lab.infrastructure.participants.human import HumanParticipantDriver
from capability_lab.presentation.seed import content
from capability_lab.presentation.seed.services import SeedServices

__all__ = ["DemoSeed", "seed_demo"]

# The seed the starting state is frozen at. Fixed rather than drawn, because a snapshot is
# identified by what it froze (ADR 0019): two runs of this command tell the same story, with
# the same timestamps, durations and figures, rather than a story that drifts with the clock.
#
# The fingerprints still differ between databases, and deliberately nothing here tries to
# stop that. A snapshot's identity covers documents that embed the identifiers of the
# definitions they pin, and those are drawn per row; making them stable would mean minting
# every definition identifier from the content, which is a change to the lifecycle rather
# than to a seed.
SNAPSHOT_SEED = 20260824


@dataclass(frozen=True, slots=True)
class DemoSeed:
    """What the seed produced, named so a command can report it and a test can read it."""

    shop_id: UUID
    customer_id: UUID
    support_identity_id: UUID
    order_id: UUID
    ticket_id: UUID
    scenario_id: UUID
    scenario_version: int
    snapshot_id: UUID
    judge_id: UUID
    configuration_ids: tuple[UUID, ...]
    experiment_id: UUID
    run_ids: tuple[UUID, ...]


async def seed_demo(services: SeedServices) -> DemoSeed:
    """Author the whole chain, run the incident under both frameworks, and annotate it."""
    shop_id = _shop(services)
    customer_id = _customer(services, shop_id)
    support_identity_id = _support_identity(services)
    order_id = _order(services, shop_id, customer_id)
    ticket_id = _ticket(services, shop_id, customer_id, order_id)
    blocks = _block_library(services)
    scenario_id, scenario_version = _scenario(services, shop_id, ticket_id, order_id, blocks)
    configurations = _agent_configurations(services, support_identity_id)
    judge_id = _judge(services)

    detail = services.experiments.start(
        shop_id,
        StartExperiment(
            label=content.EXPERIMENT_LABEL,
            scenario_id=scenario_id,
            scenario_version=scenario_version,
            seed=SNAPSHOT_SEED,
            arms=configurations.arms,
        ),
    )
    experiment_id = detail.record.experiment_id
    run_ids = tuple(run.run_id for run in detail.runs)

    # The trigger is already in every arm — the runner writes the pinned ticket's own first
    # message there (ADR 0025) — so the first thing to do is answer it.
    for run_id in run_ids:
        await services.runner.advance(shop_id, experiment_id, run_id)
    services.experiments.deliver_turn(
        shop_id, experiment_id, run_ids, HumanParticipantDriver(content.FOLLOW_UP)
    )
    for run_id in run_ids:
        await services.runner.advance(shop_id, experiment_id, run_id)

    # Both arms have now answered the last turn the recipe allows, so the run is over and
    # the rows a judge owns can be filled in.
    await services.scoring.score(shop_id, experiment_id, judge_id)

    services.annotations.set_tags(shop_id, experiment_id, content.DEMO_TAGS)
    for note in content.DEMO_NOTES:
        services.annotations.add_note(shop_id, experiment_id, note)

    return DemoSeed(
        shop_id=shop_id,
        customer_id=customer_id,
        support_identity_id=support_identity_id,
        order_id=order_id,
        ticket_id=ticket_id,
        scenario_id=scenario_id,
        scenario_version=scenario_version,
        snapshot_id=detail.record.snapshot_id,
        judge_id=judge_id,
        configuration_ids=configurations.ids,
        experiment_id=experiment_id,
        run_ids=run_ids,
    )


# -- authoring -----------------------------------------------------------------


def _shop(services: SeedServices) -> UUID:
    created = services.shops.create_shop(content.shop_identity())
    shop_id = created.definition.id
    services.shops.replace_draft(shop_id, content.shop_payload())
    services.shops.publish(shop_id)
    return shop_id


def _customer(services: SeedServices, shop_id: UUID) -> UUID:
    """The customer, attached to the shop as she is created.

    Attaching is what makes her selectable by an order and a ticket in this shop (ADR 0014);
    it pins no version and enters no fingerprint, which is why it is a separate act from
    publishing her.
    """
    created = services.profiles.create_profile(
        content.customer_identity(), content.CUSTOMER_SINCE, shop_id=shop_id
    )
    customer_id = created.definition.id
    services.profiles.replace_draft(customer_id, content.customer_payload())
    services.profiles.publish(customer_id)
    return customer_id


def _support_identity(services: SeedServices) -> UUID:
    """The role the agent adopts. Shop-independent, so it is authored on its own."""
    created = services.identities.create_identity(content.support_role())
    identity_id = created.definition.id
    services.identities.replace_draft(identity_id, content.support_identity_payload())
    services.identities.publish(identity_id)
    return identity_id


def _order(services: SeedServices, shop_id: UUID, customer_id: UUID) -> UUID:
    """The paid, unfulfilled order still shipping to the flat she left in June."""
    created = services.orders.create_order(
        shop_id, content.ORDER_REFERENCE, customer_id, content.PLACED_AT
    )
    order_id = created.order_id
    services.orders.replace_order(
        shop_id,
        order_id,
        OrderEdit(
            reference=content.ORDER_REFERENCE,
            placed_at=content.PLACED_AT,
            lines=content.order_lines(),
            payment_status=PaymentStatus.PAID,
            payment_method_id="visa",
            paid_at=content.CAPTURED_AT,
            fulfilment_status=FulfilmentStatus.UNFULFILLED,
            fulfilment_method_id="standard",
            shipped_at=None,
            shipping_fee_amount="0.00",
            shipping_address_id=content.STALE_ADDRESS_ID,
            events=content.order_events(),
        ),
    )
    return order_id


def _ticket(services: SeedServices, shop_id: UUID, customer_id: UUID, order_id: UUID) -> UUID:
    created = services.tickets.create_ticket(
        shop_id,
        content.TICKET_REFERENCE,
        content.TICKET_SUBJECT,
        customer_id,
        SupportChannel.CHAT,
    )
    ticket_id = created.definition.id
    services.tickets.replace_ticket(
        shop_id,
        ticket_id,
        replace(
            created.payload,
            status=content.TICKET_STATUS,
            origin=content.ticket_origin(order_id),
            tags=content.ticket_tags(),
            history=content.ticket_history(),
            trigger=content.ticket_trigger(),
            linked_order_ids=(order_id,),
            suggested_documents=content.TICKET_SUGGESTED_DOCUMENTS,
        ),
    )
    services.tickets.publish_ticket(shop_id, ticket_id)
    return ticket_id


@dataclass(frozen=True, slots=True)
class _Blocks:
    """The published templates the recipe composes, by the role each plays in it."""

    read_document: UUID
    redirect: UUID
    explained: UUID
    mutation: UUID


def _block_library(services: SeedServices) -> _Blocks:
    """Three objectives and one fault, each published before a recipe may compose it."""
    read_document = _objective_block(services, content.read_document_block())
    redirect = _objective_block(services, content.redirect_block())
    explained = _objective_block(services, content.explained_block())

    created = services.mutations.create_block(content.MUTATION_BLOCK)
    mutation = created.definition.id
    services.mutations.replace_block(mutation, content.mutation_block())
    services.mutations.publish(mutation)

    return _Blocks(
        read_document=read_document, redirect=redirect, explained=explained, mutation=mutation
    )


def _objective_block(services: SeedServices, payload: ObjectiveBlockPayload) -> UUID:
    """Create a template under its own name, fill it in, and publish it."""
    created = services.objectives.create_block(payload.name)
    block_id = created.definition.id
    services.objectives.replace_block(block_id, payload)
    services.objectives.publish(block_id)
    return block_id


def _scenario(
    services: SeedServices,
    shop_id: UUID,
    ticket_id: UUID,
    order_id: UUID,
    blocks: _Blocks,
) -> tuple[UUID, int]:
    """The recipe: what the arms must do, what the world does to them, and when it ends."""
    created = services.scenarios.create_scenario(shop_id, content.SCENARIO_NAME, ticket_id)
    scenario_id = created.definition.id
    services.scenarios.replace_scenario(
        shop_id,
        scenario_id,
        ScenarioPayload(
            name=content.SCENARIO_NAME,
            ticket_id=ticket_id,
            context_documents=(
                ContextDocument(
                    kind=ShopDocumentKind.POLICY, document_id=content.SHIPPING_POLICY_ID
                ),
                ContextDocument(
                    kind=ShopDocumentKind.SUPPORT_GUIDELINE, document_id="order-changes"
                ),
            ),
            objectives=(
                BoundObjective(
                    id=content.READ_POLICY_OBJECTIVE,
                    block_id=blocks.read_document,
                    severity=ObjectiveSeverity.REQUIRED,
                    bindings=(
                        ScenarioBinding(
                            parameter="doc_ref",
                            value=f"policy:{content.SHIPPING_POLICY_ID}",
                        ),
                    ),
                ),
                BoundObjective(
                    id=content.REDIRECT_OBJECTIVE,
                    block_id=blocks.redirect,
                    severity=ObjectiveSeverity.REQUIRED,
                    bindings=(
                        ScenarioBinding(
                            parameter="doc_ref",
                            value=f"order:{order_id}#shipping_address",
                        ),
                    ),
                ),
                BoundObjective(
                    id=content.EXPLAINED_OBJECTIVE,
                    block_id=blocks.explained,
                    severity=ObjectiveSeverity.REQUIRED,
                ),
            ),
            mutations=(
                BoundMutation(
                    id=content.FAULT,
                    block_id=blocks.mutation,
                    bindings=(
                        ScenarioBinding(parameter="entity_ref", value=f"order:{order_id}"),
                        ScenarioBinding(parameter="timing", value="after_first_read"),
                    ),
                ),
            ),
            hidden_facts=content.HIDDEN_FACTS,
            completion=CompletionConditions(
                statement=content.COMPLETION_STATEMENT, max_turns=content.COMPLETION_TURNS
            ),
        ),
    )
    published = services.scenarios.publish_scenario(shop_id, scenario_id)
    return scenario_id, published.published.version


# -- the agents ----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Configurations:
    ids: tuple[UUID, ...]
    arms: tuple[ArmSelection, ...]


def _agent_configurations(services: SeedServices, support_identity_id: UUID) -> _Configurations:
    """Two published configurations that differ in the framework and in nothing else.

    Same model, same prompt, same tools, same architecture, same adopted identity — every
    dimension ADR 0025's matrix compares is held equal here on purpose, because a matrix
    reporting two differences is a run nothing can be attributed to.
    """
    ids: list[UUID] = []
    arms: list[ArmSelection] = []
    for label, framework_id in (
        ("Arm A — Pydantic AI", PYDANTIC_AI_FRAMEWORK_ID),
        ("Arm B — OpenAI Agents SDK", OPENAI_AGENTS_FRAMEWORK_ID),
    ):
        created = services.configurations.create_configuration(label, support_identity_id)
        configuration_id = created.definition.id
        services.configurations.replace_configuration(
            configuration_id,
            AgentConfigurationPayload(
                name=label,
                framework_id=framework_id,
                support_identity_id=support_identity_id,
                model=content.agent_model(),
                description=content.CONFIGURATION_DESCRIPTION,
                prompt=content.PROMPT,
                tools=INCIDENT_TOOLS,
            ),
        )
        published = services.configurations.publish(configuration_id)
        ids.append(configuration_id)
        arms.append(
            ArmSelection(
                configuration_id=configuration_id,
                version=published.published.version,
                label=label,
            )
        )
    return _Configurations(ids=tuple(ids), arms=tuple(arms))


def _judge(services: SeedServices) -> UUID:
    created = services.judges.create_judge(content.JUDGE_NAME)
    judge_id = created.definition.id
    services.judges.replace_judge(judge_id, content.judge_payload())
    services.judges.publish(judge_id)
    return judge_id
