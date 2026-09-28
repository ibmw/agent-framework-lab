import type { ToneOfVoiceSchema } from "@agent-lab/contracts";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ButtonIcon } from "../components/ButtonIcon";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { CurrencyField } from "../components/CurrencyField";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldRows } from "../components/FieldHint";
import { LocaleField } from "../components/LocaleField";
import { PrimaryAction, type Refusal, RefusalLine } from "../components/PrimaryAction";
import { SetupChecklist } from "../components/SetupChecklist";
import { ShopLogoCard } from "../components/ShopLogoCard";
import { ToggleChipGroup } from "../components/ToggleChipGroup";
import {
  Card,
  DefaultToneChip,
  EditorSaveActions,
  EntryCard,
  EntryEditNotice,
  EntryId,
  EntryText,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import { entryEdit, useEntryEdit } from "../lib/entryEdit";
import { slugify, uniqueSuggestion } from "../lib/entryIds";
import { optionsOf, SUPPORT_CHANNEL } from "../lib/enumLabels";
import {
  alreadyTakenMessage,
  DERIVED_KEBAB_RULE,
  KEBAB_PATTERN,
  SHOP_NAME_RULE,
  SHOP_SLUG_DETAIL_RULE,
  SHOP_SLUG_TAKEN_PLACE,
  TONE_DEFAULT_REMOVAL_RULE,
  TONE_NAME_RULE,
} from "../lib/fieldRules";
import { consequenceOf, findingClauses, type Removal, useRemoval } from "../lib/removal";
import { unsoldCurrencyFindings } from "../lib/setupChecklist";
import {
  destructiveSubtleButtonClasses,
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  fieldLabelClasses,
  textAreaClasses,
} from "../lib/ui";
import { HELD_VALUE_REASON, useRegisterUnsavedWork } from "../lib/unsavedWork";
import { useShopWorkspace } from "../shell/useShopWorkspace";
import { FulfilmentMethodsCard, PaymentMethodsCard } from "./ShopMethodCards";

const CHANNELS = optionsOf(SUPPORT_CHANNEL);

/**
 * The pages that edit one shop draft between them. Their header is an editor's and pinned like
 * one: Save is in it, and Shop details runs to more than two screens (ADR 0066).
 */
function SetupPage({
  title,
  held = false,
  saveRefusal = null,
  children,
}: {
  title: string;
  /** A field on the page holds a value the draft does not, which is unsaved work too. */
  held?: boolean;
  /** Why Save is refused, naming the field line that says so (ADR 0063). */
  saveRefusal?: Refusal | null;
  children: ReactNode;
}) {
  const { shopId, content, preview, checking, save, saving, discard, discarding, dirty, error } =
    useShopWorkspace();
  return (
    <>
      <PageHeader
        title={title}
        chips={<VersionChips preview={preview} />}
        actions={
          <EditorSaveActions
            tone="accent"
            dirty={dirty || held}
            saving={saving}
            discarding={discarding}
            refusal={saveRefusal}
            onSave={() => void save()}
            onDiscard={() => void discard()}
          />
        }
        reasons={
          error ? (
            <p role="alert" className="text-[13px] text-lab-error">
              {error}
            </p>
          ) : null
        }
        sticky
      />
      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>{children}</div>
        <div className={editorPanelClasses}>
          <SetupChecklist
            shopId={shopId}
            content={content}
            issues={preview?.issues ?? []}
            checking={checking}
            dirty={dirty}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The entry's name belongs in the accessible name, not in the visible label: a policy may be
 * titled a paragraph long, and a button that renders it stretches the row it sits on. Every
 * other editor in the workspace already names its Remove this way.
 */
function RemoveButton({
  label,
  removal,
  entryKey,
  notice,
  onRemove,
}: {
  label: string;
  /** The list's second press (ADR 0060), and the key this row is armed under. */
  removal: Removal;
  entryKey: string;
  /** What the list's notice line says once the entry has gone. */
  notice: string;
  onRemove: () => void;
}) {
  return (
    <button
      className={destructiveSubtleButtonClasses}
      type="button"
      aria-label={`Remove ${label}`}
      ref={removal.trigger(entryKey)}
      onClick={removal.ask(entryKey, onRemove, notice)}
    >
      <ButtonIcon verb="delete" />
      Remove
    </button>
  );
}

/**
 * The authoring form sits below the saved entries it adds to. Now that an entry carries its
 * body, the rule is what tells an author where the saved configuration ends and the blank
 * form begins.
 */
const addFormClasses = "grid gap-2 border-t border-admin-border pt-3";

/**
 * A tone of voice's authored fields, and the one function that turns them into the entry the
 * draft stores.
 *
 * The add form holds the fields, the edit mode holds the fields, and both hand them to the
 * same builder with the entry's identifier beside them — which is what keeps the two paths
 * from drifting into two shapes of the same payload. The identifier is the builder's first
 * argument rather than one of the fields because it is derived once, when the entry is
 * created, and an edit hands back the one the entry already has.
 */
interface ProseFields {
  name: string;
  text: string;
}

function toneEntry(id: string, fields: ProseFields & { is_default: boolean }): ToneOfVoiceSchema {
  return { id, name: fields.name, guidance: fields.text, is_default: fields.is_default };
}

/**
 * The name-and-prose pair that four of this page's six kinds are — a policy, an FAQ entry, a
 * support guideline, a tone of voice — under the four different pairs of words they wear.
 *
 * The add form and the edit mode render this same component, so the control that takes a
 * policy body is one control with one set of rules rather than two that happen to look alike.
 * `beside` is what shares the first row: the derived ID on an add form, which an edit mode
 * never shows because it never asks.
 */
function ProseFieldset({
  nameLabel,
  textLabel,
  columns = "sm:grid-cols-2",
  value,
  onChange,
  beside,
}: {
  nameLabel: string;
  textLabel: string;
  columns?: string;
  value: ProseFields;
  onChange: (next: ProseFields) => void;
  beside?: ReactNode;
}) {
  return (
    <>
      <div className={`grid gap-2 ${columns}`}>
        <label className={fieldLabelClasses}>
          {nameLabel}
          <input
            className={`${fieldControlClasses} w-full`}
            value={value.name}
            required
            onChange={(event) => onChange({ ...value, name: event.target.value })}
          />
        </label>
        {beside}
      </div>
      <label className={fieldLabelClasses}>
        {textLabel}
        <textarea
          className={`${textAreaClasses} w-full`}
          value={value.text}
          required
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
      </label>
    </>
  );
}

export function ShopIdentityPage() {
  const { shopId, shops, shopsPending, content, edit, discarding } = useShopWorkspace();
  const identity = content.identity;
  const slugLineId = useId();

  /**
   * What is in the Slug field, while it differs from the slug the draft holds: one another shop
   * already uses, or nothing while it is being retyped.
   *
   * A taken slug is refused where the create page refuses it — on the field, off the same
   * listing (`GET /shops`) — and it never reaches the draft, so no Save anywhere in the
   * workspace can write it. The lab would take it: shops are addressed by their id and ADR 0013
   * leaves the slug unconstrained across shops, so this is the workspace's own rule, the one
   * the create page already applies, kept once the shop exists and applied only to a slug the
   * operator changes to (ADR 0069).
   */
  const [typedSlug, setTypedSlug] = useState<string | null>(null);
  /**
   * The slug the draft held when this run of typing began, until the field is left. Every free
   * value is written as it is typed, so typing a taken slug key by key passes through prefixes
   * the operator never meant — `northsta` on the way to `northstar`. When the field holds a
   * value it will not write — a taken slug, or nothing — the draft goes back to this, so a held
   * value never leaves a prefix behind for a Save elsewhere to store, and an emptied field hands
   * this back on leaving rather than the last prefix.
   */
  const [slugOrigin, setSlugOrigin] = useState<string | null>(null);
  /**
   * The slug the lab holds for this shop: the listing's own row for it, which `GET /shops`
   * reads off the saved draft and the workspace reads again after every save. A shop that
   * already shares that slug with another — written before this rule, or by a direct write —
   * is not refused for keeping it: the rule is about a change, and refusing what the lab
   * already holds would be a second, stricter gate over every other edit on the page.
   */
  const savedSlug = shops.find((shop) => shop.shop_id === shopId)?.slug;
  // This shop's own row is never counted: the other shops are told apart by id, not spelling.
  const takenSlugs = shops
    .filter((shop) => shop.shop_id !== shopId)
    .map((shop) => shop.slug)
    .filter((slug) => slug !== savedSlug);
  const shownSlug = typedSlug ?? identity.slug;
  const slugTaken = shownSlug !== "" && takenSlugs.includes(shownSlug);
  const heldSlug =
    typedSlug !== null && typedSlug !== "" && typedSlug !== identity.slug ? typedSlug : null;

  // A discard that lands puts back the slug the lab holds, so what was typed over it is no
  // longer about the draft under it.
  const wasDiscarding = useRef(discarding);
  useEffect(() => {
    if (wasDiscarding.current && !discarding) {
      setTypedSlug(null);
      setSlugOrigin(null);
    }
    wasDiscarding.current = discarding;
  }, [discarding]);

  useRegisterUnsavedWork(
    heldSlug === null
      ? null
      : {
          label: `The Slug field holds “${heldSlug}”, which another shop already uses; this shop is still ${identity.slug}.`,
          unsavable: HELD_VALUE_REASON,
          discard: () => {
            setTypedSlug(null);
            setSlugOrigin(null);
          },
        },
  );

  function changeSlug(next: string) {
    const origin = slugOrigin ?? identity.slug;
    if (slugOrigin === null) {
      setSlugOrigin(identity.slug);
    }
    if (next === identity.slug) {
      setTypedSlug(null);
      return;
    }
    if (next !== "" && !takenSlugs.includes(next)) {
      setTypedSlug(null);
      edit({ ...content, identity: { ...identity, slug: next } });
      return;
    }
    setTypedSlug(next);
    if (identity.slug !== origin) {
      edit({ ...content, identity: { ...identity, slug: origin } });
    }
  }

  return (
    <SetupPage
      title="Shop details"
      held={heldSlug !== null}
      saveRefusal={
        slugTaken
          ? { id: slugLineId, reason: alreadyTakenMessage(shownSlug, SHOP_SLUG_TAKEN_PLACE) }
          : null
      }
    >
      {/* The prototype's cards, in its order (`Workspace.dc.html` :2016): Identity, the Logo,
          Commerce, Channels. The two method lists this page also holds follow them. */}
      <Card title="Identity">
        <p className="text-[13px] text-admin-muted">
          What the shop is called, and the slug scenarios, orders and published versions address it
          by.
        </p>
        <FieldRows>
          <Field label="Name" hint={SHOP_NAME_RULE}>
            <input
              className={`${fieldControlClasses} w-full`}
              value={identity.name}
              onChange={(event) =>
                edit({ ...content, identity: { ...identity, name: event.target.value } })
              }
            />
          </Field>
          {/* The create page's field, minus the follow: here the slug is the shop's, not the
              name's, so emptying it hands back the slug the shop already has rather than one
              derived from anything. */}
          <DerivedIdField
            arrangement="row"
            label="Slug"
            hint={SHOP_SLUG_DETAIL_RULE}
            value={shownSlug}
            suggested={identity.slug}
            follows={false}
            preview={false}
            pending={shopsPending}
            taken={takenSlugs}
            takenPlace={SHOP_SLUG_TAKEN_PLACE}
            extraId={slugLineId}
            onChange={changeSlug}
            onLeave={() => setSlugOrigin(null)}
          />
        </FieldRows>
      </Card>

      <ShopLogoCard
        name={identity.name}
        logo={content.logo}
        onChange={(logo) => edit({ ...content, logo })}
      />

      <Card title="Commerce">
        <p className="text-[13px] text-admin-muted">
          Where the shop trades and what it can price in.
        </p>
        {/* `LocaleField` and `CurrencyField` each carry their own label and their own rule,
            so neither is wrapped in a row that would name it a second time. They are asked
            to draw themselves as rows instead, which is what keeps one card to one label
            typography and one unbroken run of dividing rules. */}
        <FieldRows>
          <LocaleField
            arrangement="row"
            value={identity.locale}
            onChange={(locale) => edit({ ...content, identity: { ...identity, locale } })}
          />
          <CurrencyField
            arrangement="row"
            value={identity.currencies}
            findings={unsoldCurrencyFindings(content)}
            onChange={(currencies) => edit({ ...content, identity: { ...identity, currencies } })}
          />
        </FieldRows>
      </Card>

      <Card title="Channels">
        <p className="text-[13px] text-admin-muted">A shop must always answer on at least one.</p>
        <FieldRows>
          <ToggleChipGroup
            arrangement="row"
            label="Answers on"
            hint="The last channel left on stays on. A ticket arrives on one of these, and its gate refuses a channel the shop does not offer."
            options={CHANNELS.map((channel) => ({ value: channel.value, label: channel.label }))}
            value={identity.channels}
            keepOne="A shop answers on at least one channel."
            onChange={(channels) => edit({ ...content, identity: { ...identity, channels } })}
          />
        </FieldRows>
      </Card>

      <PaymentMethodsCard />
      <FulfilmentMethodsCard />
    </SetupPage>
  );
}

/**
 * The muted line that stands where the shop default's Remove would: a refusal with a way out,
 * rather than a refused action, so not the validation weight (`docs/design-direction.md`, *A
 * refusal that has a way out names the way out*).
 */
const wayOutLineClasses = "text-xs text-admin-muted";

export function ToneOfVoicePage() {
  const { shopId, content, edit } = useShopWorkspace();
  const [tone, setTone] = useState<{ id: string } & ProseFields>({ id: "", name: "", text: "" });
  const takenToneIds = content.tone_of_voice_guidelines.map((entry) => entry.id);
  const toneEditor = useEntryEdit<ProseFields>(takenToneIds);
  const toneNotice = useId();
  const toneSuggested = uniqueSuggestion(slugify(tone.name, ""), takenToneIds);
  const toneRemoval = useRemoval(shopId);

  /**
   * One cause, two refusals, one sentence each place it bites.
   *
   * A guideline with no name can neither be committed nor be made the shop default, and the
   * open row is where both refusals meet: its Save and its default radio are described by the
   * same line, because it is the same fact about the same row. The add form has a line of its
   * own for the same reason it has a button of its own.
   */
  const openRefusalId = useId();
  const addRefusalId = useId();
  const addNameless = tone.name.trim() === "";
  const openNameless = toneEditor.open !== null && toneEditor.open.fields.name.trim() === "";

  function setDefault(id: string) {
    edit({
      ...content,
      tone_of_voice_guidelines: content.tone_of_voice_guidelines.map((entry) => ({
        ...entry,
        is_default: entry.id === id,
      })),
      default_tone_of_voice_id: id,
    });
  }

  return (
    <SetupPage title="Tone of voice">
      <Card title="Guidelines">
        <ul className="grid gap-2 text-[13px]">
          {content.tone_of_voice_guidelines.map((entry) => {
            // The radio answers for the row in front of the operator, so while that row is
            // open it reads the *typed* name rather than the saved one: a guideline being
            // renamed to nothing is a guideline that cannot be the default, and the radio
            // that would make it one says so instead of writing it.
            const namelessHere = toneEditor.isOpen(entry.id) && openNameless;
            const drop = () =>
              edit({
                ...content,
                tone_of_voice_guidelines: content.tone_of_voice_guidelines.filter(
                  (item) => item.id !== entry.id,
                ),
              });
            if (toneRemoval.isArmed(entry.id)) {
              return (
                <ConfirmRemove
                  key={entry.id}
                  as="li"
                  title={`Remove the guideline “${entry.name}”?`}
                  consequence={consequenceOf(
                    "An agent configuration that names it as an override will be naming a guideline the shop's next published version does not have.",
                    findingClauses([
                      content.tone_of_voice_guidelines.length === 1
                        ? "shop_without_tone_of_voice"
                        : entry.is_default && "tone_of_voice_without_default",
                    ]),
                    "Nothing is written until you save the draft, and a published shop version keeps it.",
                  )}
                  onConfirm={toneRemoval.confirm(
                    drop,
                    `Removed the guideline “${entry.name}” from the draft.`,
                  )}
                  onKeep={toneRemoval.keep}
                />
              );
            }
            return (
              <EntryCard
                key={entry.id}
                lead={
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="default-tone"
                      checked={entry.is_default}
                      disabled={namelessHere}
                      title={namelessHere ? TONE_NAME_RULE : undefined}
                      aria-describedby={namelessHere ? openRefusalId : undefined}
                      onChange={() => setDefault(entry.id)}
                    />
                    <span className="sr-only">Make {entry.name} the shop default</span>
                  </label>
                }
                title={entry.name}
                chips={
                  <>
                    <EntryId value={entry.id} />
                    {entry.is_default ? <DefaultToneChip /> : null}
                  </>
                }
                edit={entryEdit(
                  toneEditor,
                  toneNotice,
                  entry.id,
                  entry.name,
                  () => ({ name: entry.name, text: entry.guidance }),
                  (fields) =>
                    edit({
                      ...content,
                      tone_of_voice_guidelines: content.tone_of_voice_guidelines.map((item) =>
                        item.id === entry.id
                          ? // `is_default` is the radio's answer on the row above, never the
                            // form's: an edit to the wording must not move the shop default.
                            toneEntry(entry.id, { ...fields, is_default: entry.is_default })
                          : item,
                      ),
                    }),
                  (value, onChange) => (
                    <>
                      <ProseFieldset
                        nameLabel="Name"
                        textLabel="Guidance"
                        columns="sm:grid-cols-1"
                        value={value}
                        onChange={onChange}
                      />
                      {value.name.trim() === "" ? (
                        <RefusalLine id={openRefusalId}>{TONE_NAME_RULE}</RefusalLine>
                      ) : null}
                    </>
                  ),
                  (value) =>
                    value.name.trim() === "" ? { id: openRefusalId, reason: TONE_NAME_RULE } : true,
                )}
                actions={
                  // The shop default has no Remove at all: deleting it would leave the draft
                  // owing `tone_of_voice_without_default` with no control on this page to pay
                  // it, so where the button would stand the row says what to do instead. The
                  // prototype writes the refusal in exactly that place (`Workspace.dc.html`
                  // :1897) rather than as a Remove that argues with itself.
                  entry.is_default ? (
                    <p className={wayOutLineClasses}>{TONE_DEFAULT_REMOVAL_RULE}</p>
                  ) : (
                    <RemoveButton
                      label={entry.name}
                      removal={toneRemoval}
                      entryKey={entry.id}
                      notice={`Removed the guideline “${entry.name}” from the draft.`}
                      onRemove={drop}
                    />
                  )
                }
              >
                <EntryText label="Guidance" value={entry.guidance} />
              </EntryCard>
            );
          })}
          {content.tone_of_voice_guidelines.length === 0 ? (
            <li className="text-admin-muted">No tone-of-voice guideline yet.</li>
          ) : null}
        </ul>
        <EntryEditNotice id={toneNotice} label={toneEditor.open?.label ?? null} />
        <RemovalNotice removal={toneRemoval} />
        <form
          className={addFormClasses}
          onSubmit={(event) => {
            event.preventDefault();
            // `required` on the Name input already refuses an empty one — the browser and
            // jsdom both run `reportValidity()` before the submit fires — so the door this
            // closes is a name of nothing but spaces, which `required` is satisfied by and
            // `require_label` then refuses with a 422 (`not value.strip()`). The button
            // reports the same rule, and the handler holds it for a submit reached any
            // other way.
            if (!tone.id || addNameless || takenToneIds.includes(tone.id)) {
              return;
            }
            edit({
              ...content,
              tone_of_voice_guidelines: [
                ...content.tone_of_voice_guidelines,
                toneEntry(tone.id, {
                  ...tone,
                  is_default: content.tone_of_voice_guidelines.length === 0,
                }),
              ],
            });
            setTone({ id: "", name: "", text: "" });
          }}
        >
          <ProseFieldset
            nameLabel="Name"
            textLabel="Guidance"
            value={tone}
            onChange={(next) => setTone({ ...tone, ...next })}
            beside={
              <DerivedIdField
                label="ID"
                hint={DERIVED_KEBAB_RULE}
                value={tone.id}
                suggested={toneSuggested.value}
                taken={takenToneIds}
                takenBase={toneSuggested.takenBase}
                takenPlace="in the draft"
                pattern={KEBAB_PATTERN}
                title={DERIVED_KEBAB_RULE}
                required
                onChange={(id) => setTone({ ...tone, id })}
              />
            }
          />
          <PrimaryAction
            variant="accent"
            className="justify-self-start"
            type="submit"
            refusal={addNameless ? { id: addRefusalId, reason: TONE_NAME_RULE } : null}
          >
            <ButtonIcon verb="create" />
            Add tone of voice
          </PrimaryAction>
          {addNameless ? <RefusalLine id={addRefusalId}>{TONE_NAME_RULE}</RefusalLine> : null}
        </form>
        <p className="text-xs text-admin-muted">
          Agent configurations resolve the shop default through{" "}
          <code>{"{{shop.tone_of_voice}}"}</code> or select a named override. Renaming a guideline
          never moves the shop default: it is a pointer, and the radio on the row is the only
          control that moves it.
        </p>
      </Card>
    </SetupPage>
  );
}
