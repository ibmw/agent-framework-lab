import type {
  AddExperimentNoteRequest,
  ExperimentAnnotationsResponse,
  ExperimentEvaluationResponse,
  ExperimentHistoryEntrySchema,
  ExperimentHistoryResponse,
  ExperimentListResponse,
  ExperimentPreviewResponse,
  ExperimentResponse,
  ExperimentTimelineResponse,
  ExperimentTracesResponse,
  ForkExperimentRequest,
  ObjectiveResultSchema,
  ParticipantTurnListResponse,
  ParticipantTurnRequest,
  RunTurnResponse,
  ScoreExperimentRequest,
  SetExperimentTagsRequest,
  StartExperimentRequest,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function experimentsPath(shopId: string, suffix = ""): string {
  return apiPath(`/shops/${encodeURIComponent(shopId)}/experiments${suffix}`);
}

/**
 * How history is narrowed, as the query string the contract takes.
 *
 * The two closed vocabularies are the contract's own rather than plain strings: a status or
 * an outcome the backend does not publish is a 422, and a caller should be told that where
 * it is written rather than where it is answered.
 */
export interface ExperimentHistoryQuery {
  shop_id?: string;
  scenario_id?: string;
  framework_id?: string;
  tag?: string;
  status?: ExperimentHistoryEntrySchema["status"] | "";
  outcome?: ObjectiveResultSchema["outcome"] | "";
  started_after?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

/**
 * Read every experiment this lab has run, narrowed and paged.
 *
 * Deliberately not under a shop: `listExperiments` is the bench's listing of what has been
 * started *here*, and this is the lab's. The response carries the filter options beside the
 * rows, so one read fills the screen rather than rendering filters against a lab it has not
 * listed.
 */
export async function listExperimentHistory(
  query: ExperimentHistoryQuery,
  signal?: AbortSignal,
): Promise<ExperimentHistoryResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return read<ExperimentHistoryResponse>(
    await fetch(apiPath(`/experiments${search === "" ? "" : `?${search}`}`), { signal }),
  );
}

export async function listExperiments(
  shopId: string,
  signal?: AbortSignal,
): Promise<ExperimentListResponse> {
  return read<ExperimentListResponse>(await fetch(experimentsPath(shopId), { signal }));
}

export async function getExperiment(
  shopId: string,
  experimentId: string,
  signal?: AbortSignal,
): Promise<ExperimentResponse> {
  return read<ExperimentResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}`), { signal }),
  );
}

/**
 * Read one experiment's execution as one normalized, framework-neutral stream.
 *
 * Separate from `getExperiment` because it answers a different question: the experiment is
 * the threads and what they were run against, and this is what happened and where the
 * project's own code ran. It deliberately carries no message body — the thread already has
 * those — so a client renders words from one and order from the other.
 */
export async function getExperimentTimeline(
  shopId: string,
  experimentId: string,
  signal?: AbortSignal,
): Promise<ExperimentTimelineResponse> {
  return read<ExperimentTimelineResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/timeline`), {
      signal,
    }),
  );
}

/**
 * Read the recorded span tree of every attempt both arms made.
 *
 * Separate from the timeline beside it because it is a different *kind* of thing rather
 * than a different question: the timeline is projected from the record on every read, and
 * this is stored, because an attempt and its calls are timestamped from one reading of the
 * clock and where inside the attempt each call ran cannot be recovered afterwards. A stored
 * span carries no attribute of its own; the tool it timed and what that tool answered are
 * joined onto it from the same events `getExperiment` serves.
 */
export async function getExperimentTraces(
  shopId: string,
  experimentId: string,
  signal?: AbortSignal,
): Promise<ExperimentTracesResponse> {
  return read<ExperimentTracesResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/traces`), {
      signal,
    }),
  );
}

/**
 * Judge each arm against the objectives its scenario composed.
 *
 * Separate from `getExperiment` for the same reason the timeline is: the experiment is what
 * each arm was asked and what it answered, and this is how each arm is doing against what the
 * recipe asked for. Read after every advance, because an objective is met by a call the arm
 * has just made.
 */
export async function getExperimentEvaluation(
  shopId: string,
  experimentId: string,
  signal?: AbortSignal,
): Promise<ExperimentEvaluationResponse> {
  return read<ExperimentEvaluationResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/evaluation`), {
      signal,
    }),
  );
}

/**
 * Score every objective this scenario left to a judge, in every arm.
 *
 * Answers with the whole evaluation rather than with the verdicts it produced: a scoring
 * pass fills some of an arm's rows and none of the others, and a client that had to merge
 * them into a matrix it read separately would be holding two readings of one experiment.
 */
