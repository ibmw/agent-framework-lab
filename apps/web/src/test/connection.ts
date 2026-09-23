import type {
  LabStatusResponse,
  ModelConnectionSource,
  ProviderConnectionListResponse,
} from "@agent-lab/contracts";
import { HttpResponse, http } from "msw";

/**
 * The two reads a surface makes to learn which providers this lab can reach (ADR 0053), served
 * from one answer of the resolution chain so the pair can never disagree with itself.
 *
 * `saved` and `saved_unreadable` both hold a saved connection with a key — the list cannot tell
 * them apart, which is exactly why the source is read beside it — while `environment` and
 * `none` hold nothing saved. The run mode follows the source as `read_lab_status` computes it.
 *
 * `source` is a function so a suite can move the lab between states while a page is open, the
 * way a connection saved from `/settings` moves it. `served` counts the answers given, so a
 * case asserting that *nothing* is said can first wait until the page has been told enough to
 * say something — a negative asserted before the reads land proves nothing.
 */
export function labConnection(
  source: () => ModelConnectionSource,
  served: { statuses: number; listings: number } = { statuses: 0, listings: 0 },
) {
  return [
    http.get("*/api/v1/model-connections", () => {
      served.listings += 1;
      return HttpResponse.json(connectionsFor(source()) satisfies ProviderConnectionListResponse);
    }),
    http.get("*/api/v1/lab-status", () => {
      served.statuses += 1;
      return HttpResponse.json({
        run_mode: source() === "saved" || source() === "environment" ? "credentialed" : "offline",
        connection_source: source(),
        model_id: "gpt-5-mini",
        trace_export_configured: false,
      } satisfies LabStatusResponse);
    }),
  ];
}

function connectionsFor(source: ModelConnectionSource): ProviderConnectionListResponse {
  const saved = source === "saved" || source === "saved_unreadable";
  return {
    providers: [
      {
        provider_id: "openai",
        connection: saved
          ? {
              provider_id: "openai",
              base_url: "http://localhost:11434/v1",
              key_configured: true,
              key_added_at: "2026-09-19T14:07:00+00:00",
              created_at: "2026-09-19T14:07:00+00:00",
              updated_at: "2026-09-19T14:07:00+00:00",
            }
          : null,
      },
    ],
  };
}
