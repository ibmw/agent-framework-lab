import type {
  GuidanceNoteSchema,
  SupportIdentityPayloadSchema,
  SupportIdentityPreviewResponse,
  SupportPermission,
} from "@agent-lab/contracts";
import { useId, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getSupportIdentityDraft,
  previewSupportIdentityDraft,
  publishSupportIdentity,
  replaceSupportIdentityDraft,
} from "../api/supportIdentities";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipListField } from "../components/ChipListField";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import {
  Card,
  EditorSaveActions,
  EntryCard,
  EntryEditNotice,
  EntryId,
  EntryText,
  Fingerprint,
  GateCard,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { entryEdit, useEntryEdit } from "../lib/entryEdit";
import { slugify, uniqueId } from "../lib/entryIds";
import { optionText, SUPPORT_PERMISSION } from "../lib/enumLabels";
import {
  CHIP_LABEL_MAX_LENGTH,
  ESCALATION_CONDITIONS_RULE,
  IDENTITY_TONE_RULE,
} from "../lib/fieldRules";
import { consequenceOf, findingClauses, useRemoval } from "../lib/removal";
import {
  destructiveSubtleButtonClasses,
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  fieldLabelClasses,
  inkButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useLabWorkspace } from "../shell/useLabWorkspace";

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
  const { listings } = useLabWorkspace();
  const publishReasonsId = useId();
  const editor = useDefinitionEditor(identityId, CLIENT, {
    label: "The support identity draft has unsaved changes.",
    // The library index prints the row this editor is changing, and it renders the shell's
    // listing rather than reading its own (ADR 0056). Declared on the editor rather than on
    // the button, because the navigation prompt saves this draft too.
    afterSave: listings.supportIdentities.refresh,
  });
  const { content, preview, edit } = editor;
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const guidanceEditor = useEntryEdit<GuidanceFields>(
    (content?.guidance ?? []).map((note) => note.id),
  );
  const guidanceNotice = useId();
  const guidanceRemoval = useRemoval(identityId);

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

  function dropGuidance(id: string) {
    if (!content) {
      return;
    }
    edit({ ...content, guidance: content.guidance.filter((entry) => entry.id !== id) });
  }

  function saveGuidance(id: string, fields: GuidanceFields) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      guidance: content.guidance.map((note) => (note.id === id ? guidanceEntry(id, fields) : note)),
    });
  }

  return (
    <>
      <PageHeader
        title={content.role.name}
        chips={<VersionChips preview={preview} />}
        // The prototype's line names the identity by its role's title (`Workspace.dc.html`
        // :1749); an emptied title still leaves the line saying what the page is.
        back={{
          to: "..",
          label: "Support identities",
          kind: content.role.title.trim() === "" ? "identity" : content.role.title,
        }}
        description={
          preview ? (
            <>
              Draft fingerprint <Fingerprint value={preview.content_fingerprint} />
            </>
          ) : null
        }
        actions={
          <>
            <EditorSaveActions
              dirty={editor.dirty}
              saving={editor.saving}
              discarding={editor.discarding}
              onSave={() => void editor.save()}
              onDiscard={() => void editor.discard()}
            />
            <PublishButton
              preview={preview}
              dirty={editor.dirty}
              checking={editor.checking}
              publishing={editor.publishing}
              reasonsId={publishReasonsId}
              onPublish={() => {
                // A frozen version is printed by the index this editor was opened from, and
                // that index renders the shell's listing (ADR 0056).
                void editor.publish().then((version) => {
                  setPublishedVersion(version);
                  if (version !== null) {
                    void listings.supportIdentities.refresh();
                  }
                });
              }}
            />
          </>
        }
        reasons={
          <>
            {editor.error ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {editor.error}
              </p>
            ) : null}
            {publishedVersion !== null ? (
              <p role="status" className="text-[13px] text-lab-success">
                Published version {publishedVersion}. Agent configurations pin an exact version.
              </p>
            ) : null}
            <PublishReasons
              id={publishReasonsId}
              preview={preview}
              dirty={editor.dirty}
              checking={editor.checking}
            />
          </>
        }
        sticky
      />

      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>
          <Card title="Role">
            <FieldRows>
              <Field label="Name">
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={content.role.name}
                  onChange={(event) =>
                    edit({ ...content, role: { ...content.role, name: event.target.value } })
                  }
                />
              </Field>
              <Field label="Title">
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={content.role.title}
                  onChange={(event) =>
                    edit({ ...content, role: { ...content.role, title: event.target.value } })
                  }
                />
              </Field>
              {/* The note the card used to close on is about this field — the prototype draws
                  it under Remit (:1808) — so it is the row's rule, and the create page's words. */}
              <Field label="Remit" hint={IDENTITY_TONE_RULE}>
                <textarea
                  className={`${textAreaClasses} w-full`}
                  value={content.role.description}
                  onChange={(event) =>
                    edit({
                      ...content,
                      role: { ...content.role, description: event.target.value },
                    })
                  }
                />
              </Field>
            </FieldRows>
          </Card>

          <Card
            title="Permissions"
            description={
              <>
                The tool layer authorizes against these exact permissions, so an identity that can
                act on orders it cannot read is refused at publication.
              </>
            }
          >
            {/* Two groups named by their rows, as the prototype names them (:1818, :1834). */}
            <FieldRows>
              <FieldGroup label="Read">
                <PermissionBoxes
                  permissions={READ_PERMISSIONS}
                  granted={content.permissions}
                  onToggle={togglePermission}
                />
              </FieldGroup>
              <FieldGroup label="Act">
                <PermissionBoxes
                  permissions={ACTION_PERMISSIONS}
                  granted={content.permissions}
                  onToggle={togglePermission}
                />
              </FieldGroup>
            </FieldRows>
          </Card>

          <Card title="Guidance">
            {content.guidance.length === 0 ? (
              <p className="text-[13px] text-admin-muted">No guidance authored yet.</p>
            ) : (
              <ul className="grid gap-2 text-[13px]">
                {content.guidance.map((note) =>
                  guidanceRemoval.isArmed(note.id) ? (
                    <ConfirmRemove
                      key={note.id}
                      as="li"
                      title={`Remove the guidance “${note.title}”?`}
                      consequence={consequenceOf(
                        "An agent running as this identity is no longer given it.",
                        findingClauses([
                          content.guidance.length === 1 && "identity_without_guidance",
                        ]),
                        "Nothing is written until you save the draft, and a published version keeps it.",
                      )}
                      onConfirm={guidanceRemoval.confirm(
                        () => dropGuidance(note.id),
                        `Removed the guidance “${note.title}” from the draft.`,
                      )}
                      onKeep={guidanceRemoval.keep}
                    />
                  ) : (
                    <EntryCard
                      key={note.id}
                      title={note.title}
                      chips={<EntryId value={note.id} />}
                      edit={entryEdit(
                        guidanceEditor,
                        guidanceNotice,
                        note.id,
                        note.title,
                        () => ({ title: note.title, body: note.body }),
                        (fields) => saveGuidance(note.id, fields),
                        (value, onChange) => (
                          <div className="flex flex-wrap items-end gap-2">
                            <GuidanceFieldset value={value} onChange={onChange} />
                          </div>
                        ),
                      )}
                      actions={
                        <button
                          className={destructiveSubtleButtonClasses}
                          type="button"
                          aria-label={`Remove ${note.title}`}
                          ref={guidanceRemoval.trigger(note.id)}
                          onClick={guidanceRemoval.ask(
                            note.id,
                            () => dropGuidance(note.id),
                            `Removed the guidance “${note.title}” from the draft.`,
                          )}
                        >
                          <ButtonIcon verb="delete" />
                          Remove
                        </button>
                      }
                    >
                      <EntryText label="Guidance" value={note.body} />
                    </EntryCard>
                  ),
                )}
              </ul>
            )}
            <EntryEditNotice id={guidanceNotice} label={guidanceEditor.open?.label ?? null} />
            <RemovalNotice removal={guidanceRemoval} />
            <GuidanceForm
              onAdd={(fields) =>
                edit({
                  ...content,
                  guidance: [
                    ...content.guidance,
                    guidanceEntry(
                      uniqueId(
                        slugify(fields.title, "note"),
                        content.guidance.map((note) => note.id),
                      ),
                      fields,
                    ),
                  ],
                })
              }
            />
          </Card>

          <Card title="Escalation">
            <FieldRows>
              <Field label="Escalate to">
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={content.escalation.escalate_to}
                  onChange={(event) =>
                    edit({
                      ...content,
                      escalation: { ...content.escalation, escalate_to: event.target.value },
                    })
                  }
                />
              </Field>
            </FieldRows>
            {/* `ChipListField` is a `<fieldset>` with its own `<legend>` and its own hint on the
                control that takes the next condition, as a ticket's tags are drawn under their
                rows. Wrapping it in a row would name it twice. */}
            <ChipListField
              legend="Conditions"
              label="New condition"
              hint={ESCALATION_CONDITIONS_RULE}
              maxLength={CHIP_LABEL_MAX_LENGTH}
              addLabel="Add condition"
              placeholder="the customer asks for a manager"
              empty="No condition yet; this identity never escalates."
              values={content.escalation.conditions}
              takenPlace="an escalation condition"
              confirmRemoval={{
                scope: identityId,
                title: (condition) => `Remove the escalation condition “${condition}”?`,
                consequence: (_condition, conditions) =>
                  consequenceOf(
                    "An agent running as this identity no longer escalates when it holds.",
                    findingClauses([
                      conditions.length === 1 && "identity_without_escalation_condition",
                    ]),
                    "Nothing is written until you save the draft, and a published version keeps it.",
                  ),
                notice: (condition) =>
                  `Removed the escalation condition “${condition}” from the draft.`,
              }}
              onChange={(conditions) =>
                edit({ ...content, escalation: { ...content.escalation, conditions } })
              }
            />
          </Card>
        </div>

        <div className={editorPanelClasses}>
          <GateCard title="Publish gate" busy={editor.checking} dirty={editor.dirty}>
            <IssueList issues={preview?.issues ?? []} />
          </GateCard>
          <Card title="What publishing freezes">
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

