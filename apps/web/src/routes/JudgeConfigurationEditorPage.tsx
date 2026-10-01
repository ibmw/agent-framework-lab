import type {
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationPreviewResponse,
  JudgeConfigurationResourcesResponse,
  JudgeEvidenceScope,
} from "@agent-lab/contracts";
import { useEffect, useId, useState } from "react";
import { useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  getJudgeConfigurationDraft,
  previewJudgeConfigurationDraft,
  publishJudgeConfiguration,
  readJudgeConfigurationResources,
  replaceJudgeConfigurationDraft,
} from "../api/judgeConfigurations";
import { Field, FieldRows } from "../components/FieldHint";
import { ProvenModelField } from "../components/ProvenModelField";
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
import { describeProvider } from "../lib/agents";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { JUDGE_EVIDENCE_SCOPE } from "../lib/enumLabels";
import {
  LABEL_MAX_LENGTH,
  PROVEN_PROVIDER_RULE,
  RUBRIC_EMPTY_RULE,
  rubricNamesAnArmRule,
  TEMPERATURE_PATTERN,
  TEMPERATURE_RULE,
  TEXT_MAX_LENGTH,
  unprovenJudgeProviderRule,
} from "../lib/fieldRules";
import { unreachableProviderNote } from "../lib/modelConnections";
import { pythonStrip } from "../lib/pythonText";
import { namedTerms } from "../lib/rubric";
import {
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  textAreaClasses,
} from "../lib/ui";
import { useUnreachableProviders } from "../lib/useUnreachableProviders";
import { useLabWorkspace } from "../shell/useLabWorkspace";

const CLIENT: DefinitionClient<
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationPreviewResponse
> = {
  getDraft: getJudgeConfigurationDraft,
  previewDraft: previewJudgeConfigurationDraft,
  replaceDraft: replaceJudgeConfigurationDraft,
  publish: publishJudgeConfiguration,
  // A judge carries no derived evidence, so the content *is* the payload — with its texts
  // stripped as Python strips them, because the lab refuses surrounding whitespace on each:
  // `require_label` on the name and the model, `require_text` on the rubric and the
  // description, and a textarea ends on a newline as often as not.
  toPayload: (content) => ({
    ...content,
    name: pythonStrip(content.name),
    model: { ...content.model, model_id: pythonStrip(content.model.model_id) },
    description: pythonStrip(content.description),
    rubric: pythonStrip(content.rubric),
  }),
  unavailable: "The judge service is unavailable.",
};

/**
 * The judge editor.
 *
 * Three things an author decides, and each is part of the published version: the rubric,
 * the model that reads it, and what the judge is shown. The third is the one that is easy
 * to under-read — a judge shown different evidence is answering a different question, so
 * the fingerprint moves with it and this page says so rather than treating it as a setting.
 *
 * There is no preview resolution beside the gate, unlike an agent configuration: a rubric
 * names nothing the lab resolves. What the judge is shown is built from an arm's record at
 * scoring time, which is the bench's, not this page's.
 */
