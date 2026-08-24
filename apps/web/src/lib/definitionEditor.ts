import { useCallback, useEffect, useRef, useState } from "react";
import { describeApiError } from "../api/client";
import type { VersionProvenance } from "../components/WorkspaceChrome";

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

export interface DefinitionEditor<ContentT, PreviewT> {
  content: ContentT | null;
  preview: PreviewT | null;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  publishing: boolean;
  error: string | null;
  edit: (next: ContentT) => void;
  save: () => Promise<void>;
  publish: () => Promise<number | null>;
}

export function useDefinitionEditor<ContentT, PayloadT, PreviewT extends VersionProvenance>(
  id: string,
  client: DefinitionClient<ContentT, PayloadT, PreviewT>,
): DefinitionEditor<ContentT, PreviewT> {
  const [content, setContent] = useState<ContentT | null>(null);
  const [preview, setPreview] = useState<PreviewT | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
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

  const save = useCallback(async () => {
    if (content === null) {
      return;
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
      setPreview(await client.previewDraft(id));
    } catch (cause: unknown) {
      setError(describeApiError(cause, client.unavailable));
    } finally {
      setSaving(false);
    }
  }, [content, id, client]);

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

  return { content, preview, loading, dirty, saving, publishing, error, edit, save, publish };
}
