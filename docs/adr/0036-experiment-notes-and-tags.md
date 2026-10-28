# ADR 0036 — What an operator writes on a run, and why it is not part of the run

Status: accepted — 2026-09-05

Amendment: 2026-10-28 — ADR 0080 places what an operator writes on the results: the tags in the
header under *Filed under*, and the notes as the sheet's last section, the composer first.
Nothing this record decides about storing, folding or writing them changes.

Delivers the notes-and-tags quarter of `docs/PLAN.md` Milestone 5's seventh outcome, which
that outcome splits from traces, replay, and fork provenance by name. Records the annotation
as a document stored beside the experiment rather than inside it, the fold that gives a tag
one spelling, the difference between appending a note and replacing a tag set, and why this
one reading does not travel with the run.

## Context

Everything this lab holds about an experiment is either a record of what happened — the
turns, the tool calls, the faults, the judge executions — or a reading of one: the standing
(ADR 0029), the evaluation (ADR 0030), the metrics (ADR 0032), the state diff (ADR 0035).
The results screen and the history listing are both built entirely out of those two kinds of
thing, and ADR 0033 and ADR 0034 spent most of their reasoning making sure no third kind
crept in.

A note is a third kind. It is what a person concluded, it arrives after the run is over, and
nothing about the run produces it. Frame 9 puts it at the bottom of the results screen as a
strip of chips and one sentence — *"Beacon acts before reading policy — its prompt likely
under-specifies the policy tool"* — and frame 10 makes it searchable and its tags a filter.
Neither is expressible with what the lab had.

## Decision

### An annotation is stored beside the experiment, never inside it

`experiments` is written once and never updated (ADR 0025) because the document it holds is
what explains the result. Notes and tags therefore live in two tables of their own,
`experiment_notes` and `experiment_tags`, keyed by the experiment they are about.

That is what makes the obvious thing true: annotating a run six months later cannot move its
`resolution_fingerprint` or its `sandbox_fingerprint`, so a run that has been written about
is still bit-for-bit the run that was started. Putting a tag list in the experiment document
would have made a reviewer's opinion part of the identity of the experiment, and two runs
that differed only in how someone filed them would have stopped being repeats of each other.

### A note is appended; a tag set is replaced

They are different kinds of statement, so they get different operations.

A note is an observation made at a moment. It is written once and never edited, for the
reason a judge execution is never overwritten (ADR 0031): what makes it worth keeping is
that it is what a reviewer thought when they read this evidence, and a note quietly rewritten
afterwards is no longer that. `POST .../notes` is deliberately not idempotent, the way
delivering a customer turn is not — two reviewers who wrote the same sentence wrote two
notes, and collapsing them would delete the second person's reading.

Tags are how the run is *currently* filed. Refiling is an ordinary thing to do, so
`PUT .../tags` takes the whole set: the operator is looking at the chips and saying what they
should be. An add-and-remove pair would let two requests that crossed leave a set neither of
them asked for, and it would have to be right about which shelves already existed. Setting
the same set again changes nothing, which is what makes the write safe to retry.

Both operations answer with everything written on the run, for the reason a scoring pass
answers with the whole evaluation: a client that had to merge one appended note into a list
it read separately would be holding two readings of one run.

### A tag is folded to one spelling, and refused if that fails

`normalize_tag` trims, lowercases, and collapses runs of whitespace, underscores, or hyphens
to single hyphens. `Read check gap`, `read_check_gap`, `READ-CHECK-GAP`, and `read - check -
gap` are one shelf, because a tag exists to be narrowed by: two spellings would be two
options in the same dropdown, and choosing one would hide the runs filed under the other.
The hyphen is a separator as well as the character the fold writes, deliberately — a class
that folded spaces but not the hyphens around them would refuse kebab-case for being
kebab-case. A leading or trailing separator still folds to a leading or trailing hyphen and
is still refused, because `-leading` is not a slug. The fold is idempotent, so the stored
value is what the next fold produces and comparison is plain equality.

