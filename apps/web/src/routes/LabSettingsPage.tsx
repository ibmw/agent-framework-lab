import type {
  AgentConfigurationResourcesResponse,
  LabSeedResponse,
  LabStatusResponse,
  ModelConnectionSchema,
  ModelConnectionSource,
  ModelConnectionTestResponse,
  ProvenFrameworkSchema,
  ProviderConnectionListResponse,
  ProviderConnectionSchema,
  ShopSummarySchema,
} from "@agent-lab/contracts";
import { ArrowLeft, ChevronDown, ChevronRight, Lock } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { readAgentConfigurationResources } from "../api/agentConfigurations";
import { describeApiError } from "../api/client";
import { seedLab } from "../api/labSeed";
import { getLabStatus } from "../api/labStatus";
import {
  listModelConnections,
  saveModelConnection,
  testModelConnection,
} from "../api/modelConnections";
import { ButtonIcon } from "../components/ButtonIcon";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { Card, EntryCard, EntryId, EntryKind, PageHeader } from "../components/WorkspaceChrome";
import { describeArchitecture, describeProvider, readableTerm } from "../lib/agents";
import {
  describeProbe,
  describeSource,
  describeZoneSource,
  ENDPOINT_PRESETS,
  presetForBaseUrl,
  sameEndpoint,
} from "../lib/modelConnections";
import {
  type AppLanding,
  forgetLastVisitedShop,
  readAppLanding,
  readConfirmBeforeDelete,
  readLastVisitedShop,
  readNavigationCollapsed,
  readSettingsReturn,
  readTimestampFormat,
  resetChosenPreferences,
  type TimestampFormat,
  writeAppLanding,
  writeConfirmBeforeDelete,
  writeNavigationCollapsed,
  writeTimestampFormat,
} from "../lib/preferences";
import { pythonStrip } from "../lib/pythonText";
import { useRefusalTouch } from "../lib/refusalTouch";
import {
  cardTitleClasses,
  focusRingClasses,
  formatAbsoluteTimestamp,
  formatTimestamp,
  idControlClasses,
  outlineButtonClasses,
  readOnlyValueClasses,
  subtleButtonClasses,
  warningButtonClasses,
} from "../lib/ui";
import { AppShell } from "../shell/AppShell";
import type { LabSurfaceValue } from "../shell/LabSurface";
import { useLabSurface } from "../shell/useLabSurface";

/**
 * A value composed at start-up, quoted where it can be changed: an environment variable, a
 * file path, a model name.
 *
 * `EntryId`'s own span does not wrap, which is right for an identifier in a chip row and wrong
 * for `AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces` inside a card
 * that hides its overflow — the one line on this page long enough to be clipped by it.
 */