/** One group's permissions, a checkbox each, named by the permission and what it allows. */
function PermissionBoxes({
  permissions,
  granted,
  onToggle,
}: {
  permissions: SupportPermission[];
  granted: SupportPermission[];
  onToggle: (permission: SupportPermission) => void;
}) {
  return (
    <div className="grid gap-2">
      {permissions.map((permission) => (
        <label key={permission} className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={granted.includes(permission)}
            onChange={() => onToggle(permission)}
          />
          {optionText(SUPPORT_PERMISSION[permission])}
        </label>
      ))}
    </div>
  );
}

/**
 * A guidance note's two fields, and the one function that turns them into the note the draft
 * stores.
 *
 * These rows are where PLAN-UX takes edit mode from: they already corrected in place, but they
 * asked their two questions through `aria-label` alone, so a reader with a pointer saw two
 * unlabelled boxes. Slice 7 asks for visible labels, and the way a row gets them is by asking
 * with the same words — and the same component — the add form asks with.
 */
interface GuidanceFields {
  title: string;
  body: string;
}

function guidanceEntry(id: string, fields: GuidanceFields): GuidanceNoteSchema {
  return { id, title: fields.title, body: fields.body };
}

function GuidanceFieldset({
  value,
  onChange,
}: {
  value: GuidanceFields;
  onChange: (next: GuidanceFields) => void;
}) {
  return (
    <>
      <label className={`${fieldLabelClasses} min-w-48 flex-1`}>
        Title
        <input
          className={`${fieldControlClasses} w-full`}
          value={value.title}
          required
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Guidance
        <input
          className={`${fieldControlClasses} w-full`}
          value={value.body}
          required
          onChange={(event) => onChange({ ...value, body: event.target.value })}
        />
      </label>
    </>
  );
}

function GuidanceForm({ onAdd }: { onAdd: (fields: GuidanceFields) => void }) {
  const [fields, setFields] = useState<GuidanceFields>({ title: "", body: "" });

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(fields);
        setFields({ title: "", body: "" });
      }}
    >
      <GuidanceFieldset value={fields} onChange={setFields} />
      <button className={inkButtonClasses} type="submit">
        <ButtonIcon verb="create" />
        Add guidance
      </button>
    </form>
  );
}
