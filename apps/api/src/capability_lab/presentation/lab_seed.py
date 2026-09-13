"""The demo seed, offered over HTTP as well as from a terminal (ADR 0047).

ADR 0043 built this as a command and refused it a route, on the grounds that "a running lab
must never be one request away from being overwritten with a fixture". ADR 0047 keeps that
sentence and disagrees about what secures it. What makes the seed safe to run is the
emptiness gate, not the absence of a URL: `run_seed` refuses unless every table in
`SEEDED_TABLES` is empty, so a running lab holding anything at all is exactly as safe behind
this route as it is behind the command. Nothing here upserts, truncates, wipes or reseeds,
and this module adds no way to ask it to.

What the route therefore is: the same function the CLI calls, reached over the same contract
every other screen is served by, refusing for the same two reasons and naming the same
remedy. What it is not is a second seed implementation — a route that could seed a database
the command would refuse would be the thing ADR 0043 was actually protecting against.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter

from capability_lab.infrastructure.config import Settings
from capability_lab.presentation.base import StrictApiModel
from capability_lab.presentation.seed.demo import DemoSeed
from capability_lab.presentation.seed.runner import default_alembic_config, run_seed


class LabSeedResponse(StrictApiModel):
    """What the seed wrote, by identifier, so a caller can open any of it.

    The same listing the command prints to a terminal. Identifiers rather than a message,
    because the screen that asked for this has somewhere to send a reader afterwards and a
    sentence of prose would make it parse one.
    """

    shop_id: UUID
    customer_id: UUID
    support_identity_id: UUID
    order_id: UUID
    ticket_id: UUID
    scenario_id: UUID
    scenario_version: int
    snapshot_id: UUID
    judge_id: UUID
    configuration_ids: list[UUID]
    experiment_id: UUID
    run_ids: list[UUID]

    @classmethod
    def of(cls, seeded: DemoSeed) -> LabSeedResponse:
        return cls(
            shop_id=seeded.shop_id,
            customer_id=seeded.customer_id,
            support_identity_id=seeded.support_identity_id,
            order_id=seeded.order_id,
            ticket_id=seeded.ticket_id,
            scenario_id=seeded.scenario_id,
            scenario_version=seeded.scenario_version,
            snapshot_id=seeded.snapshot_id,
            judge_id=seeded.judge_id,
            configuration_ids=list(seeded.configuration_ids),
            experiment_id=seeded.experiment_id,
            run_ids=list(seeded.run_ids),
        )


class LabSeedRoutes:
    """The one route that writes the demo, bound to composed settings like the status route.

    Serialized on a lock for the length of a seed. Two requests arriving together would both
    pass the emptiness gate before either had written anything, and the loser would fail
    somewhere inside a half-written story rather than at the gate that exists to say no
    politely. The lock makes the second request refuse the way a second `make seed` does.
    """

    def __init__(self, settings: Settings, *, alembic_config: Path | None = None) -> None:
        self._settings = settings
        # Located once at composition: it reads the checkout's migration tree, which does not
        # move while the process runs, and `run_seed` already treats a missing one as a head
        # that went unchecked rather than as a refusal.
        self._alembic_config = alembic_config or default_alembic_config()
        self._running = asyncio.Lock()

    async def seed(self) -> LabSeedResponse:
        async with self._running:
            seeded, _url = await run_seed(self._settings, alembic_config=self._alembic_config)
        return LabSeedResponse.of(seeded)

    def register(self, router: APIRouter) -> None:
        async def post_lab_seed() -> LabSeedResponse:
            return await self.seed()

        router.add_api_route(
            "/lab-seed",
            post_lab_seed,
            methods=["POST"],
            response_model=LabSeedResponse,
            status_code=201,
            operation_id="seedLab",
            summary="Write the demo into an empty lab",
            description=(
                "Writes one complete worked example — the wrong-address incident, authored "
                "end to end and driven to completion under two agent frameworks — through "
                "the same application services the screens call. Needs no provider "
                "credential and contacts no provider. Refuses with 409 rather than merging: "
                "a database that is not at the migration head, or that holds any row in a "
                "table the story writes, is left untouched and the tables that stopped it "
                "are named. Nothing here overwrites, wipes or reseeds."
            ),
        )


__all__ = ["LabSeedResponse", "LabSeedRoutes"]
