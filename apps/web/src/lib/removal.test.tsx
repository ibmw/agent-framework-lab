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