export async function scoreExperiment(
  shopId: string,
  experimentId: string,
  command: ScoreExperimentRequest,
): Promise<ExperimentEvaluationResponse> {
  return read<ExperimentEvaluationResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/judgements`), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

/**
 * Read what an operator has written on this run: their notes, and the tags they filed it on.
 *
 * Separate from `getExperiment` because it is not a reading of the run at all. The standing,
 * the metrics, and the state diff travel with the experiment because they are projections of
 * what it did; this is a stored document with its own lifecycle — the run is finished, and
 * this is not.
 */
export async function getExperimentAnnotations(
  shopId: string,
  experimentId: string,
  signal?: AbortSignal,
): Promise<ExperimentAnnotationsResponse> {
  return read<ExperimentAnnotationsResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/annotations`), {
      signal,
    }),
  );
}

/**
 * Write one note about this run.
 *
 * Answers with everything written on it rather than with the note it appended, so the screen
 * never holds a list it merged itself. Deliberately not idempotent: two reviewers who wrote
 * the same sentence wrote two notes.
 */
export async function addExperimentNote(
  shopId: string,
  experimentId: string,
  command: AddExperimentNoteRequest,
): Promise<ExperimentAnnotationsResponse> {
  return read<ExperimentAnnotationsResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/notes`), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

/**
 * Replace the tags this run is filed under.
 *
 * The whole set, because that is what the operator is looking at: an add-and-remove pair
 * would let two requests that crossed leave a set neither of them asked for. Each value is
 * folded to lowercase kebab-case by the backend, so the answer is what was actually stored.
 */
export async function setExperimentTags(
  shopId: string,
  experimentId: string,
  command: SetExperimentTagsRequest,
): Promise<ExperimentAnnotationsResponse> {
  return read<ExperimentAnnotationsResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/tags`), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

/**
 * Judge a setup without starting it.
 *
 * Takes the same body a start does, deliberately: the matrix and the gate are answers about
 * exactly the experiment that would be started, and a preview shaped differently could
 * describe one the operator is not about to run.
 */
export async function previewExperiment(
  shopId: string,
  command: StartExperimentRequest,
  signal?: AbortSignal,
): Promise<ExperimentPreviewResponse> {
  return read<ExperimentPreviewResponse>(
    await fetch(experimentsPath(shopId, "/preview"), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
      signal,
    }),
  );
}

export async function startExperiment(
  shopId: string,
  command: StartExperimentRequest,
): Promise<ExperimentResponse> {
  return read<ExperimentResponse>(
    await fetch(experimentsPath(shopId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

export async function deliverParticipantTurn(
  shopId: string,
  experimentId: string,
  command: ParticipantTurnRequest,
): Promise<ParticipantTurnListResponse> {
  return read<ParticipantTurnListResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/participant-turns`), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

/**
 * Run one arm's agent against the customer turn it has not answered.
 *
 * One arm at a time and never a side effect of sending a message: the arms progress
 * independently, and a model call is slow and costly enough that the operator decides when
 * it happens. Idempotent over an answer — advancing an already-answered arm returns that
 * answer and calls no model — and not over an attempt, so a failed turn can be retried.
 */
export async function advanceExperimentRun(
  shopId: string,
  experimentId: string,
  runId: string,
): Promise<RunTurnResponse> {
  return read<RunTurnResponse>(
    await fetch(
      experimentsPath(
        shopId,
        `/${encodeURIComponent(experimentId)}/runs/${encodeURIComponent(runId)}/agent-turns`,
      ),
      { method: "POST", headers: JSON_HEADERS },
    ),
  );
}

/**
 * Derive a new experiment that re-runs this one as it was recorded.
 *
 * A replay cannot change the experiment it replays — an experiment is immutable and
 * everything about it is in the record — so it answers with a *different* run: the same
 * snapshot cloned again, the same configuration versions, and the customer's compositions
 * replayed into it. Deliberately not idempotent, and slow enough to be worth a pending
 * state: the derived arms are actually run before the answer comes back.
 */
export async function replayExperiment(
  shopId: string,
  experimentId: string,
): Promise<ExperimentResponse> {
  return read<ExperimentResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/replays`), {
      method: "POST",
      headers: JSON_HEADERS,
    }),
  );
}

/**
 * Derive a new experiment that runs this one's incident with the arms an operator chose.
 *
 * The same snapshot cloned again, the same recipe version at the same seed, and the same
 * recorded compositions — so the arms are the one thing that moved and a difference in the
 * answers is about them. At least one arm has to differ from what its source ran: a
 * derivation that changes nothing is a replay. Deliberately not idempotent, and slow enough
 * to be worth a pending state, because the derived arms are actually run before it answers.
 */
export async function forkExperiment(
  shopId: string,
  experimentId: string,
  command: ForkExperimentRequest,
): Promise<ExperimentResponse> {
  return read<ExperimentResponse>(
    await fetch(experimentsPath(shopId, `/${encodeURIComponent(experimentId)}/forks`), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}
