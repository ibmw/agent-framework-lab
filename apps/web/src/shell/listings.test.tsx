import { renderHook, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { shellListings } from "../test/shell";
import { useShopListings } from "./listings";

const server = setupServer(...shellListings());

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * `refresh` answers whether its read landed an answer. A caller about to rely on the listing —
 * Customers after a detach (ADR 0060) — reads that answer, so a read that was superseded or that
 * outlived its subject has to say `false` rather than claim a fresh listing it did not deliver.
 */
describe("a listing's refresh", () => {
  it("answers true for the read that landed and false for the one it superseded", async () => {
    const { result } = renderHook(() => useShopListings("shop-1"));
    await waitFor(() => expect(result.current.orders.loading).toBe(false));

    const [superseded, landed] = await Promise.all([
      result.current.orders.refresh(),
      result.current.orders.refresh(),
    ]);

    expect(superseded).toBe(false);
    expect(landed).toBe(true);
  });

  it("answers false for a refresh captured before the listing moved to another subject", async () => {
    const { result, rerender } = renderHook(({ shop }) => useShopListings(shop), {
      initialProps: { shop: "shop-1" },
    });
    await waitFor(() => expect(result.current.orders.loading).toBe(false));
    const captured = result.current.orders.refresh;

    rerender({ shop: "shop-2" });

    expect(await captured()).toBe(false);
  });
});
