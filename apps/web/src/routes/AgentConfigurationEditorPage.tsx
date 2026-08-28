import type {
  AgentConfigurationPayloadSchema,
  AgentConfigurationPreviewResponse,
  AgentConfigurationResolutionSchema,
  AgentConfigurationResourcesResponse,
  MemoryMode,
  ResolvedVariableSchema,
  ToneOfVoiceSource,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getAgentConfigurationDraft,
  previewAgentConfigurationDraft,
  publishAgentConfiguration,
  readAgentConfigurationResources,
  replaceAgentConfigurationDraft,
} from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
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
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "The agent-configuration service is unavailable.";

/**
 * The gate half of the preview, read without a shop.
 *
 * The resolution half is fetched separately, because the author picks which shop to resolve
 * against and that choice must not reload — and discard — the draft being edited.
 */
const CLIENT: DefinitionClient<
  AgentConfigurationPayloadSchema,
  AgentConfigurationPayloadSchema,
  AgentConfigurationPreviewResponse
> = {
  getDraft: getAgentConfigurationDraft,
  previewDraft: (id, signal) => previewAgentConfigurationDraft(id, undefined, signal),
  replaceDraft: replaceAgentConfigurationDraft,
  publish: publishAgentConfiguration,
  // A configuration carries no derived evidence, so the content *is* the payload.
  toPayload: (content) => content,
  unavailable: UNAVAILABLE,
};

const MEMORY_MODES: { value: MemoryMode; label: string; detail: string }[] = [
  { value: "none", label: "None", detail: "Every turn starts from the prompt and the tools." },
  {
    value: "conversation",
    label: "Conversation",
    detail: "The run's own turns are replayed to the model.",
  },
  {
    value: "durable",
    label: "Durable",
    detail: "Memory the lab persists and can restore across runs.",
  },
];

const GROUP_LABELS: Record<string, string> = {
  shop: "Shop",
  support_identity: "Support identity",
  interaction: "Customer · order · ticket",
};

const VARIABLE_PATTERN = /\{\{([^{}]*)\}\}/g;

