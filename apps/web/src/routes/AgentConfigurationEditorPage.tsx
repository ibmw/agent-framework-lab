import type {
  AgentConfigurationPayloadSchema,
  AgentConfigurationPreviewResponse,
  AgentConfigurationResolutionSchema,
  AgentConfigurationResourcesResponse,
  MemoryMode,
  PreviewShopOptionSchema,
  ResolvedVariableSchema,
  ToneOfVoiceOptionSchema,
  ToneOfVoiceSource,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getAgentConfigurationDraft,
  previewAgentConfigurationDraft,
  publishAgentConfiguration,
  readAgentConfigurationResources,
  replaceAgentConfigurationDraft,
  toAgentConfigurationPayload,
} from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
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
import { ARCHITECTURE_LABELS, ARCHITECTURES, describeProvider } from "../lib/agents";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { SLUG_MAX_LENGTH } from "../lib/entryIds";
import { labelOf, SUPPORT_PERMISSION } from "../lib/enumLabels";
import {
  LABEL_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
  PROVEN_PROVIDER_RULE,
  SUPPORT_IDENTITY_PIN_RULE,
  TEMPERATURE_PATTERN,
  TEMPERATURE_RULE,
  TEXT_MAX_LENGTH,
  TONE_OVERRIDE_RULE,
  unprovenAgentProviderRule,
} from "../lib/fieldRules";
import { unreachableProviderNote } from "../lib/modelConnections";
import { pythonStrip } from "../lib/pythonText";
import {
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  readOnlyValueClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useUnreachableProviders } from "../lib/useUnreachableProviders";
import { useLabWorkspace } from "../shell/useLabWorkspace";

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
  toPayload: toAgentConfigurationPayload,
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

/**
 * What the preview picker decides, which its second line ("Values: …") answers. The values
 * come from the chosen shop's published version and the adopted identity's
 * (`AgentConfigurationService.resolve`, `application/agent_configurations.py`), and a run
 * resolves the template again against the shop its experiment names — the card's first line.
 */
const PREVIEW_CONTEXT_RULE =
  "The shop whose published version, with the adopted identity's, fills the resolved prompt below.";

const GROUP_LABELS: Record<string, string> = {
  shop: "Shop",
  support_identity: "Support identity",
  interaction: "Customer · order · ticket",
};

const VARIABLE_PATTERN = /\{\{([^{}]*)\}\}/g;

