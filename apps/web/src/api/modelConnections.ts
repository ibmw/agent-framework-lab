import type {
  ModelConnectionTestRequest,
  ModelConnectionTestResponse,
  ProviderConnectionListResponse,
  ProviderConnectionSchema,
  SaveModelConnectionRequest,
} from "@agent-lab/contracts";
import { apiPath, JSON_HEADERS, read } from "./client";

/**
 * Where this lab is pointed, and the key it reaches under (ADR 0052).
 *
 * The one direction a key travels is *into* this resource. There is no read route for it, no
 * mask and no reveal control, so nothing in this module ever receives a credential: a saved
 * connection comes back as its endpoint, `key_configured` and `key_added_at`, and those three
 * are the whole of what the lab says about it.
 *
 * Leaving `api_key` out of a save keeps the stored one, which is what makes changing a base
 * URL something an operator can do without retyping a secret they cannot read back.
 */

function providerPath(providerId: string, suffix = ""): string {
  return apiPath(`/model-connections/${encodeURIComponent(providerId)}${suffix}`);
}

/**
 * Every provider this lab can be pointed at, with the connection it holds or `null`.
 *
 * The whole table rather than the saved rows: what the settings page is asking is where this
 * lab *can* be pointed, and a listing of rows would answer that with silence on a lab nobody
 * has configured yet.
 */
export async function listModelConnections(
  signal?: AbortSignal,
): Promise<ProviderConnectionListResponse> {
  return read<ProviderConnectionListResponse>(
    await fetch(apiPath("/model-connections"), { signal }),
  );
}

/** Point the lab at one endpoint, replacing this provider's connection whole. */
export async function saveModelConnection(
  providerId: string,
  command: SaveModelConnectionRequest,
): Promise<ProviderConnectionSchema> {
  return read<ProviderConnectionSchema>(
    await fetch(providerPath(providerId), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
    }),
  );
}

/**
 * Ask one endpoint whether it is reachable, right now.
 *
 * The answer is about a moment and is stored nowhere, so the caller holds it only for as long
 * as the connection it was asked about is the one in front of the operator.
 */
export async function testModelConnection(
  providerId: string,
  command: ModelConnectionTestRequest,
  signal?: AbortSignal,
): Promise<ModelConnectionTestResponse> {
  return read<ModelConnectionTestResponse>(
    await fetch(providerPath(providerId, "/test"), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(command),
      signal,
    }),
  );
}
