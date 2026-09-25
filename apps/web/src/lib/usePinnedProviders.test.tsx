import { act, renderHook, waitFor } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Pin, usePinnedProviders } from "./usePinnedProviders";

/** Every version read the hook made, as `configuration@version`, in the order it made them. */
const reads: string[] = [];
/** How the version route answers: at once, refused, or slowly enough to be overtaken. */
let answer: "at-once" | "refused" | "slowly" = "at-once";

const server = setupServer(
  http.get(
    "*/api/v1/agent-configurations/:configurationId/versions/:version",
    async ({ params }) => {
      reads.push(`${params.configurationId}@${params.version}`);
      if (answer === "refused") {
        return HttpResponse.json(
          { code: "internal_error", message: "unavailable", request_id: "r" },
          { status: 500 },
        );
      }
      if (answer === "slowly") {
        await delay(200);
      }
      // Only the field the hook reads: what the version names as its provider.
      return HttpResponse.json({ content: { model: { provider: "openai" } } });
    },
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  reads.length = 0;
  answer = "at-once";
});
afterAll(() => server.close());

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const A: Pin = { configurationId: "a", version: 1 };
const B: Pin = { configurationId: "b", version: 2 };

/**
 * The claims `usePinnedProviders` makes about what it reads, pinned by counting the reads: a
 * surface that already knows the lab reaches everything asks nothing, and a version pinned by
 * many arms or rows is asked once.
 */
describe("usePinnedProviders", () => {
  it("reads nothing while it is not wanted, and each version once when it becomes wanted", async () => {
    const { result, rerender } = renderHook(({ wanted }) => usePinnedProviders([A, B], wanted), {
      initialProps: { wanted: false },
    });
    await wait(50);
    expect(reads).toEqual([]);

    // The lab's reach arriving: `null`, then a set naming a provider.
    rerender({ wanted: true });
    await waitFor(() => expect(result.current.size).toBe(2));
    await wait(50);
    expect([...reads].sort()).toEqual(["a@1", "b@2"]);
    expect(result.current.get("a@1")).toBe("openai");
  });

  it("reads a version once however many arms and rows pin it", async () => {
    const { result } = renderHook(() => usePinnedProviders([A, A, A, B, B], true));

    await waitFor(() => expect(result.current.size).toBe(2));
    await wait(50);
    expect([...reads].sort()).toEqual(["a@1", "b@2"]);
  });

  it("reads a version that keeps failing once, however often the pins are handed over again", async () => {
    answer = "refused";
    const { result, rerender } = renderHook(({ pins }) => usePinnedProviders(pins, true), {
      initialProps: { pins: [A] },
    });
    await wait(50);
    for (let again = 0; again < 5; again += 1) {
      rerender({ pins: [A] });
      await wait(20);
    }
    rerender({ pins: [A, B] });
    await wait(50);
    rerender({ pins: [A] });
    await wait(50);

    expect(reads).toEqual(["a@1", "b@2"]);
    // Refused says nothing, rather than something.
    expect(result.current.size).toBe(0);
  });

  it("asks a read overtaken by a change of pins once more, and answers it", async () => {
    answer = "slowly";
    const { result, rerender } = renderHook(({ pins }) => usePinnedProviders(pins, true), {
      initialProps: { pins: [A] },
    });
    await wait(20);

    rerender({ pins: [A, B] });

    await waitFor(() => expect(result.current.size).toBe(2), { timeout: 2000 });
    expect(reads.filter((key) => key === "a@1")).toHaveLength(2);
    expect(reads.filter((key) => key === "b@2")).toHaveLength(1);
  });

  it("sets nothing and asks nothing more once the surface is gone mid-read", async () => {
    answer = "slowly";
    const { result, unmount } = renderHook(() => usePinnedProviders([A], true));
    await wait(20);

    unmount();
    await wait(300);

    expect(reads).toEqual(["a@1"]);
    expect(result.current.size).toBe(0);
  });
});
