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
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
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
import { CappedTitle } from "../components/CappedTitle";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import { MoveButton, RemoveButton } from "../components/ItemList";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import {
  Card,
  EditorSaveActions,
  EntryCard,
  EntryEditNotice,
  EntryId,
  Fingerprint,
  GateCard,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { type EntryEdit, entryEdit, useEntryEdit } from "../lib/entryEdit";
import { labelOf, OBJECTIVE_SEVERITY, optionsOf } from "../lib/enumLabels";
import {
  CONTEXT_DOCUMENTS_CAP_RULE,
  LABEL_MAX_LENGTH,
  MUTATIONS_CAP_RULE,
  OBJECTIVES_CAP_RULE,
  TEXT_MAX_LENGTH,
} from "../lib/fieldRules";
import { consequenceOf, findingClauses, type Removal, useRemoval } from "../lib/removal";
import {
  addMutation,
  addObjective,
  bindableParameters,
  boundMutation,
  boundObjective,
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
  mutationFields,
  objectiveFields,
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
  withCurrentChoice,
} from "../lib/scenarios";
import { onlyChoiceNote, soleCandidate, useSingleChoice } from "../lib/singleChoice";
import {
  addFormClasses,
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  fieldLabelClasses,
  readOnlyValueClasses,
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
  const publishReasonsId = useId();
  const documentsCapId = useId();
  const documentsId = useId();
  const editor = useDefinitionEditor(scenarioId, client, {
    label: "The scenario draft has unsaved changes.",
    // The Scenarios index prints the row this editor is changing, and it renders the shell's
    // listing rather than reading its own (ADR 0056).
    afterSave: listings.scenarios.refresh,
  });
  const { content, preview, edit: editDraft } = editor;
  const objectiveRemoval = useRemoval(scenarioId);
  const mutationRemoval = useRemoval(scenarioId);
  // Each composed list's one open row: its bindings (and an objective's severity) are not in
  // the draft until its Save (ADR 0051), and the line that says so is what the other rows'
  // Edit points at.
  const objectiveEditor = useEntryEdit(content?.objectives ?? [], {
    keyOf: (objective) => objective.id,
    labelOf: (objective) => objective.id,
    fieldsOf: objectiveFields,
  });
  const mutationEditor = useEntryEdit(content?.mutations ?? [], {
    keyOf: (mutation) => mutation.id,
    labelOf: (mutation) => mutation.id,
    fieldsOf: mutationFields,
  });
  const objectiveNotice = useId();
  const mutationNotice = useId();
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
  const documentsFull = content.context_documents.length >= MAX_CONTEXT_DOCUMENTS;

  return (
    <>
      <PageHeader
        title={content.name}
        chips={<VersionChips preview={preview} />}
        // The ticket it is built on is the Ticket row's own value; the line keeps the draft's
        // fingerprint and the way to the scenario's starting states.
        back={{
          to: "..",
          label: "Scenarios",
          kind: "scenario",
          detail: (
            <>
              {preview ? (
                <>
                  draft fingerprint <Fingerprint value={preview.content_fingerprint} /> ·{" "}
                </>
              ) : null}
              <Link className="font-semibold text-lab-ink" to="snapshots">
                Starting states
              </Link>
            </>
          ),
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
              onPublish={() => {
                // A frozen version is printed by the index this editor was opened from, and
                // that index renders the shell's listing (ADR 0056).
                void editor.publish().then((version) => {
                  setPublishedVersion(version);
                  if (version !== null) {
                    void listings.scenarios.refresh();
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
                Published version {publishedVersion}. It keeps the ticket and template versions it
                pinned, whatever the library does next.{" "}
                <Link className="font-semibold text-lab-ink" to="snapshots">
                  Freeze it into starting state
                </Link>{" "}
                to settle the orders it only names.
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

      {state.status === "failed" ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-lab-error">
            {state.message} The scenario is readable, but nothing can be bound until this shop's
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

      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>
          <Card
            title="Built on"
            description={
              <>
                A scenario never moves off its ticket: the context, bindings, and hidden facts all
                describe the incident it was built on.
              </>
            }
          >
            {/* The prototype's four rows (`Workspace.dc.html` :3047–3062): the name, and the
                ticket, customer and shop version the scenario is read against, which this page
                cannot change and so shows rather than asks. */}
            <FieldRows>
              <Field label="Name">
                <input
                  maxLength={LABEL_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  value={content.name}
                  onChange={(event) => edit({ ...content, name: event.target.value })}
                />
              </Field>
              {/* The ticket's latest published version, read on every resolve as the shop's
                  is (`ScenarioService.resolve`), so it says published rather than frozen. */}
              <Field label="Ticket">
                <output className={readOnlyValueClasses}>
                  <span>
                    <span className="font-mono font-semibold">
                      {resolution?.ticket_reference ?? "—"}
                    </span>{" "}
                    · {resolution?.ticket_subject ?? "…"}
                    {/* A space rather than a margin, so the line reads as words too. */}
                    {resolution === null ? null : (
                      <span className="text-admin-muted">
                        {" "}
                        {resolution.ticket_version === null
                          ? "— not published yet"
                          : `— published at v${resolution.ticket_version}`}
                      </span>
                    )}
                  </span>
                </output>
              </Field>
              <Field label="Customer">
                <output className={readOnlyValueClasses}>
                  {resolution?.customer_display_name ?? "…"}
                </output>
              </Field>
              {/* Not the prototype's hint, which says publishing the shop again does not move
                  the scenario: `ScenarioService.resolve` (`application/scenarios.py`) reads the
                  shop's latest published version each time, so a new publish does move it. */}
              <Field
                label="Shop version"
                hint="The shop's newest published version, which is what the scenario resolves against today."
              >
                <output className={readOnlyValueClasses}>
                  {resolution === null
                    ? "…"
                    : resolution.shop_version === null
                      ? `${resolution.shop_name} — not published yet`
                      : `${resolution.shop_name} v${resolution.shop_version}`}
                </output>
              </Field>
            </FieldRows>
          </Card>

          <Card
            title={
              <CappedTitle
                title="Context documents"
                count={content.context_documents.length}
                max={MAX_CONTEXT_DOCUMENTS}
              />
            }
            label="Context documents"
            description={
              <>
                Readable by the agent through tools only. Listing a document here does not make the
                agent read it — a read-check objective is what asserts that, and the read/no-read
                event is recorded evidence either way.
              </>
            }
          >
            {/* The prototype draws no context documents card; the row's name is the card's own
                verb, each box saying whether its document is listed, as *Enabled* does for a
                tool. The boxes keep the names their labels give them, which the specs check
                them by (rule 5); the collection and tool, and the read-check, drawn beside a
                box are its description, before the cap's rule when it holds the box off. */}
            <FieldRows>
              <FieldGroup label="Listed">
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
                      const capped = !listed && documentsFull;
                      const detailId = `${documentsId}-${key}-detail`;
                      const readingId = `${documentsId}-${key}-reading`;
                      return (
                        <li
                          key={document.reference_value}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-2.5 text-[13px]"
                        >
                          <label className="flex items-center gap-2 font-semibold">
                            <input
                              type="checkbox"
                              checked={listed}
                              // A native control keeps `disabled` at the cap (ADR 0063), with the
                              // lab's sentence in `title` and in the line its description names.
                              disabled={capped}
                              title={capped ? CONTEXT_DOCUMENTS_CAP_RULE : undefined}
                              aria-describedby={[
                                detailId,
                                reading.length > 0 ? readingId : null,
                                capped ? documentsCapId : null,
                              ]
                                .filter(Boolean)
                                .join(" ")}
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
                          <span id={detailId} className="text-admin-muted">
                            {documentCollectionLabel(document.kind)} · read via{" "}
                            <code className="font-mono text-[11.5px]">
                              {documentToolName(document.kind)}
                            </code>
                          </span>
                          {reading.length > 0 ? (
                            <span
                              id={readingId}
                              className="ml-auto rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft"
                            >
                              read-check → objective {reading.join(", ")}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {documentsFull ? (
                  <p id={documentsCapId} className="text-xs text-admin-muted">
                    {CONTEXT_DOCUMENTS_CAP_RULE}
                  </p>
                ) : null}
              </FieldGroup>
            </FieldRows>
          </Card>

          <Card
            title={
              <CappedTitle
                title="Objectives"
                count={content.objectives.length}
                max={MAX_OBJECTIVES}
              />
            }
            label="Objectives"
            description={
              <>
                Order is priority, not a script: a scenario stays goal-based and never implies a
                scripted conversation. Only mutations sit on the run timeline.
              </>
            }
          >
            {content.objectives.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No objective yet. A scenario with none asserts nothing, so a run would produce no
                evidence to compare.
              </p>
            ) : (
              <ol className="grid gap-2 text-[13px]">
                {content.objectives.map((objective, index) => {
                  const option = findOption(objectiveOptions, objective.block_id);
                  return (
                    <BoundBlockRow
                      key={objective.id}
                      index={index + 1}
                      instance={objective}
                      option={option}
                      resources={resources}
                      pending={pending}
                      isFirst={index === 0}
                      isLast={index === content.objectives.length - 1}
                      edit={entryEdit(
                        objectiveEditor,
                        objectiveNotice,
                        objective.id,
                        (fields) =>
                          edit(
                            updateObjective(
                              content,
                              objective.id,
                              boundObjective(objective.id, objective.block_id, fields),
                            ),
                          ),
                        (value, onChange) => (
                          <FieldRows>
                            <BindingFields
                              instanceId={objective.id}
                              option={option}
                              resources={resources}
                              values={value.bindings}
                              onBind={(parameter, bound) =>
                                onChange({
                                  ...value,
                                  bindings: { ...value.bindings, [parameter]: bound },
                                })
                              }
                            />
                            <Field label="Severity">
                              <select
                                aria-label={`Severity of ${objective.id}`}
                                className={`${fieldControlClasses} w-full`}
                                value={value.severity}
                                onChange={(event) =>
                                  onChange({
                                    ...value,
                                    severity: event.target.value as ObjectiveSeverity,
                                  })
                                }
                              >
                                {SEVERITIES.map((entry) => (
                                  <option key={entry.value} value={entry.value}>
                                    {entry.option}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </FieldRows>
                        ),
                      )}
                      onMove={(direction) => edit(moveObjective(content, objective.id, direction))}
                      removal={objectiveRemoval}
                      consequence={consequenceOf(
                        "A run no longer asserts it, and the bindings it carries are lost with it — composing the template again starts them empty.",
                        findingClauses([
                          content.objectives.length === 1 && "scenario_without_objective",
                        ]),
                        "Nothing is written until you save the draft, and a published version keeps it.",
                      )}
                      onRemove={() => edit(removeObjective(content, objective.id))}
                    >
                      <dt className="text-xs font-semibold text-admin-muted">Severity</dt>
                      <dd className="text-admin-ink-soft">
                        {labelOf(OBJECTIVE_SEVERITY, objective.severity)}
                      </dd>
                    </BoundBlockRow>
                  );
                })}
              </ol>
            )}
            <EntryEditNotice id={objectiveNotice} label={objectiveEditor.open?.label ?? null} />
            <RemovalNotice removal={objectiveRemoval} />
            <TemplatePicker
              label="Add objective block"
              options={objectiveOptions}
              pending={pending}
              full={content.objectives.length >= MAX_OBJECTIVES}
              capRule={OBJECTIVES_CAP_RULE}
              onAdd={(option) => edit(addObjective(content, option))}
            />
          </Card>

          <Card
            title={
              <CappedTitle title="Mutations" count={content.mutations.length} max={MAX_MUTATIONS} />
            }
            label="Mutations"
            description={
              <>
                Injected into the run's sandbox at a bound moment and never exposed as an agent tool
                — an arm observes the consequence, never the cause. Order is the run timeline, and
                both arms receive the identical schedule.
              </>
            }
          >
            {content.mutations.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No mutation. The sandbox stays still for the whole run, which is a legitimate
                scenario.
              </p>
            ) : (
              <ol className="grid gap-2 text-[13px]">
                {content.mutations.map((mutation, index) => {
                  const option = findOption(mutationOptions, mutation.block_id);
                  return (
                    <BoundBlockRow
                      key={mutation.id}
                      index={index + 1}
                      instance={mutation}
                      option={option}
                      resources={resources}
                      pending={pending}
                      isFirst={index === 0}
                      isLast={index === content.mutations.length - 1}
                      edit={entryEdit(
                        mutationEditor,
                        mutationNotice,
                        mutation.id,
                        (fields) =>
                          edit(
                            updateMutation(
                              content,
                              mutation.id,
                              boundMutation(mutation.id, mutation.block_id, fields),
                            ),
                          ),
                        (value, onChange) => (
                          <FieldRows>
                            <BindingFields
                              instanceId={mutation.id}
                              option={option}
                              resources={resources}
                              values={value.bindings}
                              onBind={(parameter, bound) =>
                                onChange({
                                  ...value,
                                  bindings: { ...value.bindings, [parameter]: bound },
                                })
                              }
                            />
                          </FieldRows>
                        ),
                      )}
                      onMove={(direction) => edit(moveMutation(content, mutation.id, direction))}
                      removal={mutationRemoval}
                      consequence="The sandbox no longer changes at that point of a run, and the bindings it carries are lost with it — composing the template again starts them empty. Nothing is written until you save the draft, and a published version keeps it."
                      onRemove={() => edit(removeMutation(content, mutation.id))}
                    />
                  );
                })}
              </ol>
            )}
            <EntryEditNotice id={mutationNotice} label={mutationEditor.open?.label ?? null} />
            <RemovalNotice removal={mutationRemoval} />
            <TemplatePicker
              label="Add mutation block"
              options={mutationOptions}
              pending={pending}
              full={content.mutations.length >= MAX_MUTATIONS}
              capRule={MUTATIONS_CAP_RULE}
              onAdd={(option) => edit(addMutation(content, option))}
            />
          </Card>

          <Card
            title="Hidden facts — operator only"
            description={
              <>
                Never shown to the support agent, never logged, and never traced. It steers whoever
                drives the customer.
              </>
            }
          >
            {/* The prototype's *Facts* row is a list of facts with an add form
                (`Workspace.dc.html` :3067–3085); the draft holds one free text, so the row is one
                wide textarea, named "Hidden facts", the name the specs fill it by (rule 5). */}
            <FieldRows>
              <Field label="Hidden facts" wide>
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${textAreaClasses} w-full`}
                  value={content.hidden_facts}
                  placeholder="What the customer knows, will confirm if asked, and never volunteers."
                  onChange={(event) => edit({ ...content, hidden_facts: event.target.value })}
                />
              </Field>
            </FieldRows>
          </Card>

          <Card
            title="Completion"
            description={
              <>
                The statement is what the operator and, later, the judge read. The cap is the hard
                stop that guarantees a run terminates — both arms are bounded identically.
              </>
            }
          >
            <FieldRows>
              <Field label="A resolved incident looks like">
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${textAreaClasses} w-full`}
                  value={content.completion.statement}
                  placeholder="The order ships to the confirmed address and the customer acknowledges it."
                  onChange={(event) =>
                    edit({
                      ...content,
                      completion: { ...content.completion, statement: event.target.value },
                    })
                  }
                />
              </Field>
              <TurnCapField
                value={content.completion.max_turns}
                onCommit={(max_turns) =>
                  edit({ ...content, completion: { ...content.completion, max_turns } })
                }
              />
            </FieldRows>
          </Card>
        </div>

        <div className={editorPanelClasses}>
          <GateCard title="Publish gate" busy={editor.checking} dirty={editor.dirty}>
            <IssueList issues={preview?.issues ?? []} />
          </GateCard>
          <Card title="Resolved-state preview">
            {resolution === null ? (
              <p className="text-[13px] text-admin-muted">Resolving…</p>
            ) : (
              <ResolvedState resolution={resolution} />
            )}
          </Card>
          <Card title="How read-checks report">
            <p className="text-[13px] text-admin-ink-soft">
              <strong>Required</strong> — the objective fails when the arm never reads the document.{" "}
              <strong>Expected</strong> — a visible warning on the run, without failing it. Either
              way the read/no-read event is recorded evidence.
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
    <Field label="Turn cap">
      <input
        type="number"
        min={MIN_TURN_CAP}
        max={MAX_TURN_CAP}
        className={`${fieldControlClasses} w-full`}
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
    </Field>
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
  edit,
  onMove,
  removal,
  consequence,
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
  /** The row's open-in-place edit: its bindings on field rows, and an objective's severity. */
  edit: EntryEdit;
  onMove: (direction: -1 | 1) => void;
  /** The list's second press (ADR 0060), and what it says the removal costs. */
  removal: Removal;
  consequence: string;
  onRemove: () => void;
  /** What the row reads back besides its bindings, as `<dt>`/`<dd>` pairs. */
  children?: ReactNode;
}) {
  const named = option?.statement || instance.id;
  const notice = `Removed “${named}” from the draft.`;
  if (removal.isArmed(instance.id)) {
    return (
      <ConfirmRemove
        as="li"
        title={`Remove ${named}?`}
        consequence={consequence}
        onConfirm={removal.confirm(onRemove, notice)}
        onKeep={removal.keep}
      />
    );
  }
  const bindable = bindableParameters(option);
  return (
    <EntryCard
      lead={
        <span className="rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-bold text-admin-ink-soft">
          {index}
        </span>
      }
      title={named}
      chips={
        option ? (
          <>
            <EntryId
              value={`${option.name} ${
                option.latest_published_version === null
                  ? "draft"
                  : `v${option.latest_published_version}`
              }`}
            />
            <span className="text-[11.5px] text-admin-muted">{option.type_label}</span>
          </>
        ) : pending ? (
          <span className="text-[11.5px] text-admin-muted">Loading template…</span>
        ) : (
          <span className="text-[11.5px] font-semibold text-lab-error">
            template no longer in the library
          </span>
        )
      }
      edit={edit}
      actions={
        // The order is authored — priority for objectives, the run timeline for mutations —
        // so the arrows stay on the row beside its Remove.
        <>
          <MoveButton
            name={instance.id}
            direction="up"
            disabled={isFirst}
            onMove={() => onMove(-1)}
          />
          <MoveButton
            name={instance.id}
            direction="down"
            disabled={isLast}
            onMove={() => onMove(1)}
          />
          <RemoveButton
            name={instance.id}
            entryKey={instance.id}
            removal={removal}
            notice={notice}
            onRemove={onRemove}
          />
        </>
      }
    >
      {bindable.length > 0 || children ? (
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
          {bindable.map((parameter) => {
            const bound = boundLabel(parameter, boundValue(instance, parameter.name), resources);
            return (
              <Fragment key={parameter.name}>
                <dt className="font-mono text-xs font-semibold text-admin-muted">
                  {parameter.name}
                </dt>
                <dd className={bound === null ? "text-admin-muted" : "text-admin-ink-soft"}>
                  {bound ?? "Not bound yet"}
                </dd>
              </Fragment>
            );
          })}
          {children}
        </dl>
      ) : null}
    </EntryCard>
  );
}

/**
 * What a binding reads as on a closed row: the choice the picker would show for it, or the
 * value itself where no picker names it. Null while it is unbound.
 */
function boundLabel(
  parameter: BlockParameterSchema,
  value: string,
  resources: ScenarioResourcesSchema | null,
): string | null {
  if (!value) {
    return null;
  }
  if (parameter.kind === "data_reference") {
    const { entity, field } = splitDataReference(value);
    const choices = resources ? referenceChoices(parameter, resources) : [];
    const named = choices.find((choice) => choice.value === entity)?.label ?? entity;
    return field ? `${named} · ${field}` : named;
  }
  const choices =
    parameter.kind === "timing"
      ? TIMING_CHOICES
      : resources
        ? referenceChoices(parameter, resources)
        : [];
  return choices.find((choice) => choice.value === value)?.label ?? value;
}

/** An open row's bindings, one field row per parameter the template leaves to the scenario. */
function BindingFields({
  instanceId,
  option,
  resources,
  values,
  onBind,
}: {
  instanceId: string;
  option: ScenarioBlockOptionSchema | undefined;
  resources: ScenarioResourcesSchema | null;
  values: Readonly<Record<string, string>>;
  onBind: (parameter: string, value: string) => void;
}) {
  return (
    <>
      {bindableParameters(option).map((parameter) => (
        <BindingField
          key={parameter.name}
          instanceId={instanceId}
          parameter={parameter}
          resources={resources}
          value={values[parameter.name] ?? ""}
          onBind={onBind}
        />
      ))}
    </>
  );
}

/**
 * One binding on a field row. Each control keeps the name it had when the rows were always open
 * — "doc_ref of read-required-document" — so the parameter's name, which the row's label also
 * shows, leads it, and a reader, a test and a journey reach the same control as before.
 */
function BindingField({
  instanceId,
  parameter,
  resources,
  value,
  onBind,
}: {
  instanceId: string;
  parameter: BlockParameterSchema;
  resources: ScenarioResourcesSchema | null;
  value: string;
  onBind: (parameter: string, value: string) => void;
}) {
  const name = `${parameter.name} of ${instanceId}`;
  const hint = parameterHint(parameter);

  if (parameter.kind === "data_reference") {
    const { entity, field } = splitDataReference(value);
    const choices = resources ? referenceChoices(parameter, resources) : [];
    return (
      // A group row: the value is two controls, so there is no single control for a label to
      // name. Each half names itself.
      <FieldGroup label={parameter.name} hint={hint}>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={name}
            className={`${fieldControlClasses} w-full min-w-40 flex-1`}
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
            className={`${fieldControlClasses} w-full min-w-40 flex-1`}
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
      </FieldGroup>
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
      <Field label={parameter.name} hint={hint}>
        <select
          aria-label={name}
          className={`${fieldControlClasses} w-full`}
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
      </Field>
    );
  }

  return (
    <Field label={parameter.name} hint={hint}>
      <input
        maxLength={TEXT_MAX_LENGTH}
        aria-label={name}
        className={`${fieldControlClasses} w-full`}
        value={value}
        placeholder={parameter.default ?? ""}
        onChange={(event) => onBind(parameter.name, event.target.value)}
      />
    </Field>
  );
}

/** What the template says a binding is for, and where it resolves: the binding row's hint. */
function parameterHint(parameter: BlockParameterSchema): string {
  return `${parameter.description || "The template gives no guidance on what to bind."}${
    parameter.shop_bound ? " · resolved inside this shop" : ""
  }`;
}

function TemplatePicker({
  label,
  options,
  pending,
  full,
  capRule,
  onAdd,
}: {
  label: string;
  options: readonly ScenarioBlockOptionSchema[];
  /** The library has not answered yet: an unloaded list is not an empty one. */
  pending: boolean;
  /** The scenario already composes as many of these as the lab stores. */
  full: boolean;
  /** The lab's sentence for that cap, which the refused Add says. */
  capRule: string;
  onAdd: (option: ScenarioBlockOptionSchema) => void;
}) {
  const [blockId, setBlockId] = useState("");
  const capId = useId();
  const noteId = useId();
  // One template in the library is not a choice (ADR 0064): the form opens on it, and goes
  // back to it after each add, since composing one leaves the library as it was.
  const candidates = options.map((option) => option.block_id);
  const onlyTemplate = useSingleChoice(candidates, blockId, setBlockId);

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

  // Add is the one submit of this form, so at the cap it is refused with the lab's sentence
  // rather than going quiet (ADR 0063); an unchosen template is its own field's to say, which
  // the select does natively as `required`, and the handler checks both.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const option = options.find((entry) => entry.block_id === blockId);
    if (full || option === undefined) {
      return;
    }
    onAdd(option);
    setBlockId(soleCandidate(candidates) ?? "");
  }

  return (
    <form className={addFormClasses} onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
          {label}
          <select
            aria-label={label}
            aria-describedby={onlyTemplate ? noteId : undefined}
            className={`${fieldControlClasses} w-full`}
            value={blockId}
            required
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
          {onlyTemplate ? (
            <span id={noteId} className="text-xs font-normal text-admin-muted">
              {onlyChoiceNote("template in the library")}
            </span>
          ) : null}
        </label>
        <PrimaryAction
          variant="outline"
          type="submit"
          refusal={full ? { id: capId, reason: capRule } : null}
        >
          <ButtonIcon verb="create" />
          Add
        </PrimaryAction>
      </div>
      {full ? <RefusalLine id={capId}>{capRule}</RefusalLine> : null}
    </form>
  );
}
