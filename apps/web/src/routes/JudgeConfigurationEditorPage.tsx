import type {
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationPreviewResponse,
  JudgeConfigurationResourcesResponse,
  JudgeEvidenceScope,
} from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  getJudgeConfigurationDraft,
  previewJudgeConfigurationDraft,
  publishJudgeConfiguration,
  readJudgeConfigurationResources,
  replaceJudgeConfigurationDraft,
} from "../api/judgeConfigurations";
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
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  outlineButtonClasses,
  textAreaClasses,
} from "../lib/ui";

const CLIENT: DefinitionClient<
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationPayloadSchema,
  JudgeConfigurationPreviewResponse
> = {
  getDraft: getJudgeConfigurationDraft,
  previewDraft: previewJudgeConfigurationDraft,
  replaceDraft: replaceJudgeConfigurationDraft,
  publish: publishJudgeConfiguration,
  // A judge carries no derived evidence, so the content *is* the payload.
  toPayload: (content) => content,
  unavailable: "The judge service is unavailable.",
};

/** What each evidence scope shows the judge, in the words an author decides by. */
const SCOPES: Record<JudgeEvidenceScope, string> = {
  customer_turns: "What the customer said to this arm, in order.",
  agent_replies: "What this arm answered. Without it, the judge scores the calls alone.",
  tool_calls: "Which tools the arm called, with what arguments, and how each answered.",
  state_changes: "Which calls moved this arm's world.",
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
  const editor = useDefinitionEditor(judgeId, CLIENT);
  const { content, preview, edit } = editor;
  const [resources, setResources] = useState<JudgeConfigurationResourcesResponse | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

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

  const models = resources?.judges.find(
    (judge) => judge.provider === content.model.provider,
  )?.models;

  return (
    <>
      <PageHeader
        title={content.name}
        chips={<VersionChips preview={preview} />}
        description={
          <>
            <Link className="font-semibold text-lab-ink" to=".." relative="path">
              Judges
            </Link>{" "}
            · {content.model.model_id}
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

      {(editor.error ?? resourceError) ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {editor.error ?? resourceError}
        </p>
      ) : null}
      <div className="mb-4 grid gap-1">
        <PublishReasons preview={preview} dirty={editor.dirty} />
      </div>
      {publishedVersion !== null ? (
        <p role="status" className="mb-4 text-[13px] text-lab-success">
          Published version {publishedVersion}. Every verdict records the version that produced it.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4">
          <Card title="Rubric">
            <label className={fieldLabelClasses}>
              Name
              <input
                className={fieldControlClasses}
                value={content.name}
                onChange={(event) => edit({ ...content, name: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Description
              <input
                className={fieldControlClasses}
                value={content.description}
                onChange={(event) => edit({ ...content, description: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              How this judge scores
              <textarea
                className={`${textAreaClasses} min-h-56 font-mono`}
                value={content.rubric}
                onChange={(event) => edit({ ...content, rubric: event.target.value })}
              />
            </label>
            <p className="text-xs text-admin-muted">
              What "met", "missed", and "unclear" mean is the lab's rule and travels above every
              rubric — including that "unclear" is a real answer rather than a failure. Write what
              the judge is looking for, not how to report it.
            </p>
          </Card>

          <Card title="Evidence">
            <p className="mb-3 text-xs text-admin-muted">
              A judge shown different things is answering a different question, so this is part of
              the published version and of its fingerprint — not a display setting.
            </p>
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
                      <span className="font-semibold text-lab-ink">{scope.replace(/_/g, " ")}</span>
                      <br />
                      {SCOPES[scope]}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Publish gate">
            <IssueList issues={preview?.issues ?? []} />
          </Card>

          <Card title="Model">
            <label className={fieldLabelClasses}>
              Provider
              <select
                aria-label="Provider"
                className={fieldControlClasses}
                value={content.model.provider}
                onChange={(event) =>
                  edit({
                    ...content,
                    model: { ...content.model, provider: event.target.value },
                  })
                }
              >
                {(resources?.judges ?? []).map((judge) => (
                  <option key={judge.provider} value={judge.provider}>
                    {judge.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldLabelClasses}>
              Model
              <input
                className={fieldControlClasses}
                list="judge-models"
                value={content.model.model_id}
                onChange={(event) =>
                  edit({
                    ...content,
                    model: { ...content.model, model_id: event.target.value },
                  })
                }
              />
            </label>
            <datalist id="judge-models">
              {(models ?? []).map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <label className={fieldLabelClasses}>
              Temperature
              <input
                className={fieldControlClasses}
                value={content.model.temperature}
                onChange={(event) =>
                  edit({
                    ...content,
                    model: { ...content.model, temperature: event.target.value },
                  })
                }
              />
            </label>
            <p className="text-xs text-admin-muted">
              Zero by default: a judge is rerun to see whether a verdict holds, and one that varied
              for its own reasons would make every rerun unreadable.
            </p>
          </Card>

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
