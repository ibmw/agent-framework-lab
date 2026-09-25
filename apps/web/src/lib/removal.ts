import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { readConfirmBeforeDelete } from "./preferences";

/**
 * Which row of one list is being asked about, and the first press that asks (ADR 0060).
 *
 * One per list: arming a second row walks the first back, because two open questions about
 * one list are two answers an operator has to keep straight. The act itself is never held
 * here. `ask` runs it at once when the preference has removed the second press, and
 * otherwise the confirm is handed the act again when it renders — so the removal written is
 * the one against the draft as it stands at the second press, not a copy of the draft taken
 * at the first, which would put back every edit made in between.
 */
/**
 * What a removal does. A draft edit is synchronous and cannot fail. A write to the lab — a
 * detach — is a promise answering whether it landed, and the notice waits for that answer: it
 * says nothing about a write that failed, whose page shows its own error instead.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a draft edit returns nothing, a write answers
export type RemovalAct = () => void | Promise<boolean>;

export interface Removal {
  isArmed: (key: string) => boolean;
  /**
   * The first press: arms the row, or — when the preference has removed the second press —
   * acts at once and says `notice`, exactly as the second press would have.
   */
  ask: (key: string, act: RemovalAct, notice: string | null) => () => void;
  /** Where focus goes back to when the confirm is walked back. */
  trigger: (key: string) => (element: HTMLElement | null) => void;
  /** Walks the confirm back, returning focus to the control that asked. */
  keep: () => void;
  /** The second press: acts, says `notice`, and moves focus to the list's notice line. */
  confirm: (act: RemovalAct, notice: string | null) => () => void;
  /** What the last removal on this list said, for `RemovalNotice`, or nothing. */
  notice: string | null;
  /**
   * Says that a row is on screen without asking whether it is armed — for a list that offers
   * no Remove of its own but shows a removal made elsewhere (ADR 0060).
   */
  present: (key: string) => void;
  /** Says a removal made on another page, which navigated here to say it. */
  announce: (text: string, key: string) => void;
  /** Stops saying the last removal. */
  clear: () => void;
  /** The notice line, which is where focus goes once the row it was on has gone. */
  noticeRef: (element: HTMLElement | null) => void;
}

/**
 * One list's second press.
 *
 * `scope` names what the list belongs to — the product, the profile, the order. A route that
 * moves to another one without remounting the page drops whatever was armed or said, so a
 * confirm never follows the operator onto an entry it was not asked about. And an armed key
 * that no row asked about in the last render is dropped too: a row taken away by *Discard
 * changes*, a search or a move elsewhere does not come back already armed when an entry of
 * the same key returns.
 *
 * `discarding` is the draft's own flag, for a list whose subject has no identity steadier than
 * the key it is addressed by (a product, ADR 0060): once a discard lands, the draft under the
 * list has been read again, and neither an armed row nor the last notice is about it any more.
 */
