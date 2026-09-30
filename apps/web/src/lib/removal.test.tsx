import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect, useReducer, useRef, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RemovalNotice } from "../components/ConfirmRemove";
import { productEntryState, productKeyIn } from "./productKeys";
import {
  findingClauses,
  REMOVAL_FINDINGS,
  removedState,
  useArrivedRemoval,
  useRemoval,
} from "./removal";

/** One list with one row keyed `a`, belonging to `scope`. */
function List({ scope }: { scope: string }) {
  const removal = useRemoval(scope);
  return removal.isArmed("a") ? (
    <p>Asking about a in {scope}</p>
  ) : (
    <button type="button" onClick={removal.ask("a", () => {}, "Removed a.")}>
      Remove a
    </button>
  );
}

describe("useRemoval", () => {
  it("drops what was armed when the list moves to another subject with a row of the same key", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<List scope="order-1" />);

    await user.click(screen.getByRole("button", { name: "Remove a" }));
    expect(screen.getByText("Asking about a in order-1")).toBeVisible();

    // The page is not remounted and the new subject has a row keyed `a` too.
    rerender(<List scope="order-2" />);
    expect(screen.queryByText(/Asking about a/)).toBeNull();

    // Nor does it come back when the first subject does.
    rerender(<List scope="order-1" />);
    expect(screen.queryByText(/Asking about a/)).toBeNull();
  });
});

