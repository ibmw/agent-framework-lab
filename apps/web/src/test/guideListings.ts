import { HttpResponse, http } from "msw";

/**
 * The listings the guide strip reads, answered as an empty lab.
 *
 * The strip is mounted on the shops index and every shop home, so any test that renders one
 * of those serves these too. They are here rather than copied into each suite because what
 * the strip reads is a property of the strip: a listing it starts reading tomorrow is added
 * once.
 */
export function guideListingHandlers(shopId: string) {
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
    http.get("*/api/v1/customer-profiles", () => HttpResponse.json({ profiles: [] })),
    http.get(`*/api/v1/shops/${shopId}/orders`, () => HttpResponse.json({ orders: [] })),
    http.get(`*/api/v1/shops/${shopId}/tickets`, () => HttpResponse.json({ tickets: [] })),
    http.get(`*/api/v1/shops/${shopId}/scenarios`, () => HttpResponse.json({ scenarios: [] })),
    http.get("*/api/v1/objective-blocks", () => HttpResponse.json({ blocks: [] })),
    http.get("*/api/v1/support-identities", () => HttpResponse.json({ identities: [] })),
    http.get("*/api/v1/agent-configurations", () => HttpResponse.json({ configurations: [] })),
    http.get("*/api/v1/judge-configurations", () => HttpResponse.json({ judges: [] })),
  ];
}
