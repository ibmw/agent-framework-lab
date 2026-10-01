import type {
  GuidanceNoteSchema,
  SupportIdentityPayloadSchema,
  SupportIdentityPreviewResponse,
  SupportPermission,
} from "@agent-lab/contracts";
import { useId, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getSupportIdentityDraft,
  previewSupportIdentityDraft,
  publishSupportIdentity,
  replaceSupportIdentityDraft,
  toSupportIdentityPayload,
} from "../api/supportIdentities";
import { ChipListField } from "../components/ChipListField";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { Field, FieldGroup, FieldHint, FieldRows } from "../components/FieldHint";
import { EditButton, ItemFormRow, ListItem, RemoveButton } from "../components/ItemList";
import {
  Card,
  EditorSaveActions,
  Fingerprint,
  GateCard,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { slugify, uniqueId } from "../lib/entryIds";
import { optionText, SUPPORT_PERMISSION } from "../lib/enumLabels";
import {
  CHIP_LABEL_MAX_LENGTH,
  ESCALATION_CONDITIONS_RULE,
  IDENTITY_TONE_RULE,
  LABEL_MAX_LENGTH,
  TEXT_MAX_LENGTH,
} from "../lib/fieldRules";
import {
  BLANK_GUIDANCE,
  type GuidanceFields,
  guidanceEntry,
  guidanceFields,
  guidanceRefusal,
} from "../lib/guidanceNotes";
import {
  formTitle,
  type ItemFormWords,
  refusedProps,
  useEditButtons,
  useFocusAfterCommit,
  useItemForm,
} from "../lib/itemForm";
import { pythonStrip } from "../lib/pythonText";
import { consequenceOf, findingClauses, useRemoval } from "../lib/removal";
import {
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
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
  toPayload: toSupportIdentityPayload,
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
                  maxLength={LABEL_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  value={content.role.name}
                  onChange={(event) =>
                    edit({ ...content, role: { ...content.role, name: event.target.value } })
                  }
                />
              </Field>
              <Field label="Title">
                <input
                  maxLength={LABEL_MAX_LENGTH}
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
                  maxLength={TEXT_MAX_LENGTH}
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
            <FieldRows>
              <GuidanceNotes identityId={identityId} content={content} edit={edit} />
            </FieldRows>
          </Card>

          <Card title="Escalation">
            <FieldRows>
              <Field label="Escalate to">
                <input
                  maxLength={TEXT_MAX_LENGTH}
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

const GUIDANCE_WORDS: ItemFormWords = { form: "Guidance", entry: "a note", record: "draft" };

/**
 * The identity's guidance, as items, and the one form that adds a note or edits the one chosen
 * (ADR 0074). The prototype draws a note with a one-press × and no Edit (`Workspace.dc.html`
 * :1858–1866); the item carries the pencil and a trash that asks twice (ADR 0060).
 */
function GuidanceNotes({
  identityId,
  content,
  edit,
}: {
  identityId: string;
  content: SupportIdentityPayloadSchema;
  edit: (next: SupportIdentityPayloadSchema) => void;
}) {
  const notes = content.guidance;
  const ids = notes.map((note) => note.id);
  const noteOf = (id: string) => notes.find((note) => note.id === id) as GuidanceNoteSchema;
  const nameOf = (id: string) => notes.find((note) => note.id === id)?.title ?? id;
  const form = useItemForm<GuidanceFields>({
    blank: BLANK_GUIDANCE,
    ids,
    words: GUIDANCE_WORDS,
    nameOf,
    formOf: (id) => guidanceFields(noteOf(id)),
    typedOf: (fields) => fields.title,
  });
  const removal = useRemoval(identityId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const titleInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = guidanceRefusal(form.fields);
  const marked = form.dirty ? refusal : null;

  function drop(id: string) {
    edit({ ...content, guidance: notes.filter((note) => note.id !== id) });
  }

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      // An edit that changed nothing writes nothing, so the draft stays as clean as it was.
      if (form.dirty) {
        edit({
          ...content,
          guidance: notes.map((note) =>
            note.id === editing ? guidanceEntry(note.id, form.fields) : note,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      const id = uniqueId(slugify(pythonStrip(form.fields.title), "note"), ids);
      edit({ ...content, guidance: [...notes, guidanceEntry(id, form.fields)] });
    }
    form.reset();
  }

  return (
    <>
      <FieldGroup label="Notes">
        <div className="grid gap-2">
          {notes.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {notes.map((note) => {
                const notice = `Removed the guidance “${note.title}” from the draft.`;
                if (removal.isArmed(note.id)) {
                  return (
                    <ConfirmRemove
                      key={note.id}
                      as="li"
                      title={`Remove the guidance “${note.title}”?`}
                      consequence={consequenceOf(
                        "An agent running as this identity is no longer given it.",
                        findingClauses([notes.length === 1 && "identity_without_guidance"]),
                        "Nothing is written until you save the draft, and a published version keeps it.",
                      )}
                      onConfirm={removal.confirm(() => drop(note.id), notice)}
                      onKeep={removal.keep}
                    />
                  );
                }
                return (
                  <ListItem
                    key={note.id}
                    name={note.title}
                    id={note.id}
                    detail={note.body}
                    multiline
                    editing={form.editing === note.id}
                  >
                    <EditButton
                      name={note.title}
                      buttonRef={editButtons.ref(note.id)}
                      onEdit={() => {
                        form.begin(note.id, guidanceFields(note));
                        focusAfterCommit(() => titleInput.current);
                      }}
                    />
                    <RemoveButton
                      name={note.title}
                      entryKey={note.id}
                      removal={removal}
                      notice={notice}
                      onRemove={() => drop(note.id)}
                    />
                  </ListItem>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-admin-muted">No guidance authored yet.</p>
          )}
          <RemovalNotice removal={removal} />
        </div>
      </FieldGroup>
      <ItemFormRow
        title={formTitle(form.editing, nameOf, GUIDANCE_WORDS.entry)}
        editing={form.editing !== null}
        addLabel="Add guidance"
        refusal={refusal}
        reasonId={reasonId}
        onSubmit={submit}
        onCancel={() => {
          const editing = form.editing;
          form.reset();
          if (editing !== null) {
            focusAfterCommit(() => editButtons.get(editing));
          }
        }}
      >
        <FieldHint label="Title">
          <input
            maxLength={LABEL_MAX_LENGTH}
            ref={titleInput}
            className={`${fieldControlClasses} w-full`}
            value={form.fields.title}
            {...refusedProps(marked, "title", reasonId)}
            onChange={(event) => form.update({ title: event.target.value })}
          />
        </FieldHint>
        <div className="col-span-full">
          <FieldHint label="Guidance">
            <textarea
              maxLength={TEXT_MAX_LENGTH}
              className={`${textAreaClasses} w-full`}
              value={form.fields.body}
              {...refusedProps(marked, "body", reasonId)}
              onChange={(event) => form.update({ body: event.target.value })}
            />
          </FieldHint>
        </div>
      </ItemFormRow>
    </>
  );
}
