import type {
  BlockParameterKind,
  BlockParameterSchema,
  BlockSummarySchema,
  MutationBlockPayloadSchema,
  MutationBlockPreviewResponse,
  MutationEffect,
  ObjectiveAssessment,
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPreviewResponse,
  ObjectiveEvidence,
  ObjectiveSeverity,
} from "@agent-lab/contracts";
import { type ReactNode, useId, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { mutationBlocks, objectiveBlocks, toBlockPayload } from "../api/blocks";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { Field, FieldGroup, FieldHint, FieldRows } from "../components/FieldHint";
import { GateFindingLine } from "../components/GateFindingLine";
import {
  EditButton,
  FixedKeyField,
  ItemFormRow,
  ListItem,
  MoveButton,
  RemoveButton,
} from "../components/ItemList";
import {
  Card,
  EditorSaveActions,
  EntryKind,
  Fingerprint,
  GateCard,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import {
  ASSESSMENTS,
  acceptsDefault,
  BLANK_PARAMETER,
  type BlockPayload,
  bindingSentence,
  bindsShopObject,
  DETERMINISTIC_EVIDENCE,
  EFFECTS,
  evidenceFor,
  moveParameter,
  PARAMETER_KINDS,
  type ParameterFormFields,
  parameterFormFields,
  parameterRefusal,
  removeParameter,
  replaceParameter,
  retypedFields,
  shopBoundCount,
  toIdentifier,
  uniqueParameterName,
  withParameter,
} from "../lib/blocks";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { SLUG_MAX_LENGTH } from "../lib/entryIds";
import { BLOCK_PARAMETER_KIND, labelOf, OBJECTIVE_SEVERITY, optionsOf } from "../lib/enumLabels";
import { savedAsPreview } from "../lib/fieldPreviews";
import { optionalParameterWithoutDefaultRule, TEXT_MAX_LENGTH } from "../lib/fieldRules";
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
import type { Listing } from "../shell/listings";
import { useLabWorkspace } from "../shell/useLabWorkspace";

const OBJECTIVE_CLIENT: DefinitionClient<
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPreviewResponse
> = {
  getDraft: objectiveBlocks.getDraft,
  previewDraft: objectiveBlocks.previewDraft,
  replaceDraft: objectiveBlocks.replaceDraft,
  publish: objectiveBlocks.publish,
  toPayload: toBlockPayload,
  unavailable: "The objective-block library is unavailable.",
};

const MUTATION_CLIENT: DefinitionClient<
  MutationBlockPayloadSchema,
  MutationBlockPayloadSchema,
  MutationBlockPreviewResponse
> = {
  getDraft: mutationBlocks.getDraft,
  previewDraft: mutationBlocks.previewDraft,
  replaceDraft: mutationBlocks.replaceDraft,
  publish: mutationBlocks.publish,
  toPayload: toBlockPayload,
  unavailable: "The mutation-block library is unavailable.",
};

const SEVERITIES = optionsOf(OBJECTIVE_SEVERITY);

function BlockEditor<
  PayloadT extends BlockPayload,
  PreviewT extends ObjectiveBlockPreviewResponse | MutationBlockPreviewResponse,
>({
  blockId,
  client,
  listing,
  noun,
  backLabel,
  typeAxis,
  publishedNote,
}: {
  blockId: string;
  client: DefinitionClient<PayloadT, PayloadT, PreviewT>;
  /** The library index's listing, which prints the row this editor changes (ADR 0056). */
  listing: Listing<BlockSummarySchema>;
  noun: string;
  backLabel: string;
  typeAxis: (content: PayloadT, edit: (next: PayloadT) => void) => ReactNode;
  publishedNote: string;
}) {
  const publishReasonsId = useId();
  const editor = useDefinitionEditor(blockId, client, {
    label: `The ${noun} draft has unsaved changes.`,
    // Declared on the editor rather than on the button, because the navigation prompt saves
    // this draft too.
    afterSave: listing.refresh,
  });
  const { content, preview, edit } = editor;
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

  if (editor.loading) {
    return <p className="text-sm text-admin-muted">Loading {noun}…</p>;
  }

  if (!content) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {editor.error ?? `This ${noun} could not be loaded.`}
      </div>
    );
  }

  const bound = shopBoundCount(content);

  return (
    <>
      <PageHeader
        title={content.name}
        chips={<VersionChips preview={preview} />}
        // The line says what no row below does: the draft's fingerprint. The statement is the
        // Statement row's own value.
        back={{
          to: "..",
          label: backLabel,
          kind: noun,
          detail: preview ? (
            <>
              draft fingerprint <Fingerprint value={preview.content_fingerprint} />
            </>
          ) : null,
        }}
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
              onRefusedPress={editor.publishTouch.touch}
              onPublish={() => {
                // A frozen version is printed by the library index this editor was opened
                // from, and that index renders the shell's listing (ADR 0056).
                void editor.publish().then((version) => {
                  setPublishedVersion(version);
                  if (version !== null) {
                    void listing.refresh();
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
                Published version {publishedVersion}. {publishedNote}
              </p>
            ) : null}
            <PublishReasons
              id={publishReasonsId}
              preview={preview}
              dirty={editor.dirty}
              checking={editor.checking}
              touched={editor.publishTouch.touched}
            />
          </>
        }
        sticky
      />

      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>
          <Card title="Template">
            <FieldRows>
              <Field label="Name">
                <input
                  maxLength={SLUG_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full font-mono`}
                  value={content.name}
                  onChange={(event) => edit({ ...content, name: event.target.value })}
                />
              </Field>
              {/* The sentence the card carried under this field, moved beside it and not
                  rewritten: the scenario editor titles each composed instance with the
                  template's statement, and `domain/blocks.py` refuses an empty one at
                  publication for that reason. */}
              <Field
                label="Statement"
                hint="A scenario renders each bound instance as this statement followed by what it was bound to — “Read document → Address-change policy”."
              >
                <input
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  value={content.statement}
                  placeholder="Read document"
                  onChange={(event) => edit({ ...content, statement: event.target.value })}
                />
              </Field>
              <Field label="Description">
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${textAreaClasses} w-full`}
                  value={content.description}
                  onChange={(event) => edit({ ...content, description: event.target.value })}
                />
              </Field>
            </FieldRows>
          </Card>

          {typeAxis(content, edit)}

          <Card
            title="Parameters"
            description={
              bound === 0
                ? "No parameter points at a shop object, so this template binds the same way in every shop."
                : `${bound} parameter(s) must be bound to objects in the scenario's own shop. A template never names one itself.`
            }
          >
            <TemplateParameters blockId={blockId} content={content} edit={edit} />
          </Card>
        </div>

        <div className={editorPanelClasses}>
          <GateCard title="Publish gate" busy={editor.checking} dirty={editor.dirty}>
            <IssueList issues={preview?.issues ?? []} />
          </GateCard>
          <Card title="Used by">
            <p className="text-[13px] text-admin-muted">
              A published scenario pins the exact template version it composed, so editing here
              always happens in a new draft and never reaches a scenario that already froze this
              block. A cross-shop usage roll-up arrives with the experiment surfaces that need it.
            </p>
          </Card>
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

const PARAMETER_WORDS: ItemFormWords = {
  form: "Parameters",
  entry: "a parameter",
  record: "draft",
};

/**
 * The checkbox writes `required`, which `check_bindings` (`domain/blocks.py`) holds a scenario to
 * only while the template gives no default: a required parameter with one may be left unbound.
 */
const REQUIRED_LABEL = "A scenario must bind this, unless the template gives a default";

const PARAMETER_LABEL_HINT = "The name a scenario binds. Saved as a snake_case identifier.";

const PARAMETER_FIXED_HINT =
  "Saved as this identifier when the parameter was added. A scenario binds by it, so it is fixed.";

/** The pill beside a parameter whose binding must resolve inside the scenario's own shop. */
function BoundSameShop() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
      <span aria-hidden>⌖</span> bound same-shop
    </span>
  );
}

/**
 * What a parameter's item says under its name: the description, the default where its kind
 * carries one, and how a scenario binds it — each its own phrase on the one detail line.
 */
function ParameterDetail({ parameter }: { parameter: BlockParameterSchema }) {
  const literal = acceptsDefault(parameter.kind);
  return (
    <>
      {parameter.description ? (
        <span>{parameter.description}</span>
      ) : (
        <span>No description yet — a scenario binding it is told nothing.</span>
      )}
      {literal ? (
        <>
          {" · "}
          <span>
            Default:{" "}
            {parameter.default === null ? (
              "none"
            ) : parameter.kind === "severity" ? (
              labelOf(OBJECTIVE_SEVERITY, parameter.default as ObjectiveSeverity)
            ) : (
              <code className="font-mono text-[12px]">{parameter.default}</code>
            )}
          </span>
        </>
      ) : null}
      {" · "}
      <span>{bindingSentence(parameter)}</span>
    </>
  );
}

/**
 * A template's parameters, as items, and the one form that adds a parameter or edits the one
 * chosen (ADR 0074). The order is authored — it is the order a scenario binds in — so ↑ and ↓
 * stay on the item, before the pencil, and stay free while the form edits another parameter.
 * The name is fixed while editing, because a scenario binds by it.
 */
function TemplateParameters<PayloadT extends BlockPayload>({
  blockId,
  content,
  edit,
}: {
  blockId: string;
  content: PayloadT;
  edit: (next: PayloadT) => void;
}) {
  const parameters = content.parameters;
  const names = parameters.map((parameter) => parameter.name);
  const parameterOf = (name: string) =>
    parameters.find((parameter) => parameter.name === name) as BlockParameterSchema;
  const form = useItemForm<ParameterFormFields>({
    blank: BLANK_PARAMETER,
    ids: names,
    words: PARAMETER_WORDS,
    nameOf: (name) => name,
    formOf: (name) => parameterFormFields(parameterOf(name)),
    typedOf: (fields) => fields.label,
  });
  const removal = useRemoval(blockId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const kindSelect = useRef<HTMLSelectElement>(null);
  const reasonId = useId();
  const findingId = useId();
  const refusal = parameterRefusal(form.fields, parameters.length, form.editing);
  // A blank form is refused and says why; a field is marked by it only once the form is
  // touched, when the line says it at the validation weight (ADR 0078).
  const touched = form.touch.touched;
  const identifier = uniqueParameterName(toIdentifier(form.fields.label), names);
  const literal = acceptsDefault(form.fields.kind);
  // The gate's `optional_parameter_without_default`, said under the checkbox while the form holds
  // it: a finding and not a refusal, so *Save changes* and *Add parameter* still write it.
  // A parameter being added has no name until a label is typed, so the finding, which names it,
  // waits for one rather than naming the fallback identifier.
  const findingName = form.editing ?? (pythonStrip(form.fields.label) === "" ? null : identifier);
  const finding: string | null =
    findingName !== null && !form.fields.required && form.fields.default === null
      ? optionalParameterWithoutDefaultRule(findingName, literal)
      : null;
  const optionalWithoutDefault = finding !== null;
  // A reference is always required once the form has chosen its kind (`retypedFields`), so the
  // checkbox is not drawn for one. A draft authored through the API can still hold a reference
  // that is not, which the gate refuses with "make it required" — and an edit writes what the
  // draft held while the kind is unchanged. So the one reference the form asks about is that
  // one: opened with its kind kept and not required as saved, the checkbox stands while the
  // form is open, so ticking it does not take away the control that had focus.
  const savedEntry =
    form.editing === null
      ? undefined
      : parameters.find((parameter) => parameter.name === form.editing);
  const optionalReference =
    !literal &&
    savedEntry !== undefined &&
    savedEntry.kind === form.fields.kind &&
    !savedEntry.required;
  const requiredCheckbox = (
    <div className="col-span-full grid gap-1">
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={form.fields.required}
          aria-describedby={optionalWithoutDefault ? findingId : undefined}
          aria-invalid={optionalWithoutDefault || undefined}
          onChange={(event) => form.update({ required: event.target.checked })}
        />
        {REQUIRED_LABEL}
      </label>
      <GateFindingLine id={findingId}>{finding}</GateFindingLine>
    </div>
  );

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      // An edit that changed nothing writes nothing, so the draft stays as clean as it was.
      if (form.dirty) {
        edit(replaceParameter(content, editing, form.fields));
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      edit({ ...content, parameters: withParameter(parameters, form.fields.label, form.fields) });
    }
    form.reset();
  }

  function cancel() {
    const editing = form.editing;
    form.reset();
    if (editing !== null) {
      focusAfterCommit(() => editButtons.get(editing));
    }
  }

  return (
    <FieldRows>
      <FieldGroup
        label="Typed parameters"
        hint="A scenario binds them in this order; ↑ and ↓ move one."
      >
        <div className="grid gap-2">
          {parameters.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {parameters.map((parameter, index) => {
                const notice = `Removed the parameter ${parameter.name} from the draft.`;
                // A mutation is injected at a bound moment, so its only timing parameter is
                // one `validate_mutation_block` refuses to lose.
                const lastTiming =
                  "effect" in content &&
                  parameter.kind === "timing" &&
                  parameters.filter((entry) => entry.kind === "timing").length === 1;
                const drop = () => edit(removeParameter(content, parameter.name));
                if (removal.isArmed(parameter.name)) {
                  return (
                    <ConfirmRemove
                      key={parameter.name}
                      as="li"
                      title={`Remove the parameter ${parameter.name}?`}
                      consequence={consequenceOf(
                        "Its description, its default and whether it is required go with it, and a scenario composing the next published version has nothing to bind under this name.",
                        findingClauses([lastTiming && "mutation_without_timing"]),
                        "Nothing is written until you save the draft, and a published version — and every scenario that pinned one — keeps it.",
                      )}
                      onConfirm={removal.confirm(drop, notice)}
                      onKeep={removal.keep}
                    />
                  );
                }
                const itemFinding = !parameter.required && parameter.default === null;
                return (
                  <ListItem
                    key={parameter.name}
                    name={parameter.name}
                    monospace
                    tag={
                      <>
                        <EntryKind value={labelOf(BLOCK_PARAMETER_KIND, parameter.kind)} />
                        {bindsShopObject(parameter.kind) ? <BoundSameShop /> : null}
                      </>
                    }
                    detail={
                      <>
                        <ParameterDetail parameter={parameter} />
                        {/* The gate's finding, said on the item that holds it, as it was on the
                            closed row (ADR 0063's lab amendment). */}
                        {itemFinding ? (
                          <div className="mt-1">
                            <GateFindingLine id={`${findingId}-${index}`}>
                              {optionalParameterWithoutDefaultRule(
                                parameter.name,
                                acceptsDefault(parameter.kind),
                              )}
                            </GateFindingLine>
                          </div>
                        ) : null}
                      </>
                    }
                    editing={form.editing === parameter.name}
                  >
                    <MoveButton
                      name={parameter.name}
                      direction="up"
                      disabled={index === 0}
                      onMove={() => edit(moveParameter(content, parameter.name, -1))}
                    />
                    <MoveButton
                      name={parameter.name}
                      direction="down"
                      disabled={index === parameters.length - 1}
                      onMove={() => edit(moveParameter(content, parameter.name, 1))}
                    />
                    <EditButton
                      name={parameter.name}
                      buttonRef={editButtons.ref(parameter.name)}
                      onEdit={() => {
                        form.begin(parameter.name, parameterFormFields(parameter));
                        // The name is fixed while editing, so the first field asked is the kind.
                        focusAfterCommit(() => kindSelect.current);
                      }}
                    />
                    <RemoveButton
                      name={parameter.name}
                      entryKey={parameter.name}
                      removal={removal}
                      notice={notice}
                      onRemove={drop}
                    />
                  </ListItem>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-admin-muted">
              No parameter yet. A template with none can only be bound one way, which is a
              legitimate design for a rule that applies everywhere.
            </p>
          )}
          <RemovalNotice removal={removal} />
        </div>
      </FieldGroup>
      <ItemFormRow
        title={formTitle(form.editing, (name) => name, PARAMETER_WORDS.entry)}
        hint="The kind, description, default and binding can change later; the identifier is fixed once the parameter is added."
        editing={form.editing !== null}
        addLabel="Add parameter"
        refusal={refusal}
        reasonId={reasonId}
        touch={form.touch}
        onSubmit={submit}
        onCancel={cancel}
      >
        {form.editing !== null ? (
          <FixedKeyField label="Label" hint={PARAMETER_FIXED_HINT} value={form.fields.label} />
        ) : (
          <FieldHint
            label="Label"
            hint={PARAMETER_LABEL_HINT}
            extra={pythonStrip(form.fields.label) ? savedAsPreview(identifier) : undefined}
          >
            <input
              className={`${fieldControlClasses} w-full`}
              value={form.fields.label}
              placeholder="Document"
              {...refusedProps(refusal, "label", reasonId, touched)}
              onChange={(event) => form.update({ label: event.target.value })}
            />
          </FieldHint>
        )}
        <FieldHint label="Kind">
          <select
            ref={kindSelect}
            className={`${fieldControlClasses} w-full`}
            value={form.fields.kind}
            onChange={(event) =>
              form.update(retypedFields(form.fields, event.target.value as BlockParameterKind))
            }
          >
            {PARAMETER_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </select>
        </FieldHint>
        <div className="col-span-full">
          <FieldHint label="Description" optional>
            <input
              maxLength={TEXT_MAX_LENGTH}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.description}
              onChange={(event) => form.update({ description: event.target.value })}
            />
          </FieldHint>
        </div>
        {literal ? (
          <>
            <FieldHint label="Default" optional>
              {form.fields.kind === "severity" ? (
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={form.fields.default ?? ""}
                  aria-describedby={optionalWithoutDefault ? findingId : undefined}
                  onChange={(event) => form.update({ default: event.target.value || null })}
                >
                  <option value="">No default</option>
                  {SEVERITIES.map((severity) => (
                    <option key={severity.value} value={severity.value}>
                      {severity.option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  value={form.fields.default ?? ""}
                  placeholder={form.fields.kind === "timing" ? "after_first_read" : "PT30S"}
                  aria-describedby={optionalWithoutDefault ? findingId : undefined}
                  onChange={(event) => form.update({ default: event.target.value || null })}
                />
              )}
            </FieldHint>
            {requiredCheckbox}
          </>
        ) : optionalReference ? (
          requiredCheckbox
        ) : (
          // A template that defaulted a reference would hand one shop's object to every other
          // shop, so the field is absent rather than present and refused.
          <p className="col-span-full text-xs text-admin-muted">
            A parameter that names an object is always bound by the scenario, and a template cannot
            default it.
          </p>
        )}
      </ItemFormRow>
    </FieldRows>
  );
}

export function ObjectiveBlockEditorPage() {
  const { blockId = "" } = useParams();
  const { listings } = useLabWorkspace();
  return (
    <BlockEditor
      blockId={blockId}
      client={OBJECTIVE_CLIENT}
      listing={listings.objectiveBlocks}
      noun="objective block"
      backLabel="Objective blocks"
      publishedNote="A scenario binds this exact version."
      typeAxis={(content, edit) => (
        <Card
          title="Assessment"
          description={
            <>
              Objective order in a scenario is priority, not a script, so an objective never says
              when it applies — only mutations sit on the run timeline.
            </>
          }
        >
          <FieldRows>
            {/* A judged objective has no evidence to choose, so what it is scored on is the
                assessment's second line rather than a row of its own. Each claim is the lab's:
                the judge is shown the anonymized brief (`JudgeRequest`,
                `application/judge_runtime.py:95`), a pass freezes the judge's published version
                (`application/judge_runs.py:13`), and a rerun appends an attempt beside the last
                (`application/judgements.py:9`). */}
            <Field
              label="Assessed by"
              extra={
                content.assessment === "judge"
                  ? "A judged objective is scored on a rubric dimension. Judge evidence is anonymized, versioned, and rerunnable, and is recorded separately from deterministic evidence."
                  : null
              }
            >
              <select
                className={`${fieldControlClasses} w-full`}
                value={content.assessment}
                onChange={(event) => {
                  const assessment = event.target.value as ObjectiveAssessment;
                  // A judge scores a rubric dimension and nothing else, and `evidenceFor` is
                  // where that pairing is decided for both this editor and the create page.
                  edit({
                    ...content,
                    assessment,
                    evidence: evidenceFor(assessment, content.evidence),
                  });
                }}
              >
                {ASSESSMENTS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            {content.assessment === "judge" ? null : (
              <Field label="Evidence">
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.evidence}
                  onChange={(event) =>
                    edit({ ...content, evidence: event.target.value as ObjectiveEvidence })
                  }
                >
                  {DETERMINISTIC_EVIDENCE.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </FieldRows>
        </Card>
      )}
    />
  );
}

export function MutationBlockEditorPage() {
  const { blockId = "" } = useParams();
  const { listings } = useLabWorkspace();
  return (
    <BlockEditor
      blockId={blockId}
      client={MUTATION_CLIENT}
      listing={listings.mutationBlocks}
      noun="mutation block"
      backLabel="Mutation blocks"
      publishedNote="A scenario binds this exact version."
      typeAxis={(content, edit) => (
        <Card
          title="Effect"
          description={
            <>
              Mutation order in a scenario is the run timeline, so a published mutation declares
              exactly one timing parameter. The agent never sees the injection — only its
              consequences.
            </>
          }
        >
          <FieldRows>
            <Field label="Perturbs">
              <select
                className={`${fieldControlClasses} w-full`}
                value={content.effect}
                onChange={(event) =>
                  edit({ ...content, effect: event.target.value as MutationEffect })
                }
              >
                {EFFECTS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
          </FieldRows>
        </Card>
      )}
    />
  );
}
