# ADR 0059 — A captured refresh is safe to call, and a read that has lost its subject drops itself

Status: accepted — 2026-09-22

Narrows ADR 0056's ordering rule for the listings the two workspace shells hold. `useReading`
ordered reads with a counter on which the read that started last wins, which is an answer about
*when* and not about *what*: a `refresh` captured by a continuation that outlived its page starts
its read last and so wins, whichever listing it is a read of. This adds the second half — a read
whose `load` is no longer the holder's is dropped, and dropped before it takes a number — which
makes any captured `refresh` safe to call from anywhere.

Records one decision and the rule it retires: the create pages' "the run may not call `refresh`",
which was never an ADR's and is no longer true.

## Context

ADR 0056 put every listing the rail counts in the shell that draws the rail, and gave the cache one
invalidation rule: *a surface that changes a listing refreshes it*. `useReading` orders the reads
that result — the mount read, a change of shop, and refreshes fired from handlers that have no
controller to be aborted by — with a counter, and its comment states the rule plainly: "the read
that started last wins, whichever kind started it".

That is sound for every read a mounted surface makes, and it has one hole. A create page's run is a
plain async continuation that outlives the page: `POST`, re-read, `PUT`, re-read, navigate. Every
await in it is a place the operator can leave from, and the `refresh` it holds belongs to the shell
the page was opened in — which may be showing another shop by the time the run resumes. Such a read
starts *after* the new subject's own mount read, so the counter makes it the winner at exactly the
moment it should lose, and the rows of the shop that was left land on the rail of the shop on
screen. That is the one thing a count on the chrome must never do.

The workaround, taken twice and named in both commit messages, was to forbid the call. A run that
had stood down wrote nothing, navigated nobody and *read nothing either*, and both create paths
carried a comment saying that calling `refresh` from there was the one thing that must not happen.

It has a price, and the price is a residue rather than a risk. Abandoning a create while the first
write is in flight leaves an order — or a scenario, or a judge — that the lab holds and no listing
has been told about: the rail's count and the index stay one row short until the shop or the lab is
entered again, because a listing re-reads when its `load` changes or the shell mounts, and walking
to the index inside the same shop does neither. The visible tail is worse than the figure: the next
create reads the short listing for its reference suggestion and offers one the lab already holds,
which `_require_free_reference` then refuses by name — a refusal about a row the operator cannot
see, over a name the field itself should have stepped past.

## Decision

### A read that is no longer a read of this holder's subject is dropped

`useReading` keeps the subject it is currently reading — the `load` its own effect last started
from — beside the counter, and a read answers to both:

- **Before it takes a number.** A read whose `load` is not the holder's current one returns without
  incrementing the counter and without touching any state. Dropping it only on the way back would
  be worse than not dropping it at all: a stale read that counted would make the read the shell
  actually wants no longer the last-started, and the listing on screen would never settle.
- **And on the way back**, because `load` can change while a read is in flight. The mount read has
  an `AbortController` for that case; a handler-fired refresh has none, and this is what it has
  instead.

The subject is assigned in the same effect that starts the mount read, before that read, so nothing
can start a read against a subject this holder has not adopted yet.

**What this buys is one sentence rather than a rule per surface**: a `refresh` is safe to hold on
to and safe to call late. It lands where the shell is still reading what it is a refresh of, and it
is dropped everywhere else, for every surface rather than for the two that knew to be careful.

### So the run re-reads the listing its own create changed, on the way down

The create pattern's stand-down (`useCreateThenComplete`) stops writing and stops navigating, as
ADR 0051's *Discard and leave* requires, and it now re-reads the listing at each point where it has
already changed what that listing answers: after its `POST`, and after a second write that was in
the air when the run was told to let go and landed once it had. ADR 0056's invalidation rule is about what the surface *did*,
not about whether it got to finish, and a rule that stopped applying the moment nobody was watching
would be a different rule. The two comments asserting that a stood-down run may not call `refresh`
are removed with the rule they describe.

## Deliberately not here

- **Aborting a handler-fired refresh.** `useReading`'s own comment weighed a controller per
  handler-fired read when the counter was written, and took the counter instead for a reason that
  still holds: cancelling on a change of subject says nothing about refreshes racing *each other*,
  or against the mount read. (ADR 0056 records no decision about a controller either way; the
  reasoning is the holder's, at `apps/web/src/shell/listings.ts`.) This adds the predicate that
  reasoning was missing; it does not replace the counter.
- **Re-reading a listing whenever its index mounts.** ADR 0056 refused it and nothing here reopens
  it. What lands the abandoned row is the run saying so, not the index asking again.
- **A refresh that survives the shell.** Nothing queues a read for a subject nobody is standing in.
  A dropped read is dropped, and the listing is read again when the shop is next entered — which is
  what it already did.

## Consequences

Every surface in both shells can call a `refresh` it captured. The two create paths stop saying
they may not, and the shared pattern — which the order page now uses too — calls it at the two
stop points where it used to return in silence, so an abandoned create leaves the rail and the
index counting what the lab actually holds and the next create steps past the reference it took.
One suite asserted the retired rule directly, as "no third read of the listing" after a discard
whose write was already in the air (`JudgeConfigurations.test.tsx`); its figure moves and its
subject does not, because what that case is about — the run navigating nobody into the editor of
what was abandoned — is unchanged and still asserted.

Nothing about what a listing contains, what it is read from, or when the shell reads it changes. No
contract moves and no backend is touched.

## Verification

- `Orders.test.tsx` holds both halves against one another. *Re-reads the listing its own create
  changed, after the operator has walked away*: the `POST` is held, the page is left before it
  answers, and the index the operator is standing on gains the row without being entered again.
  *Never lands that read on the shop the operator moved to*: the same abandonment across a change
  of shop, where the read starts last and must still lose.
- The suite's existing *drops a refresh that outlived the shop it was asked for* is unchanged and
  still passes: the counter's own case is not weakened by the predicate added beside it.
- `JudgeConfigurations.test.tsx`'s *stands the running write down when the operator discards it and
  leaves* now reads three listing reads rather than two, which is the second stop point above: the
  rubric is on the judge, so the row the index prints has moved, and the run says so on its way
  down without taking anybody anywhere.
- No contract test, because no contract moved.