`fold_tag` is that step plus the refusal, and the two are separate functions because their
callers want different halves of one rule. A **write** must end in a shelf that can be
stored, so it refuses what it cannot fold. A **filter** must never refuse: a link shared
after the last run under a shelf was refiled should narrow to nothing rather than become an
error page, and a query is not authoring. Both go through the same normalization, which is
what makes them agree — a filter that only lowercased would work for the spellings the
dropdown emits and find nothing for a hand-typed `tag=Read check gap`, with the identical
tag sitting on a row.

What the fold will not do is invent a tag out of anything. The normalized value must still
be a slug, so an accented or punctuated string is refused rather than mangled into a key
nobody would guess. That is a real limit — `écoles` is not a tag — and it is the right one:
the words go in a note, and a tag is what the note is filed under. `fold_tags` deduplicates
and sorts, because a set typed in two orders by two operators is one classification.

### Two requests filing one run at once is a conflict, not a failure

Replacing a set is a delete and then inserts, not an atomic swap, so two crossing requests
that both file the run under one shelf can both delete and then meet the primary key on the
second commit. SQLite serializes writers and never produces it; PostgreSQL under READ
COMMITTED does, and this build is meant to be portable to it.

The repository translates that violation into `ExperimentTagConflictError`, answered as 409,
the way a second publication of one version is — because it is the same kind of fact, and
because the retry it asks for is safe here by construction: setting a tag set is idempotent,
so "read the chips and set them again" always terminates. Left untranslated it would have
surfaced as a 500, which is the one shape a retryable conflict must not have.

The translation deliberately does not discriminate between integrity failures, and the
foreign key is therefore tested against the store rather than through this method: nothing
in this lab deletes an experiment, so an orphaned annotation is unreachable from the service,
and reporting one as "filed concurrently" would be worse than not translating at all.

### It is read on its own rather than on the run

The standing, the metrics, and the state diff travel with `ExperimentDetail` because each is
a projection of documents that read has already resolved, and a client handed the inputs
would be free to compute something else (ADR 0029, ADR 0032, ADR 0035). None of that applies
here. An annotation is a stored document with its own lifecycle — the run is finished, and
this is not — and there is no second reading of it to disagree with.

So `GET .../annotations` is its own operation, and `ExperimentService` does not know
annotations exist. The alternative would have made the runner, the timeline, and every
history row carry text nobody on those paths asked for. The results screen reads it in the
same `Promise.all` it already reads the experiment and the evaluation in, so the screen is
still one reading arriving at once.

The write service reads the experiment *row* rather than the detail the bench builds:
attaching a note needs to know the run exists in this shop and nothing else, and resolving
every pinned version to store a sentence would be paying for the whole record to write
beside it.

### History shows the tags, counts the notes, and searches both

A tag is a column, a filter, and a facet — it exists to narrow by, and the facet list offers
exactly the shelves runs are actually on, so it is empty in a lab where nobody has tagged
anything rather than offering a vocabulary nobody uses. The tag filter matches the stored
folded value and never refuses: a link shared after the last run under a shelf was refiled
narrows to nothing rather than becoming an error page.

A note is the opposite. It is prose about one run and reads as itself only beside the
evidence it was written against, so the row carries the *count* — `note_count`, named apart
from the annotation document's `notes`, because one field name holding a number on one
response and an array on another is a trap a generated client walks into once and a person
walks into every time — and the search box carries the words. That is the one place a
listing reaches into text it does not show, and it is worth it: a note is the most specific
thing anyone ever writes about a run, and so the thing they are most likely to come back
with.

The whole listing reads annotations in two statements rather than two per row — history
already projects every experiment, and this is the one part of a row that does not arrive
with the record.

## Deliberately not here

- **Editing or deleting a note.** Append-only is the point, as above. An operator who wrote
  the wrong thing writes the right thing beneath it, which is also what the record shows.
