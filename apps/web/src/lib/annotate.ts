import type { ExperimentAnnotationsResponse } from "@agent-lab/contracts";

/**
 * One write of what an operator has written on a run — a note added, the tag set replaced — sent
 * by the results' layout, which holds the annotation and lets one write go at a time (ADR 0036).
 *
 * Its answer is the whole annotation, which replaces what is on screen. It resolves true when it
 * did, and false when the operator had moved to another run by the time it answered: the write
 * is kept, but the answer is about a run no longer on screen, so neither it nor the box it came
 * from is touched. It rejects with the write's failure, for the caller to say where it was made.
 */
export type Annotate = (change: () => Promise<ExperimentAnnotationsResponse>) => Promise<boolean>;
