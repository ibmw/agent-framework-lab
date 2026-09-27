import { useEffect, useRef } from "react";

/**
 * A select with exactly one candidate opens on it, and says so (ADR 0064).
 *
 * A candidate is an option the operator could pick: a placeholder ("Select a customer") is the
 * absence of a choice and a disabled option cannot be picked, so neither counts. A caller
 * passes the values of its selectable options only.
 */
export function soleCandidate(candidates: readonly string[]): string | null {
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * The hint's sentence, in the prototype's words ("This one is the only published scenario in
 * the shop, so it is already chosen.", `Workspace.dc.html`, the setup's Scenario row). `what`
 * finishes "the only …": "published scenario in the shop".
 */
export function onlyChoiceNote(what: string): string {
  return `This one is the only ${what}, so it is already chosen.`;
}

/**
 * Chooses the sole candidate when there is one and nothing is chosen, and says whether the
 * value on screen is that sole candidate — the moment the hint's sentence is true.
 *
 * It writes only into an empty value, and only when the sole candidate *changes* — a listing
 * arriving, or a set shrinking to one after an add — so a choice the operator made is never
 * overwritten by a later load, and a placeholder they picked on purpose is not refilled under
 * them while the set stays what it was.
 */
export function useSingleChoice(
  candidates: readonly string[],
  value: string,
  choose: (candidate: string) => void,
): boolean {
  const only = soleCandidate(candidates);
  const current = useRef({ value, choose });
  current.current = { value, choose };
  useEffect(() => {
    if (only !== null && current.current.value === "") {
      current.current.choose(only);
    }
  }, [only]);
  return only !== null && value === only;
}