/** One list of rows `a` and `b`, of which only the given ones are drawn. */
function Rows({ drawn }: { drawn: string[] }) {
  const removal = useRemoval("list");
  return (
    <ul>
      {drawn.map((key) =>
        removal.isArmed(key) ? (
          <li key={key}>Asking about {key}</li>
        ) : (
          <li key={key}>
            <button type="button" onClick={removal.ask(key, () => {}, `Removed ${key}.`)}>
              Remove {key}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

describe("useRemoval and the rows it is asked about", () => {
  it("drops a confirm whose row left the list, so the row does not return armed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Rows drawn={["a", "b"]} />);

    await user.click(screen.getByRole("button", { name: "Remove a" }));
    expect(screen.getByText("Asking about a")).toBeVisible();

    rerender(<Rows drawn={["b"]} />);
    rerender(<Rows drawn={["a", "b"]} />);
    expect(screen.queryByText("Asking about a")).toBeNull();
  });
});

/** A list still drawing row `a`, told from elsewhere that `a` was removed. */
function StillDrawn() {
  const removal = useRemoval("list");
  removal.present("a");
  return (
    <>
      <button type="button" onClick={() => removal.announce("Removed a.", "a")}>
        Say a was removed
      </button>
      <RemovalNotice removal={removal} />
    </>
  );
}

describe("a notice about an entry still on screen", () => {
  it("is dropped rather than said, and does not take focus to the empty line", async () => {
    const user = userEvent.setup();
    render(<StillDrawn />);
    const button = screen.getByRole("button", { name: "Say a was removed" });

    await user.click(button);

    expect(screen.queryByText("Removed a.")).toBeNull();
    // Focusing the line in the pass that emptied it would leave the reader on a hidden element.
    expect(button).toHaveFocus();
  });
});

/** One row `a` whose removal is a write answered by `answer`, asked twice. */
function WrittenRow({ answer }: { answer: () => Promise<boolean> }) {
  const removal = useRemoval("list");
  return (
    <>
      {/* Keyed apart, as the confirm and its row are in the workspace: without keys React
          would reuse one button for both, and focus would never leave it. */}
      {removal.isArmed("a") ? (
        <button key="confirm" type="button" onClick={removal.confirm(answer, "Removed a.")}>
          Confirm a
        </button>
      ) : (
        <button
          key="row"
          type="button"
          ref={removal.trigger("a")}
          onClick={removal.ask("a", answer, "Removed a.")}
        >
          Remove a
        </button>
      )}
      <RemovalNotice removal={removal} />
    </>
  );
}

describe("a removal whose write does not land", () => {
  it.each([
    // Answered after the second press's render has landed, as a write to the lab is: an
    // answer already settled would be read before that render and need no render of its own.
    [
      "answers false",
      () => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
    ],
    [
      "rejects",
      () =>
        new Promise<boolean>((_resolve, reject) =>
          setTimeout(() => reject(new Error("offline")), 20),
        ),
    ],
  ])(
    "walks back when it %s: nothing is said, and focus returns to the control that asked",
    async (_how, answer) => {
      const user = userEvent.setup();
      render(<WrittenRow answer={answer} />);

      await user.click(screen.getByRole("button", { name: "Remove a" }));
      // The confirm's own button unmounts on the second press, so focus leaves it; only the
      // walk-back — which needs a render of its own, after the write answered — brings it back.
      await user.click(screen.getByRole("button", { name: "Confirm a" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Remove a" })).toHaveFocus());
      expect(screen.queryByText("Removed a.")).toBeNull();
    },
  );
});

/** A deferred answer to a write, settled by the test. */
function deferred() {
  let settle: (landed: boolean) => void = () => {};
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return { promise, settle: (landed: boolean) => settle(landed) };
}

/** Rows of `drawn`, each removed by a write answered by `answers[key]`, confirm keyed apart. */
function Board({
  scope = "board",
  drawn,
  answers,
}: {
  scope?: string;
  drawn: string[];
  answers: Record<string, () => Promise<boolean>>;
}) {
  const removal = useRemoval(scope);
  return (
    <>
      {drawn.map((key) =>
        removal.isArmed(key) ? (
          <button
            key={`${key}-confirm`}
            type="button"
            onClick={removal.confirm(answers[key], `Removed ${key}.`)}
          >
            Confirm {key}
          </button>
        ) : (
          <button
            key={key}
            type="button"
            ref={removal.trigger(key)}
            onClick={removal.ask(key, answers[key], `Removed ${key}.`)}
          >
            Remove {key}
          </button>
        ),
      )}
      <RemovalNotice removal={removal} />
    </>
  );
}

describe("a walk-back owed when another row is armed", () => {
  it("is not delivered later, when the row armed after it leaves the list", async () => {
    const user = userEvent.setup();
    const a = deferred();
    const answers = {
      a: () => a.promise,
      b: () => Promise.resolve(true),
      c: () => Promise.resolve(true),
    };
    const { rerender } = render(<Board drawn={["a", "b", "c"]} answers={answers} />);

    // a is confirmed and in flight; b is armed when a fails, so a's walk-back is owed.
    await user.click(screen.getByRole("button", { name: "Remove a" }));
    await user.click(screen.getByRole("button", { name: "Confirm a" }));
    await user.click(screen.getByRole("button", { name: "Remove b" }));
    await act(async () => a.settle(false));
    // Then c is armed, and its row leaves the list, which disarms it.
    await user.click(screen.getByRole("button", { name: "Remove c" }));
    rerender(<Board drawn={["a", "b"]} answers={answers} />);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByRole("button", { name: "Remove a" })).not.toHaveFocus();
  });
});

describe("a write that answers after its list moved to another subject", () => {
  it.each([
    ["fails", false],
    ["lands", true],
  ])("says nothing and moves no focus when it %s", async (_how, landed) => {
    const user = userEvent.setup();
    const a = deferred();
    const answers = { a: () => a.promise };
    const { rerender } = render(<Board scope="one" drawn={["a"]} answers={answers} />);

    await user.click(screen.getByRole("button", { name: "Remove a" }));
    await user.click(screen.getByRole("button", { name: "Confirm a" }));
    // The list now shows another subject, which also has a row keyed `a`.
    rerender(<Board scope="two" drawn={["a"]} answers={answers} />);
    await act(async () => a.settle(landed));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.getByRole("button", { name: "Remove a" })).not.toHaveFocus();
    expect(screen.queryByText("Removed a.")).toBeNull();
  });
});

describe("findingClauses", () => {
  it("says each finding once, in order, and nothing for a removal that raises none", () => {
    expect(findingClauses([false, null, undefined])).toBe("");
    expect(findingClauses(["order_without_line", false, "order_without_event"])).toBe(
      `${REMOVAL_FINDINGS.order_without_line} ${REMOVAL_FINDINGS.order_without_event}`,
    );
  });
});

describe("the tone-of-voice clauses", () => {
  // The default guideline carries no Remove (`docs/design-direction.md`), so the second of
  // these is said only where a draft somehow offers one; both are the gate's errors.
  it("names both findings as refusals at publication", () => {
    expect(findingClauses(["shop_without_tone_of_voice"])).toBe(
      "It is the shop's last tone-of-voice guideline, and a shop with none is refused at publication.",
    );
    expect(findingClauses(["tone_of_voice_without_default"])).toBe(
      "It is the shop default, and the shop is refused at publication until another guideline is made the default.",
    );
  });
});

/** A page that says a removal carried to it, as the indexes do. */
function Arrived() {
  const removal = useRemoval("page");
  useArrivedRemoval(removal);
  return <RemovalNotice removal={removal} />;
}

describe("a notice carried to a page", () => {
  it("is taken off the entry without the product key the entry is stamped with (ADR 0061)", async () => {
    const router = createMemoryRouter([{ path: "/products/:handle", element: <Arrived /> }], {
      initialEntries: [
        {
          pathname: "/products/alpine-shell-jacket",
          state: { ...removedState("Removed a.", "a"), ...productEntryState("product-k-1") },
        },
      ],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Removed a.")).toBeVisible();
    await waitFor(() => expect(router.state.location.state).not.toHaveProperty("removed"));
    expect(productKeyIn(router.state.location.state)).toBe("product-k-1");
  });

  it("leaves an entry that carried nothing else with no state at all", async () => {
    const router = createMemoryRouter([{ path: "/orders", element: <Arrived /> }], {
      initialEntries: [{ pathname: "/orders", state: removedState("Removed a.", "a") }],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Removed a.")).toBeVisible();
    await waitFor(() => expect(router.state.location.state).toBeNull());
  });
});

/**
 * One row `a` whose removal is a write that lands inside an unrelated commit of this list — a
 * router navigation's, say — so the removal says its notice after that commit and before the
 * commit's passive effects have run: the effect that runs next still sees no notice.
 */
function InterruptedRow() {
  const removal = useRemoval("list");
  const [gone, setGone] = useState(false);
  const [tick, rerender] = useReducer((count: number) => count + 1, 0);
  const land = useRef<((landed: boolean) => void) | null>(null);
  useLayoutEffect(() => {
    if (tick > 0) {
      land.current?.(true);
      land.current = null;
    }
  }, [tick]);
  const write = () => {
    setGone(true);
    // A render outside any event: its commit's effects are passive, run after the microtask
    // that says the notice.
    setTimeout(rerender, 0);
    return new Promise<boolean>((resolve) => {
      land.current = resolve;
    });
  };
  return (
    <>
      {gone ? null : removal.isArmed("a") ? (
        <button key="confirm" type="button" onClick={removal.confirm(write, "Removed a.")}>
          Confirm a
        </button>
      ) : (
        <button
          key="row"
          type="button"
          ref={removal.trigger("a")}
          onClick={removal.ask("a", write, "Removed a.")}
        >
          Remove a
        </button>
      )}
      <RemovalNotice removal={removal} />
    </>
  );
}

describe("a notice whose line is drawn after an unrelated commit", () => {
  it("still takes focus once it is drawn", async () => {
    const user = userEvent.setup();
    render(<InterruptedRow />);

    await user.click(screen.getByRole("button", { name: "Remove a" }));
    await user.click(screen.getByRole("button", { name: "Confirm a" }));

    expect(await screen.findByText("Removed a.")).toBeVisible();
    await waitFor(() => expect(screen.getByText("Removed a.")).toHaveFocus());
  });
});

describe("the clauses a product's Delete says (ADR 0062)", () => {
  // Every finding the domain raises when a product leaves the shop draft, by the severity it
  // gives each: all four are errors.
  it("names each as a refusal, or as an order unable to seed a sandbox", () => {
    expect(findingClauses(["shop_without_product"])).toBe(
      "It is the shop's last product, and a shop that sells nothing is refused at publication.",
    );
    expect(findingClauses(["origin_product_missing_from_catalog"])).toMatch(
      /^A ticket opened from it is refused at publication once the draft is saved/,
    );
    expect(findingClauses(["binding_product_missing_from_catalog"])).toMatch(
      /^A scenario with a block bound to it is refused at publication once the draft is saved/,
    );
    expect(REMOVAL_FINDINGS.line_sku_missing_from_catalog).toMatch(
      /reported as unable to seed a sandbox/,
    );
  });
});

/**
 * A list whose rows are keyed by an identity a discard gives back, told a row was removed, with
 * a discard in flight or landed (`discarding`) and the rows it draws after it.
 */
function KeyedByIdentity({ drawn, discarding }: { drawn: string[]; discarding: boolean }) {
  const removal = useRemoval("catalog", discarding, true);
  return (
    <>
      <ul>
        {drawn.map((key) =>
          removal.isArmed(key) ? (
            <li key={key}>Asking about {key}</li>
          ) : (
            <li key={key}>
              <button type="button" onClick={removal.ask(key, () => {}, `Removed ${key}.`)}>
                Remove {key}
              </button>
            </li>
          ),
        )}
      </ul>
      <button type="button" onClick={() => removal.announce("Removed gone.", "gone")}>
        Say gone was removed
      </button>
      <RemovalNotice removal={removal} />
    </>
  );
}

describe("a notice keyed by an identity a discard gives back", () => {
  it("outlives a discard that restores nothing, and clears once its entry is back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<KeyedByIdentity drawn={["a"]} discarding={false} />);

    await user.click(screen.getByRole("button", { name: "Say gone was removed" }));
    expect(screen.getByText("Removed gone.")).toBeVisible();

    // A discard lands and the entry is still not in the list: the notice is still true.
    rerender(<KeyedByIdentity drawn={["a"]} discarding={true} />);
    rerender(<KeyedByIdentity drawn={["a"]} discarding={false} />);
    expect(screen.getByText("Removed gone.")).toBeVisible();

    // The entry is back under its key: the notice would now be untrue.
    rerender(<KeyedByIdentity drawn={["a", "gone"]} discarding={false} />);
    await waitFor(() => expect(screen.queryByText("Removed gone.")).toBeNull());
  });

  it("still drops an armed row when a discard lands", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<KeyedByIdentity drawn={["a"]} discarding={false} />);

    await user.click(screen.getByRole("button", { name: "Remove a" }));
    expect(screen.getByText("Asking about a")).toBeVisible();
    rerender(<KeyedByIdentity drawn={["a"]} discarding={true} />);
    rerender(<KeyedByIdentity drawn={["a"]} discarding={false} />);

    await waitFor(() => expect(screen.queryByText("Asking about a")).toBeNull());
  });
});

describe("the removal clauses", () => {
  // Every module that says a removal's clauses — the ones importing this table — as text. A
  // module that names a gate code for another reason (the setup checklist owns
  // `shop_without_payment_method`) is not a removal, and must not count as citing one.
  const sources = Object.entries(
    import.meta.glob("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>,
  ).filter(
    ([path, source]) =>
      !path.includes(".test.") &&
      path !== "./removal.ts" &&
      /from "(?:\.\.\/lib|\.)\/removal"/.test(source),
  );

  /** Whether some removal can say the clause: its code written as a literal, or read by name. */
  function cited(code: string): boolean {
    const literal = new RegExp(`["'\`]${code}["'\`]`);
    const read = new RegExp(`REMOVAL_FINDINGS\\.${code}\\b`);
    return sources.some(([, source]) => literal.test(source) || read.test(source));
  }

  it("found the removals to look in", () => {
    // Asserted first: a glob that matched nothing would leave every clause uncited.
    expect(sources.some(([path]) => path.endsWith("ShopMethodCards.tsx"))).toBe(true);
    expect(cited("payment_method_missing_from_shop")).toBe(true);
    expect(cited("not_a_finding_code")).toBe(false);
    expect(sources.some(([path]) => path.endsWith("setupChecklist.ts"))).toBe(false);
  });

  it("holds only clauses some removal says", () => {
    // A clause no removal reaches is a sentence about a consequence the workspace no longer
    // offers: the last enabled payment method cannot be removed (ADR 0072), so the gate's
    // `shop_without_payment_method` is the checklist's to say, never a confirm's.
    expect(Object.keys(REMOVAL_FINDINGS).filter((code) => !cited(code))).toEqual([]);
  });
});
