"""The demo seed: one command that fills an empty database with one complete example.

A developer who has just run `make migrate` has a schema and nothing in it, and every
screen of the product reads a chain that starts at a published shop and ends at a run with
evidence on it. Building that chain by hand takes an afternoon and produces something
different every time, so it is built here instead, once, as the wrong-address incident the
lab was designed around.

It is a developer tool and not a product feature, which decides three things about it. It
lives in `presentation` because that is where this project composes a process, and a
command is a second entry point rather than a new layer. It reaches the world only through
the application services in `services`, so every publish gate, every setup gate and every
invariant refuses the seed exactly as it refuses an operator — there is no back door here
and no repository call. And it is not on the HTTP surface at all: `packages/contracts`
knows nothing about it, because a running lab must never be one request away from being
overwritten with a fixture.
"""

from capability_lab.presentation.seed.demo import DemoSeed, seed_demo
from capability_lab.presentation.seed.runner import (
    DatabaseNotEmptyError,
    DatabaseNotMigratedError,
    SeedRefusedError,
    run_seed,
)
from capability_lab.presentation.seed.services import SeedServices, build_services

__all__ = [
    "DatabaseNotEmptyError",
    "DatabaseNotMigratedError",
    "DemoSeed",
    "SeedRefusedError",
    "SeedServices",
    "build_services",
    "run_seed",
    "seed_demo",
]
