import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";

/**
 * One piece of work the operator would lose if they left this page now.
 *
 * Two kinds exist and they are not the same kind of thing. A **draft** is content the editor
 * holds and its own Save writes to the lab; it can be saved from anywhere, so it carries a
 * `save`. An **open row** is `EntryCard` edit mode: its typing is deliberately outside the
 * draft's `content` (ADR 0051, and the Slice 7 revision in `docs/design-direction.md`), so the
 * page's Save does not carry it and neither does this prompt — it has no `save`, and the
 * prompt says where it can be saved instead.
 */
export interface UnsavedWork {
  /** What is unsaved, named the way the operator reads it on the page. */
  label: string;
  /**
   * Where this work is still reachable, by pathname. Work that the destination can still save
   * is not stranded by going there, so it does not block.
   *
   * Omitted is the strict answer — nowhere else — which is right for anything that dies with
   * its page: every page-scoped editor, and every open row. The shop draft is the exception,
   * because its editor lives on the workspace layout and outlives the page:
   * `shopDraftIsSavableAt` in `lib/shop.ts` names the surfaces that render its Save.
   */
  reaches?: (pathname: string) => boolean;
  /**
   * Writes it to the lab, answering with the refusal or `null` when it landed. Absent when
   * this work can only be saved where it stands.
   *
   * It answers with the message rather than leaving the prompt to read the editor's `error`
   * afterwards: the prompt is an ancestor of the editor, so it renders *before* the editor in
   * the commit that records the failure, and a prompt reading state committed in that render
   * would show the previous attempt's message or none at all.
   */
  save?: () => Promise<string | null>;
  /** Throws it away: a draft re-fetches what the server holds, an open row closes. */
  discard: () => void;
}

/**
 * One registration, as the guard reads it. Every field is read through the registering hook's
 * own ref, so the guard always calls the current render's closures rather than the ones that
 * happened to be live when the work was first registered.
 */
export interface RegisteredWork {
  read: () => UnsavedWork;
}

export interface UnsavedWorkRegister {
  /** The live list. Read through the ref: the guard is re-rendered on every change. */
  items: { current: RegisteredWork[] };
  register: (work: RegisteredWork) => () => void;
}

/**
 * The workspace's one register of unsaved work.
 *
 * Null outside the guard, and registering into nothing is then a no-op: a component test that
 * renders one card is not asked to mount a router-level guard to do it. The route tree puts
 * the guard above every route (`App.tsx`), and `App.test.tsx` asserts that it is there, so the
 * application itself never runs unguarded.
 */
export const UnsavedWorkContext = createContext<UnsavedWorkRegister | null>(null);

/**
 * Declare — or stop declaring — one piece of unsaved work.
 *
 * Pass `null` while there is nothing unsaved. The registration follows that, so a hook calls
 * this unconditionally and the register holds exactly what is currently at risk.
 */
export function useRegisterUnsavedWork(work: UnsavedWork | null): void {
  const register = useContext(UnsavedWorkContext);
  const latest = useRef<UnsavedWork | null>(work);

  // After the commit rather than during the render, so a render React discards can never leave
  // the register calling a closure the operator's screen was never built from.
  useLayoutEffect(() => {
    latest.current = work;
  });

  const active = work !== null;
  const entry = useMemo<RegisteredWork>(
    () => ({
      read: () => latest.current ?? { label: "", discard: () => {} },
    }),
    [],
  );

  useEffect(() => {
    if (register === null || !active) {
      return;
    }
    // `latest` is assigned in a layout effect, which has already run for this commit.
    return register.register(entry);
  }, [register, active, entry]);
}
