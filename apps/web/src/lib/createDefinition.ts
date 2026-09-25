import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeApiError } from "../api/client";
import { useRegisterUnsavedWork } from "./unsavedWork";

/**
 * A create whose page asks for more than the create request can carry (PLAN-UX Slice 13).
 *
 * Six of the lab's authored objects are created by a `POST` that takes little more than a
 * name — for a configuration the identity it adopts, for a scenario the ticket it is built
 * on, for an order the customer and the day it was placed. Everything else about the first
 * draft — the framework and the model, the rubric, a block's assessment and its parameters,
 * an order's line and its shipping address — lives in the payload a `PUT` replaces, because
 * the contract says so: *"A block is created with its name only; everything else is decided
 * in the editor."* The plan puts some of those answers on the create page anyway, because
 * they are what constrains the work that follows, so the page makes the object and then
 * completes it.
 *
 * `NewOrderPage` proved the shape in Slice 12 and stated the reasoning; the four definition
 * pages took it in Slice 13, the scenario page became the fifth, and the order page has now
 * folded its own copy onto this one. Its three particulars are accommodated here rather than
 * kept apart: the listing is re-read *between* the two writes, which every consumer wants and
 * the order page needs for its reference suggestion; `made` is handed back, so a page can
 * freeze what the create froze and read what the lab called it; and `owes` is asked of the
 * draft that was made rather than of the form.
 *
 * Five rules, each of them load-bearing:
 *
 * - **The second write is sent only where it is owed.** `compose` answers with the whole
 *   draft the form is asking for, built over what the lab actually made; where those are the
 *   same object the create already said everything and the page navigates on one write. A
 *   block created with nothing but a name is a one-write create, and says so by not
 *   registering anything.
 * - **The listing is re-read the moment the definition exists**, whether or not the write
 *   that follows lands, and again after that write, because the row the index prints carries
 *   what the second write changed (ADR 0056).
 * - **A refusal keeps the operator here with what was made.** A second press retries the
 *   `PUT` alone rather than creating a second definition, which is what `AGENTS.md` means by
 *   keeping a write idempotent.
 * - **The run stands down when the operator leaves.** `run` is a plain async continuation
 *   that outlives the component, so every await in it is a place to leave from; a run that
 *   kept going would write again and navigate somebody who has gone elsewhere into an
 *   editor. What it still does on the way down is re-read the listing wherever it has already
 *   changed what that listing answers — its `POST`, and a `PUT` that landed — because
 *   ADR 0056's rule is about what the surface *did* rather than about whether it finished. A
 *   captured `refresh` is safe to call from anywhere: `useReading` drops a read whose subject
 *   the shell has moved off (ADR 0059).
 * - **There is one second write, whoever is waiting for it.** The run holds its `PUT` where
 *   the registered `save` can find it, so *Save and leave* joins the write already on its
 *   way instead of sending a second one — and stands the run down as it joins, so the two
 *   cannot both decide what happens when it lands (ADR 0051).
 */
export interface Created<PayloadT> {
  /** The identifier the lab gave it, which its editor is addressed by. */
  id: string;
  /** The draft the lab made, which the second write replaces. */
  draft: PayloadT;
}

export interface CreateSpec<PayloadT> {
  /** The first write: the create request the contract takes. */
  create: () => Promise<Created<PayloadT>>;
  /**
   * The whole draft the form is asking for, composed over what the lab made.
   *
   * Built by spreading `made`, so the answer carries the create's own values for everything
   * the page does not ask about — and so the comparison below is sound.
   */
  compose: (made: PayloadT) => PayloadT;
  /** The second write. */
  replace: (id: string, payload: PayloadT) => Promise<unknown>;
  /** The listing the rail counts and the index renders (ADR 0056). */
  refresh: () => Promise<unknown>;
  /** Where the editor of what was made lives. */
  editorAt: (id: string) => string;
  /**
   * What the unsaved-work register calls the answers the second write still owes.
   *
   * Asked with the draft the lab made, for the one consumer that reads it. An order is named
   * by a reference the `POST` answers with, and that page's own field can be retyped after a
   * refusal, so a label built from the field would name an order the lab does not hold.
   *
   * The others build their label from their form and ignore the argument. Only the two block
   * libraries make that watertight, by freezing their Name once the create lands; the agent
   * configuration, the judge and the scenario leave theirs open — what those three freeze is
   * what the create request froze and the second write cannot move, the adopted identity and
   * the ticket — so a name retyped after a refusal does label their prompt with a name the lab
   * was never told. That is those pages' residue rather than this hook's, and the argument is
   * here for whoever closes it.
   */
  owes: (made: PayloadT) => string;
  /**
   * What the chip beside the create page's title says while that is true.
   *
   * Only for the interval where a second write is owed. A create that owed none still needs
   * the chip to stop saying "nothing created yet" between the write landing and the editor
   * opening, and what is true of every page then is the same word, so the hook says it
   * rather than asking each consumer for a second string.
   */
  standing: string;
  whenCreateFails: string;
  whenCompleteFails: string;
}

