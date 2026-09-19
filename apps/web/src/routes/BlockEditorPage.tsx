import type {
  BlockParameterKind,
  BlockParameterSchema,
  MutationBlockPayloadSchema,
  MutationBlockPreviewResponse,
  MutationEffect,
  ObjectiveAssessment,
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPreviewResponse,
  ObjectiveEvidence,
} from "@agent-lab/contracts";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { mutationBlocks, objectiveBlocks } from "../api/blocks";
import { ButtonIcon } from "../components/ButtonIcon";
import { savedAsPreview } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import {
  Card,
  canPublish,
  EditorSaveActions,
  Fingerprint,
  IssueList,
  PageHeader,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import {
  acceptsDefault,
  addParameter,
  type BlockPayload,
  bindsShopObject,
  MAX_PARAMETERS,
  moveParameter,
  PARAMETER_KINDS,
  removeParameter,
  retypeParameter,
  shopBoundCount,
  toIdentifier,
  uniqueParameterName,
  updateParameter,
} from "../lib/blocks";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { OBJECTIVE_SEVERITY, optionsOf } from "../lib/enumLabels";
import {
  accentButtonClasses,
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  inkButtonClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";

const OBJECTIVE_CLIENT: DefinitionClient<
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPayloadSchema,
  ObjectiveBlockPreviewResponse
> = {
  getDraft: objectiveBlocks.getDraft,
  previewDraft: objectiveBlocks.previewDraft,
  replaceDraft: objectiveBlocks.replaceDraft,
  publish: objectiveBlocks.publish,
  // `shop_bound` is the server's derived echo of the kind, so the content is the payload.
  toPayload: (content) => content,
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
  toPayload: (content) => content,
  unavailable: "The mutation-block library is unavailable.",
};

const ASSESSMENTS: { value: ObjectiveAssessment; label: string }[] = [
  { value: "deterministic", label: "Deterministic — an encoded rule decides" },
  { value: "judge", label: "Judge — an LLM scores a rubric dimension" },
];

const DETERMINISTIC_EVIDENCE: { value: ObjectiveEvidence; label: string }[] = [
  { value: "event", label: "Event — a recorded tool call or read" },
  { value: "policy", label: "Policy — an encoded rule over state and events" },
  { value: "state", label: "State — the sandbox the run ended in" },
  { value: "forbidden", label: "Forbidden — something that must never occur" },
];

const EFFECTS: { value: MutationEffect; label: string }[] = [
  { value: "entity_mutation", label: "Entity mutation — an out-of-band write bumps a version" },
  { value: "tool_fault", label: "Tool fault — a tool fails or times out" },
  { value: "clock_shift", label: "Clock shift — sandbox time jumps forward" },
  { value: "service_outage", label: "Service outage — a dependency is unavailable" },
];

const SEVERITIES = optionsOf(OBJECTIVE_SEVERITY);

function BlockEditor<
  PayloadT extends BlockPayload,
  PreviewT extends ObjectiveBlockPreviewResponse | MutationBlockPreviewResponse,
>({
  blockId,
  client,
  noun,
  backLabel,
  typeAxis,
  publishedNote,
}: {
  blockId: string;
  client: DefinitionClient<PayloadT, PayloadT, PreviewT>;
  noun: string;
  backLabel: string;
  typeAxis: (content: PayloadT, edit: (next: PayloadT) => void) => ReactNode;
  publishedNote: string;
}) {
  const editor = useDefinitionEditor(blockId, client, {
    label: `The ${noun} draft has unsaved changes.`,
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
        description={
          <>
            <Link className="font-semibold text-lab-ink" to=".." relative="path">
              {backLabel}
            </Link>{" "}
            · {content.statement || "No statement yet"}
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
            <EditorSaveActions
              dirty={editor.dirty}
              saving={editor.saving}
              discarding={editor.discarding}
              onSave={() => void editor.save()}
              onDiscard={() => void editor.discard()}
            />
            <button
              className={accentButtonClasses}
              type="button"
              onClick={() => {
                void editor.publish().then((version) => setPublishedVersion(version));
              }}
              disabled={editor.publishing || !canPublish(preview, editor.dirty)}
            >
              <ButtonIcon verb="publish" />
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
          Published version {publishedVersion}. {publishedNote}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4">
          <Card title="Template">
            <label className={fieldLabelClasses}>
              Name
              <input
                className={`${fieldControlClasses} font-mono`}
                value={content.name}
                onChange={(event) => edit({ ...content, name: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Statement
              <input
                className={fieldControlClasses}
                value={content.statement}
                placeholder="Read document"
                onChange={(event) => edit({ ...content, statement: event.target.value })}
              />
            </label>
            <p className="text-xs text-admin-muted">
              A scenario renders each bound instance as this statement followed by what it was bound
              to — “Read document → Address-change policy”.
            </p>
            <label className={fieldLabelClasses}>
              Description
              <textarea
                className={textAreaClasses}
                value={content.description}
                onChange={(event) => edit({ ...content, description: event.target.value })}
              />
            </label>
          </Card>

          {typeAxis(content, edit)}

          <Card
            title="Parameters"
            footer={
              <p className="text-xs text-admin-muted">
                {bound === 0
                  ? "No parameter points at a shop object, so this template binds the same way in every shop."
                  : `${bound} parameter(s) must be bound to objects in the scenario's own shop. A template never names one itself.`}
              </p>
            }
          >
            {content.parameters.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No parameter yet. A template with none can only be bound one way, which is a
                legitimate design for a rule that applies everywhere.
              </p>
            ) : (
              <ul className="grid gap-3">
                {content.parameters.map((parameter, index) => (
                  <ParameterRow
                    key={parameter.name}
                    parameter={parameter}
                    isFirst={index === 0}
                    isLast={index === content.parameters.length - 1}
                    onRetype={(kind) => edit(retypeParameter(content, parameter.name, kind))}
                    onUpdate={(next) => edit(updateParameter(content, parameter.name, next))}
                    onMove={(direction) => edit(moveParameter(content, parameter.name, direction))}
                    onRemove={() => edit(removeParameter(content, parameter.name))}
                  />
                ))}
              </ul>
            )}
            <ParameterForm
              taken={content.parameters.map((parameter) => parameter.name)}
              onAdd={(name, kind) => edit(addParameter(content, name, kind))}
              disabled={content.parameters.length >= MAX_PARAMETERS}
            />
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
          <Card title="Used by">
            <p className="text-[13px] text-admin-muted">
              A published scenario pins the exact template version it composed, so editing here
              always happens in a new draft and never reaches a scenario that already froze this
              block. A cross-shop usage roll-up arrives with the experiment surfaces that need it.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function ParameterRow({
  parameter,
  isFirst,
  isLast,
  onRetype,
  onUpdate,
  onMove,
  onRemove,
}: {
  parameter: BlockParameterSchema;
  isFirst: boolean;
  isLast: boolean;
  onRetype: (kind: BlockParameterKind) => void;
  onUpdate: (next: Partial<BlockParameterSchema>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const literal = acceptsDefault(parameter.kind);

  return (
    <li className="grid gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-[13px] font-semibold text-lab-ink">{parameter.name}</code>
        {bindsShopObject(parameter.kind) ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
            <span aria-hidden>⌖</span> bound same-shop
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            className={subtleButtonClasses}
            type="button"
            aria-label={`Move ${parameter.name} up`}
            disabled={isFirst}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            className={subtleButtonClasses}
            type="button"
            aria-label={`Move ${parameter.name} down`}
            disabled={isLast}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            className={destructiveSubtleButtonClasses}
            type="button"
            aria-label={`Remove ${parameter.name}`}
            onClick={onRemove}
          >
            <ButtonIcon verb="delete" />
            Remove
          </button>
        </div>
      </div>

      <label className={fieldLabelClasses}>
        Kind
        <select
          aria-label={`Kind of ${parameter.name}`}
          className={fieldControlClasses}
          value={parameter.kind}
          onChange={(event) => onRetype(event.target.value as BlockParameterKind)}
        >
          {PARAMETER_KINDS.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>

      <label className={fieldLabelClasses}>
        Description
        <input
          aria-label={`Description of ${parameter.name}`}
          className={fieldControlClasses}
          value={parameter.description}
          onChange={(event) => onUpdate({ description: event.target.value })}
        />
      </label>

      {literal ? (
        <>
          {/* A div, not a label: the control is chosen in a branch, so a wrapping label has
              no resolvable control. Each branch names itself instead. */}
          <div className={fieldLabelClasses}>
            <span>Default</span>
            {parameter.kind === "severity" ? (
              <select
                aria-label={`Default of ${parameter.name}`}
                className={fieldControlClasses}
                value={parameter.default ?? ""}
                onChange={(event) => onUpdate({ default: event.target.value || null })}
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
                aria-label={`Default of ${parameter.name}`}
                className={fieldControlClasses}
                value={parameter.default ?? ""}
                placeholder={parameter.kind === "timing" ? "after_first_read" : "PT30S"}
                onChange={(event) => onUpdate({ default: event.target.value || null })}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={parameter.required}
              onChange={(event) => onUpdate({ required: event.target.checked })}
            />
            A scenario must bind this
          </label>
        </>
      ) : (
        // A template that defaulted a reference would hand one shop's object to every other
        // shop, so the field is absent rather than present and refused.
        <p className="text-xs text-admin-muted">
          A parameter that names an object is always bound by the scenario, and a template cannot
          default it.
        </p>
      )}
    </li>
  );
}

function ParameterForm({
  taken,
  onAdd,
  disabled,
}: {
  taken: readonly string[];
  onAdd: (name: string, kind: BlockParameterKind) => void;
  disabled: boolean;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<BlockParameterKind>("document_reference");
  const identifier = uniqueParameterName(toIdentifier(label), taken);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAdd(label, kind);
    setLabel("");
  }

  return (
    <form className="flex flex-wrap items-end gap-2" aria-label="Add a parameter" onSubmit={submit}>
      <div className="min-w-40 flex-1">
        <FieldHint
          label="Label"
          hint="The name a scenario binds. Saved as a snake_case identifier."
          extra={label ? savedAsPreview(identifier) : undefined}
        >
          <input
            className={fieldControlClasses}
            value={label}
            required
            placeholder="Document"
            onChange={(event) => setLabel(event.target.value)}
          />
        </FieldHint>
      </div>
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Kind
        {/* Named explicitly: a wrapping label around a select carries every option's text in
            its own text content, so the control needs its own name to be addressable. */}
        <select
          aria-label="Kind"
          className={fieldControlClasses}
          value={kind}
          onChange={(event) => setKind(event.target.value as BlockParameterKind)}
        >
          {PARAMETER_KINDS.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <button className={inkButtonClasses} type="submit" disabled={disabled}>
        <ButtonIcon verb="create" />
        Add parameter
      </button>
    </form>
  );
}

export function ObjectiveBlockEditorPage() {
  const { blockId = "" } = useParams();
  return (
    <BlockEditor
      blockId={blockId}
      client={OBJECTIVE_CLIENT}
      noun="objective block"
      backLabel="Objective blocks"
      publishedNote="A scenario binds this exact version."
      typeAxis={(content, edit) => (
        <Card title="Assessment">
          <label className={fieldLabelClasses}>
            Assessed by
            <select
              aria-label="Assessed by"
              className={fieldControlClasses}
              value={content.assessment}
              onChange={(event) => {
                const assessment = event.target.value as ObjectiveAssessment;
                // A judge scores a rubric dimension and nothing else, so the editor moves the
                // evidence with it rather than leaving a pairing the publish gate refuses.
                edit({
                  ...content,
                  assessment,
                  evidence:
                    assessment === "judge"
                      ? "dimension"
                      : content.evidence === "dimension"
                        ? "event"
                        : content.evidence,
                });
              }}
            >
              {ASSESSMENTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          {content.assessment === "judge" ? (
            <p className="text-[13px] text-admin-ink-soft">
              A judged objective is scored on a rubric dimension. Judge evidence is anonymized,
              versioned, and rerunnable, and is recorded separately from deterministic evidence.
            </p>
          ) : (
            <label className={fieldLabelClasses}>
              Evidence
              <select
                aria-label="Evidence"
                className={fieldControlClasses}
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
            </label>
          )}
          <p className="text-xs text-admin-muted">
            Objective order in a scenario is priority, not a script, so an objective never says when
            it applies — only mutations sit on the run timeline.
          </p>
        </Card>
      )}
    />
  );
}

export function MutationBlockEditorPage() {
  const { blockId = "" } = useParams();
  return (
    <BlockEditor
      blockId={blockId}
      client={MUTATION_CLIENT}
      noun="mutation block"
      backLabel="Mutation blocks"
      publishedNote="A scenario binds this exact version."
      typeAxis={(content, edit) => (
        <Card title="Effect">
          <label className={fieldLabelClasses}>
            Perturbs
            <select
              aria-label="Perturbs"
              className={fieldControlClasses}
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
          </label>
          <p className="text-xs text-admin-muted">
            Mutation order in a scenario is the run timeline, so a published mutation declares
            exactly one timing parameter. The agent never sees the injection — only its
            consequences.
          </p>
        </Card>
      )}
    />
  );
}
