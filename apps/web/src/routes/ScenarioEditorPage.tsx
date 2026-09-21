import type {
  BlockParameterSchema,
  BoundMutationSchema,
  BoundObjectiveSchema,
  ObjectiveSeverity,
  ScenarioBlockOptionSchema,
  ScenarioContentSchema,
  ScenarioPreviewResponse,
  ScenarioResolutionSchema,
  ScenarioResourcesSchema,
} from "@agent-lab/contracts";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  getScenarioDraft,
  getScenarioResources,
  previewScenarioDraft,
  publishScenario,
  replaceScenarioDraft,
} from "../api/scenarios";
import { ButtonIcon } from "../components/ButtonIcon";
import {
  Card,
  EditorSaveActions,
  Fingerprint,
  IssueList,
  PageHeader,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { canPublish, type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { OBJECTIVE_SEVERITY, optionsOf } from "../lib/enumLabels";
import {
  addMutation,
  addObjective,
  bindableParameters,
  boundValue,
  dataFieldsFor,
  documentCollectionLabel,
  documentKey,
  documentToolName,
  findOption,
  MAX_CONTEXT_DOCUMENTS,
  MAX_MUTATIONS,
  MAX_OBJECTIVES,
  MAX_TURN_CAP,
  MIN_TURN_CAP,
  moveMutation,
  moveObjective,
  parseTurnCap,
  readChecksByDocument,
  referenceChoices,
  removeMutation,
  removeObjective,
  retargetDataReference,
  splitDataReference,
  TIMING_CHOICES,
  toggleContextDocument,
  toScenarioRequest,
  updateMutation,
  updateObjective,
  withBinding,
  withCurrentChoice,
} from "../lib/scenarios";
import {
  accentButtonClasses,
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  outlineButtonClasses,
  subtleButtonClasses,
  surfaceClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const UNAVAILABLE = "The scenario workspace is unavailable.";

/**
 * The pickers are loaded beside the draft, and the editor must not confuse "not here yet"
 * with "not there at all": a bound row whose template is still loading is not an orphan, and
 * an empty library is not an unreachable one.
 */
type ResourceState =
  | { status: "loading" }
  | { status: "loaded"; resources: ScenarioResourcesSchema }
  | { status: "failed"; message: string };

/** The option style every explained select in the workspace follows, read from one table. */
const SEVERITIES = optionsOf(OBJECTIVE_SEVERITY);

/**
 * Frame 4: the scenario as a composition surface rather than a set of bespoke forms.
 *
 * Every binding is picked from what this shop actually holds, so the value grammar the
 * backend resolves is written by the editor and never typed by an author. The right rail
 * pairs the publish gate with the resolved state, because "may this be frozen" and "what
 * would it freeze" are one question read together.
 */
export function ScenarioEditorPage() {
  const { shopId, listings } = useShopWorkspace();
  const { scenarioId = "" } = useParams();
  // Memoized on the shop, not rebuilt per render: the client is a dependency of the
  // editor's load effect, and a new object each render would reload the draft forever.
  const client = useMemo<
    DefinitionClient<
      ScenarioContentSchema,
      ReturnType<typeof toScenarioRequest>,
      ScenarioPreviewResponse
    >
  >(
    () => ({
      getDraft: (id, signal) => getScenarioDraft(shopId, id, signal),
      previewDraft: (id, signal) => previewScenarioDraft(shopId, id, signal),
      replaceDraft: (id, payload) => replaceScenarioDraft(shopId, id, payload),
      publish: (id) => publishScenario(shopId, id),
      toPayload: toScenarioRequest,
      unavailable: UNAVAILABLE,
    }),
    [shopId],
  );
  const editor = useDefinitionEditor(scenarioId, client, {
    label: "The scenario draft has unsaved changes.",
    // The Scenarios index prints the row this editor is changing, and it renders the shell's
    // listing rather than reading its own (ADR 0056).
    afterSave: listings.scenarios.refresh,
  });
  const { content, preview, edit: editDraft } = editor;
  const [state, setState] = useState<ResourceState>({ status: "loading" });
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

  // The published-version notice describes the draft as it was frozen, so any edit retires it
  // rather than leaving a green banner over content it no longer describes.
  const edit = useCallback(
    (next: ScenarioContentSchema) => {
      setPublishedVersion(null);
      editDraft(next);
    },
    [editDraft],
  );

  const refreshResources = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        setState({
          status: "loaded",
          resources: await getScenarioResources(shopId, scenarioId, signal),
        });
      } catch (cause: unknown) {
        if (!signal?.aborted) {
          setState({ status: "failed", message: describeApiError(cause, UNAVAILABLE) });
        }
      }
    },
    [shopId, scenarioId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setPublishedVersion(null);
    void refreshResources(controller.signal);
    return () => controller.abort();
  }, [refreshResources]);

  if (editor.loading) {
    return <p className="text-sm text-admin-muted">Loading scenario…</p>;
  }

  if (!content) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {editor.error ?? "This scenario could not be loaded."}
      </div>
    );
  }

  const resolution = preview?.resolution ?? null;
  const resources = state.status === "loaded" ? state.resources : null;
  // Everything that would otherwise read an absent picker list as an empty one.
  const pending = state.status !== "loaded";
  const objectiveOptions = resources?.objective_blocks ?? [];
  const mutationOptions = resources?.mutation_blocks ?? [];
  const readers = readChecksByDocument(content, objectiveOptions);

  return (
    <>
      <PageHeader
        title={content.name}
        chips={<VersionChips preview={preview} />}
        description={
          <>
            <Link className="font-semibold text-lab-ink" to=".." relative="path">
              Scenarios
            </Link>{" "}
            · built on ticket{" "}
            <span className="font-mono">{resolution?.ticket_reference ?? "—"}</span>
            {preview ? (
              <>
                {" "}
                · draft fingerprint <Fingerprint value={preview.content_fingerprint} />
              </>
            ) : null}{" "}
            ·{" "}
            <Link className="font-semibold text-lab-ink" to="snapshots">
              Starting states
            </Link>
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
                // A frozen version is printed by the index this editor was opened from, and
                // that index renders the shell's listing (ADR 0056).
                void editor.publish().then((version) => {
                  setPublishedVersion(version);
                  if (version !== null) {
                    void listings.scenarios.refresh();
                  }
                });
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
      {state.status === "failed" ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-lab-error">
            {state.message} The recipe is readable, but nothing can be bound until this shop's
            objects and the block libraries load.
          </span>
          <button
            className={subtleButtonClasses}
            type="button"
            onClick={() => void refreshResources()}
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="mb-4 grid gap-1">
        <PublishReasons preview={preview} dirty={editor.dirty} />
      </div>
      {publishedVersion !== null ? (
        <p role="status" className="mb-4 text-[13px] text-lab-success">
          Published version {publishedVersion}. It keeps the ticket and template versions it pinned,
          whatever the library does next.{" "}
          <Link className="font-semibold text-lab-ink" to="snapshots">
            Freeze it into starting state
          </Link>{" "}
          to settle the orders it only names.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          <Card title="Recipe">
            <label className={fieldLabelClasses}>
              Name
              <input
                className={fieldControlClasses}
                value={content.name}
                onChange={(event) => edit({ ...content, name: event.target.value })}
              />
            </label>
            <p className="text-[13px] text-admin-ink-soft">
              Built on ticket{" "}
              <span className="font-mono font-semibold">{resolution?.ticket_reference ?? "—"}</span>{" "}
              · {resolution?.ticket_subject ?? "…"} · {resolution?.customer_display_name ?? "…"}
              {resolution === null ? null : (
                <span className="ml-1.5 text-admin-muted">
                  {resolution.ticket_version === null
                    ? "— not published yet"
                    : `— frozen at v${resolution.ticket_version}`}
                </span>
              )}
            </p>
            <p className="text-xs text-admin-muted">
              A scenario never moves off its ticket: the context, bindings, and hidden facts all
              describe the incident it was built on.
            </p>
          </Card>

          <Card
            title="Context documents"
            footer={
              <p className="text-xs text-admin-muted">
                Readable by the agent through tools only. Listing a document here does not make the
                agent read it — a read-check objective is what asserts that, and the read/no-read
                event is recorded evidence either way.
              </p>
            }
          >
            {state.status === "loading" ? (
              <p className="text-[13px] text-admin-muted">Loading this shop's documents…</p>
            ) : resources === null ? (
              <p className="text-[13px] text-admin-muted">
                This shop's documents could not be loaded.
              </p>
            ) : resources.documents.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                This shop configures no policies, guidelines, or FAQ entries yet.
              </p>
            ) : (
              <ul className="grid gap-2">
                {resources.documents.map((document) => {
                  const key = documentKey(document);
                  const listed = content.context_documents.some(
                    (entry) => documentKey(entry) === key,
                  );
                  const reading = readers.get(key) ?? [];
                  return (
                    <li
                      key={document.reference_value}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-2.5 text-[13px]"
                    >
                      <label className="flex items-center gap-2 font-semibold">
                        <input
                          type="checkbox"
                          checked={listed}
                          disabled={
                            !listed && content.context_documents.length >= MAX_CONTEXT_DOCUMENTS
                          }
                          onChange={() =>
                            edit(
                              toggleContextDocument(content, {
                                kind: document.kind,
                                document_id: document.document_id,
                              }),
                            )
                          }
                        />
                        {document.title}
                      </label>
                      <span className="text-admin-muted">
                        {documentCollectionLabel(document.kind)} · read via{" "}
                        <code className="font-mono text-[11.5px]">
                          {documentToolName(document.kind)}
                        </code>
                      </span>
                      {reading.length > 0 ? (
                        <span className="ml-auto rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
                          read-check → objective {reading.join(", ")}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card
            title="Objectives"
            footer={
              <p className="text-xs text-admin-muted">
                Order is priority, not a script: a scenario stays goal-based and never implies a
                scripted conversation. Only mutations sit on the run timeline.
              </p>
            }
          >
            {content.objectives.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No objective yet. A scenario with none asserts nothing, so a run would produce no
                evidence to compare.
              </p>
            ) : (
              <ol className="grid gap-3">
                {content.objectives.map((objective, index) => (
                  <BoundBlockRow
                    key={objective.id}
                    index={index + 1}
                    instance={objective}
                    option={findOption(objectiveOptions, objective.block_id)}
                    resources={resources}
                    pending={pending}
                    isFirst={index === 0}
                    isLast={index === content.objectives.length - 1}
                    onBind={(parameter, value) =>
                      edit(
                        updateObjective(
                          content,
                          objective.id,
                          withBinding(objective, parameter, value),
                        ),
                      )
                    }
                    onMove={(direction) => edit(moveObjective(content, objective.id, direction))}
                    onRemove={() => edit(removeObjective(content, objective.id))}
                  >
                    <label className={fieldLabelClasses}>
                      Severity
                      <select
                        aria-label={`Severity of ${objective.id}`}
                        className={fieldControlClasses}
                        value={objective.severity}
                        onChange={(event) =>
                          edit(
                            updateObjective(content, objective.id, {
                              ...objective,
                              severity: event.target.value as ObjectiveSeverity,
                            }),
                          )
                        }
                      >
                        {SEVERITIES.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {entry.option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </BoundBlockRow>
                ))}
              </ol>
            )}
            <TemplatePicker
              label="Add objective block"
              options={objectiveOptions}
              pending={pending}
              disabled={content.objectives.length >= MAX_OBJECTIVES}
              onAdd={(option) => edit(addObjective(content, option))}
            />
          </Card>

          <Card
            title="Mutations"
            footer={
              <p className="text-xs text-admin-muted">
                Injected into the run's sandbox at a bound moment and never exposed as an agent tool
                — an arm observes the consequence, never the cause. Order is the run timeline, and
                both arms receive the identical schedule.
              </p>
            }
          >
            {content.mutations.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No mutation. The sandbox stays still for the whole run, which is a legitimate
                recipe.
              </p>
            ) : (
              <ol className="grid gap-3">
                {content.mutations.map((mutation, index) => (
                  <BoundBlockRow
                    key={mutation.id}
                    index={index + 1}
                    instance={mutation}
                    option={findOption(mutationOptions, mutation.block_id)}
                    resources={resources}
                    pending={pending}
                    isFirst={index === 0}
                    isLast={index === content.mutations.length - 1}
                    onBind={(parameter, value) =>
                      edit(
                        updateMutation(
                          content,
                          mutation.id,
                          withBinding(mutation, parameter, value),
                        ),
                      )
                    }
                    onMove={(direction) => edit(moveMutation(content, mutation.id, direction))}
                    onRemove={() => edit(removeMutation(content, mutation.id))}
                  />
                ))}
              </ol>
            )}
            <TemplatePicker
              label="Add mutation block"
              options={mutationOptions}
              pending={pending}
              disabled={content.mutations.length >= MAX_MUTATIONS}
              onAdd={(option) => edit(addMutation(content, option))}
            />
          </Card>

          <Card title="Hidden facts — operator only">
            <textarea
              aria-label="Hidden facts"
              className={textAreaClasses}
              value={content.hidden_facts}
              placeholder="What the customer knows, will confirm if asked, and never volunteers."
              onChange={(event) => edit({ ...content, hidden_facts: event.target.value })}
            />
            <p className="text-xs text-admin-muted">
              Never shown to the support agent, never logged, and never traced. It steers whoever
              drives the customer.
            </p>
          </Card>

          <Card title="Completion">
            <label className={fieldLabelClasses}>
              A resolved incident looks like
              <textarea
                className={textAreaClasses}
                value={content.completion.statement}
                placeholder="The order ships to the confirmed address and the customer acknowledges it."
                onChange={(event) =>
                  edit({
                    ...content,
                    completion: { ...content.completion, statement: event.target.value },
                  })
                }
              />
            </label>
            <TurnCapField
              value={content.completion.max_turns}
              onCommit={(max_turns) =>
                edit({ ...content, completion: { ...content.completion, max_turns } })
              }
            />
            <p className="text-xs text-admin-muted">
              The statement is what the operator and, later, the judge read. The cap is the hard
              stop that guarantees a run terminates — both arms are bounded identically.
            </p>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Resolved-state preview">
            {resolution === null ? (
              <p className="text-[13px] text-admin-muted">Resolving…</p>
            ) : (
              <ResolvedState resolution={resolution} />
            )}
          </Card>
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
          <Card title="How read-checks report">
            <p className="text-[13px] text-admin-ink-soft">
              <strong>Required</strong> — the objective fails when the arm never reads the document.{" "}
              <strong>Expected</strong> — a visible warning on the run, without failing it. Either
              way the read/no-read event is recorded evidence.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function ResolvedState({ resolution }: { resolution: ScenarioResolutionSchema }) {
  return (
    <dl className="grid gap-2 text-[13px]">
      <Row label="Shop">
        {resolution.shop_name} <Version version={resolution.shop_version} />
      </Row>
      <Row label="Ticket">
        <span className="font-mono">{resolution.ticket_reference}</span>{" "}
        <Version version={resolution.ticket_version} /> · {resolution.customer_display_name}{" "}
        <Version version={resolution.customer_profile_version} />
      </Row>
      <Row label="Documents">
        {resolution.documents.length === 0
          ? "none"
          : resolution.documents.map((document) => (
              <span key={`${document.kind}:${document.document_id}`} className="mr-2">
                {document.title ?? document.document_id}
                {document.resolved ? null : (
                  <span className="ml-1 text-lab-error">— missing from this shop</span>
                )}
              </span>
            ))}
      </Row>
      <Row label="Entities">
        {resolution.entities.length === 0
          ? "none bound"
          : resolution.entities.map((entity) => (
              <span key={`${entity.kind}:${entity.identifier}`} className="mr-2">
                {entity.label ?? entity.identifier}
                {entity.detail ? (
                  <span className="text-admin-muted"> — {entity.detail}</span>
                ) : null}
                {entity.resolved ? null : <span className="ml-1 text-lab-error">— unresolved</span>}
              </span>
            ))}
      </Row>
      <Row label="Blocks">
        {resolution.objective_count} objective(s), {resolution.mutation_count} mutation(s) from{" "}
        {resolution.templates.length} template(s)
        <ul className="mt-1 grid gap-0.5 text-admin-muted">
          {resolution.templates.map((template) => (
            <li key={template.block_id}>
              <code className="font-mono text-[11.5px]">{template.name}</code>{" "}
              <Version version={template.version} /> · {template.instance_count} binding(s)
            </li>
          ))}
        </ul>
      </Row>
      <Row label="Completion">by turn {resolution.max_turns}</Row>
    </dl>
  );
}

/**
 * The turn cap keeps what was typed and commits only what parses.
 *
 * `Number(value) || 1` snapped the draft to the minimum the moment the field was cleared,
 * fighting anyone retyping it. Holding the text locally and committing every parseable
 * keystroke fixes that without moving the commit to blur, which would race the Save click
 * that caused the blur.
 */
function TurnCapField({ value, onCommit }: { value: number; onCommit: (turns: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);

  return (
    <label className={fieldLabelClasses}>
      Turn cap
      <input
        type="number"
        min={MIN_TURN_CAP}
        max={MAX_TURN_CAP}
        className={fieldControlClasses}
        value={typed ?? String(value)}
        onChange={(event) => {
          setTyped(event.target.value);
          const parsed = parseTurnCap(event.target.value);
          if (parsed !== null) {
            onCommit(parsed);
          }
        }}
        // Leaving the field re-syncs it to the cap the draft actually holds, so a cleared or
        // clamped entry never lingers on screen as something the scenario does not say.
        onBlur={() => setTyped(null)}
      />
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[11px] font-bold tracking-wide text-admin-muted uppercase">{label}</dt>
      <dd className="text-admin-ink-soft">{children}</dd>
    </div>
  );
}

/** A version that would be pinned, or the reason there is none to pin. */
function Version({ version }: { version: number | null }) {
  return version === null ? (
    <span className="font-semibold text-lab-error">unpublished</span>
  ) : (
    <span className="font-semibold text-lab-ink">v{version}</span>
  );
}

function BoundBlockRow({
  index,
  instance,
  option,
  resources,
  pending,
  isFirst,
  isLast,
  onBind,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  instance: BoundObjectiveSchema | BoundMutationSchema;
  option: ScenarioBlockOptionSchema | undefined;
  resources: ScenarioResourcesSchema | null;
  /** The library has not answered yet, so an absent option is not a missing template. */
  pending: boolean;
  isFirst: boolean;
  isLast: boolean;
  onBind: (parameter: string, value: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="grid gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-bold text-admin-ink-soft">
          {index}
        </span>
        <span className="text-[13px] font-semibold">{option?.statement || instance.id}</span>
        {option ? (
          <>
            <code className="rounded bg-admin-border/60 px-1.5 py-0.5 font-mono text-[11px] text-admin-ink-soft">
              {option.name}{" "}
              {option.latest_published_version === null
                ? "draft"
                : `v${option.latest_published_version}`}
            </code>
            <span className="text-[11.5px] text-admin-muted">{option.type_label}</span>
          </>
        ) : pending ? (
          <span className="text-[11.5px] text-admin-muted">Loading template…</span>
        ) : (
          <span className="text-[11.5px] font-semibold text-lab-error">
            template no longer in the library
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            className={subtleButtonClasses}
            type="button"
            aria-label={`Move ${instance.id} up`}
            disabled={isFirst}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            className={subtleButtonClasses}
            type="button"
            aria-label={`Move ${instance.id} down`}
            disabled={isLast}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            className={destructiveSubtleButtonClasses}
            type="button"
            aria-label={`Remove ${instance.id}`}
            onClick={onRemove}
          >
            <ButtonIcon verb="delete" />
            Remove
          </button>
        </div>
      </div>

      {bindableParameters(option).map((parameter) => (
        <BindingField
          key={parameter.name}
          instance={instance}
          parameter={parameter}
          resources={resources}
          onBind={onBind}
        />
      ))}
      {children}
    </li>
  );
}

function BindingField({
  instance,
  parameter,
  resources,
  onBind,
}: {
  instance: BoundObjectiveSchema | BoundMutationSchema;
  parameter: BlockParameterSchema;
  resources: ScenarioResourcesSchema | null;
  onBind: (parameter: string, value: string) => void;
}) {
  const value = boundValue(instance, parameter.name);
  const name = `${parameter.name} of ${instance.id}`;

  if (parameter.kind === "data_reference") {
    const { entity, field } = splitDataReference(value);
    const choices = resources ? referenceChoices(parameter, resources) : [];
    return (
      // A div, not a label: the value is two controls, so a wrapping label has no single
      // resolvable control. Each half names itself instead.
      <div className={fieldLabelClasses}>
        <span>{parameter.name}</span>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={name}
            className={`${fieldControlClasses} min-w-40 flex-1`}
            value={entity}
            onChange={(event) =>
              // Clearing the object clears the whole reference, and a field the new object has
              // no answer for does not survive the switch: `retargetDataReference` holds both
              // halves of the backend's rule so the editor never stores a pair it would refuse.
              onBind(parameter.name, retargetDataReference(event.target.value, field))
            }
          >
            <option value="">Select an object</option>
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`Field of ${name}`}
            className={`${fieldControlClasses} min-w-40 flex-1`}
            value={field}
            onChange={(event) =>
              onBind(parameter.name, retargetDataReference(entity, event.target.value))
            }
          >
            <option value="">Select a field</option>
            {withCurrentChoice(
              dataFieldsFor(entity).map((option) => ({ value: option, label: option })),
              field,
            ).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <ParameterHint parameter={parameter} />
      </div>
    );
  }

  // The timing list is a convenience, not the contract, and a shop's objects can move under a
  // draft — so whatever is bound is always offered, or a controlled select would read as
  // unbound and the first interaction would silently replace it.
  const choices = withCurrentChoice(
    parameter.kind === "timing"
      ? TIMING_CHOICES
      : resources
        ? referenceChoices(parameter, resources)
        : [],
    value,
  );

  if (choices.length > 0 || parameter.shop_bound) {
    return (
      <label className={fieldLabelClasses}>
        {parameter.name}
        <select
          aria-label={name}
          className={fieldControlClasses}
          value={value}
          onChange={(event) => onBind(parameter.name, event.target.value)}
        >
          <option value="">Not bound yet</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <ParameterHint parameter={parameter} />
      </label>
    );
  }

  return (
    <label className={fieldLabelClasses}>
      {parameter.name}
      <input
        aria-label={name}
        className={fieldControlClasses}
        value={value}
        placeholder={parameter.default ?? ""}
        onChange={(event) => onBind(parameter.name, event.target.value)}
      />
      <ParameterHint parameter={parameter} />
    </label>
  );
}

function ParameterHint({ parameter }: { parameter: BlockParameterSchema }) {
  return (
    <span className="text-[11.5px] font-normal text-admin-muted">
      {parameter.description || "The template gives no guidance on what to bind."}
      {parameter.shop_bound ? " · resolved inside this shop" : null}
    </span>
  );
}

function TemplatePicker({
  label,
  options,
  pending,
  disabled,
  onAdd,
}: {
  label: string;
  options: readonly ScenarioBlockOptionSchema[];
  /** The library has not answered yet: an unloaded list is not an empty one. */
  pending: boolean;
  disabled: boolean;
  onAdd: (option: ScenarioBlockOptionSchema) => void;
}) {
  const [blockId, setBlockId] = useState("");

  if (pending) {
    return <p className="text-[13px] text-admin-muted">Loading the library…</p>;
  }

  if (options.length === 0) {
    return (
      <p className={`${surfaceClasses} p-3 text-[13px] text-admin-muted`}>
        The library holds no template yet. Author one first — a scenario composes templates and
        never restates what they assert.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        {label}
        <select
          aria-label={label}
          className={fieldControlClasses}
          value={blockId}
          onChange={(event) => setBlockId(event.target.value)}
        >
          <option value="">Select a template</option>
          {options.map((option) => (
            <option key={option.block_id} value={option.block_id}>
              {option.name} —{" "}
              {option.latest_published_version === null
                ? "draft"
                : `v${option.latest_published_version}`}
            </option>
          ))}
        </select>
      </label>
      <button
        className={outlineButtonClasses}
        type="button"
        disabled={disabled || !blockId}
        onClick={() => {
          const option = options.find((entry) => entry.block_id === blockId);
          if (option) {
            onAdd(option);
            setBlockId("");
          }
        }}
      >
        <ButtonIcon verb="create" />
        Add
      </button>
    </div>
  );
}
