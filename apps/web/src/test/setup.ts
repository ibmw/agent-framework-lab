import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

if (!window.localStorage) {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
  Object.defineProperty(window, "localStorage", { value: storage });
}

class NoopResizeObserver implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

globalThis.ResizeObserver = NoopResizeObserver;

afterEach(cleanup);

/**
 * An opt-in stress: `VERSION_LATENCY_MS=60 pnpm test` answers every pinned-version read — a
 * scenario's, a ticket's, a customer profile's, an agent configuration's — that many
 * milliseconds late, after its handler has run, as a slow lab would. A test that asserts on
 * what such a read decides without waiting for it fails under it, rather than passing only
 * because MSW answers at once. A read aborted meanwhile rejects as it would on the wire.
 */
const VERSION_LATENCY_MS = Number(process.env.VERSION_LATENCY_MS ?? 0);
const PINNED_VERSION_READ =
  /\/api\/v1\/(?:shops\/[^/]+\/(?:scenarios|tickets)|customer-profiles|agent-configurations)\/[^/]+\/versions\/\d+(?:\?.*)?$/;

if (VERSION_LATENCY_MS > 0) {
  let unwrapped: typeof fetch | undefined;
  // Each test, after its suite's `server.listen()` has put MSW's own `fetch` in place.
  beforeEach(() => {
    const answer = globalThis.fetch;
    unwrapped = answer;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined;
      const url = request ? request.url : String(input);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const response = await answer(input, init);
      if (method === "GET" && PINNED_VERSION_READ.test(url)) {
        const signal = init?.signal ?? request?.signal;
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          const timer = setTimeout(resolve, VERSION_LATENCY_MS);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }
      return response;
    };
  });
  afterEach(() => {
    if (unwrapped) {
      globalThis.fetch = unwrapped;
    }
  });
}