export function useRemoval(scope = "", discarding = false): Removal {
  const [armed, setArmed] = useState<{ scope: string; key: string } | null>(null);
  const [said, setSaid] = useState<{ scope: string; text: string; key: string } | null>(null);
  const triggers = useRef(new Map<string, HTMLElement>());
  const returnTo = useRef<string | null>(null);
  const noticeElement = useRef<HTMLElement | null>(null);
  const focusNotice = useRef(false);
  // A write that did not land walks the removal back from outside a render; this is what asks
  // for the render that puts focus back on the control that asked.
  const [, walkedBack] = useReducer((count: number) => count + 1, 0);
  // The subject this list is showing now, and whether it is still mounted: a write that
  // answers late speaks only to the list that sent it, never to one that has moved on.
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The keys the rows asked about while this list last rendered.
  const asked = useRef(new Set<string>());
  asked.current = new Set();

  const armedKey = armed !== null && armed.scope === scope ? armed.key : null;
  const notice = said !== null && said.scope === scope ? said.text : null;

  // Walked back or moved on: nothing stays armed for a subject that is no longer on screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope is the trigger
  useEffect(() => {
    setArmed(null);
    setSaid(null);
  }, [scope]);

  const wasDiscarding = useRef(discarding);
  useEffect(() => {
    if (wasDiscarding.current && !discarding) {
      setArmed(null);
      setSaid(null);
    }
    wasDiscarding.current = discarding;
  }, [discarding]);

  useEffect(() => {
    if (armedKey !== null && !asked.current.has(armedKey)) {
      setArmed(null);
    }
    // The row the notice speaks of is back — *Discard changes* restored it — so the notice
    // would now say something untrue. A notice cleared here is not focused below: the next
    // commit hides the line.
    let clearing = false;
    if (notice !== null && said !== null && asked.current.has(said.key)) {
      setSaid(null);
      clearing = true;
    }
    // After a walk-back the row is drawn again, and its Remove is a new element: focus can
    // only go back to it once it exists, which is after the commit that redrew it.
    if (armedKey === null && returnTo.current !== null) {
      const element = triggers.current.get(returnTo.current);
      returnTo.current = null;
      if (element?.isConnected) {
        element.focus();
      }
    }
    // After a removal the row is gone, and the line saying so is where the reader is left —
    // unless the line was emptied in this same pass: a notice about an entry that is still on
    // screen (a removal carried here onto a list that still draws it) is dropped rather than
    // said, and focusing the empty, hidden line would leave the reader nowhere.
    if (focusNotice.current && (clearing || notice === null)) {
      focusNotice.current = false;
    } else if (focusNotice.current && noticeElement.current?.isConnected) {
      focusNotice.current = false;
      noticeElement.current.focus();
    }
  });

  const removed = useCallback(
    (key: string, act: RemovalAct, text: string | null) => {
      setArmed(null);
      // A walk-back owed from an earlier removal is not this one's to deliver.
      returnTo.current = null;
      const sentFor = scope;
      const stillHere = () => mounted.current && currentScope.current === sentFor;
      const say = () => {
        if (text !== null) {
          setSaid({ scope, text, key });
          focusNotice.current = true;
        }
      };
      const done = act();
      if (done instanceof Promise) {
        // Only once the write has landed: before it, the row is still drawn and the notice
        // would be cleared as soon as it was set; after a failure it would be untrue. A write
        // that failed — or threw — is walked back instead: nothing is said, and focus returns
        // to the control that asked, whose row is drawn again.
        const walkBack = () => {
          if (!stillHere()) {
            return;
          }
          returnTo.current = key;
          walkedBack();
        };
        void done.then((landed) => {
          if (!landed) {
            walkBack();
          } else if (stillHere()) {
            say();
          }
        }, walkBack);
      } else {
        say();
      }
    },
    [scope],
  );

  const ask = useCallback(
    (key: string, act: RemovalAct, text: string | null) => () => {
      if (!readConfirmBeforeDelete()) {
        removed(key, act, text);
        return;
      }
      setSaid(null);
      returnTo.current = null;
      setArmed({ scope, key });
    },
    [scope, removed],
  );

  // A detached element is left in the map rather than deleted on React's null call, which
  // arrives for the old callback on every render; the focus above checks it is still drawn.
  const trigger = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element) {
        triggers.current.set(key, element);
      }
    },
    [],
  );

  const keep = useCallback(() => {
    returnTo.current = armedKey;
    setArmed(null);
  }, [armedKey]);

  const confirm = useCallback(
    (act: RemovalAct, text: string | null) => () => removed(armedKey ?? "", act, text),
    [removed, armedKey],
  );

  const clear = useCallback(() => setSaid(null), []);

  const announce = useCallback(
    (text: string, key: string) => {
      setSaid({ scope, text, key });
      focusNotice.current = true;
    },
    [scope],
  );

  const noticeRef = useCallback((element: HTMLElement | null) => {
    noticeElement.current = element;
  }, []);

  return useMemo(
    () => ({
      isArmed: (key: string) => {
        asked.current.add(key);
        return armedKey === key;
      },
      ask,
      trigger,
      keep,
      confirm,
      notice,
      noticeRef,
      present: (key: string) => {
        asked.current.add(key);
      },
      announce,
      clear,
    }),
    [armedKey, ask, trigger, keep, confirm, notice, noticeRef, announce, clear],
  );
}

/**
 * What the publish gate says after a removal, in the operator's words, keyed by the finding
 * code the domain raises (`domain/shop.py`, `customer_profile.py`, `support_identity.py`,
 * `order_fixture.py`, `ticket.py`, `scenario.py`).
 *
 * One place, so the clause a confirm says about a finding is the same wherever the removal
 * that raises it is offered. Each clause names the severity the gate gives it — *refused at
 * publication* for an error, *warned about* for a warning — and nothing it does not.
 */
