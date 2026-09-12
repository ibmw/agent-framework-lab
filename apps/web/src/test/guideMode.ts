import { HttpResponse, http } from "msw";

/**
 * The one reading guide mode is derived from, answered as a lab with no completed comparison.
 *
 * Guide mode decides whether a surface offers its tour, and it reads exactly one thing: whether
 * the history listing holds a completed experiment. Any suite that renders a surface with a tour
 * serves this, and it is here rather than copied into each of them because what guide mode reads
 * is a property of guide mode (ADR 0045).
 */
export function guideModeHandlers() {
  return [
    http.get("*/api/v1/experiments", ({ request }) =>
      HttpResponse.json({
        experiments: [],
        page: 1,
        page_size: Number(new URL(request.url).searchParams.get("page_size") ?? 1),
        total: 0,
        shops: [],
        scenarios: [],
        frameworks: [],
        tags: [],
      }),
    ),
  ];
}
