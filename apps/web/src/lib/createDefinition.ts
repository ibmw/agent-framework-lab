import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { describeApiError } from "../api/client";
import { useRegisterUnsavedWork } from "./unsavedWork";

/**
 * A create whose page asks for more than the create request can carry (PLAN-UX Slice 13).
 *
 * Four of the lab's definitions are created by a `POST` that takes a name and, for a
 * configuration, the identity it adopts. Everything else about the first draft — the
 * framework and the model, the rubric, a block's assessment and its parameters — lives in
 * the payload a `PUT` replaces, because the contract says so: *"A block is created with its
 * name only; everything else is decided in the editor."* The plan puts some of those answers
 * on the create page anyway, because they are what constrains the work that follows, so the
 * page makes the definition and then completes it.
 *
 * `NewOrderPage` proved the shape in Slice 12 and states the reasoning; this is that shape
 * with three more consumers, so the rules below are written once rather than four times.
 * The order page keeps its own copy: it refreshes its listing between the two writes to feed
 * a reference suggestion, freezes its Customer select once the `POST` lands, and reads the
 * created order's own reference back into its title — three behaviours that are the order
 * fixture's rather than this pattern's.
 *
 * Four rules, each of them load-bearing:
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
 *   kept going would write again, re-read a listing through a closure belonging to a shell
 *   nobody is standing in, and navigate somebody who has gone elsewhere into an editor.
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
  refresh: () => Promise<void>;
  /** Where the editor of what was made lives. */
  editorAt: (id: string) => string;
  /** What the unsaved-work register calls the answers the second write still owes. */
  owes: string;
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

export interface Creating {
  /** The create page's `<form>` submit handler, refusal included. */
  submit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string | null;
  /** `CreatePage`'s chip, once the first write has landed and the second is still owed. */
  standing?: string;
  /** Why Create cannot be pressed, resolved against whether the definition exists yet. */
  blockedBy?: string;
  /**
   * True once the first write has landed.
   *
   * A page reads it to freeze the answers that write froze — what the create request carried
   * and the page's second write cannot move — for the reason the order page fixes its
   * Customer select: a control that still looks like a question is a control lying about
   * what the lab holds.
   */
  created: boolean;
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
   * Asked with whether the definition already exists, because a refusal read off a listing
   * has to stop counting what this page has just written: the listing is re-read the moment
   * the first write lands, so a create page refusing "that name is taken" would refuse the
   * retry of its own create, by itself.
   */
  blocked: (created: boolean) => string | undefined,
): Creating {
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
  /** Set when this run must stand down: the operator left, or somebody else finished it. */
  const stopped = useRef(false);
  useEffect(() => {
    // Reset on mount as well as set on unmount, because `StrictMode` runs the pair twice.
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  const blockedBy = blocked(made !== null);

  async function run() {
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
      // The definition exists but the operator has gone: this run writes, reads and
      // navigates nothing further. Calling `refresh` from here is the one thing that must
      // not happen — the shell that closure belongs to may be showing something else by now.
      if (stopped.current) {
        return;
      }
      setMade(created);
      setOwed(!sameDraft(spec.compose(created.draft), created.draft));
      await spec.refresh();
      if (stopped.current) {
        return;
      }
    }
    // The form's *current* answers, so a value corrected after a refusal is the one that
    // lands.
    const payload = spec.compose(created.draft);
    if (!sameDraft(payload, created.draft)) {
      try {
        await spec.replace(created.id, payload);
      } catch (cause: unknown) {
        if (stopped.current) {
          return;
        }
        setError(describeApiError(cause, spec.whenCompleteFails));
        setBusy(false);
        return;
      }
      if (stopped.current) {
        return;
      }
      // Nothing is unsaved from here: the page must not stand in the way of any navigation,
      // including its own.
      landed.current = true;
      setOwed(false);
      // The row the index prints carries what that write changed.
      await spec.refresh();
      if (stopped.current) {
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
          label: spec.owes,
          reaches: () => landed.current,
          save: async () => {
            try {
              await spec.replace(made.id, spec.compose(made.draft));
            } catch (cause: unknown) {
              return describeApiError(cause, spec.whenCompleteFails);
            }
            // Done, by this hand rather than by the run that started it: that run stands
            // down so it cannot write a second time or navigate somebody who is leaving.
            landed.current = true;
            stopped.current = true;
            setOwed(false);
            await spec.refresh();
            return null;
          },
          // Thrown away, as ADR 0051 says Discard throws every piece away. What the lab
          // already holds stays as it is, and the run that was completing it writes no more.
          discard: () => {
            stopped.current = true;
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
    created: made !== null,
  };
}
