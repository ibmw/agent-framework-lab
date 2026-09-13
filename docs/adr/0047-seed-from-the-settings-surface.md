# ADR 0047 — The seed gets a route and a button, and keeps the refusal that made it safe

Status: accepted — 2026-09-13

Reverses the half of ADR 0043 that made the demo seed unreachable over HTTP, and the item ADR
0044 listed as deliberately not built. `POST /api/v1/lab-seed` writes the demo, and lab settings
carries the button that calls it. `make seed` is unchanged and remains the documented path.

Records one decision and one concession: that the refusal rather than the absence of a URL is
what protects a populated lab, and that a deployment where the operator is not the author is now
one press from a populated lab rather than zero presses from an untouched one.

## Context

ADR 0043 built the seed as a command and gave it two gates. A database must be at this build's
migration head, and every table in `SEEDED_TABLES` must be empty; either one failing is a refusal
that names what is in the way and what to do about it. It then made a third decision, in a section
titled *It is a command, and never a route*:

> A running lab must never be one request away from being overwritten with a fixture, and a seed
> on the public contract would be exactly that — including on a deployment where the operator is
> not the person who wrote the data.

ADR 0044 inherited that and listed "a seed route, or any button that populates the lab" under what
it deliberately did not build, adding that "ADR 0043's refusal is load-bearing and is not relaxed
by being inconvenient". The setup guide was written around it: the fast path is text, and the page
performs nothing.

What changed is not the inconvenience. It is that the sentence and the gates were read together.

## Decision

**The seed is reachable over HTTP, and the emptiness gate is what makes that safe.**

Re-read the sentence with `SEEDED_TABLES` in front of it. A running lab — one with a shop, a
scenario, a run, anything — *cannot* be overwritten with a fixture, by this route or by the
command, because the gate refuses before a row is written. The fixture reaches exactly one kind of
database: an empty one at the migration head, which by definition holds nothing anybody could lose.
"One request away from being overwritten" describes a seed that merges, upserts or wipes, and ADR
0043 rejected all three in the section immediately above the one quoted. Its own refusal had
already answered the risk its route decision was defending against a second time.

That is the whole argument, and it is worth being precise about what it does not cover. Removing
the route was protecting one thing the gate does not: an *empty* lab on a shared deployment, where
anyone who can reach the settings page can put the demo in it. That is real, and it is small — the
loss is nothing, the remedy is the reset path, and the lab is a single-tenant developer tool with
no user model at all (ADR 0044: "There is no user. Tenancy is deferred."). When tenancy arrives it
arrives for every write route in the contract, and this one is not special.

**The route calls the function the command calls.** `LabSeedRoutes` awaits `run_seed`, the same
entry point `cli.py` awaits, and holds no seeding logic of its own. A second implementation is the
thing actually worth refusing: a route that could seed a database the command would decline is how
the gates come apart, and the only defence against that is having one of them.

**It refuses with 409 and says what the command says.** `SeedRefusedError` reaches an exception
handler that reports its message verbatim, so a reader gets the occupied tables with their counts
and the remedy. Nothing about the request was malformed; the database is in a state this route will
not write into.

**The button confirms once, and asks for nothing else.** The first press arms, the second writes.
A control that writes a dozen published versions should cost more than a stray click, and it should
cost no more than that, because there is nothing to lose behind it — no typed phrase, no dialog.
Settings hides it altogether when the shop list is non-empty, which is a courtesy rather than a
gate: the server counts every table the story writes and the browser can see one of them.

**Seeds serialize.** Two requests arriving together would both clear the gate before either wrote,
and the loser would fail somewhere inside a half-written story rather than at the gate built to say
no politely. An `asyncio.Lock` for the length of a seed makes the second request refuse the way a
second `make seed` does.

**The guide still performs nothing.** It names the command, links to the settings button, and
carries no control of its own. The guide is a reader of the chain and gains no privilege over it —
that half of ADR 0044 stands, and its test still asserts the page holds no button.

## Deliberately not here

- **Reset, wipe, reseed, or any flag that relaxes the gates.** The reason the route is safe is that
  it refuses, so a route that refuses less is a different decision and would need a different ADR.
  Deleting the database file stays in a shell, where `docs/development.md` owns it.
- **Removing `make seed`.** It runs where no browser is, it is what CI and `test_demo_seed.py` use,
  and a developer with a terminal open should not have to open a page.
- **Parameterization.** ADR 0043 refused a `--count` and a `--live`; putting a form in front of the
  same function would refuse them less convincingly.
- **Authentication on the route.** There is nothing to authenticate against. Adding a check here
  and nowhere else would be security theatre on the one route that cannot destroy anything.
- **A progress indication.** The seed is one transaction. Reporting its stages would mean either
  inventing them or holding the request open to stream them, and it finishes in about a second.

## Consequences

- `packages/contracts` gains a path and a schema, which ADR 0043 had explicitly left untouched. The
  seed is now part of the public v1 contract and moves with it.
- `docs/development.md`'s reset path is unchanged and is now the only part of seeding that requires
  a terminal, which makes it the thing a reader will go looking for after pressing the button on a
  lab that refused.
- A deployment that does not want this must not expose the API, which was already true of every
  write route in the contract.

## Verification

- `test_lab_seed_api.py` posts at an empty migrated database and reads the identifiers back through
  the routes that serve the shop and the experiment; posts twice and asserts the second is a 409
  naming `definition_drafts` and the remedy, with the first seed's rows still there and the shop
  list still holding exactly one; and posts at a database behind the head, asserting the refusal
  and that nothing was written.
- `LabSettings.test.tsx` asserts the first press writes nothing, the second writes and links to the
  comparison, a refusal is read back with its tables and remedy rather than replaced by a message
  of the page's own, and a lab that already holds a shop is not offered the control.
- `SetupGuide.test.tsx` still asserts the guide carries no button in any of its cards.