function ConfigValue({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-admin-border/60 px-1.5 py-0.5 font-mono text-[12px] text-admin-ink-soft [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/**
 * One of the settings page's zones: a display heading, a line beside it saying what the zone
 * is, an optional control at the right, and whatever the zone holds.
 *
 * The zones are told apart twice over, because *at a glance* and *read out* are two different
 * readers. By **surface**: white where the cards may be edited, grey behind a padlock where
 * they report and cannot. By **role and heading**: each zone is a landmark named by its own
 * `h2`, so a reader who sees no colour still arrives at a run of named places rather than one
 * run of cards.
 */
function Zone({
  title,
  description,
  action,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id={headingId} className="font-display text-[18px] font-bold tracking-[-0.01em]">
          {title}
        </h2>
        <p className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-admin-muted [text-wrap:pretty]">
          {description}
        </p>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A card in the read-only zone: the grey ground, the padlock, and the "To change it:" line
 * every one of them ends in.
 *
 * It is not `Card` with a colour swapped. `Card`'s heading is an `h2`, and these sit under the
 * zone's own `h2`; and the line at the foot is the whole point of the treatment — a card that
 * says it cannot be edited here without saying where it can be is a dead end.
 */
function ReadOnlyCard({
  title,
  change,
  children,
}: {
  title: string;
  change: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-[10px] border border-admin-border bg-[#f6f7f8]"
    >
      <h3
        className={`flex items-center gap-2.5 border-b border-[#e5e9ec] px-[18px] py-[13px] ${cardTitleClasses}`}
      >
        <Lock size={13} aria-hidden="true" focusable="false" className="flex-none opacity-55" />
        {title}
      </h3>
      <div className="grid gap-2.5 px-[18px] py-4 text-[13px] leading-[1.6] text-admin-ink-soft">
        {children}
        <p className="text-xs text-admin-muted">To change it: {change}</p>
      </div>
    </section>
  );
}

/**
 * A closed set of two or three, drawn as the prototype's segmented control.
 *
 * Native radios underneath, because *a closed set is named radios* (`docs/design-direction.md`,
 * *The form language*) and because the prototype's own segments are `div`s with no role and no
 * name at all. The input carries the name and the keyboard behaviour; the label carries the
 * drawing, and takes the focus ring off the input beside it.
 */
function SegmentedChoice<T extends string>({
  name,
  value,
  options,
  onChoose,
}: {
  name: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChoose: (value: T) => void;
}) {
  const group = useId();
  return (
    <div className="inline-flex flex-wrap rounded-[9px] border border-[#dfe3e6] bg-[#f6f7f8] p-[3px]">
      {options.map(([option, label]) => (
        <label
          key={option}
          className={`flex min-h-[34px] cursor-pointer items-center rounded-[7px] px-[13px] text-[12.5px] whitespace-nowrap transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lab-primary ${
            option === value
              ? "bg-admin-surface font-bold text-admin-ink shadow-[0_1px_2px_rgb(22_51_45/10%)]"
              : "font-semibold text-admin-muted hover:text-admin-ink"
          }`}
        >
          <input
            type="radio"
            className="sr-only"
            name={`${group}-${name}`}
            checked={option === value}
            onChange={() => onChoose(option)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

/** The three openings, in the prototype's order and its words. */
const APP_LANDINGS: readonly (readonly [AppLanding, string])[] = [
  ["last-shop", "Last shop"],
  ["shops", "All shops"],
  ["lab", "Experiment lab"],
];

const APP_LANDING_HINTS: Readonly<Record<AppLanding, string>> = {
  "last-shop": "The shop you were last in, straight to its overview.",
  shops: "The list of shops, so you choose deliberately each time.",
  lab: "Straight to the experiment lab, for when you rarely touch a shop's setup.",
};

const TIMESTAMP_FORMATS: readonly (readonly [TimestampFormat, string])[] = [
  ["relative", "Relative"],
  ["absolute", "Absolute"],
];

/**
 * The instant the *absolute* reading's hint is drawn from. It goes through the formatter
 * rather than being typed beside it, so the hint cannot come to describe a shape the
 * workspace stopped drawing, and it renders in the reader's own zone, which is the one it is
 * an example of. The relative reading's hint is the prototype's own literal, because there is
 * no fixed instant a formatter could render "12 minutes ago" from.
 */
const TIMESTAMP_EXAMPLE = "2026-09-19T14:07:00+00:00";

/**
 * *Your preferences*: white, saved the moment they change, with one control that puts back the
 * four an operator chose.
 *
 * Five rows, not the prototype's seven. Auto-offered tours and table density are cut
 * (`docs/design-direction.md`, *Proposals, not decisions*; ADR 0049 refused the first
 * outright), and confirm-before-delete landed with the confirm it governs (ADR 0060).
 */
function PreferencesZone({ surface }: { surface: LabSurfaceValue }) {
  const [landing, setLanding] = useState(readAppLanding);
  const [collapsed, setCollapsed] = useState(readNavigationCollapsed);
  const [stamps, setStamps] = useState(readTimestampFormat);
  const [confirmDelete, setConfirmDelete] = useState(readConfirmBeforeDelete);
  const [rememberedId, setRememberedId] = useState(readLastVisitedShop);

  const rememberedShop = surface.shops.find((shop) => shop.shop_id === rememberedId) ?? null;

  function chooseLanding(next: AppLanding) {
    setLanding(next);
    writeAppLanding(next);
  }

  function chooseCollapsed(next: boolean) {
    setCollapsed(next);
    writeNavigationCollapsed(next);
  }

  function chooseStamps(next: TimestampFormat) {
    setStamps(next);
    writeTimestampFormat(next);
  }

  function chooseConfirmDelete(next: boolean) {
    setConfirmDelete(next);
    writeConfirmBeforeDelete(next);
  }

  function forget() {
    setRememberedId(null);
    forgetLastVisitedShop();
  }

  function reset() {
    setLanding("last-shop");
    setCollapsed(false);
    setStamps("relative");
    setConfirmDelete(true);
    resetChosenPreferences();
  }

  return (
    <Zone
      title="Your preferences"
      description="Saved in this browser the moment you change them — there is nothing to submit, and none of them reaches another browser or says anything about the lab."
      action={
        <button type="button" className={outlineButtonClasses} onClick={reset}>
          <ButtonIcon verb="discard" />
          Reset to defaults
        </button>
      }
    >
      <Card>
        <FieldRows>
          <FieldGroup
            label="Where the app opens"
            hint={
              landing === "last-shop" && rememberedShop === null && !surface.loading
                ? `${APP_LANDING_HINTS[landing]} With none remembered it opens the list of shops instead.`
                : APP_LANDING_HINTS[landing]
            }
          >
            <SegmentedChoice
              name="app-landing"
              value={landing}
              options={APP_LANDINGS}
              onChoose={chooseLanding}
            />
          </FieldGroup>

          <FieldGroup
            label="Last-visited shop"
            hint="Remembered as you move, so the opening above has somewhere to go. Forgetting it opens the list of shops instead."
          >
            {rememberedShop ? (
              <div className="flex flex-wrap items-center gap-4">
                <Link
                  className={`text-[13px] font-bold text-lab-ink underline-offset-2 hover:underline ${focusRingClasses}`}
                  to={`/shops/${rememberedShop.shop_id}`}
                >
                  {rememberedShop.name}
                </Link>
                <button
                  type="button"
                  className={subtleButtonClasses}
                  aria-label={`Forget ${rememberedShop.name}`}
                  onClick={forget}
                >
                  Forget
                </button>
              </div>
            ) : surface.loading || surface.error ? (
              // Until the shop list answers, this page has not established that there is no
              // remembered shop — only that it cannot yet name one.
              <p className="text-[13px] text-admin-muted">Reading…</p>
            ) : (
              <p className="text-[13px] text-admin-muted">
                None yet. Open a shop and this browser remembers the way back.
              </p>
            )}
          </FieldGroup>

          <Field
            label="Start with the navigation rail collapsed"
            hint="The rail's own collapse control writes this same preference."
          >
            <input
              type="checkbox"
              checked={collapsed}
              onChange={(event) => chooseCollapsed(event.target.checked)}
            />
          </Field>

          {/* The prototype's own sentence (`Workspace.dc.html` :3926). Both halves are true of
              this lab: nothing here offers to delete a published version or a recorded run,
              and no route would take the request. The native checkbox, as on the row above
              — the prototype's switch is a `div` with no role and no name. */}
          <Field
            label="Confirm before anything is deleted"
            hint="Turning this off removes the second press on deletes. A published shop version and a recorded run are never deletable, whichever way this is set."
          >
            <input
              type="checkbox"
              checked={confirmDelete}
              onChange={(event) => chooseConfirmDelete(event.target.checked)}
            />
          </Field>

          <FieldGroup
            label="Timestamps"
            hint={
              stamps === "relative"
                ? "Shown as 12 minutes ago. Easier to read a fresh run with."
                : `Shown as ${formatAbsoluteTimestamp(TIMESTAMP_EXAMPLE)}. Easier to quote in a report with.`
            }
          >
            <SegmentedChoice
              name="timestamp-format"
              value={stamps}
              options={TIMESTAMP_FORMATS}
              onChoose={chooseStamps}
            />
          </FieldGroup>
        </FieldRows>
      </Card>
    </Zone>
  );
}

/** The endpoint chip, in the prototype's two weights (`Workspace.dc.html` :4004). */
const presetChipClasses =
  "flex min-h-[38px] cursor-pointer items-center gap-[7px] rounded-lg border px-[13px] text-[13px] transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lab-primary";

const chosenPresetChipClasses = `${presetChipClasses} border-admin-chip-border bg-admin-chip font-bold text-lab-primary hover:bg-admin-chip-hover`;

const offeredPresetChipClasses = `${presetChipClasses} border-admin-field-border bg-admin-surface font-semibold text-admin-ink-soft hover:bg-admin-canvas`;

/** The answer one probe came back with. Green where it worked, warm red where it did not. */
const probeChipClasses =
  "inline-flex items-center gap-[7px] rounded-full px-[11px] py-[5px] text-xs font-bold";

/**
 * *Model provider*: the one setting on this page that is not a browser preference (the fast
 * path below writes to the lab too, but it is an action run once, not a setting).
 *
 * White rather than the read-only grey, for the reason the placeholder that stood here was
 * white — the surface says whose the zone is, and this one is the operator's.
 *
 * **It draws no model field.** ADR 0052 refuses one at length: the model is authored content
 * resolved from each arm's published configuration (ADR 0024), and a model on the connection
 * would be the environment substituting for an authored input in a friendlier hat. The
 * prototype's *Default model* row is a recorded departure, not an omission.
 *
 * **It never draws a mask.** The response carries `key_configured` and `key_added_at` and no
 * other fact about the key — not a prefix, a suffix, a length or a hash — so what a
 * configured key can be told by is when it was saved, and the way to change it is to save the
 * one you mean. That is the whole cost, and ADR 0052 names it rather than hiding it.
 *
 * The one thing this page refuses locally is an empty base URL, and that is a refusal about
 * *this form* rather than a second copy of the storage rule: every judgement about what an
 * endpoint may be belongs to `domain/model_connection.py`, which answers 422 with a sentence
 * this zone reads back. A page with its own opinion about base URLs would be a second,
 * stricter gate that stops matching the one that decides.
 */
function ModelProviderZone({
  source,
  onSaved,
}: {
  /** Which answer of the resolution chain is in force, once the lab has said; `null` until then. */
  source: ModelConnectionSource | null;
  onSaved: () => void;
}) {
  const reading = useReading(loadConnections, "The lab could not report where it is pointed.");
  const providers = reading.value?.providers ?? null;
  const inForce = source === null ? null : describeZoneSource(source);

  return (
    <Zone
      title="Model provider"
      description="Any OpenAI-compatible endpoint — hosted or one you run yourself. Saved for the whole lab, not just this browser."
    >
      {/* The form opens on Custom and an empty Base URL whenever nothing is saved, which reads
          as *pointed nowhere* whether or not the environment is pointing the lab somewhere. */}
      {inForce === null ? null : (
        <p className="text-[13px] leading-[1.55] text-admin-ink-soft [text-wrap:pretty]">
          {inForce}
        </p>
      )}
      {providers === null ? (
        <Card>
          <Unavailable reading={reading} />
        </Card>
      ) : (
        // One card per provider that can hold a connection. Today that is exactly one, and it
        // is one for a reason that generalizes rather than as a limit somebody imposed: a
        // connection is keyed by the provider id the proven tables use, and `openai` names
        // the protocol this lab speaks rather than the company (ADR 0052). Rendering the
        // listing rather than one hard-coded id is what keeps that true of a second.
        providers.map((provider) => (
          <ConnectionCard
            key={provider.provider_id}
            provider={provider}
            unreadable={source === "saved_unreadable"}
            onSaved={onSaved}
          />
        ))
      )}
      <p className="text-[12.5px] leading-[1.55] text-admin-muted [text-wrap:pretty]">
        A connection saved here takes effect for runs started afterwards, with no restart. A run
        already recorded keeps the endpoint it reached and refuses to be advanced against another,
        naming both; forking the experiment is the way on.
      </p>
    </Zone>
  );
}

/**
 * The lab's connection to one provider, as a form.
 *
 * The form's state is the endpoint in the field and, where the operator is typing one, a key.
 * Which chip is lit is **derived** from the endpoint rather than remembered beside it, so the
 * page cannot hold two answers to *where is this pointed*; and `typed` is `null` for "keep
 * the stored key", which is what lets a base URL be changed without retyping a credential the
 * lab will not show anybody.
 */
function ConnectionCard({
  provider,
  unreadable,
  onSaved,
}: {
  provider: ProviderConnectionSchema;
  /**
   * The lab reports a saved key it cannot decrypt (`saved_unreadable`). `key_configured` reports
   * a key's presence and never its readability, so without this the row would say *Configured*
   * beside a key that reaches nothing (ADR 0052, amendment of 2026-09-22).
   */
  unreadable: boolean;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<ModelConnectionSchema | null>(provider.connection);
  const [baseUrl, setBaseUrl] = useState(provider.connection?.base_url ?? "");
  const [typed, setTyped] = useState<string | null>(
    provider.connection?.key_configured === true ? null : "",
  );
  const [probe, setProbe] = useState<ModelConnectionTestResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * Which probe the zone is still willing to hear from.
   *
   * A reachability answer is true of one endpoint at one moment (ADR 0052), so the moment the
   * connection under it moves, the answer in flight is about a connection that is no longer
   * the one in front of the operator. Every edit bumps this counter, and a reply that comes
   * back on a stale number is dropped rather than drawn — which is the case a `setProbe(null)`
   * on edit alone does not cover, because the reply lands *after* the edit and would paint a
   * verdict about the old endpoint onto the new one.
   */
  const probeToken = useRef(0);
  const reasonId = useId();
  const presets = useId();

  const preset = presetForBaseUrl(baseUrl);
  // Sent exactly as typed. The server is the authority on what an endpoint is, and a page that
  // trimmed first would send something other than what its chip was lit for: `trim()` removes a
  // byte-order mark the server keeps.
  const endpoint = baseUrl;
  const key = typed === null || pythonStrip(typed) === "" ? null : pythonStrip(typed);
  // The typed endpoint as the server would store it, against what the lab holds as stored, so
  // a trailing slash, a shouted host or `:443` on the saved endpoint is nothing to save.
  const moves = !sameEndpoint(endpoint, saved?.base_url ?? "");
  const dirty = moves || key !== null;
  // The connection's refusal is a hint until the operator has edited the card — a field, a
  // preset, *Replace key* or *Keep the current key* — or pressed Save or Test while refused
  // (ADR 0078). Save sits above the card, outside what `watch` hears, so it reports its press.
  const connectionTouch = useRefusalTouch();
  /**
   * Where a key is about to go, when a saved connection points somewhere else. A key left
   * unsent is the saved one (ADR 0052: "falling back to the saved one"), so moving the endpoint
   * with the read-out showing sends the installed key to the new endpoint on Test and keeps it
   * for that endpoint on Save; a typed key goes wherever the field points. With nothing saved
   * there is one endpoint on the page and no other a key could be read as going to, so nothing
   * is said. Said on the key's own row rather than prevented, because pointing a key at a new
   * endpoint is often exactly what the operator means.
   *
   * A key the lab cannot read is sent nowhere on Test, but Save still keeps it for the new
   * endpoint, and it goes there the day `AGENT_LAB_CREDENTIAL_KEY` can open it again — so that
   * is said too, rather than letting the move look as though it left the key behind.
   */
  const keyDestination =
    saved === null || !moves
      ? null
      : key !== null
        ? "The key typed here will be sent to this endpoint on Test, and saved for it on Save."
        : !saved.key_configured
          ? null
          : unreadable
            ? "The stored key cannot be read now, but Save keeps it for this endpoint; it will be sent here once it can be."
            : "The installed key will be sent to this endpoint on Test, and kept for it on Save.";
  const blockedBy =
    pythonStrip(endpoint) === ""
      ? "No base URL to reach, so there is nothing to test or save."
      : null;

  /** The key field's state that the saved connection implies: the read-out, or an empty field. */
  const keptKey = saved?.key_configured === true ? null : "";

  function moved() {
    probeToken.current += 1;
    setProbe(null);
    setTesting(false);
    setRefusal(null);
  }

  /**
   * Picking a preset drops a key *typed* for the last endpoint, putting the field back to what
   * the lab holds. That is all it does. Where a key is stored, the field then sends none, and
   * the server falls back to the stored key (ADR 0052) — so the installed key still goes to the
   * new endpoint on Test and is kept for it on Save, as it does when an endpoint is typed or
   * pasted into Base URL, which leaves a typed key alone. The key row says where a key is about
   * to go whenever the endpoint has moved (`keyDestination`).
   */
  function choosePreset(next: string) {
    setBaseUrl(next);
    setTyped(keptKey);
    moved();
  }

  function typeEndpoint(next: string) {
    setBaseUrl(next);
    moved();
  }

  function typeKey(next: string | null) {
    setTyped(next);
    moved();
  }

  async function test() {
    probeToken.current += 1;
    const token = probeToken.current;
    setTesting(true);
    setProbe(null);
    setRefusal(null);
    try {
      const result = await testModelConnection(provider.provider_id, {
        base_url: endpoint,
        api_key: key,
      });
      if (probeToken.current === token) {
        setProbe(result);
      }
    } catch (cause: unknown) {
      if (probeToken.current === token) {
        setRefusal(describeApiError(cause, "The endpoint could not be tested."));
      }
    } finally {
      if (probeToken.current === token) {
        setTesting(false);
      }
    }
  }

  async function save() {
    // The inputs are disabled while this is in flight, so the read-back below cannot overwrite
    // an edit made after the press: there is none to overwrite.
    setSaving(true);
    setRefusal(null);
    try {
      const written = await saveModelConnection(provider.provider_id, {
        base_url: endpoint,
        api_key: key,
      });
      // Read back rather than kept: the endpoint is stored normalized, so what the lab holds
      // can be a different spelling from what was typed — and it is the stored one a run is
      // pinned to.
      setSaved(written.connection);
      setBaseUrl(written.connection?.base_url ?? "");
      setTyped(written.connection?.key_configured === true ? null : "");
      onSaved();
    } catch (cause: unknown) {
      setRefusal(describeApiError(cause, "The connection could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setBaseUrl(saved?.base_url ?? "");
    setTyped(keptKey);
    moved();
  }

  const answered = probe === null ? null : describeProbe(probe);

  /**
   * The key field, in either row that draws one. `new-password` rather than `off`, which
   * browsers ignore on a password field: a password manager would otherwise fill a login
   * password in here, and the form would send it to the endpoint.
   */
  function keyInput(width = "") {
    return (
      <input
        type="password"
        autoComplete="new-password"
        aria-label={saved?.key_configured === true ? "New API key" : undefined}
        className={`${idControlClasses} w-full ${width}`}
        placeholder="sk-…"
        value={typed ?? ""}
        disabled={saving}
        onChange={(event) => typeKey(event.target.value)}
      />
    );
  }

  return (
    <>
      {/* Only while there is something to save or put back, which is the prototype's own
          rule: a Discard that undoes nothing teaches a reader the form is dirty when it is
          not. The pair sits above the card rather than in the zone's heading row — the
          prototype draws it there, but the dirty state belongs to the connection rather than
          to the zone, and a zone holding a second connection would have two of them. */}
      {dirty ? (
        <div className="-mt-1 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={outlineButtonClasses}
            disabled={saving}
            onClick={discard}
          >
            <ButtonIcon verb="discard" />
            Discard
          </button>
          <PrimaryAction
            type="button"
            variant="accent"
            refusal={blockedBy === null ? null : { id: reasonId, reason: blockedBy }}
            onRefusedPress={connectionTouch.touch}
            busy={saving}
            onClick={save}
          >
            <ButtonIcon verb="save" />
            {saving ? "Saving…" : "Save connection"}
          </PrimaryAction>
        </div>
      ) : null}

      {/* No title and no label: the zone's own `h2` is the landmark, and a second named
          region inside it would give one place two names. */}
      <div {...connectionTouch.watch}>
        <Card>
          <FieldRows>
            <FieldGroup label="Endpoint preset" hint={preset.note}>
              {/* Native radios under the prototype's chips, because *a closed set is named
                radios* and the prototype's own chips are `div`s with no role and no name.
                They choose an endpoint rather than a provider: every one of them is saved
                under the same provider id, which is the protocol this lab has proven it can
                speak rather than the company (ADR 0052). */}
              <div className="flex flex-wrap gap-[7px]">
                {ENDPOINT_PRESETS.map((option) => (
                  <label
                    key={option.id}
                    className={
                      option.id === preset.id ? chosenPresetChipClasses : offeredPresetChipClasses
                    }
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name={`${presets}-endpoint`}
                      checked={option.id === preset.id}
                      disabled={saving}
                      onChange={() => choosePreset(option.baseUrl)}
                    />
                    {option.id === preset.id ? <span aria-hidden>✓</span> : null}
                    {option.label}
                  </label>
                ))}
              </div>
            </FieldGroup>

            <Field
              label="Base URL"
              hint="Must speak the OpenAI chat-completions API. A native Anthropic or Bedrock endpoint will not work here — those arms run through the frameworks the build already proves. Plain http reaches a loopback or private host only, so a key is never sent across the internet in the clear."
            >
              <input
                type="url"
                className={`${idControlClasses} w-full`}
                placeholder="http://localhost:11434/v1"
                value={baseUrl}
                disabled={saving}
                onChange={(event) => typeEndpoint(event.target.value)}
              />
            </Field>

            {saved?.key_configured === true && typed === null ? (
              <FieldGroup
                label="API key"
                hint={
                  unreadable
                    ? "This API cannot open the stored key: AGENT_LAB_CREDENTIAL_KEY is unset, or is not the one the key was saved under. The lab reaches nothing and does not fall back to the environment. Set that variable if it is unset — a key cannot be saved without it — then replace the key with the one you mean and save the connection again."
                    : "Stored encrypted and never served back — not the value, not a prefix or a suffix, not a length, not a hash. What this lab can say about it is that one is installed and when it was saved; to change it, save the one you mean."
                }
                extra={keyDestination}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {/* Weighted rather than red, as the read-out's own remedy line is: *the warm
                    red is destructive and nothing else*, and this is an instruction. */}
                  <p
                    className={`${readOnlyValueClasses} flex-1 ${unreadable ? "font-semibold" : ""}`}
                  >
                    {unreadable
                      ? "Stored, but this lab cannot read it"
                      : saved.key_added_at === null
                        ? "Configured"
                        : `Configured ${formatTimestamp(saved.key_added_at)}`}
                  </p>
                  <button
                    type="button"
                    className={subtleButtonClasses}
                    disabled={saving}
                    onClick={() => typeKey("")}
                  >
                    Replace
                  </button>
                </div>
              </FieldGroup>
            ) : saved?.key_configured === true ? (
              // Replace was pressed. A key is still installed and is still what a run uses, so
              // the row says so and offers the way back to the read-out — without which an
              // operator who changed their mind would be left with an empty optional field
              // reading as though no key were stored, and nothing to press but Discard, which
              // would also put back any endpoint they had typed.
              <FieldGroup
                label="API key"
                hint={
                  unreadable
                    ? "The stored key cannot be read, so leaving this empty keeps it and the lab stays offline. Type the key you mean and save the connection."
                    : "The installed key is kept, and used, until you save another; leaving this empty keeps it too. Stored encrypted under AGENT_LAB_CREDENTIAL_KEY and never shown again."
                }
                extra={keyDestination}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {keyInput("min-w-0 flex-1")}
                  <button
                    type="button"
                    className={subtleButtonClasses}
                    disabled={saving}
                    onClick={() => typeKey(null)}
                  >
                    Keep the current key
                  </button>
                </div>
              </FieldGroup>
            ) : (
              <Field
                label="API key"
                optional
                hint="Only if your endpoint asks for one: a local Ollama or vLLM does not, and an arm against one is the case this zone exists for. Stored encrypted under AGENT_LAB_CREDENTIAL_KEY and never shown again."
                extra={keyDestination}
              >
                {keyInput()}
              </Field>
            )}

            <FieldGroup
              label="Connection"
              hint="Asks the endpoint above for its model list, once, under a short timeout. Nothing is recorded and no experiment is touched, and the answer is true of the moment it was asked rather than a promise about the next run."
            >
              <div className="flex flex-wrap items-center gap-2.5">
                {/* No glyph: the prototype's bolt is one of the two marks outside this
                  workspace's verb vocabulary (`lib/ui.ts`, `buttonIcon`). */}
                <PrimaryAction
                  type="button"
                  variant="outline"
                  refusal={blockedBy === null ? null : { id: reasonId, reason: blockedBy }}
                  busy={testing || saving}
                  onClick={test}
                >
                  {testing ? "Reaching the endpoint…" : "Test connection"}
                </PrimaryAction>
                {/* Mounted whether or not it has anything to say, so an answer is announced
                  rather than appearing as a new element. */}
                <p role="status" className="text-[13px]">
                  {answered === null ? (
                    ""
                  ) : (
                    <span
                      className={`${probeChipClasses} ${
                        answered.tone === "good"
                          ? "bg-admin-chip text-lab-primary"
                          : "bg-lab-error-tint text-lab-error"
                      }`}
                    >
                      <span aria-hidden>{answered.tone === "good" ? "●" : "○"}</span>
                      {answered.sentence}
                    </span>
                  )}
                </p>
              </div>
            </FieldGroup>
          </FieldRows>
        </Card>
      </div>

      {/* The one line both refused controls name (ADR 0063): a keyboard reader who lands on
          either is told it, and it is on screen for everyone else. */}
      {blockedBy === null ? null : (
        <RefusalLine id={reasonId} touched={connectionTouch.touched}>
          {blockedBy}
        </RefusalLine>
      )}
      {refusal === null ? null : (
        <p role="alert" className="text-[13px] leading-relaxed text-lab-error">
          {refusal}
        </p>
      )}
    </>
  );
}

function FrameworkRow({ framework }: { framework: ProvenFrameworkSchema }) {
  return (
    // One level deeper than a list of these usually sits: the card holding them is an `h3`
    // under the zone's `h2`, so a row at `h3` would read as the card's sibling.
    <EntryCard
      title={framework.label}
      titleLevel={4}
      chips={<EntryId value={framework.framework_id} />}
    >
      <p className="text-[13px] text-admin-ink-soft">{framework.summary}</p>
      <dl className="grid gap-1.5 text-[12.5px] text-admin-ink-soft sm:grid-cols-[110px_minmax(0,1fr)]">
        <dt className="font-semibold text-admin-muted">Architectures</dt>
        <dd>{framework.architectures.map(describeArchitecture).join(", ")}</dd>
        <dt className="font-semibold text-admin-muted">Provider · model</dt>
        <dd>
          {framework.providers.map(describeProvider).join(", ")} · {framework.models.join(", ")}
        </dd>
        <dt className="font-semibold text-admin-muted">Proven</dt>
        <dd className="flex flex-wrap gap-1.5">
          {framework.capabilities.map((capability) => (
            <EntryKind key={capability} value={readableTerm(capability)} />
          ))}
        </dd>
      </dl>
    </EntryCard>
  );
}

/**
 * The one control in this application that populates the lab (ADR 0047).
 *
 * ADR 0043 refused this a route on the grounds that "a running lab must never be one request
 * away from being overwritten with a fixture", and ADR 0047 keeps that sentence: what makes
 * the seed safe is its refusal, which the route inherits whole. A lab holding anything at all
 * gets 409 and keeps every row. So the danger this guards against is not lost data but a
 * pointless wait, and the guard is proportionate — one confirmation press, because a button
 * that writes a dozen published versions should take more than a stray click, and no typed
 * phrase, because there is nothing here to lose.
 *
 * It is a zone of its own rather than a card among the preferences, because it is an action:
 * it runs once and changes what the lab holds, where everything above it only changes how the
 * lab is read.
 */
function FastPathZone({ shops, onSeeded }: { shops: ShopSummarySchema[]; onSeeded: () => void }) {
  const [arming, setArming] = useState(false);
  const [running, setRunning] = useState(false);
  const [seeded, setSeeded] = useState<LabSeedResponse | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // A lab with a shop in it will be refused, and saying so before the press is kinder than
  // spending a request to be told. It is a hint and not the gate: the server counts every
  // table the story writes, and this browser can only see one of them.
  const occupied = shops.length > 0;

  async function write() {
    setArming(false);
    setRunning(true);
    setRefusal(null);
    try {
      setSeeded(await seedLab());
      onSeeded();
    } catch (cause: unknown) {
      setRefusal(describeApiError(cause, "The demo could not be written."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Zone
      title="The fast path"
      description="An action, not a setting. It runs once and changes what the lab holds."
    >
      <Card>
        <FieldRows>
          <FieldGroup
            label="Create the demo"
            hint={
              <>
                A shop with a catalog, a customer with an incident, and a finished comparison of two
                agent frameworks — the same thing <ConfigValue>make seed</ConfigValue> does in a
                terminal. It works on an empty lab only, and never touches a lab that already holds
                something.
              </>
            }
          >
            {seeded === null ? (
              <div className="grid justify-items-start gap-1.5">
                <button
                  className={arming ? warningButtonClasses : outlineButtonClasses}
                  type="button"
                  disabled={running || occupied}
                  onClick={() => (arming ? write() : setArming(true))}
                >
                  {running
                    ? "Creating the demo…"
                    : arming
                      ? "Press again to create it"
                      : "Create the demo"}
                </button>
                {/* The live region is mounted whether or not it has anything to say, so the
                    armed message is announced rather than appearing as a new element. Idle and
                    empty is the prototype's own `seedNote`. */}
                <p className="text-xs text-admin-muted" role="status">
                  {occupied
                    ? "This lab is not empty, so there is nothing to create here."
                    : arming
                      ? "Nothing is created until you press again."
                      : ""}
                </p>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <p className="text-[13px] text-admin-ink-soft">
                  Written. Its results are listed in History.
                </p>
                <p className="flex flex-wrap gap-3 text-[13px]">
                  <Link
                    className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                    to={`/shops/${seeded.shop_id}`}
                  >
                    Open the shop's overview
                  </Link>
                  <Link
                    className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                    to={`/lab/bench/${seeded.shop_id}/${seeded.experiment_id}/results`}
                  >
                    Open the results
                  </Link>
                </p>
              </div>
            )}
            {refusal === null ? null : (
              <p role="alert" className="mt-2 text-[13px] leading-relaxed text-lab-error">
                {refusal}
              </p>
            )}
          </FieldGroup>
        </FieldRows>
      </Card>
    </Zone>
  );
}

/**
 * Run mode and trace export are one request; "this build" is another. They are rendered from
 * separate state for the same reason they are fetched separately: run mode needs no database,
 * and a listing that fails should not take a read-out that answered with it.
 */
interface Reading<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

function Unavailable({ reading }: { reading: Reading<unknown> }) {
  if (reading.loading) {
    return <p className="text-[13px] text-admin-muted">Reading…</p>;
  }
  return (
    <p role="alert" className="text-[13px] text-lab-error">
      {reading.error}
    </p>
  );
}

// Run mode is not a version state, so it does not borrow the published/draft palette: those
// two colours mean "frozen" and "in progress" everywhere else in the workspace. Like every
// other chip here it pairs its colour with a glyph and a written label.
const runModeChipClasses =
  "inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft";

/**
 * Run mode, and which of the chain's four answers put it there.
 *
 * Read only, and still one of the three cards ADR 0044 built — but no longer for the reason
 * that ADR gave. Composition moved from start-up to the request (ADR 0052), so run mode is a
 * per-request answer that a save in *Model provider* above moves without a restart; what is
 * read only here is the *reading*, not the fact. The card's "To change it:" line therefore
 * points at the zone above it before it points at the environment, because that is the order
 * the resolution chain reads them in.
 *
 * The source is drawn as four answers and not two. ADR 0052's *Decision* writes "which of the
 * two is in force"; its amendment of 2026-09-22 narrows that, because two of the chain's four
 * states are the same run mode and one of them — a saved connection whose key will not
 * decrypt — is an offline lab whose remedy nothing else on this page could tell an operator.
 */
function RunModeCard({ reading }: { reading: Reading<LabStatusResponse> }) {
  const status = reading.value;
  const source = status === null ? null : describeSource(status.connection_source);
  return (
    <ReadOnlyCard
      title="Run mode"
      change={
        <>
          save a connection in <em>Model provider</em> above, which takes effect on the next run
          with no restart; with none saved, set <ConfigValue>AGENT_LAB_OPENAI_API_KEY</ConfigValue>{" "}
          in the API's environment and restart it. The reading is per request, so it moves while
          this page is open.
        </>
      }
    >
      {status === null ? (
        <Unavailable reading={reading} />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className={runModeChipClasses}>
              <span aria-hidden>{status.run_mode === "credentialed" ? "●" : "◦"}</span>
              {status.run_mode === "credentialed" ? "Credentialed" : "Offline"}
            </span>
            <span className="text-admin-ink-soft">
              Conversation model <EntryId value={status.model_id} />
            </span>
          </p>
          {/* Relabelled from "Configured model", as ADR 0052 requires: this names the model
              the POC's `/conversations` routes reach for — the one surface where the
              environment still decides — and never the model an experiment runs, which is
              the one its published agent configuration named (ADR 0024). */}
          <p className="text-xs text-admin-muted">
            The model the POC's conversation routes reach for. An experiment runs the model its
            published agent configuration named, and a connection holds none at all.
          </p>
          {source === null ? null : (
            <>
              <p className="leading-relaxed">{source.sentence}</p>
              {source.remedy === null ? null : (
                <p className="leading-relaxed font-semibold">{source.remedy}</p>
              )}
            </>
          )}
          {status.run_mode === "offline" ? (
            // The standing version of the qualification ADR 0042 established and ADR 0043
            // could only write onto one seeded run. It belongs here because it is a property
            // of the build: a run an operator drove themselves without a credential inherits
            // it too, and carries no label because nobody wrote one.
            <p className="leading-relaxed">
              No provider credential is configured, so only the deterministic control arm can be
              advanced here: both model-backed frameworks reach their provider under the same
              credential, and an arm running either is refused the moment it is advanced. Any
              comparison this lab does hold offline — the seeded demo among them — has both arms'
              decisions held identical by construction, so what it establishes is the evidence
              model: that tool calls, state changes, objectives, traces and cost reach the record.
              Only a credentialed run answers how two frameworks actually choose.
            </p>
          ) : (
            // Not "a provider credential is configured", which was true while the environment
            // was the only source and is false of a saved connection with no key at all — a
            // local endpoint needs none, and that lab is credentialed (ADR 0052).
            <p className="leading-relaxed">
              This lab reaches an endpoint, so a model-backed arm reaches the provider and a two-arm
              comparison can be about how the frameworks actually choose. Each run records the
              endpoint it reached and refuses to be advanced against another.
            </p>
          )}
        </>
      )}
    </ReadOnlyCard>
  );
}

function TraceExportCard({ reading }: { reading: Reading<LabStatusResponse> }) {
  const status = reading.value;
  return (
    <ReadOnlyCard
      title="Trace export"
      change={
        <>
          start <ConfigValue>infra/phoenix/compose.yaml</ConfigValue>, set{" "}
          <ConfigValue>
            AGENT_LAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces
          </ConfigValue>{" "}
          in the API's environment, restart it, and open{" "}
          <ConfigValue>http://localhost:6006</ConfigValue>.
        </>
      }
    >
      {status === null ? (
        <Unavailable reading={reading} />
      ) : status.trace_export_configured ? (
        <>
          <p className="leading-relaxed">
            An OTLP endpoint is configured, so the spans the lab opens leave this process under the
            written allowlist: pseudonymized identifiers, an arm's position, the turn, the framework
            and the published tool name and version. No free-form string of the lab's own is
            exported. A framework SDK that exports its own spans is a separate path the lab does not
            write and cannot promise the sanitization of.
          </p>
          <p className="text-xs text-admin-muted">
            The endpoint itself is not reported here. A collector URL is a place a deployment can
            put a token, and a route that served it would serve that token the day one did.
          </p>
        </>
      ) : (
        <p className="leading-relaxed">
          No OTLP endpoint is configured. The lab still records a span tree beside every experiment
          arm it advances — the traces tab on a run reads that record, not an exporter — but nothing
          is exported anywhere.
        </p>
      )}
    </ReadOnlyCard>
  );
}

function ProvenBuildCard({ reading }: { reading: Reading<AgentConfigurationResourcesResponse> }) {
  return (
    <ReadOnlyCard
      title="What this build can run"
      change={
        <>
          add the adapter and the suite that proves it, and the framework joins{" "}
          <ConfigValue>PROVEN_FRAMEWORKS</ConfigValue> in{" "}
          <ConfigValue>application/agent_capabilities.py</ConfigValue>. It is a property of the
          build rather than of this deployment.
        </>
      }
    >
      <p className="leading-relaxed">
        The frameworks this lab has an implementation for and a suite that keeps exercising it, with
        the envelope each was proven inside. An agent configuration naming a framework, architecture
        or provider outside this table cannot be published; naming a model outside it is a warning
        that does not block publication.
      </p>
      {reading.value === null ? (
        <Unavailable reading={reading} />
      ) : (
        <ul className="grid gap-2">
          {reading.value.frameworks.map((framework) => (
            <FrameworkRow key={framework.framework_id} framework={framework} />
          ))}
        </ul>
      )}
    </ReadOnlyCard>
  );
}

/**
 * *Runtime configuration · Read only*, as a collapsed disclosure.
 *
 * Collapsed by default and held in component state, not in a preference: the handoff lists it
 * with the tour index and the switcher panel as ephemeral, and a lab's composition is the thing
 * on this page an operator least often needs and can least often act on.
 *
 * The three cards keep ADR 0044's character — the surface reports composition and never edits
 * it — and each one ends where that ADR's argument ends, in the variable, the file or the zone
 * that does change it. What ADR 0052 narrowed is the *always*: run mode is now a per-request
 * answer that the zone above moves, so this zone reports a reading rather than a constant.
 */
function RuntimeZone({
  status,
  resources,
}: {
  status: Reading<LabStatusResponse>;
  resources: Reading<AgentConfigurationResourcesResponse>;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-[10px] border border-admin-border bg-[#fbfcfc]"
    >
      <h2 id={headingId}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`flex w-full items-center gap-2.5 px-[18px] py-[15px] text-left text-[13.5px] font-bold text-admin-ink transition hover:bg-[#f4f6f6] ${focusRingClasses}`}
        >
          {open ? (
            <ChevronDown size={13} aria-hidden="true" focusable="false" className="opacity-65" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" focusable="false" className="opacity-65" />
          )}
          Runtime configuration
          <span className="font-semibold text-admin-muted">· Read only</span>
        </button>
      </h2>
      {open ? (
        <div className="grid gap-3 border-t border-[#eceef0] px-[18px] pt-4 pb-5">
          <p className="text-[12.5px] leading-[1.5] text-admin-muted [text-wrap:pretty]">
            Read from the environment when the API started — except run mode, which is answered
            afresh on every request and moves the moment a connection is saved above. Nothing below
            can be edited from the app; each card names what to change instead.
          </p>
          <RunModeCard reading={status} />
          <TraceExportCard reading={status} />
          <ProvenBuildCard reading={resources} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * One read, and a way to ask for it again.
 *
 * The second is what ADR 0052 made necessary: run mode used to be a property of the process
 * and could not move while it ran, so a reading taken at mount stayed true for as long as the
 * page was open. It is a per-request answer now, and saving a connection is the act on this
 * page that changes it — so the zone that saves one asks for the reading again rather than
 * leaving a stale *Offline* under a connection the operator has just made.
 */
function useReading<T>(
  load: (signal: AbortSignal) => Promise<T>,
  unavailable: string,
): Reading<T> & { refresh: () => void } {
  const [reading, setReading] = useState<Reading<T>>({
    value: null,
    loading: true,
    error: null,
  });
  const inFlight = useRef<AbortController | null>(null);

  // The read itself, so that the mount and a refresh are one path rather than two. The
  // previous answer is left standing while a refresh is in flight: a reading that blanked
  // itself would flicker *Reading…* through a card nobody asked to reload.
  const read = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setReading({ value, loading: false, error: null });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setReading({ value: null, loading: false, error: describeApiError(cause, unavailable) });
        }
      });
  }, [load, unavailable]);

  useEffect(() => {
    read();
    return () => inFlight.current?.abort();
    // The loaders below are module-level functions, so `read` is stable and this runs once
    // per mount.
  }, [read]);

  return { ...reading, refresh: read };
}

const loadStatus = (signal: AbortSignal) => getLabStatus(signal);
const loadResources = (signal: AbortSignal) => readAgentConfigurationResources(signal);
const loadConnections = (signal: AbortSignal): Promise<ProviderConnectionListResponse> =>
  listModelConnections(signal);

/**
 * The lab's settings, in the prototype's three zones with its action under them
 * (`Workspace.dc.html` :3854).
 *
 * A centred column rather than the two the page used to run in: *Principles* already exempts
 * "the settings column cap" from the rule that nothing is fixed width, and the zones read as a
 * sequence from the ones an operator owns to the ones the environment does.
 *
 * *Back to workspace* is the bar's Settings toggle written as a link in the page — the same
 * remembered location, read from the same preference (ADR 0055), so there is one answer to
 * "what was underneath this" and not two. It is not resolved against anything before the move,
 * for the reason that ADR gives: resolving an arbitrary path would mean a second copy of the
 * route tree, and a browser that remembers nowhere goes to the shops index.
 */
export function LabSettingsPage() {
  const surface = useLabSurface();
  const status = useReading(loadStatus, "The lab could not report how it is composed.");
  const resources = useReading(loadResources, "The lab could not report what it can run.");
  // Read once, at mount: the shell stops rewriting it the moment `/settings` is open, so it
  // cannot move underneath the reader while they are standing here.
  const [back] = useState(() => readSettingsReturn() ?? "/shops");

  return (
    <AppShell shops={surface.shops}>
      <div className="mx-auto grid w-full max-w-[1024px] gap-[26px] pb-12">
        <div>
          <Link
            to={back}
            className={`mb-[26px] inline-flex items-center gap-[7px] rounded text-[13px] font-semibold text-lab-primary hover:text-lab-primary-hover ${focusRingClasses}`}
          >
            <ArrowLeft size={15} aria-hidden="true" focusable="false" />
            Back to workspace
          </Link>
          <PageHeader
            title="Lab settings"
            description="Three things live here, and they are kept apart: the preferences saved in this browser, the model provider the whole lab runs through, and the runtime configuration composed when the API started — reported below, read only."
          />
          {surface.error ? (
            <p role="alert" className="text-[13px] text-lab-error">
              {surface.error}
            </p>
          ) : null}
        </div>

        <PreferencesZone surface={surface} />
        {/* Saving a connection moves run mode, which the read-only zone below reports: the
            reading is per request now, so the page asks for it again rather than leaving an
            answer that was true a moment ago (ADR 0052). */}
        <ModelProviderZone
          source={status.value?.connection_source ?? null}
          onSaved={status.refresh}
        />
        <RuntimeZone status={status} resources={resources} />
        <FastPathZone shops={surface.shops} onSeeded={surface.refresh} />
      </div>
    </AppShell>
  );
}
