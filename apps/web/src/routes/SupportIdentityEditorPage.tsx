import type {
  GuidanceNoteSchema,
  SupportIdentityPayloadSchema,
  SupportIdentityPreviewResponse,
  SupportPermission,
} from "@agent-lab/contracts";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getSupportIdentityDraft,
  previewSupportIdentityDraft,
  publishSupportIdentity,
  replaceSupportIdentityDraft,
} from "../api/supportIdentities";
import {
  Card,
  canPublish,
  Fingerprint,
  IssueList,
  PageHeader,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { slugify, uniqueId } from "../lib/entryIds";
import { optionText, SUPPORT_PERMISSION } from "../lib/enumLabels";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  inkButtonClasses,
  outlineButtonClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";

const CLIENT: DefinitionClient<
  SupportIdentityPayloadSchema,
  SupportIdentityPayloadSchema,
  SupportIdentityPreviewResponse
> = {
  getDraft: getSupportIdentityDraft,
  previewDraft: previewSupportIdentityDraft,
  replaceDraft: replaceSupportIdentityDraft,
  publish: publishSupportIdentity,
  // A support identity carries no derived evidence, so the content *is* the payload.
  toPayload: (content) => content,
  unavailable: "The support-identity service is unavailable.",
};

const READ_PERMISSIONS: SupportPermission[] = [
  "read_catalog",
  "read_customer",
  "read_orders",
  "read_policies",
];

const ACTION_PERMISSIONS: SupportPermission[] = [
  "cancel_order",
  "change_shipping_address",
  "issue_refund",
  "apply_discount",
  "escalate_to_human",
];

export function SupportIdentityEditorPage() {
  const { identityId = "" } = useParams();
  const editor = useDefinitionEditor(identityId, CLIENT);
  const { content, preview, edit } = editor;
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [condition, setCondition] = useState("");

  if (editor.loading) {
    return <p className="text-sm text-admin-muted">Loading support identity…</p>;
  }

  if (!content) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {editor.error ?? "This support identity could not be loaded."}
      </div>
    );
  }

  function togglePermission(permission: SupportPermission) {
    if (!content) {
      return;
    }
    const granted = content.permissions.includes(permission);
    edit({
      ...content,
      permissions: granted
        ? content.permissions.filter((entry) => entry !== permission)
        : [...content.permissions, permission],
    });
  }

  function updateGuidance(id: string, next: Partial<GuidanceNoteSchema>) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      guidance: content.guidance.map((note) => (note.id === id ? { ...note, ...next } : note)),
    });
  }

  function addCondition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content || content.escalation.conditions.includes(condition)) {
      return;
    }
    edit({
      ...content,
      escalation: {
        ...content.escalation,
        conditions: [...content.escalation.conditions, condition],
      },
    });
    setCondition("");
  }

  return (
    <>
      <PageHeader
        title={content.role.name}
        chips={<VersionChips preview={preview} />}
        description={
          <>
            <Link className="font-semibold text-lab-ink" to=".." relative="path">
              Support identities
            </Link>{" "}
            · {content.role.title}
            {preview ? (
              <>
                {" "}
                · draft fingerprint <Fingerprint value={preview.content_fingerprint} />
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <button
              className={outlineButtonClasses}
              type="button"
              onClick={() => void editor.save()}
              disabled={!editor.dirty || editor.saving}
            >
              {editor.saving ? "Saving…" : editor.dirty ? "Save draft" : "Saved"}
            </button>
            <button
              className={accentButtonClasses}
              type="button"
              onClick={() => {
                void editor.publish().then((version) => setPublishedVersion(version));
              }}
              disabled={editor.publishing || !canPublish(preview, editor.dirty)}
            >
              {editor.publishing ? "Publishing…" : `Publish v${preview?.next_version ?? 1}`}
            </button>
          </>
        }
      />

      {editor.error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {editor.error}
        </p>
      ) : null}
      <div className="mb-4 grid gap-1">
        <PublishReasons preview={preview} dirty={editor.dirty} />
      </div>
      {publishedVersion !== null ? (
        <p role="status" className="mb-4 text-[13px] text-lab-success">
          Published version {publishedVersion}. Agent configurations pin an exact version.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4">
          <Card title="Role">
            <label className={fieldLabelClasses}>
              Name
              <input
                className={fieldControlClasses}
                value={content.role.name}
                onChange={(event) =>
                  edit({ ...content, role: { ...content.role, name: event.target.value } })
                }
              />
            </label>
            <label className={fieldLabelClasses}>
              Title
              <input
                className={fieldControlClasses}
                value={content.role.title}
                onChange={(event) =>
                  edit({ ...content, role: { ...content.role, title: event.target.value } })
                }
              />
            </label>
            <label className={fieldLabelClasses}>
              Remit
              <textarea
                className={textAreaClasses}
                value={content.role.description}
                onChange={(event) =>
                  edit({
                    ...content,
                    role: { ...content.role, description: event.target.value },
                  })
                }
              />
            </label>
            <p className="text-xs text-admin-muted">
              Tone of voice is not authored here: it belongs to the shop, and an agent configuration
              selects the shop default or a named override.
            </p>
          </Card>

          <Card title="Permissions">
            <fieldset className="grid gap-2">
              <legend className="text-xs font-semibold text-admin-muted uppercase">Read</legend>
              {READ_PERMISSIONS.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={content.permissions.includes(permission)}
                    onChange={() => togglePermission(permission)}
                  />
                  {optionText(SUPPORT_PERMISSION[permission])}
                </label>
              ))}
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="text-xs font-semibold text-admin-muted uppercase">Act</legend>
              {ACTION_PERMISSIONS.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={content.permissions.includes(permission)}
                    onChange={() => togglePermission(permission)}
                  />
                  {optionText(SUPPORT_PERMISSION[permission])}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-admin-muted">
              The tool layer authorizes against these exact permissions, so an identity that can act
              on orders it cannot read is refused at publication.
            </p>
          </Card>

          <Card title="Guidance">
            {content.guidance.length === 0 ? (
              <p className="text-[13px] text-admin-muted">No guidance authored yet.</p>
            ) : (
              <ul className="grid gap-2 text-[13px]">
                {content.guidance.map((note) => (
                  <li key={note.id} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`Guidance title for ${note.id}`}
                        className={fieldControlClasses}
                        value={note.title}
                        onChange={(event) => updateGuidance(note.id, { title: event.target.value })}
                      />
                      <button
                        className={subtleButtonClasses}
                        type="button"
                        aria-label={`Remove ${note.title}`}
                        onClick={() =>
                          edit({
                            ...content,
                            guidance: content.guidance.filter((entry) => entry.id !== note.id),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      aria-label={`Guidance body for ${note.id}`}
                      className={fieldControlClasses}
                      value={note.body}
                      onChange={(event) => updateGuidance(note.id, { body: event.target.value })}
                    />
                  </li>
                ))}
              </ul>
            )}
            <GuidanceForm
              onAdd={(title, body) =>
                edit({
                  ...content,
                  guidance: [
                    ...content.guidance,
                    {
                      id: uniqueId(
                        slugify(title, "note"),
                        content.guidance.map((note) => note.id),
                      ),
                      title,
                      body,
                    },
                  ],
                })
              }
            />
          </Card>

          <Card title="Escalation">
            <label className={fieldLabelClasses}>
              Escalate to
              <input
                className={fieldControlClasses}
                value={content.escalation.escalate_to}
                onChange={(event) =>
                  edit({
                    ...content,
                    escalation: { ...content.escalation, escalate_to: event.target.value },
                  })
                }
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {content.escalation.conditions.map((entry) => (
                <button
                  key={entry}
                  className={subtleButtonClasses}
                  type="button"
                  onClick={() =>
                    edit({
                      ...content,
                      escalation: {
                        ...content.escalation,
                        conditions: content.escalation.conditions.filter(
                          (value) => value !== entry,
                        ),
                      },
                    })
                  }
                >
                  {entry} ✕
                </button>
              ))}
            </div>
            <form className="flex flex-wrap items-end gap-2" onSubmit={addCondition}>
              <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
                New condition
                <input
                  className={fieldControlClasses}
                  value={condition}
                  required
                  onChange={(event) => setCondition(event.target.value)}
                />
              </label>
              <button className={inkButtonClasses} type="submit">
                Add condition
              </button>
            </form>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Publish gate">
            <IssueList issues={preview?.issues ?? []} />
          </Card>
          <Card title="What publishing would freeze">
            {preview && preview.changes.length > 0 ? (
              <ul className="grid gap-1 text-[13px] text-admin-ink-soft">
                {preview.changes.map((change) => (
                  <li key={`${change.kind}:${change.path}`}>{change.description}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-admin-muted">
                The draft matches the latest published version.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function GuidanceForm({ onAdd }: { onAdd: (title: string, body: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(title, body);
        setTitle("");
        setBody("");
      }}
    >
      <label className={`${fieldLabelClasses} min-w-48 flex-1`}>
        Title
        <input
          className={fieldControlClasses}
          value={title}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Guidance
        <input
          className={fieldControlClasses}
          value={body}
          required
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <button className={inkButtonClasses} type="submit">
        Add guidance
      </button>
    </form>
  );
}
