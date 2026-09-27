import { useCallback, useEffect, useRef, useState } from "react";
import { describeApiError } from "../api/client";
import type { PublishGate, VersionProvenance } from "../components/WorkspaceChrome";
import { useRegisterUnsavedWork } from "./unsavedWork";

/**
 * Every definition resource is edited the same way (ADR 0012): load the draft and its
 * publish-gate preview, edit locally, save the whole payload, then freeze it. Only the
 * transport is per-type, so an editor supplies this client and gets the state machine.
 * Shops, customer profiles, and support identities all run on it.
 *
 * Define the client as a module constant: it is a dependency of the load effect, so a
 * value rebuilt on every render would reload the draft forever.
 */
export interface DefinitionClient<ContentT, PayloadT, PreviewT extends VersionProvenance> {
  getDraft(id: string, signal?: AbortSignal): Promise<{ content: ContentT }>;
  previewDraft(id: string, signal?: AbortSignal): Promise<PreviewT>;
  replaceDraft(id: string, payload: PayloadT): Promise<{ content: ContentT }>;
  publish(id: string): Promise<{ version: number }>;
  toPayload(content: ContentT): PayloadT;
  /** Shown when the service itself is unreachable. */
  unavailable: string;
}

/**
 * What this editor's unsaved draft is called in the navigation prompt, and where it can still
 * be saved from.
 *
 * Every editor but one leaves `reaches` alone: it is mounted by the page it edits, so any
 * navigation strands it. The shop draft is the exception, because `ShopWorkspace` holds it for
 * the whole workspace and several surfaces render its Save (`shopDraftIsSavableAt`).
 */
export interface DefinitionGuard {
  /** A sentence naming what is unsaved, read in the prompt's list. */
  label: string;
  /** Pathnames that still render this draft's Save. Omitted means none but this one. */
  reaches?: (pathname: string) => boolean;
  /**
   * Run after a save that landed, wherever it was asked for.
   *
   * It belongs to the editor rather than to the button because the navigation prompt saves too:
   * a page that wrapped its own Save to refresh something would refresh it when the button was
   * pressed and not when the prompt pressed it for them, which is how the shop switcher came to
   * keep a stale name after Save-and-leave renamed the shop.
   *
   * It runs outside the write's own error handling and **its failure is swallowed**: by the time
   * it is reached the draft is in the lab, and a follow-up read that fails is not a refusal of
   * the write. Reporting one as the other would hold a navigation pending over a save that
   * succeeded, and would tell the operator their edit had not landed when it had. Anything it
   * does that the operator must see, it must show itself — which is what both callers do.
   */
  afterSave?: () => Promise<unknown>;
}

/** Stable, so an editor that names nothing does not rebuild its callbacks every render. */
const UNNAMED: DefinitionGuard = { label: "This draft has unsaved changes." };

export interface DefinitionEditor<ContentT, PreviewT> {
  content: ContentT | null;
  preview: PreviewT | null;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  discarding: boolean;
  publishing: boolean;
  /**
   * The gate is being asked about the draft the server now holds, so the preview on screen is
   * not the answer for it: before the first answer, and between a save or a discard landing
   * and the gate answering for what it wrote. Publish is a press in flight meanwhile, and the
   * gate says "Checking the draft…" rather than its previous reasons (ADR 0063, ADR 0065).
   */
  checking: boolean;
  error: string | null;
  edit: (next: ContentT) => void;
  /** The refusal the lab answered with, or null when the draft reached it. */
  save: () => Promise<string | null>;
  /** Throws the local edits away by re-reading what the server holds. */
  discard: () => Promise<void>;
  publish: () => Promise<number | null>;
}

