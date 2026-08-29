import type {
  ExperimentListResponse,
  ExperimentPreviewResponse,
  ExperimentResponse,
  ParticipantTurnListResponse,
  ParticipantTurnRequest,
  RunTurnResponse,
  StartExperimentRequest,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

function experimentsPath(shopId: string, suffix = ""): string {
  return apiPath(`/shops/${encodeURIComponent(shopId)}/experiments${suffix}`);
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