export function AgentConfigurationEditorPage() {
  const { configurationId = "" } = useParams();
  const { currentShop, loading: shopsLoading, listings } = useLabWorkspace();
  const publishReasonsId = useId();
  const editor = useDefinitionEditor(configurationId, CLIENT, {
    label: "The agent configuration draft has unsaved changes.",
    // The library index prints the row this editor is changing, and it renders the shell's
    // listing rather than reading its own (ADR 0056).
    afterSave: listings.agentConfigurations.refresh,
  });
  const { content, preview, edit } = editor;
  const [resources, setResources] = useState<AgentConfigurationResourcesResponse | null>(null);
  // Whether the resources read is still in flight, which `resources === null` does not say: it
  // is also how a failed read looks, and how a read that failed while a later preview cleared
  // the error message looks. The preview picker needs the difference, because "nothing has
  // answered yet" and "nothing came back" are the same value and opposite things to say.
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resolution, setResolution] = useState<AgentConfigurationResolutionSchema | null>(null);
  // The shop the author has picked, or null while they have picked none. The preview shop
  // itself is *derived* below rather than stored: two answers the page is waiting for decide
  // it — the lab's current shop and the shops the resources offer — and they arrive in either
  // order. Seeding state from the first render instead would have settled the question before
  // either had come back, which is how a lab with a remembered shop opened this editor on
  // somebody else's (ADR 0054).
  const [chosenShopId, setChosenShopId] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  // Every resolution — the effect's, and the ones a save or a publish fires — runs through
  // one controller. A save resolving shop A followed immediately by a switch to shop B would
  // otherwise let A's late answer overwrite B's, leaving the chips describing a shop the
  // picker no longer shows.
  const inFlight = useRef<AbortController | null>(null);
  const unreachable = useUnreachableProviders();

  useEffect(() => {
    const controller = new AbortController();
    readAgentConfigurationResources(controller.signal)
      .then((body) => {
        setResources(body);
        setContextError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setContextError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setResourcesLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  /**
   * The shop the prompt is resolved against: what the author chose, else the lab's current
   * shop, else the first the resources offer.
   *
   * Each candidate has to be one the resources actually offer. A select holding a value that
   * is not among its options is a control showing something nobody picked, and the read it
   * would drive is a read for a shop this editor cannot name. Empty until the resources
   * answer, which is also when the picker has nothing to draw.
   *
   * The fallback waits for the shop list. Two reads settle this — the resources and the lab's
   * shops — and the fallback is only correct once the second has answered: reaching for it
   * while the list is still in flight would draw the picker on the first shop offered, resolve
   * the prompt against it, and then jump to the author's remembered shop a moment later. That
   * is right at rest and wrong to watch, so `loading` is read for the reason `LabWorkspace`
   * documents it — until the list answers, "there is no current shop" is a fact this page has
   * not established. The empty interval is the shop-free gate read the editor already makes,
   * so waiting costs no request class it did not have.
   */
  const offeredShop = (shopId: string | null | undefined): string | undefined =>
    shopId && resources?.preview_shops.some((shop) => shop.shop_id === shopId) ? shopId : undefined;
  const previewShopId =
    offeredShop(chosenShopId) ??
    offeredShop(currentShop?.shop_id) ??
    (shopsLoading ? "" : resources?.preview_shops[0]?.shop_id) ??
    "";
  const previewShops = resources?.preview_shops ?? [];
  // The picker is still asking while either read is in flight — that is a statement about
  // progress, and the value it happens to hold is not one. An empty `previewShopId` is also
  // where a lab with no shops comes to rest, and a control that says "Choosing a shop…" for
  // ever is progress copy over a final state; below, that state gets a sentence instead of a
  // select with one option that chooses nothing (`docs/design-direction.md`, *The form
  // language*).
  const previewSettling = resourcesLoading || shopsLoading;

  const resolve = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const body = await previewAgentConfigurationDraft(
        configurationId,
        previewShopId,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setResolution(body.resolution);
        // A transient failure must not pin its message over an editor that works again.
        setContextError(null);
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setContextError(describeApiError(cause, UNAVAILABLE));
      }
    }
  }, [configurationId, previewShopId]);

  useEffect(() => {
    void resolve();
    return () => inFlight.current?.abort();
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
    if (version !== null) {
      void listings.agentConfigurations.refresh();
    }
    return version;
  }, [publishDraft, resolve, listings.agentConfigurations]);

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
  const permitted = new Map((resolution?.tools ?? []).map((tool) => [tool.name, tool.permitted]));
  const enabled = new Set(content.tools);

  const framework =
    resources?.frameworks.find((entry) => entry.framework_id === content.framework_id) ?? null;
  // The catalog's set, plus whatever the payload currently carries. A select can only hold a
  // value it offers, so an option that is missing would leave the control showing one provider
  // while the draft saves another — the control lying about the payload rather than the
  // payload being wrong. An off-list value keeps its option and is told about beneath.
  const provenProviders = framework?.providers ?? [];
  const providers = provenProviders.includes(content.model.provider)
    ? provenProviders
    : [...provenProviders, content.model.provider];
  const provenModels = framework?.models ?? [];
  const unprovenProvider = framework !== null && !provenProviders.includes(content.model.provider);
  // A note about this lab, beside the field and nowhere else: not in the gate, whose answer is
  // the same on every machine, and not in `PublishReasons`, because it blocks nothing (ADR 0053).
  const providerNote = unreachable?.has(content.model.provider)
    ? unreachableProviderNote(describeProvider(content.model.provider))
    : null;
  const previewShop = resources?.preview_shops.find((shop) => shop.shop_id === previewShopId);
  const guidelines = previewShop?.tone_of_voice_guidelines ?? [];
  const resolvedValues = resolution ? (
    <>
      Values:{" "}
      {resolution.shop_name === null
        ? "no published shop"
        : `${resolution.shop_name} v${resolution.shop_version}`}{" "}
      ·{" "}
      {resolution.support_identity_name === null
        ? "unpublished identity"
        : `${resolution.support_identity_name} v${resolution.support_identity_version}`}
    </>
  ) : null;

  /**
   * Changing the framework changes what the lab has proven, so the two fields under it follow.
   *
   * The provider **resets** when it leaves the new framework's set, because the control is a
   * select that cannot represent a value it does not offer and the gate refuses one outright.
   * The model resets only when the provider actually moved, because a model name means nothing
   * outside its provider — and where the provider is unchanged (Pydantic AI and the OpenAI
   * Agents SDK are both proven on `openai`) a model the author typed is theirs to keep, since
   * the gate only warns about it. That is the same rule the judge editor applies to a provider
   * change; only the field that triggers it differs.
   */
  function chooseFramework(frameworkId: string) {
    if (!content) {
      return;
    }
    const next = resources?.frameworks.find((entry) => entry.framework_id === frameworkId);
    const provider =
      next === undefined || next.providers.includes(content.model.provider)
        ? content.model.provider
        : (next.providers[0] ?? content.model.provider);
    const modelId =
      provider === content.model.provider
        ? content.model.model_id
        : (next?.models[0] ?? content.model.model_id);
    edit({
      ...content,
      framework_id: frameworkId,
      model: { ...content.model, provider, model_id: modelId },
    });
  }

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
        // When the variables resolve is the Variables card's to say, beside them.
        back={{
          to: "..",
          label: "Agent configs",
          kind: "configuration",
          detail: (
            <>
              shop-independent
              {preview ? (
                <>
                  {" "}
                  · draft fingerprint <Fingerprint value={preview.content_fingerprint} />
                </>
              ) : null}
            </>
          ),
        }}
        actions={
          <>
            <EditorSaveActions
              dirty={editor.dirty}
              saving={editor.saving}
              discarding={editor.discarding}
              onSave={() => void save()}
              onDiscard={() => void editor.discard()}
            />
            <PublishButton
              preview={preview}
              dirty={editor.dirty}
              checking={editor.checking}
              publishing={editor.publishing}
              reasonsId={publishReasonsId}
              onPublish={() => {
                void publish().then((version) => setPublishedVersion(version));
              }}
            />
          </>
        }
        reasons={
          <>
            {(editor.error ?? contextError) ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {editor.error ?? contextError}
              </p>
            ) : null}
            {publishedVersion !== null ? (
              <p role="status" className="text-[13px] text-lab-success">
                Published version {publishedVersion}. An experiment pins this exact version.
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
          <Card title="Identity">
            <FieldRows>
              <Field label="Name">
                <input
                  maxLength={LABEL_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  value={content.name}
                  onChange={(event) => edit({ ...content, name: event.target.value })}
                />
              </Field>
              <Field label="Framework">
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.framework_id}
                  onChange={(event) => chooseFramework(event.target.value)}
                >
                  {(resources?.frameworks ?? []).map((framework) => (
                    <option key={framework.framework_id} value={framework.framework_id}>
                      {framework.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Architecture">
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.architecture}
                  onChange={(event) =>
                    edit({
                      ...content,
                      architecture: event.target.value as typeof content.architecture,
                    })
                  }
                >
                  {ARCHITECTURES.map((value) => (
                    <option key={value} value={value}>
                      {ARCHITECTURE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Support identity">
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.support_identity_id}
                  onChange={(event) =>
                    edit({ ...content, support_identity_id: event.target.value })
                  }
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

          <Card
            title="System prompt"
            description={
              <>
                Type <code className="font-mono">{"{{"}</code> to add variables, or insert one from
                the panel. The prompt stays a template: what you see resolved here comes from the
                preview context, and a run resolves it again against its own shop.
              </>
            }
          >
            {/* The rule names what the picker decides — the published versions the resolved
                prompt is read from (`AgentConfigurationService.resolve` reads the shop's and the
                identity's published versions) — and the second line answers it with the ones
                this context resolved. */}
            <FieldRows>
              {previewSettling || previewShops.length > 0 ? (
                <Field label="Preview context" hint={PREVIEW_CONTEXT_RULE} extra={resolvedValues}>
                  <select
                    className={`${fieldControlClasses} w-full`}
                    value={previewShopId}
                    onChange={(event) => setChosenShopId(event.target.value)}
                  >
                    {/* A select whose value matches no option shows its first one, so "nothing
                        is settled yet" needs an option of its own to be visible at all —
                        otherwise this control names a shop while the prompt beside it resolves
                        against none. The same shape as the top bar's switcher before a shop is
                        chosen. It is drawn while a read is in flight and never once both have
                        answered: it is the question being asked, not the value that came back. */}
                    {previewSettling ? <option value="">Choosing a shop…</option> : null}
                    {previewShops.map((shop) => (
                      <option key={shop.shop_id} value={shop.shop_id}>
                        {shop.name}
                        {shop.latest_published_version === null
                          ? " (never published)"
                          : ` v${shop.latest_published_version}`}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                // Both reads have answered and offered nothing, so there is no choice to make
                // and no control to make it with. A select of one placeholder is the same
                // sentence with a disclosure arrow on it, so the row shows the sentence as a
                // value the editor states rather than asks, as the scenario's Built on does.
                <Field label="Preview context" hint={PREVIEW_CONTEXT_RULE} extra={resolvedValues}>
                  <output className={readOnlyValueClasses}>
                    {resources === null
                      ? "The shops this prompt would resolve against could not be read."
                      : "This lab has no shops, so there is nothing to resolve the prompt against."}
                  </output>
                </Field>
              )}
            </FieldRows>
            <textarea
              maxLength={PROMPT_MAX_LENGTH}
              ref={promptRef}
              aria-label="Prompt template"
              // The size is `!` because it has to beat the one it overrides: `textAreaClasses`
              // sets `text-[14px]` (UI-7), and which of two `text-…` utilities wins is Tailwind's
              // own emit order — lexical on the candidate text for arbitrary values — not the
              // order a caller writes them. `12.5` sorts before `14`, so a plain `text-[12.5px]`
              // here would lose to the shared string and silently enlarge the template editor.
              // Lexical, not numeric: the built sheet emits `.text-[14.5px]` *before*
              // `.text-[14px]`, so an override is not safe merely because its number is smaller.
              className={`${textAreaClasses} w-full min-h-56 font-mono text-[12.5px]!`}
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
            <FieldRows>
              {/*
               * The note that used to close the card is this field's rule: how the source
               * resolves (`{{shop.tone_of_voice}}`, which `AgentConfigurationResolutionSchema`
               * carries as `tone_of_voice_label`) and what an override the target shop lacks
               * does. What the preview context resolves it to is the second line — only where
               * no field carries the answer. An override says what it resolves to beside the ID
               * that names it, and this line is the *saved* draft's resolution — so on an
               * override it would contradict the field for as long as the edit is unsaved,
               * which is a card arguing with itself.
               */}
              <Field
                label="Source"
                hint={
                  <>
                    Resolves per shop through{" "}
                    <code className="font-mono">{"{{shop.tone_of_voice}}"}</code>. An override
                    missing from the target shop fails at experiment setup and is reported as a
                    configuration variable in comparisons.
                  </>
                }
                extra={
                  content.tone_of_voice.source === "override"
                    ? null
                    : resolution?.tone_of_voice_label
                      ? `This context resolves to ${resolution.tone_of_voice_label}.`
                      : "This context resolves to nothing yet."
                }
              >
                <select
                  aria-label="Tone of voice source"
                  className={`${fieldControlClasses} w-full`}
                  value={content.tone_of_voice.source}
                  onChange={(event) =>
                    edit({
                      ...content,
                      tone_of_voice: {
                        source: event.target.value as ToneOfVoiceSource,
                        guideline_id:
                          event.target.value === "override"
                            ? content.tone_of_voice.guideline_id
                            : "",
                      },
                    })
                  }
                >
                  <option value="shop_default">Shop default (recommended)</option>
                  <option value="override">Named override</option>
                </select>
              </Field>
              {/*
               * The preview shop's own list, served with the option (`tone_of_voice_guidelines`
               * on `PreviewShopOptionSchema`) and read off its *published* version, because
               * that is the version a run resolves against. A datalist rather than a select
               * for `CountryField`'s reason: the configuration is shop-independent, so an ID
               * this shop does not publish may still be the right one for the shop the
               * experiment will name, and a dropdown would refuse it here while the lab takes
               * it. The line beneath says which of the two it is, live.
               */}
              {content.tone_of_voice.source === "override" ? (
                <Field
                  label="Guideline ID"
                  hint={TONE_OVERRIDE_RULE}
                  extra={overrideEcho(content.tone_of_voice.guideline_id, guidelines, previewShop)}
                >
                  <input
                    maxLength={SLUG_MAX_LENGTH}
                    className={`${fieldControlClasses} w-full`}
                    list="tone-of-voice-guidelines"
                    value={content.tone_of_voice.guideline_id}
                    autoComplete="off"
                    placeholder="warm-precise"
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
                </Field>
              ) : null}
            </FieldRows>
            <datalist id="tone-of-voice-guidelines">
              {guidelines.map((guideline) => (
                <option key={guideline.id} value={guideline.id} label={guideline.name} />
              ))}
            </datalist>
          </Card>

          <Card
            title={`Tool bindings · ${content.tools.length} enabled`}
            description={
              <>
                A write an agent could never be authorized to make is refused at publication, not at
                its first call.
              </>
            }
          >
            <ul className="grid gap-2">
              {/*
               * The published set, not the resolution: whether a tool is enabled is the
               * draft's own answer, and a resolution that failed to load must not hide a
               * binding the payload will still save. Only "permitted" needs the resolution.
               */}
              {(resources?.tools ?? []).map((tool) => (
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
                    {tool.required_permission && permitted.get(tool.name) === false ? (
                      <span className="text-[11.5px] font-semibold text-lab-error">
                        needs {labelOf(SUPPORT_PERMISSION, tool.required_permission)}
                      </span>
                    ) : null}
                  </label>
                  <span className="pl-6 text-xs text-admin-muted">{tool.summary}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="LLM and runtime">
            <FieldRows>
              <Field
                label="Provider"
                hint={PROVEN_PROVIDER_RULE}
                extra={
                  unprovenProvider && framework
                    ? unprovenAgentProviderRule(content.model.provider, framework.label)
                    : providerNote
                }
                extraTone={unprovenProvider ? "error" : "muted"}
              >
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.model.provider}
                  onChange={(event) =>
                    edit({
                      ...content,
                      model: {
                        ...content.model,
                        provider: event.target.value,
                        // A model belongs to its provider, so it follows one here for the
                        // reason it follows one in the judge editor.
                        model_id: provenModels[0] ?? content.model.model_id,
                      },
                    })
                  }
                >
                  {providers.map((provider) => (
                    <option key={provider} value={provider}>
                      {describeProvider(provider)}
                    </option>
                  ))}
                </select>
              </Field>
              <ProvenModelField
                arrangement="row"
                value={content.model.model_id}
                models={provenModels}
                proven={framework?.label ?? content.framework_id}
                onChange={(modelId) =>
                  edit({ ...content, model: { ...content.model, model_id: modelId } })
                }
              />
              <Field label="Temperature" hint={TEMPERATURE_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={content.model.temperature}
                  inputMode="decimal"
                  pattern={TEMPERATURE_PATTERN}
                  title={TEMPERATURE_RULE}
                  placeholder="0.20"
                  onChange={(event) =>
                    edit({
                      ...content,
                      model: { ...content.model, temperature: event.target.value },
                    })
                  }
                />
              </Field>
              <ToolRoundsField
                value={content.model.max_tool_rounds}
                onChange={(rounds) =>
                  edit({ ...content, model: { ...content.model, max_tool_rounds: rounds } })
                }
              />
              {/* Three named radios, each with the line that says what it keeps: a closed set
                  whose options need an explanation is not a chip group. */}
              <FieldGroup label="Memory">
                <div className="grid gap-2">
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
                </div>
              </FieldGroup>
            </FieldRows>
          </Card>
        </div>

        <div className={editorPanelClasses}>
          <GateCard title="Publish gate" busy={editor.checking} dirty={editor.dirty}>
            <IssueList issues={preview?.issues ?? []} />
          </GateCard>

          <Card
            title="Variables"
            label="Variables"
            description="Resolved at experiment start; the resolved configuration is pinned to the run."
          >
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

          <Card title="Reproducibility">
            <p className="text-[13px] text-admin-ink-soft">
              {SUPPORT_IDENTITY_PIN_RULE} Starting an experiment records the resolved prompt, tone
              of voice, model, and tool bindings, so a published version keeps explaining a past run
              while the template stays reusable.
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

/**
 * What the preview shop resolves a typed override ID to, beside the field that took it.
 *
 * Three answers, and each is a different fact. A named guideline echoes its name, which is
 * the whole point of the paired line: the ID is what the payload carries and the name is what
 * the run will inject. An ID this shop does not publish is stated as that and no more — this
 * page's gate does not refuse it, because a configuration is shop-independent and the shop an
 * experiment names may publish it; what refuses it is experiment setup, so that is what the
 * line says. And a shop with no published version has no list to be missing from at all.
 */
function overrideEcho(
  guidelineId: string,
  guidelines: ToneOfVoiceOptionSchema[],
  shop: PreviewShopOptionSchema | undefined,
): string | null {
  if (guidelineId === "") {
    return null;
  }
  if (shop === undefined) {
    // The resources are still loading, or name no such shop. Saying "no published version"
    // here would be a claim about a shop this page has not seen.
    return null;
  }
  const named = guidelines.find((guideline) => guideline.id === guidelineId);
  if (named) {
    return `Resolves to ${named.name} in ${shop.name}.`;
  }
  if (shop.latest_published_version === null) {
    return `${shop.name} has no published version, so nothing resolves here yet.`;
  }
  return `${shop.name} v${shop.latest_published_version} publishes no guideline with this ID. An override missing from the target shop fails at experiment setup.`;
}

/**
 * The tool-round limit, kept as text while it is being typed.
 *
 * Bound straight to the payload, clearing the field commits `Number("") === 0` — a value the
 * domain refuses, so the next save answers 422 for something the author was in the middle of
 * typing. The draft only sees a number the contract would accept.
 */
function ToolRoundsField({
  value,
  onChange,
}: {
  value: number;
  onChange: (rounds: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <Field label="Max tool rounds">
      <input
        className={`${fieldControlClasses} w-full`}
        type="number"
        min={1}
        max={50}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const rounds = Number(event.target.value);
          if (Number.isInteger(rounds) && rounds >= 1 && rounds <= 50) {
            onChange(rounds);
          }
        }}
        onBlur={() => setText(String(value))}
      />
    </Field>
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
  const injectable = variables.some((variable) => variable.injectable);
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
    // As `scan_prompt_variables` strips it in Python, so a chip names the variable the gate reads.
    const name = pythonStrip(match[1]);
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
