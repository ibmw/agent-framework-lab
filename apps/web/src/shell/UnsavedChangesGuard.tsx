import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Outlet, useBlocker } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { accentButtonClasses, outlineButtonClasses, surfaceClasses } from "../lib/ui";
import {
  type RegisteredWork,
  UnsavedWorkContext,
  type UnsavedWorkRegister,
} from "../lib/unsavedWork";

/**
 * The root of the route tree: it holds the workspace's register of unsaved work, and it is the
 * one place that asks before that work is thrown away.
 *
 * **One blocker, above every route.** `@remix-run/router` consults exactly one blocker —
 * `shouldBlockNavigation` warns and takes the last registered when there are two — and the shop
 * draft's editor is mounted at the same time as whichever page-scoped editor the operator is
 * standing in. So `useBlocker` is called here, once, over the register that every editor
 * declares into, rather than once per editor (ADR 0051).
 */
export function UnsavedChangesGuard() {
  const items = useRef<RegisteredWork[]>([]);
  const [, bump] = useReducer((count: number) => count + 1, 0);

  const register = useMemo<UnsavedWorkRegister>(
    () => ({
      items,
      register: (work) => {
        items.current = [...items.current, work];
        bump();
        return () => {
          items.current = items.current.filter((entry) => entry !== work);
          bump();
        };
      },
    }),
    [],
  );

  // Work the destination can still save is not stranded by going there. Only the shop draft
  // answers `reaches` at all; everything else dies with the page it is on, and the blocker is
  // only ever asked about a pathname that differs from the current one.
  const strandedBy = useCallback(
    (pathname: string) => items.current.filter((work) => work.read().reaches?.(pathname) !== true),
    [],
  );

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        currentLocation.pathname !== nextLocation.pathname &&
        strandedBy(nextLocation.pathname).length > 0,
      [strandedBy],
    ),
  );

  /**
   * The blocker as it stands *now*, rather than as it stood when the prompt was drawn.
   *
   * *Save and leave* awaits the saves before it proceeds, and a navigation can complete in
   * that interval — the work being saved may reach its destination, in which case the router
   * lets it through and resets every blocker to idle. The prompt's `proceed` then belongs to
   * a blocker that is no longer blocked, and `@remix-run/router` permits `blocked ->
   * proceeding` and not `unblocked -> proceeding`: calling it throws that transition by name
   * out of a promise nobody is holding. So the answer is taken from here and only while this
   * navigation is still the one being asked about (ADR 0051).
   */
  const live = useRef(blocker);
  useLayoutEffect(() => {
    live.current = blocker;
  });

  // A reload or a tab close is the one navigation the lab cannot draw a prompt over, and the
  // browser's own is the only ask available. It is armed for anything in the register — an open
  // row dies in a reload exactly as a dirty draft does — and for nothing else: a half-typed
  // create form is not an edit to something that exists, and arming on every keystroke anywhere
  // would make the prompt mean nothing.
  const anythingUnsaved = items.current.length > 0;
  useEffect(() => {
    if (!anythingUnsaved) {
      return;
    }
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [anythingUnsaved]);

  return (
    <UnsavedWorkContext.Provider value={register}>
      <Outlet />
      {blocker.state === "blocked" ? (
        <UnsavedChangesPrompt
          // A second block is a second question: a prompt that kept the first one's state would
          // carry a stale failure into it. Keyed on the destination and nothing else, so a
          // register that changes under an open prompt does not throw away what it is showing.
          key={blocker.location.key}
          stranded={strandedBy(blocker.location.pathname)}
          onLeave={() => {
            if (live.current.state === "blocked") {
              live.current.proceed?.();
            }
          }}
          onStay={() => blocker.reset?.()}
        />
      ) : null}
    </UnsavedWorkContext.Provider>
  );
}

/**
 * Save, Discard, Stay — over the work *this* navigation would strand, and nothing else.
 *
 * Work the destination can still save is not at risk and is not touched: discarding a draft an
 * operator never asked to leave would be the data loss this prompt exists to prevent.
 */
function UnsavedChangesPrompt({
  stranded,
  onLeave,
  onStay,
}: {
  stranded: RegisteredWork[];
  onLeave: () => void;
  onStay: () => void;
}) {
  const [phase, setPhase] = useState<"asking" | "saving" | "failed">("asking");
  const [refusals, setRefusals] = useState<string[]>([]);
  const dialog = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const reasonId = useId();

  const works = stranded.map((work) => work.read());
  // An open row carries no `save`: its typing is outside the draft by design, so no page-level
  // Save has ever written it and this one does not pretend to.
  const savableHere = works.length > 0 && works.every((work) => work.save !== undefined);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onStay();
      return;
    }
    if (event.key !== "Tab" || dialog.current === null) {
      return;
    }
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function saveAndLeave() {
    setPhase("saving");
    const answers = await Promise.all(works.map((work) => work.save?.() ?? Promise.resolve(null)));
    const refused = answers.filter((answer): answer is string => answer !== null);
    if (refused.length === 0) {
      onLeave();
      return;
    }
    // A save can be refused — a stale version, a payload the lab will not take. The navigation
    // stays pending and the refusal is shown here, so the reader is not sent behind the prompt
    // to find out what happened.
    setRefusals(refused);
    setPhase("failed");
  }

  function discardAndLeave() {
    for (const work of works) {
      work.discard();
    }
    onLeave();
  }

  const busy = phase === "saving";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-lab-ink/35 p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={`${surfaceClasses} grid w-full max-w-lg gap-3 p-5 outline-none`}
      >
        <h2 id={titleId} className="text-base font-bold tracking-tight">
          Unsaved changes
        </h2>
        <div id={bodyId} className="grid gap-2 text-[13px] text-admin-ink">
          {/* Not "would lose": the shop draft's editor is the workspace layout's and survives a
              move inside the shop, so what going there costs is the ability to save it, which
              is what this prompt is actually about for every entry in the list. */}
          <p>The page you are opening cannot save this work:</p>
          <ul className="grid list-disc gap-1 pl-5 text-admin-muted">
            {/* By position: two lists on one page can hold rows with the same title, and the
                product editor holds five. */}
            {works.map((work, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt per render.
              <li key={index}>{work.label}</li>
            ))}
          </ul>
        </div>
        {phase === "failed" ? (
          <div role="alert" className="grid gap-1 text-[13px] text-lab-error">
            <p>That did not save, so nothing has been left behind yet.</p>
            {refusals.map((refusal, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two saves can be refused alike.
              <p key={index}>{refusal}</p>
            ))}
          </div>
        ) : null}
        {savableHere ? null : (
          <p id={reasonId} className="text-xs text-admin-muted">
            A row that is open for editing cannot be saved from here: nothing typed in it has
            reached the draft yet. Stay, then press the row's own Save or Cancel.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className={outlineButtonClasses} type="button" onClick={onStay} disabled={busy}>
            Stay on this page
          </button>
          <button
            className={outlineButtonClasses}
            type="button"
            onClick={discardAndLeave}
            disabled={busy}
          >
            <ButtonIcon verb="discard" />
            Discard and leave
          </button>
          <button
            className={accentButtonClasses}
            type="button"
            onClick={() => void saveAndLeave()}
            disabled={busy || !savableHere}
            aria-describedby={savableHere ? undefined : reasonId}
          >
            <ButtonIcon verb="save" />
            {busy ? "Saving…" : "Save and leave"}
          </button>
        </div>
      </div>
    </div>
  );
}