export function JudgeConfigurationEditorPage() {
  const { judgeId = "" } = useParams();
  const { listings } = useLabWorkspace();
  const publishReasonsId = useId();
  const rubricRuleId = useId();
  const editor = useDefinitionEditor(judgeId, CLIENT, {
    label: "The judge draft has unsaved changes.",
    // The library index prints the row this editor is changing (ADR 0056).
    afterSave: listings.judges.refresh,
  });
  const { content, preview, edit } = editor;
  const [resources, setResources] = useState<JudgeConfigurationResourcesResponse | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const unreachable = useUnreachableProviders();

  useEffect(() => {
    const controller = new AbortController();
    readJudgeConfigurationResources(controller.signal)
      .then(setResources)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setResourceError(describeApiError(cause, "The judge catalog is unavailable."));
        }
      });
    return () => controller.abort();
  }, []);

  if (editor.loading) {
    return <p className="text-sm text-admin-muted">Loading judge…</p>;
  }

  if (!content) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {editor.error ?? "This judge could not be loaded."}
      </div>
    );
  }

  function toggleScope(scope: JudgeEvidenceScope) {
    if (!content) {
      return;
    }
    const shown = content.evidence.includes(scope);
    edit({
      ...content,
      evidence: shown
        ? content.evidence.filter((entry) => entry !== scope)
        : [...content.evidence, scope],
    });
  }

  // The gate's two rubric findings, said under the rubric as it is typed: `rubric_empty` on an
  // empty one, and `rubric_names_an_arm` once for each reserved term it names, read on the
  // gate's own boundaries (`lib/rubric.ts`) against the terms the catalog serves. Findings, not
  // refusals — the draft saves with either, and publication refuses it — so they refuse no Save.
  // A rubric of whitespace alone is saved empty (`toPayload`), so it is already empty here.
  const rubricFindings =
    pythonStrip(content.rubric) === ""
      ? [RUBRIC_EMPTY_RULE]
      : namedTerms(content.rubric, resources?.reserved_terms ?? []).map(rubricNamesAnArmRule);
  const provider =
    resources?.judges.find((judge) => judge.provider === content.model.provider) ?? null;
  const models = provider?.models ?? [];
  // The catalog's set, plus whatever the payload carries, for the reason the agent editor
  // gives: a select can only show a value it offers, so a draft whose provider is off-list —
  // reachable through the API, since `judge_capability_issues` takes any string — would
  // otherwise display the first option while the payload held another. The control must not
  // misreport the draft it is editing.
  const provenProviders = (resources?.judges ?? []).map((judge) => judge.provider);
  const unprovenProvider = resources !== null && !provenProviders.includes(content.model.provider);
  const providers = unprovenProvider
    ? [...provenProviders, content.model.provider]
    : provenProviders;
  // A note about this lab, beside the field and nowhere else: not in the gate, whose answer is
  // the same on every machine, and not in `PublishReasons`, because it blocks nothing (ADR 0053).
  const providerNote = unreachable?.has(content.model.provider)
    ? unreachableProviderNote(provider?.label ?? describeProvider(content.model.provider))
    : null;

  /**
   * A provider change takes the model with it.
   *
   * A model name means nothing outside its provider — `deterministic` is not something
   * OpenAI serves, and `gpt-5-mini` is not something the offline control runs — so leaving
   * the field on the old provider's model would hold a draft the gate warns about and no
   * run could execute. It is a reset rather than a flag because the value it discards could
   * not have been the author's answer to the question they just changed; the agent editor
   * applies the same rule, where a framework change is what moves the provider.
   */
  function chooseProvider(providerId: string) {
    if (!content) {
      return;
    }
    const chosen = resources?.judges.find((judge) => judge.provider === providerId);
    edit({
      ...content,
      model: {
        ...content.model,
        provider: providerId,
        model_id: chosen?.models[0] ?? content.model.model_id,
      },
    });
  }

  return (
    <>
      <PageHeader
        title={content.name}
        chips={<VersionChips preview={preview} />}
        back={{ to: "..", label: "Judges", kind: "judge" }}
        description={
          <>
            {content.model.model_id}
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
              checking={editor.checking}
              publishing={editor.publishing}
              reasonsId={publishReasonsId}
              onPublish={() => {
                // A frozen version is printed by the index this editor was opened from, and
                // that index renders the shell's listing (ADR 0056).
                void editor.publish().then((version) => {
                  setPublishedVersion(version);
                  if (version !== null) {
                    void listings.judges.refresh();
                  }
                });
              }}
            />
          </>
        }
        reasons={
          <>
            {(editor.error ?? resourceError) ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {editor.error ?? resourceError}
              </p>
            ) : null}
            {publishedVersion !== null ? (
              <p role="status" className="text-[13px] text-lab-success">
                Published version {publishedVersion}. Every verdict records the version that
                produced it.
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
          {/* The first line is also the rubric's own rule, so it keeps the id the field is
              described by. */}
          <Card
            title="Rubric"
            descriptionId={rubricRuleId}
            description={
              <>
                What "met", "missed", and "unclear" mean is the lab's rule and travels above every
                rubric — including that "unclear" is a real answer rather than a failure. Write what
                the judge is looking for, not how to report it.
              </>
            }
          >
            <FieldRows>
              <Field label="Name">
                <input
                  maxLength={LABEL_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  value={content.name}
                  onChange={(event) => edit({ ...content, name: event.target.value })}
                />
              </Field>
              <Field label="Description">
                <input
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  value={content.description}
                  onChange={(event) => edit({ ...content, description: event.target.value })}
                />
              </Field>
              {/* The rule is the card's first line, which the rubric keeps pointing at; the
                  gate's findings are the row's second line, at the gate's own severity — an
                  error the draft still saves with, so polite and refusing nothing. */}
              <Field
                label="How this judge scores"
                extra={
                  rubricFindings.length > 0
                    ? rubricFindings.map((finding) => (
                        <span key={finding} className="block">
                          {finding}
                        </span>
                      ))
                    : null
                }
                extraTone="finding"
              >
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${textAreaClasses} w-full min-h-56 font-mono`}
                  value={content.rubric}
                  aria-required
                  aria-describedby={rubricRuleId}
                  aria-invalid={rubricFindings.length > 0 || undefined}
                  onChange={(event) => edit({ ...content, rubric: event.target.value })}
                />
              </Field>
            </FieldRows>
          </Card>

          {/* In the main column, after the rubric, as the prototype draws the judge's model
              (`Workspace.dc.html` :503–518): the side panel holds no field of the draft. */}
          <Card title="Model">
            <FieldRows>
              <Field
                label="Provider"
                hint={PROVEN_PROVIDER_RULE}
                extra={
                  unprovenProvider
                    ? unprovenJudgeProviderRule(content.model.provider)
                    : providerNote
                }
                extraTone={unprovenProvider ? "error" : "muted"}
              >
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.model.provider}
                  onChange={(event) => chooseProvider(event.target.value)}
                >
                  {/*
                   * The served label where the catalog has one, so the option and the sentence
                   * beneath it cannot come apart: `ProvenModelField`'s subject must stay
                   * `judge.label` to keep that sentence character-identical to the gate, which
                   * writes it from exactly that field. The shared table is the fallback, for
                   * the appended off-list value that the catalog knows nothing about.
                   */}
                  {providers.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {resources?.judges.find((judge) => judge.provider === candidate)?.label ??
                        describeProvider(candidate)}
                    </option>
                  ))}
                </select>
              </Field>
              <ProvenModelField
                arrangement="row"
                value={content.model.model_id}
                models={models}
                proven={provider?.label ?? describeProvider(content.model.provider)}
                onChange={(modelId) =>
                  edit({ ...content, model: { ...content.model, model_id: modelId } })
                }
              />
              {/* The note that closed the card is about this field alone, so it is the second
                  sentence of its rule: a new draft starts on `DEFAULT_JUDGE_MODEL`
                  (`application/judge_capabilities.py`), at 0.00. */}
              <Field
                label="Temperature"
                hint={
                  <>
                    {TEMPERATURE_RULE} Zero by default: a judge is rerun to see whether a verdict
                    holds, and one that varied for its own reasons would make every rerun
                    unreadable.
                  </>
                }
              >
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={content.model.temperature}
                  inputMode="decimal"
                  pattern={TEMPERATURE_PATTERN}
                  title={TEMPERATURE_RULE}
                  placeholder="0.00"
                  onChange={(event) =>
                    edit({
                      ...content,
                      model: { ...content.model, temperature: event.target.value },
                    })
                  }
                />
              </Field>
            </FieldRows>
          </Card>

          <Card
            title="Evidence"
            description={
              <>
                A judge shown different things is answering a different question, so this is part of
                the published version and of its fingerprint — not a display setting.
              </>
            }
          >
            <ul className="grid gap-2">
              {(resources?.evidence ?? []).map((scope) => (
                <li key={scope}>
                  <label className="flex items-start gap-2 text-[13px] text-admin-ink-soft">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={content.evidence.includes(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    <span>
                      <span className="font-semibold text-lab-ink">
                        {JUDGE_EVIDENCE_SCOPE[scope].label}
                      </span>
                      <br />
                      {JUDGE_EVIDENCE_SCOPE[scope].explanation}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className={editorPanelClasses}>
          <GateCard title="Publish gate" busy={editor.checking} dirty={editor.dirty}>
            <IssueList issues={preview?.issues ?? []} />
          </GateCard>

          <Card title="Anonymity">
            <p className="text-[13px] text-admin-ink-soft">
              A judge is shown what an arm did and said, and nothing about what ran it. A rubric
              that names any of the following is refused, because it would ask the judge to score
              the label instead of the behavior:
            </p>
            <p className="mt-2 font-mono text-[12px] text-admin-muted">
              {(resources?.reserved_terms ?? []).join(" · ")}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