export function AgentConfigurationEditorPage() {
  const { configurationId = "" } = useParams();
  const { shopId } = useShopWorkspace();
  const editor = useDefinitionEditor(configurationId, CLIENT);
  const { content, preview, edit } = editor;
  const [resources, setResources] = useState<AgentConfigurationResourcesResponse | null>(null);
  const [resolution, setResolution] = useState<AgentConfigurationResolutionSchema | null>(null);
  const [previewShopId, setPreviewShopId] = useState(shopId);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    readAgentConfigurationResources(controller.signal)
      .then(setResources)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setContextError(describeApiError(cause, UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, []);

  const resolve = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const body = await previewAgentConfigurationDraft(configurationId, previewShopId, signal);
        setResolution(body.resolution);
      } catch (cause: unknown) {
        if (!signal?.aborted) {
          setContextError(describeApiError(cause, UNAVAILABLE));
        }
      }
    },
    [configurationId, previewShopId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void resolve(controller.signal);
    return () => controller.abort();
  }, [resolve]);

  // A save or a publish changes what a run would inject, so the resolution follows both
  // rather than waiting for the author to touch the preview-context picker.
  const { save: saveDraft, publish: publishDraft } = editor;
  const save = useCallback(async () => {
    await saveDraft();
    await resolve();
  }, [saveDraft, resolve]);

  const publish = useCallback(async () => {
    const version = await publishDraft();
    await resolve();
    return version;
  }, [publishDraft, resolve]);

  const insertVariable = useCallback(
    (name: string) => {
      const field = promptRef.current;
      if (!content || !field) {
        return;
      }
      const token = `{{${name}}}`;
      const start = field.selectionStart;
      const end = field.selectionEnd;
      edit({
        ...content,
        prompt: `${content.prompt.slice(0, start)}${token}${content.prompt.slice(end)}`,
      });
      // Put the caret after the chip the author just asked for, so a second insert does not
      // land back at the top of the prompt.
      requestAnimationFrame(() => {
        field.focus();
        field.setSelectionRange(start + token.length, start + token.length);
      });
    },
    [content, edit],
  );

  if (editor.loading) {
    return <p className="text-sm text-admin-muted">Loading agent configuration…</p>;
  }

  if (!content) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {editor.error ?? "This agent configuration could not be loaded."}
      </div>
    );
  }

  const values = new Map((resolution?.variables ?? []).map((entry) => [entry.name, entry]));
  const enabled = new Set(content.tools);

  function toggleTool(name: string) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      tools: enabled.has(name)
        ? content.tools.filter((entry) => entry !== name)
        : [...content.tools, name],
    });
  }

  return (
    <>
      <PageHeader
        title={content.name}
        chips={<VersionChips preview={preview} />}
        description={
          <>
            <Link className="font-semibold text-lab-ink" to=".." relative="path">
              Agent configurations
            </Link>{" "}
            · Shop-independent — variables resolve at experiment start, and the resolved
            configuration is pinned to the run.
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
              onClick={() => void save()}
              disabled={!editor.dirty || editor.saving}
            >
              {editor.saving ? "Saving…" : editor.dirty ? "Save draft" : "Saved"}
            </button>
            <button
              className={accentButtonClasses}
              type="button"
              onClick={() => {
                void publish().then((version) => setPublishedVersion(version));
              }}
              disabled={editor.publishing || !canPublish(preview, editor.dirty)}
            >
              {editor.publishing ? "Publishing…" : `Publish v${preview?.next_version ?? 1}`}
            </button>
          </>
        }
      />

      {(editor.error ?? contextError) ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {editor.error ?? contextError}
        </p>
      ) : null}
      <div className="mb-4 grid gap-1">
        <PublishReasons preview={preview} dirty={editor.dirty} />
      </div>
      {publishedVersion !== null ? (
        <p role="status" className="mb-4 text-[13px] text-lab-success">
          Published version {publishedVersion}. An experiment pins this exact version.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-4">
          <Card title="Identity">
            <label className={fieldLabelClasses}>
              Name
              <input
                className={fieldControlClasses}
                value={content.name}
                onChange={(event) => edit({ ...content, name: event.target.value })}
              />
            </label>
            <label className={fieldLabelClasses}>
              Framework
              <select
                aria-label="Framework"
                className={fieldControlClasses}
                value={content.framework_id}
                onChange={(event) => edit({ ...content, framework_id: event.target.value })}
              >
                {(resources?.frameworks ?? []).map((framework) => (
                  <option key={framework.framework_id} value={framework.framework_id}>
                    {framework.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldLabelClasses}>
              Architecture
              <select
                aria-label="Architecture"
                className={fieldControlClasses}
                value={content.architecture}
                onChange={(event) =>
                  edit({
                    ...content,
                    architecture: event.target.value as typeof content.architecture,
                  })
                }
              >
                <option value="single_agent">Single agent</option>
              </select>
            </label>
            <label className={fieldLabelClasses}>
              Support identity
              <select
                aria-label="Support identity"
                className={fieldControlClasses}
                value={content.support_identity_id}
                onChange={(event) => edit({ ...content, support_identity_id: event.target.value })}
              >
                {(resources?.support_identities ?? []).map((identity) => (
                  <option key={identity.identity_id} value={identity.identity_id}>
                    {identity.name} · {identity.title}
                    {identity.latest_published_version === null
                      ? " (never published)"
                      : ` (v${identity.latest_published_version})`}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldLabelClasses}>
              Description
              <textarea
                className={textAreaClasses}
                value={content.description}
                onChange={(event) => edit({ ...content, description: event.target.value })}
              />
            </label>
          </Card>

          <Card
            title="System prompt"
            footer={
              <p className="text-xs text-admin-muted">
                Type <code className="font-mono">{"{{"}</code> to add variables, or insert one from
                the panel. The prompt stays a template: what you see resolved here comes from the
                preview context, and a run resolves it again against its own shop.
              </p>
            }
          >
            <label className={fieldLabelClasses}>
              Preview context
              <select
                className={fieldControlClasses}
                aria-label="Preview context"
                value={previewShopId}
                onChange={(event) => setPreviewShopId(event.target.value)}
              >
                {(resources?.preview_shops ?? []).map((shop) => (
                  <option key={shop.shop_id} value={shop.shop_id}>
                    {shop.name}
                    {shop.latest_published_version === null
                      ? " (never published)"
                      : ` v${shop.latest_published_version}`}
                  </option>
                ))}
              </select>
            </label>
            {resolution ? (
              <p className="text-xs text-admin-muted">
                Values:{" "}
                {resolution.shop_name === null
                  ? "no published shop"
                  : `${resolution.shop_name} v${resolution.shop_version}`}{" "}
                ·{" "}
                {resolution.support_identity_name === null
                  ? "unpublished identity"
                  : `${resolution.support_identity_name} v${resolution.support_identity_version}`}
              </p>
            ) : null}
            <textarea
              ref={promptRef}
              aria-label="Prompt template"
              className={`${textAreaClasses} min-h-56 font-mono text-[12.5px]`}
              value={content.prompt}
              onChange={(event) => edit({ ...content, prompt: event.target.value })}
            />
            <section aria-label="Resolved prompt" className="grid gap-1">
              <h3 className="text-xs font-semibold text-admin-muted">Resolved</h3>
              <div className="rounded-lg border border-admin-border bg-admin-canvas p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
                <ResolvedPrompt prompt={content.prompt} values={values} />
              </div>
            </section>
          </Card>

          <Card title="Tone of voice">
            <label className={fieldLabelClasses}>
              Source
              <select
                aria-label="Tone of voice source"
                className={fieldControlClasses}
                value={content.tone_of_voice.source}
                onChange={(event) =>
                  edit({
                    ...content,
                    tone_of_voice: {
                      source: event.target.value as ToneOfVoiceSource,
                      guideline_id:
                        event.target.value === "override" ? content.tone_of_voice.guideline_id : "",
                    },
                  })
                }
              >
                <option value="shop_default">Shop default (recommended)</option>
                <option value="override">Named override</option>
              </select>
            </label>
            {content.tone_of_voice.source === "override" ? (
              <label className={fieldLabelClasses}>
                Guideline ID
                <input
                  className={fieldControlClasses}
                  value={content.tone_of_voice.guideline_id}
                  onChange={(event) =>
                    edit({
                      ...content,
                      tone_of_voice: {
                        ...content.tone_of_voice,
                        guideline_id: event.target.value,
                      },
                    })
                  }
                />
              </label>
            ) : null}
            <p className="text-xs text-admin-muted">
              Resolves per shop through{" "}
              <code className="font-mono">{"{{shop.tone_of_voice}}"}</code>
              {resolution?.tone_of_voice_label
                ? ` — this context resolves to ${resolution.tone_of_voice_label}.`
                : " — this context resolves to nothing yet."}{" "}
              An override missing from the target shop fails at experiment setup and is reported as
              a configuration variable in comparisons.
            </p>
          </Card>

          <Card title={`Tool bindings · ${content.tools.length} enabled`}>
            <ul className="grid gap-2">
              {(resolution?.tools ?? []).map((tool) => (
                <li key={tool.name} className="grid gap-0.5">
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={enabled.has(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                    />
                    <span className="font-mono text-[12.5px]">{tool.name}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-admin-border/60 px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
                      <span aria-hidden>{tool.effect === "write" ? "✎" : "◎"}</span>
                      {tool.effect}
                    </span>
                    {tool.required_permission && !tool.permitted ? (
                      <span className="text-[11.5px] font-semibold text-lab-error">
                        needs {tool.required_permission.replace(/_/g, " ")}
                      </span>
                    ) : null}
                  </label>
                  <span className="pl-6 text-xs text-admin-muted">{tool.summary}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-admin-muted">
              A write an agent could never be authorized to make is refused at publication, not at
              its first call.
            </p>
          </Card>

          <Card title="LLM and runtime">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldLabelClasses}>
                Provider
                <input
                  className={fieldControlClasses}
                  value={content.model.provider}
                  onChange={(event) =>
                    edit({
                      ...content,
                      model: { ...content.model, provider: event.target.value },
                    })
                  }
                />
              </label>
              <label className={fieldLabelClasses}>
                Model
                <input
                  className={fieldControlClasses}
                  value={content.model.model_id}
                  onChange={(event) =>
                    edit({
                      ...content,
                      model: { ...content.model, model_id: event.target.value },
                    })
                  }
                />
              </label>
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
              <label className={fieldLabelClasses}>
                Max tool rounds
                <input
                  className={fieldControlClasses}
                  type="number"
                  min={1}
                  max={50}
                  value={content.model.max_tool_rounds}
                  onChange={(event) =>
                    edit({
                      ...content,
                      model: {
                        ...content.model,
                        max_tool_rounds: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-xs font-semibold text-admin-muted uppercase">Memory</legend>
              {MEMORY_MODES.map((mode) => (
                <label key={mode.value} className="flex items-start gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="memory"
                    value={mode.value}
                    checked={content.memory === mode.value}
                    onChange={() => edit({ ...content, memory: mode.value })}
                  />
                  <span>
                    {mode.label}
                    <span className="block text-xs text-admin-muted">{mode.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-admin-muted">
              Temperature is an exact decimal, never a binary float: it is part of what a published
              version is fingerprinted on.
            </p>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card title="Variables" label="Variables">
            <p className="text-xs text-admin-muted">Resolved at experiment start.</p>
            {Object.entries(GROUP_LABELS).map(([group, label]) => (
              <VariableGroup
                key={group}
                label={label}
                variables={(resolution?.variables ?? []).filter(
                  (variable) => variable.group === group,
                )}
                onInsert={insertVariable}
              />
            ))}
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

          <Card title="Reproducibility">
            <p className="text-[13px] text-admin-ink-soft">
              Publishing pins the support-identity version this draft names. Starting an experiment
              records the resolved prompt, tone of voice, model, and tool bindings, so a published
              version keeps explaining a past run while the template stays reusable.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function VariableGroup({
  label,
  variables,
  onInsert,
}: {
  label: string;
  variables: ResolvedVariableSchema[];
  onInsert: (name: string) => void;
}) {
  if (variables.length === 0) {
    return null;
  }
  const injectable = variables[0].injectable;
  return (
    <section className="grid gap-1.5">
      <h3 className="text-xs font-semibold text-admin-muted uppercase">{label}</h3>
      <ul className="grid gap-1">
        {variables.map((variable) => (
          <li key={variable.name} className="flex items-center gap-2 text-[12.5px]">
            <code className="font-mono text-admin-ink-soft">{variable.name}</code>
            <span className="truncate text-admin-muted">{variable.value ?? "—"}</span>
            <button
              className={`${subtleButtonClasses} ml-auto`}
              type="button"
              disabled={!variable.injectable}
              aria-label={`Insert ${variable.name}`}
              title={
                variable.injectable
                  ? `Insert ${variable.name}`
                  : "Not injectable — agents discover this through tools"
              }
              onClick={() => onInsert(variable.name)}
            >
              +
            </button>
          </li>
        ))}
      </ul>
      {injectable ? null : (
        <p className="text-xs text-admin-muted">
          Not injectable — agents must discover these through tools. How they do that is part of
          what experiments compare.
        </p>
      )}
    </section>
  );
}

/**
 * The prompt with every `{{variable}}` rendered as the chip frame 5 shows: the name and what
 * the preview context resolves it to. A variable the lab does not resolve is chipped too, and
 * marked, because that is exactly what the publish gate is about to refuse.
 */
function ResolvedPrompt({
  prompt,
  values,
}: {
  prompt: string;
  values: Map<string, ResolvedVariableSchema>;
}) {
  const parts: React.ReactNode[] = [];
  let index = 0;
  let key = 0;
  VARIABLE_PATTERN.lastIndex = 0;
  let match = VARIABLE_PATTERN.exec(prompt);
  while (match !== null) {
    if (match.index > index) {
      parts.push(prompt.slice(index, match.index));
    }
    const name = match[1].trim();
    const resolved = values.get(name);
    const unresolvable = resolved === undefined || !resolved.injectable;
    parts.push(
      <code
        key={`chip-${key}`}
        className={
          unresolvable
            ? "rounded bg-lab-error/10 px-1.5 py-0.5 font-mono text-[11.5px] text-lab-error"
            : "rounded bg-lab-fingerprint px-1.5 py-0.5 font-mono text-[11.5px] text-lab-ink"
        }
      >
        {name}
        {unresolvable ? " · not injectable" : `: ${resolved.value ?? "unresolved"}`}
      </code>,
    );
    key += 1;
    index = match.index + match[0].length;
    match = VARIABLE_PATTERN.exec(prompt);
  }
  if (index < prompt.length) {
    parts.push(prompt.slice(index));
  }
  return <>{parts}</>;
}