export function useDefinitionEditor<ContentT, PayloadT, PreviewT extends VersionProvenance>(
  id: string,
  client: DefinitionClient<ContentT, PayloadT, PreviewT>,
  guard: DefinitionGuard = UNNAMED,
): DefinitionEditor<ContentT, PreviewT> {
  const [content, setContent] = useState<ContentT | null>(null);
  const [preview, setPreview] = useState<PreviewT | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Counts local edits. A save applies the server's echo only when nothing was typed while
  // the request was in flight; otherwise the response is stale and would discard the edit.
  const edits = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      client.getDraft(id, controller.signal),
      client.previewDraft(id, controller.signal),
    ])
      .then(([draft, draftPreview]) => {
        edits.current += 1;
        setContent(draft.content);
        setPreview(draftPreview);
        setDirty(false);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, client.unavailable));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [id, client]);

  const edit = useCallback((next: ContentT) => {
    edits.current += 1;
    setContent(next);
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<string | null> => {
    if (content === null) {
      return client.unavailable;
    }
    setSaving(true);
    setError(null);
    const sentAt = edits.current;
    try {
      const saved = await client.replaceDraft(id, client.toPayload(content));
      const editedWhileSaving = edits.current !== sentAt;
      if (!editedWhileSaving) {
        setContent(saved.content);
        setDirty(false);
      }
      setPreviewing(true);
      setPreview(await client.previewDraft(id));
    } catch (cause: unknown) {
      const message = describeApiError(cause, client.unavailable);
      setError(message);
      return message;
    } finally {
      setSaving(false);
      setPreviewing(false);
    }
    try {
      await guard.afterSave?.();
    } catch {
      // Deliberately: the draft has landed. See `DefinitionGuard.afterSave`.
    }
    return null;
  }, [content, id, client, guard]);

  /**
   * Discard: the draft goes back to what the server holds, by reading it again.
   *
   * It is marked clean before the request rather than after it, so that a navigation the
   * operator has already chosen to take cannot be blocked a second time by the very edits they
   * just threw away. A read that fails puts the flag back, because the edits are then still on
   * screen and still the only copy of themselves.
   *
   * **Nothing it read is applied to an editor that has moved on.** Discard-and-leave fires this
   * and navigates without waiting, and two of the workspace's editors are reused across a
   * change of `id` rather than remounted — the shop draft, which lives on the `/shops/:shopId`
   * layout, and the ticket editor beside its list. So a re-read of A can still be in flight
   * when the load effect's read of B lands, and applying it would put A's content under B's id,
   * report it clean, and let the next Save write it there. The edit token is what says whether
   * this editor is still the one that asked: the load effect bumps it, `edit` bumps it, so a
   * response that outlived either is dropped — which also means typing during a slow re-read
   * survives it. This is the rule `save` already follows, applied to the other read.
   */
  const discard = useCallback(async () => {
    const sentAt = edits.current;
    setDiscarding(true);
    setPreviewing(true);
    setError(null);
    setDirty(false);
    try {
      const [draft, draftPreview] = await Promise.all([
        client.getDraft(id),
        client.previewDraft(id),
      ]);
      if (edits.current !== sentAt) {
        return;
      }
      edits.current += 1;
      setContent(draft.content);
      setPreview(draftPreview);
    } catch (cause: unknown) {
      if (edits.current !== sentAt) {
        return;
      }
      setError(describeApiError(cause, client.unavailable));
      setDirty(true);
    } finally {
      // Unconditionally, unlike the writes above: this one is the control's busy state rather
      // than content, and leaving it set would disable the Save and Discard of a draft that
      // has nothing to do with this request.
      setDiscarding(false);
      setPreviewing(false);
    }
  }, [id, client]);

  // What the one blocker above the route tree reads. The hook is where `dirty` lives, so the
  // hook is what declares it; the prompt itself is drawn once, at the root, because a router
  // consults one blocker and several of these editors are mounted at the same time (ADR 0051).
  useRegisterUnsavedWork(
    dirty
      ? {
          label: guard.label,
          reaches: guard.reaches,
          save,
          discard: () => void discard(),
        }
      : null,
  );

  const publish = useCallback(async (): Promise<number | null> => {
    // Publishing freezes what the server holds. Never let the button freeze an older
    // draft than the edits sitting in this editor.
    if (dirty) {
      setError("Save the draft before publishing so the frozen version matches your edits.");
      return null;
    }
    setPublishing(true);
    setError(null);
    try {
      const published = await client.publish(id);
      setPreview(await client.previewDraft(id));
      return published.version;
    } catch (cause: unknown) {
      setError(describeApiError(cause, client.unavailable));
      return null;
    } finally {
      setPublishing(false);
    }
  }, [dirty, id, client]);

  return {
    content,
    preview,
    loading,
    dirty,
    saving,
    discarding,
    publishing,
    // Before the first answer only while it is being read: a load that failed is not checking.
    checking: previewing || (preview === null && loading),
    error,
    edit,
    save,
    discard,
    publish,
  };
}

/**
 * One definition of "may this draft be frozen", shared by every editor so the button and
 * the explanation below it can never disagree — and so a new resource cannot quietly ship
 * a weaker gate than the shop's.
 */
export function canPublish(preview: PublishGate | null, dirty: boolean): boolean {
  return preview?.publishable === true && !dirty && !preview.matches_latest_published;
}

/** Saving comes before publishing: a publish freezes the saved draft. */
export const PUBLISH_UNSAVED_REASON =
  "Save the draft first — publishing freezes the saved draft, not unsaved edits.";

export function publishErrorsReason(errors: number): string {
  return `Resolve ${errors} error(s) to publish.`;
}

export function publishUnchangedReason(version: number | null): string {
  return `The draft is identical to v${version}; there is nothing new to freeze.`;
}

/**
 * Why Publish is refused, in one sentence — the first of `PublishReasons`' lines, which is what
 * the button's `title` carries — or null where it is not refused.
 *
 * A preview that has not answered is not a refusal: there is nothing to refuse for yet, and the
 * gate ends on its own, so the button is drawn as a press in flight (ADR 0063) and the reasons
 * block says "Checking the draft…" instead (ADR 0065).
 */
export function publishRefusalReason(preview: PublishGate | null, dirty: boolean): string | null {
  if (dirty) {
    return PUBLISH_UNSAVED_REASON;
  }
  if (preview === null) {
    return null;
  }
  if (!preview.publishable) {
    return publishErrorsReason(preview.issues.filter((issue) => issue.severity === "error").length);
  }
  if (preview.matches_latest_published) {
    return publishUnchangedReason(preview.latest_published_version);
  }
  return null;
}