export const REMOVAL_FINDINGS = {
  // domain/shop.py
  product_without_variant:
    "It is the product's last variant, and the shop is refused at publication while a product has none.",
  product_without_media:
    "It is the product's last media reference, which the publish gate warns about.",
  shop_without_payment_method:
    "It is the shop's last enabled payment method, and a shop with none is refused at publication.",
  shop_without_fulfilment_method:
    "It is the shop's last fulfilment method, and a shop with none is refused at publication.",
  shop_without_policy:
    "It is the shop's last policy, and a shop with none is refused at publication.",
  shop_without_faq: "It is the shop's last FAQ entry, which the publish gate warns about.",
  shop_without_support_guideline:
    "It is the shop's last support guideline, which the publish gate warns about.",
  duplicate_variant_options:
    "the shop is refused at publication until they differ again or one of them is removed",
  shop_without_tone_of_voice:
    "It is the shop's last tone-of-voice guideline, and a shop with none is refused at publication.",
  tone_of_voice_without_default:
    "It is the shop default, and the shop is refused at publication until another guideline is made the default.",
  payment_method_missing_from_shop:
    "An order that recorded it keeps the name it froze, and its findings warn that this shop no longer configures that payment method.",
  fulfilment_method_missing_from_shop:
    "An order that recorded it keeps the name it froze, and its findings warn that this shop no longer configures that fulfilment method.",
  // domain/scenario.py (an error) and domain/ticket.py (a warning) read one document two ways.
  context_document_missing_from_shop:
    "A scenario that names it is refused at publication, because it names a document this shop no longer configures.",
  suggested_document_missing_from_shop: "A ticket that suggests it is warned about.",
  // domain/blocks.py
  mutation_without_timing:
    "It is the block's only timing parameter, and a mutation without one is refused at publication: a mutation is injected at a bound moment.",
  // domain/customer_profile.py
  profile_without_address:
    "It is the profile's last address, and a profile with none is refused at publication.",
  shipping_address_source_removed:
    "An order shipped to it keeps its frozen copy, and its findings warn that the entry can no longer be reselected.",
  address_book_without_default:
    "It is the default, and the profile is refused at publication until another entry is made the default.",
  profile_without_background:
    "It is the profile's last background entry, which the publish gate warns about.",
  // domain/support_identity.py
  identity_without_guidance:
    "It is the identity's last guidance note, which the publish gate warns about.",
  identity_without_escalation_condition:
    "It is the identity's last escalation condition, which the publish gate warns about: the identity then never escalates.",
  // domain/order_fixture.py
  order_without_line:
    "It is the order's last line, and an order with none is reported as unable to seed a sandbox.",
  order_without_event:
    "It is the order's last event, which the order's findings warn about: an agent finds no history through the order tools.",
  payment_status_without_event:
    "It is the event that explains the order's payment status, which the order's findings then warn about.",
  fulfilment_status_without_event:
    "It is the event that explains the order's fulfilment status, which the order's findings then warn about.",
  // domain/ticket.py, domain/scenario.py — an order or a customer they name leaves the shop
  linked_order_missing_from_shop:
    "A ticket that links it, or a scenario bound to it, is refused at publication, because it names an order this shop no longer has.",
  customer_not_attached_to_shop:
    "Until the profile is attached again, an order of theirs in the shop they leave is reported as unable to seed a sandbox, and a ticket or a scenario bound to them is refused at publication.",
  // domain/ticket.py
  ticket_without_trigger:
    "It is the message every arm receives at experiment start, and a ticket without one is refused at publication. An earlier message does not take its place.",
  // domain/scenario.py
  scenario_without_objective:
    "It is the scenario's last objective, and a scenario with none is refused at publication.",
} as const;

export type RemovalFinding = keyof typeof REMOVAL_FINDINGS;

/** The clauses for the findings a removal raises, in order, as one run of sentences. */
export function findingClauses(
  codes: readonly (RemovalFinding | false | null | undefined)[],
): string {
  return codes
    .filter((code): code is RemovalFinding => Boolean(code))
    .map((code) => REMOVAL_FINDINGS[code])
    .join(" ");
}

/** A confirm's consequence from its sentences, dropping the ones a given removal does not have. */
export function consequenceOf(...sentences: (string | false | null | undefined)[]): string {
  return sentences.filter((sentence): sentence is string => Boolean(sentence)).join(" ");
}

/** What a page that removed something and left says to the page it left for (ADR 0060). */
export interface RemovedState {
  removed: { text: string; key: string };
}

/**
 * The location state a removal that navigates carries, so the list it lands on can say what
 * was removed: the page that removed it is unmounting, and a notice written there is written
 * into nothing.
 */
export function removedState(text: string, key: string): RemovedState {
  return { removed: { text, key } };
}

/**
 * Reads a removal the previous page carried here, says it on this list's notice line once, and
 * clears it from the history entry so a reload or a return does not say it again.
 *
 * `discarding` is the draft's own flag, where the list is a draft's: once a discard lands the
 * removal it speaks of may be undone — and under a key this list cannot recognise, since the
 * page that removed it may have renamed it first — so the notice is dropped.
 */
export function useArrivedRemoval(removal: Removal, discarding = false): void {
  const location = useLocation();
  const navigate = useNavigate();
  const carried = (location.state as Partial<RemovedState> | null)?.removed;
  const { announce, clear } = removal;
  const wasDiscarding = useRef(discarding);

  useEffect(() => {
    if (wasDiscarding.current && !discarding) {
      clear();
    }
    wasDiscarding.current = discarding;
  }, [discarding, clear]);

  useEffect(() => {
    if (!carried) {
      return;
    }
    announce(carried.text, carried.key);
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
  }, [carried, announce, navigate, location.pathname, location.search, location.hash]);
}
