import { act, renderHook, waitFor } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Pin, publishedNameOf, usePinnedVersions } from "./usePinnedVersions";

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
      // Only the fields the hook reads: the provider the version names, and the name it was
      // published under, which differs from version to version.
      return HttpResponse.json({
        content: { name: `published as ${params.version}`, model: { provider: "openai" } },
      });
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
 * The claims `usePinnedVersions` makes about what it reads, pinned by counting the reads: a
 * surface handed no pins asks nothing, and a version pinned by many arms or rows is asked once.
 */
describe("usePinnedVersions", () => {
  it("reads nothing while it is handed no pins, and each version once when it is handed some", async () => {
    const { result, rerender } = renderHook(({ pins }) => usePinnedVersions(pins), {
      initialProps: { pins: [] as Pin[] },
    });
    await wait(50);
    expect(reads).toEqual([]);

    // A caller with something to ask — the lab's reach arriving, or an arm moved.
    rerender({ pins: [A, B] });
    await waitFor(() => expect(result.current.size).toBe(2));
    await wait(50);
    expect([...reads].sort()).toEqual(["a@1", "b@2"]);
    expect(result.current.get("a@1")).toEqual({ provider: "openai", name: "published as 1" });
  });

  it("reads a version once however many arms and rows pin it", async () => {
    const { result } = renderHook(() => usePinnedVersions([A, A, A, B, B]));

    await waitFor(() => expect(result.current.size).toBe(2));
    await wait(50);
    expect([...reads].sort()).toEqual(["a@1", "b@2"]);
  });

  it("reads a version that keeps failing once, however often the pins are handed over again", async () => {
    answer = "refused";
    const { result, rerender } = renderHook(({ pins }) => usePinnedVersions(pins), {
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
    // Refused is settled as unknown: no provider and no name, but no longer awaited.
    expect(result.current.get("a@1")).toBeNull();
    expect(result.current.has("a@1")).toBe(true);
  });

  it("asks a read overtaken by a change of pins once more, and answers it", async () => {
    answer = "slowly";
    const { result, rerender } = renderHook(({ pins }) => usePinnedVersions(pins), {
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
    const { result, unmount } = renderHook(() => usePinnedVersions([A]));
    await wait(20);

    unmount();
    await wait(300);

    expect(reads).toEqual(["a@1"]);
    expect(result.current.size).toBe(0);
  });
});

describe("publishedNameOf", () => {
  const RECORDED = { pin: A, name: "as the run recorded it" };

  it("names an arm left on the version its run pinned by the record, reading nothing", () => {
    expect(publishedNameOf(new Map(), RECORDED, A)).toBe("as the run recorded it");
  });

  it("names a moved arm by its own version's read: waited for, then its name, or unknown", () => {
    expect(publishedNameOf(new Map(), RECORDED, B)).toBeUndefined();
    // An answer for a version the arm has left says nothing about the one it is on.
    expect(
      publishedNameOf(new Map([["a@1", { provider: "openai", name: "v1" }]]), RECORDED, B),
    ).toBeUndefined();
    expect(
      publishedNameOf(new Map([["b@2", { provider: "openai", name: "v2" }]]), RECORDED, B),
    ).toBe("v2");
    expect(publishedNameOf(new Map([["b@2", null]]), RECORDED, B)).toBeNull();
  });
});