export interface Creating<PayloadT> {
  /** The create page's `<form>` submit handler, refusal included. */
  submit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string | null;
  /** `CreatePage`'s chip, once the first write has landed and the second is still owed. */
  standing?: string;
  /** Why Create cannot be pressed, resolved against whether the definition exists yet. */
  blockedBy?: string;
  /**
   * What the first write made, or `null` while it has made nothing.
   *
   * A page reads it for two things. That it is there at all is what freezes the answers the
   * create froze — what the request carried and the second write cannot move — for the
   * reason the order page fixes its Customer select: a control that still looks like a
   * question is a control lying about what the lab holds. And what is in it is what the lab
   * decided: the order page reads the reference back out of it, so a field emptied after a
   * refusal is handed the name the order actually has rather than a fresh guess.
   */
  made: Created<PayloadT> | null;
}

/**
 * Whether the form is asking for the draft the lab already made.
 *
 * A JSON comparison rather than a field-by-field one, and it is sound for exactly one
 * reason: `compose` builds its answer by spreading what the create returned, so both objects
 * carry the same keys in the same order — overwriting a key leaves it where it was. A
 * `compose` written any other way would make this say "different" when the two agree, which
 * costs one redundant write and never loses an answer.
 */
function sameDraft(asked: unknown, made: unknown): boolean {
  return JSON.stringify(asked) === JSON.stringify(made);
}

