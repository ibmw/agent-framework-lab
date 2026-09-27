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
} from "@agent-lab/contracts";
import { type ReactNode, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { mutationBlocks, objectiveBlocks } from "../api/blocks";
import { ButtonIcon } from "../components/ButtonIcon";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { GateFindingLine } from "../components/GateFindingLine";
import { ParameterForm } from "../components/ParameterForm";
import {
  Card,
  EditorSaveActions,
  Fingerprint,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import {
  ASSESSMENTS,
  acceptsDefault,
  addParameter,
  type BlockPayload,
  bindsShopObject,
  DETERMINISTIC_EVIDENCE,
  EFFECTS,
  evidenceFor,
  MAX_PARAMETERS,
  moveParameter,
  PARAMETER_KINDS,
  removeParameter,
  retypeParameter,
  shopBoundCount,
  updateParameter,
} from "../lib/blocks";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { OBJECTIVE_SEVERITY, optionsOf } from "../lib/enumLabels";
import { optionalParameterWithoutDefaultRule } from "../lib/fieldRules";
import { consequenceOf, findingClauses, type Removal, useRemoval } from "../lib/removal";
import {
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  subtleButtonClasses,
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
  const parameterRemoval = useRemoval(blockId);
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
            <PublishButton
              preview={preview}
              dirty={editor.dirty}
              publishing={editor.publishing}
              reasonsId={publishReasonsId}
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
      />

      {editor.error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {editor.error}
        </p>
      ) : null}
      <PublishReasons
        id={publishReasonsId}
        className="mb-4 grid gap-1"
        preview={preview}
        dirty={editor.dirty}
      />
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
                    removal={parameterRemoval}
                    // A mutation is injected at a bound moment, so its only timing parameter
                    // is one `validate_mutation_block` refuses to lose.
                    lastTiming={
                      "effect" in content &&
                      parameter.kind === "timing" &&
                      content.parameters.filter((entry) => entry.kind === "timing").length === 1
                    }
                    onRemove={() => edit(removeParameter(content, parameter.name))}
                  />
                ))}
              </ul>
            )}
            <RemovalNotice removal={parameterRemoval} />
            <ParameterForm
              taken={content.parameters.map((parameter) => parameter.name)}
              onAdd={(name, kind) => edit(addParameter(content, name, kind))}
              full={content.parameters.length >= MAX_PARAMETERS}
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
  removal,
  lastTiming,
  onRemove,
}: {
  parameter: BlockParameterSchema;
  isFirst: boolean;
  isLast: boolean;
  onRetype: (kind: BlockParameterKind) => void;
  onUpdate: (next: Partial<BlockParameterSchema>) => void;
  onMove: (direction: -1 | 1) => void;
  /** The list's second press (ADR 0060). */
  removal: Removal;
  lastTiming: boolean;
  onRemove: () => void;
}) {
  const literal = acceptsDefault(parameter.kind);
  // The gate's `optional_parameter_without_default`, said beside the checkbox that raises it.
  // A finding and not a refusal — `BlockParameter` stores it and publication refuses it — so it
  // refuses no save: it is said, on the checkbox and on the default that would clear it.
  const findingId = useId();
  const optionalWithoutDefault = !parameter.required && parameter.default === null;

  if (removal.isArmed(parameter.name)) {
    return (
      <ConfirmRemove
        as="li"
        title={`Remove the parameter ${parameter.name}?`}
        consequence={consequenceOf(
          "Its description, its default and whether it is required go with it, and a scenario composing the next published version has nothing to bind under this name.",
          findingClauses([lastTiming && "mutation_without_timing"]),
          "Nothing is written until you save the draft, and a published version — and every scenario that pinned one — keeps it.",
        )}
        onConfirm={removal.confirm(
          onRemove,
          `Removed the parameter ${parameter.name} from the draft.`,
        )}
        onKeep={removal.keep}
      />
    );
  }

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
            ref={removal.trigger(parameter.name)}
            onClick={removal.ask(
              parameter.name,
              onRemove,
              `Removed the parameter ${parameter.name} from the draft.`,
            )}
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
                aria-describedby={optionalWithoutDefault ? findingId : undefined}
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
                aria-describedby={optionalWithoutDefault ? findingId : undefined}
                className={fieldControlClasses}
                value={parameter.default ?? ""}
                placeholder={parameter.kind === "timing" ? "after_first_read" : "PT30S"}
                onChange={(event) => onUpdate({ default: event.target.value || null })}
              />
            )}
          </div>
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={parameter.required}
                aria-describedby={optionalWithoutDefault ? findingId : undefined}
                aria-invalid={optionalWithoutDefault || undefined}
                onChange={(event) => onUpdate({ required: event.target.checked })}
              />
              A scenario must bind this
            </label>
            <GateFindingLine id={findingId}>
              {optionalWithoutDefault
                ? optionalParameterWithoutDefaultRule(parameter.name, literal)
                : null}
            </GateFindingLine>
          </div>
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
        <Card title="Assessment">
          <label className={fieldLabelClasses}>
            Assessed by
            <select
              aria-label="Assessed by"
              className={fieldControlClasses}
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