- **A client-supplied note identifier.** `AGENTS.md` asks that replayable modifying commands
  be idempotent, and an id chosen by the caller would satisfy it: a retried request would
  converge on one note while two reviewers still produced two. It is left out because the
  operations that surround it do not have one either — starting an experiment and delivering
  a customer turn are both deliberately not idempotent — and adding it here alone would make
  this one surface answer a question the rest of the runner does not. It is the cheapest
  thing to add if a flaky network ever makes duplicate notes a real complaint, and the
  contract can gain an optional field without breaking a client.
- **Who wrote it.** This lab has no users, and a name field nothing fills would be a column
  that lies as soon as it has two operators. It belongs with the identity model, not before
  it.
- **A tag library.** Tags are folded strings, not definitions: there is no draft, no version,
  and no rename. The facet list is the vocabulary, and it is read from what is filed.
- **Annotating an arm, a turn, or an objective.** A note is about the comparison, which is
  what an operator is looking at when they conclude something. Per-arm notes would be a
  second axis with no screen asking for it.
- **Traces, replay, and fork provenance.** The rest of Milestone 5's seventh outcome. Nothing
  here constrains them: traces need the recorded spans beside the record, and replay and fork
  derive new experiments from old ones.

## Verification

- Domain tests (`test_experiment_domain.py`) cover the shape of both: a note with nothing in
  it is not a note, a note longer than the cap is refused, every spelling of one shelf —
  spaced, underscored, hyphen-padded, or doubled — folds to one tag, folding a folded tag is
  a fixed point, a leading or trailing separator is still refused, a tag the fold cannot make
  a slug of is refused rather than mangled, the lenient half normalizes without ever
  refusing, a set is deduplicated and ordered, the tag cap holds, and a bare string is not a
  tag set.
- Contract tests (`test_experiment_api.py`) drive the operations: a run nobody has written on
  reads as empty rather than missing, a note answers with everything on the run, two
  identical sentences are two notes, notes read back in the order they were written, tags are
  folded and deduplicated, setting them replaces the whole set, filing the same way twice
  changes nothing, a padded body is recorded trimmed while one that is only padding is
  refused by the contract rather than by the domain, and — the rule this ADR exists for —
  writing both leaves the experiment's two fingerprints exactly where they were.
- History tests (`test_experiment_history.py`) cover the listing: a row shows its tags and
  counts its notes, the tag filter narrows, a tag no run carries narrows to nothing rather
  than refusing, the filter matches however the shelf was typed, the search box finds a run
  by a note it does not display, and the tag options stay the whole lab's when one is chosen.
  The "however the shelf was typed" case is parametrized over case, spacing, underscores, and
  padded hyphens, because that is what the filter claims.
- Repository tests (`test_repositories.py`) cover what SQLite will not show at the HTTP
  boundary: a duplicate shelf reaches the caller as a retryable conflict and rolls the whole
  replacement back rather than leaving the run half-refiled, and an annotation for a run that
  does not exist is refused by the foreign key.
- A migration test (`test_migrations.py`) holds the two store rules apart: a run is filed
  under one shelf only once, and two identical notes are two rows.
- Frontend tests (`Experiments.test.tsx`, `History.test.tsx`) cover the strip and the row: an
  unwritten-on run says so, a note is kept as written and the box empties only on success, a
  tag change sends the whole set, the chip shows the folded spelling, removing a chip leaves
  a half-typed tag beside it alone, a failed write keeps what was typed, and a row shows its
  tags and note count while a bare one shows nothing.
- The Playwright journey (`experiment-start.spec.ts`) is extended rather than duplicated, as
  every slice since ADR 0026 has been: after reading the evidence, the operator files the run
  under a tag they typed with spaces and writes why, then finds it again in the lab's history
  by that tag and by the sentence the listing never shows.

## Migration

`20260905_0017` adds `experiment_notes` and `experiment_tags`, both foreign-keyed to
`experiments`. Nothing is backfilled and nothing existing is touched: an experiment started
before this slice reads back exactly as it did, with an empty annotation rather than a
missing one.