export function useCreateThenComplete<PayloadT>(
  spec: CreateSpec<PayloadT>,
  /**
   * Why Create cannot be pressed, which is also why a submitted form does nothing.
   *
   * Asked with what the first write made, because a refusal read off a listing has to stop
   * counting what this page has just written: the listing is re-read the moment that write
   * lands, so a create page refusing "that name is taken" would refuse the retry of its own
   * create, by itself. Most pages only need to know whether it exists; the order page reads
   * its id, to take its own row back out of the references it calls taken.
   */
  blocked: (made: Created<PayloadT> | null) => string | undefined,
): Creating<PayloadT> {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the first write made, kept so a second press finishes it rather than repeating it. */
  const [made, setMade] = useState<Created<PayloadT> | null>(null);
  /** Whether the answers on screen are still only on screen. */
  const [owed, setOwed] = useState(false);
  /**
   * Set the moment this page's work is finished and it is navigating into the editor.
   *
   * Read by the registration rather than by a render: the router asks the blocker before
   * React has committed anything, so a flag in state would still say "unsaved" and the
   * prompt would ask about the definition the operator is being taken to (ADR 0051).
   */
  const landed = useRef(false);
  /**
   * Which run may still act.
   *
   * `run` is a plain async continuation that outlives the component, so every await in it is a
   * place the operator can leave from, and something has to tell a run that resumes there that
   * it is no longer the one. A boolean cannot: *stood down* and *free to run* are the same
   * value in it, so a `save` that stands a run down and is then refused — which leaves the
   * operator here with a retry to press, and so has to hand the page back — would hand the
   * licence back to the run it stood down as well. That run would resume into the write it was
   * going to make, send a second `PUT`, and navigate an operator who is reading *that did not
   * save* into the editor of what they were leaving: the defect this pattern exists to remove,
   * in a narrower window.
   *
   * A number separates the two. Each run takes the next one as it starts and holds it against
   * this ref before acting on anything it awaited; leaving the page, discarding, and the
   * prompt's own Save each burn the current number, so whoever held it never acts again; and a
   * retry press takes a fresh one rather than reviving anybody.
   */
  const generation = useRef(0);
  /**
   * The second write while it is on its way, so there is only ever one of it.
   *
   * The registered `save` and the run both owe the same `PUT`, and the run's is usually the
   * one already in flight — it started first. A `save` that wrote again would send a second
   * idempotent `PUT` and, worse, leave two continuations each deciding what happens when a
   * write lands: the run resuming first navigates into the editor, the router resets every
   * blocker as it goes, and the prompt's `proceed()` then throws out of a promise nobody is
   * holding (ADR 0051). So the write is put here and joined rather than repeated.
   */
  const writing = useRef<Promise<string | null> | null>(null);
  useEffect(() => {
    // Leaving burns whatever number is current, which stands down a run in flight. Nothing is
    // reset on mount: a run started after one takes a number higher than every number burnt
    // before it, which is also what makes `StrictMode`'s double mount a non-event.
    return () => {
      generation.current += 1;
    };
  }, []);

  const blockedBy = blocked(made);

  /**
   * The second write, held where a joiner can find it. Answers the refusal, or `null`.
   *
   * It never rejects, because both of the things waiting for it want the same answer and
   * neither of them wants a rejection: the refusal is the value.
   */
  async function complete(id: string, payload: PayloadT): Promise<string | null> {
    const write = spec
      .replace(id, payload)
      .then(() => null)
      .catch((cause: unknown) => describeApiError(cause, spec.whenCompleteFails));
    writing.current = write;
    const refused = await write;
    if (writing.current === write) {
      writing.current = null;
    }
    return refused;
  }

  async function run() {
    generation.current += 1;
    const mine = generation.current;
    /** Whether this run is still the one the page is waiting for. */
    const standing = () => generation.current === mine;
    setBusy(true);
    setError(null);
    let created = made;
    if (created === null) {
      try {
        created = await spec.create();
      } catch (cause: unknown) {
        setError(describeApiError(cause, spec.whenCreateFails));
        setBusy(false);
        return;
      }
      // The definition exists but the operator has gone: this run writes and navigates
      // nothing further. It does re-read the listing, because the row is there whether or
      // not anybody is standing in front of it — and this is the read that was missing, the
      // one whose absence left the rail and the index a row short until the shop was
      // entered again. The closure is safe wherever it was captured: `useReading` drops a
      // read whose subject the shell has moved off (ADR 0056, ADR 0059).
      if (!standing()) {
        await spec.refresh();
        return;
      }
      setMade(created);
      setOwed(!sameDraft(spec.compose(created.draft), created.draft));
      await spec.refresh();
      if (!standing()) {
        return;
      }
    }
    // The form's *current* answers, so a value corrected after a refusal is the one that
    // lands.
    const payload = spec.compose(created.draft);
    if (!sameDraft(payload, created.draft)) {
      const refused = await complete(created.id, payload);
      // Either the operator has gone, or the prompt's Save burnt this run's number as it
      // joined this very write and owns what happens now, refusal included. Two hands on one
      // answer is the whole defect, so this one lets go — and re-reads on the way down if its
      // write landed, because a landed `PUT` changed the row the index prints whether or not
      // anybody stayed to see it (ADR 0056). In the joined case the Save re-reads too; the
      // two are reads of the same listing and the later one wins, which costs one request and
      // can answer nothing different (ADR 0059).
      if (!standing()) {
        if (refused === null) {
          await spec.refresh();
        }
        return;
      }
      if (refused !== null) {
        setError(refused);
        setBusy(false);
        return;
      }
      // Nothing is unsaved from here: the page must not stand in the way of any navigation,
      // including its own.
      landed.current = true;
      setOwed(false);
      // The row the index prints carries what that write changed.
      await spec.refresh();
      if (!standing()) {
        return;
      }
    }
    landed.current = true;
    navigate(spec.editorAt(created.id));
  }

  /**
   * Once the definition exists, this page holds an edit to something that exists.
   *
   * ADR 0051's "a half-typed create form is not an edit to something that exists" keeps a
   * one-write create out of the register, and it stops being true the moment the first write
   * lands with answers the second one has not carried yet: they are on screen and nowhere
   * else. So from that moment the page declares itself, with its own second write as their
   * save. Discarding leaves the definition as the lab holds it, which is exactly what walking
   * away does.
   */
  useRegisterUnsavedWork(
    made === null || !owed
      ? null
      : {
          label: spec.owes(made.draft),
          reaches: () => landed.current,
          save: async () => {
            // The run's own `PUT` may already be on its way; this joins it rather than
            // sending a second.
            //
            // The number is burnt *here*, before the await, for the case where there is
            // nothing to join. The run is then parked in the listing read that follows its
            // `POST` — a macrotask, which can answer while this hand's own write is still in
            // flight — and a run that found its number intact would resume into the write it
            // was about to make and navigate on top of this one. Burning it once the answer
            // arrived would be too late for exactly that run, which is the ordering
            // `burns the run's number before its own write, not after it` stages.
            //
            // The joined case is safe either way, so it is not the reason: `save` resumes
            // before the run does, because the run awaits the promise `complete` returns and
            // this awaits the write itself.
            const joined = writing.current;
            generation.current += 1;
            const refused = await (joined ?? complete(made.id, spec.compose(made.draft)));
            if (refused !== null) {
              // Nothing was finished, so the page is handed back as a refused press leaves
              // it: the reason under the button and a Create that can be pressed again. The
              // run stays down — a retry takes a number of its own, so nothing here has to
              // hand a licence back to a continuation that was told to let go.
              setError(refused);
              setBusy(false);
              return refused;
            }
            // Done, by this hand rather than by the run that started it: that run stays
            // stood down so it cannot navigate somebody who is leaving.
            landed.current = true;
            setOwed(false);
            await spec.refresh();
            return null;
          },
          // Thrown away, as ADR 0051 says Discard throws every piece away. What the lab
          // already holds stays as it is, and the run that was completing it writes no more.
          discard: () => {
            generation.current += 1;
          },
        },
  );

  return {
    submit: (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (blockedBy !== undefined) {
        return;
      }
      void run();
    },
    busy,
    error,
    // `CreatePage`'s chip reads "nothing created yet" while this is absent, and that stops
    // being true the moment the first write lands — including on the one-write path, whose
    // navigation is still in flight when it does.
    standing: made === null ? undefined : owed ? spec.standing : "created",
    blockedBy,
    made,
  };
}
