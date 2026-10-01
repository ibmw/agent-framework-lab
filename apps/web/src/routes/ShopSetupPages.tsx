import type { ToneOfVoiceSchema } from "@agent-lab/contracts";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { CurrencyField } from "../components/CurrencyField";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldGroup, FieldHint, FieldRows } from "../components/FieldHint";
import {
  EditButton,
  FixedKeyField,
  ItemFormRow,
  ListItem,
  RemoveButton,
} from "../components/ItemList";
import { LocaleField } from "../components/LocaleField";
import type { Refusal } from "../components/PrimaryAction";
import { SetupChecklist } from "../components/SetupChecklist";
import { ShopLogoCard } from "../components/ShopLogoCard";
import { ToggleChipGroup } from "../components/ToggleChipGroup";
import {
  Card,
  DefaultToneChip,
  EditorSaveActions,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import { SLUG_MAX_LENGTH, slugify, uniqueSuggestion } from "../lib/entryIds";
import { optionsOf, SUPPORT_CHANNEL } from "../lib/enumLabels";
import {
  alreadyTakenMessage,
  DERIVED_KEBAB_RULE,
  LABEL_MAX_LENGTH,
  SHOP_NAME_RULE,
  SHOP_SLUG_DETAIL_RULE,
  SHOP_SLUG_TAKEN_PLACE,
  TEXT_MAX_LENGTH,
  TONE_DEFAULT_REMOVAL_RULE,
} from "../lib/fieldRules";
import {
  formTitle,
  type ItemFormWords,
  refusedProps,
  useEditButtons,
  useFocusAfterCommit,
  useItemForm,
} from "../lib/itemForm";
import { pythonStrip } from "../lib/pythonText";
import { consequenceOf, findingClauses, useRemoval } from "../lib/removal";
import { unsoldCurrencyFindings } from "../lib/setupChecklist";
import {
  BLANK_TONE,
  TONE_TAKEN_PLACE,
  type ToneFields,
  toneEntry,
  toneFields,
  toneRefusal,
} from "../lib/toneGuidelines";
import {
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
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
      <Card
        title="Identity"
        description={
          <>
            What the shop is called, and the slug scenarios, orders and published versions address
            it by.
          </>
        }
      >
        <FieldRows>
          <Field label="Name" hint={SHOP_NAME_RULE}>
            <input
              maxLength={LABEL_MAX_LENGTH}
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
            maxLength={SLUG_MAX_LENGTH}
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

      <Card title="Commerce" description="Where the shop trades and what it can price in.">
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

      <Card title="Channels" description="A shop must always answer on at least one.">
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

const TONE_WORDS: ItemFormWords = { form: "Guidelines", entry: "a guideline", record: "draft" };

const TONE_ID_FIXED_HINT =
  "Set when the guideline was added. An agent configuration names it by this ID as an override.";

/**
 * The muted line that stands where the shop default's trash would: a refusal with a way out,
 * rather than a refused action, so not the validation weight (`docs/design-direction.md`, *A
 * refusal that has a way out names the way out*).
 */
const wayOutLineClasses = "max-w-[26ch] text-xs text-admin-muted";

/**
 * The shop's guidelines, as items, and the one form that adds a guideline or edits the one
 * chosen (ADR 0074). The default's radio is the item's lead and the list's control, never the
 * form's (ADR 0072): it reads the draft, which always holds a guideline's saved name, so it is
 * free while the form holds an edit — a nameless one included — and an edit never moves the
 * default. The ID is fixed while editing, because a configuration names a guideline by it.
 */
export function ToneOfVoicePage() {
  const { shopId, content, edit } = useShopWorkspace();
  const guidelines = content.tone_of_voice_guidelines;
  const ids = guidelines.map((entry) => entry.id);
  const guidelineOf = (id: string) =>
    guidelines.find((entry) => entry.id === id) as ToneOfVoiceSchema;
  const nameOf = (id: string) => guidelines.find((entry) => entry.id === id)?.name ?? id;
  const form = useItemForm<ToneFields>({
    blank: BLANK_TONE,
    ids,
    words: TONE_WORDS,
    nameOf,
    formOf: (id) => toneFields(guidelineOf(id)),
    typedOf: (fields) => fields.name,
  });
  const removal = useRemoval(shopId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const nameInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = toneRefusal(form.fields, ids, form.editing);
  // A blank form is refused and says why, but marks nothing until something is in it.
  const marked = form.dirty ? refusal : null;
  const suggested = uniqueSuggestion(slugify(pythonStrip(form.fields.name), ""), ids);

  function setDefault(id: string) {
    edit({
      ...content,
      tone_of_voice_guidelines: guidelines.map((entry) => ({
        ...entry,
        is_default: entry.id === id,
      })),
      default_tone_of_voice_id: id,
    });
  }

  function drop(id: string) {
    edit({ ...content, tone_of_voice_guidelines: guidelines.filter((entry) => entry.id !== id) });
  }

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      // An edit that changed nothing writes nothing, so the draft stays as clean as it was.
      if (form.dirty) {
        edit({
          ...content,
          tone_of_voice_guidelines: guidelines.map((entry) =>
            entry.id === editing
              ? // `is_default` is the radio's answer on the item, never the form's: an edit to
                // the wording must not move the shop default.
                toneEntry(entry.id, form.fields, entry.is_default)
              : entry,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      edit({
        ...content,
        tone_of_voice_guidelines: [
          ...guidelines,
          // The first guideline is the default: a shop with one has no other to point at.
          toneEntry(form.fields.id, form.fields, guidelines.length === 0),
        ],
      });
    }
    form.reset();
  }

  function cancel() {
    const editing = form.editing;
    form.reset();
    if (editing !== null) {
      focusAfterCommit(() => editButtons.get(editing));
    }
  }

  return (
    <SetupPage title="Tone of voice">
      <Card title="Guidelines">
        <FieldRows>
          <FieldGroup
            label="Voices"
            hint={
              <>
                Agent configurations resolve the shop default through{" "}
                <code>{"{{shop.tone_of_voice}}"}</code> or name another as an override. The radio is
                the only control that moves the default; an edit never does.
              </>
            }
          >
            <div className="grid gap-2">
              {guidelines.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {guidelines.map((entry) => {
                    const notice = `Removed the guideline “${entry.name}” from the draft.`;
                    if (removal.isArmed(entry.id)) {
                      return (
                        <ConfirmRemove
                          key={entry.id}
                          as="li"
                          title={`Remove the guideline “${entry.name}”?`}
                          consequence={consequenceOf(
                            "An agent configuration that names it as an override will be naming a guideline the shop's next published version does not have.",
                            findingClauses([
                              guidelines.length === 1
                                ? "shop_without_tone_of_voice"
                                : entry.is_default && "tone_of_voice_without_default",
                            ]),
                            "Nothing is written until you save the draft, and a published shop version keeps it.",
                          )}
                          onConfirm={removal.confirm(() => drop(entry.id), notice)}
                          onKeep={removal.keep}
                        />
                      );
                    }
                    return (
                      <ListItem
                        key={entry.id}
                        lead={
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name="default-tone"
                              checked={entry.is_default}
                              onChange={() => setDefault(entry.id)}
                            />
                            <span className="sr-only">Make {entry.name} the shop default</span>
                          </label>
                        }
                        name={entry.name}
                        tag={entry.is_default ? <DefaultToneChip /> : undefined}
                        id={entry.id}
                        detail={entry.guidance}
                        multiline
                        editing={form.editing === entry.id}
                      >
                        <EditButton
                          name={entry.name}
                          buttonRef={editButtons.ref(entry.id)}
                          onEdit={() => {
                            form.begin(entry.id, toneFields(entry));
                            focusAfterCommit(() => nameInput.current);
                          }}
                        />
                        {/* The shop default has no trash at all: deleting it would leave the
                            draft owing `tone_of_voice_without_default` with no control on this
                            page to pay it, so where the trash would stand the item says what to
                            do instead, as the prototype writes it (`Workspace.dc.html` :1897). */}
                        {entry.is_default ? (
                          <p className={wayOutLineClasses}>{TONE_DEFAULT_REMOVAL_RULE}</p>
                        ) : (
                          <RemoveButton
                            name={entry.name}
                            entryKey={entry.id}
                            removal={removal}
                            notice={notice}
                            onRemove={() => drop(entry.id)}
                          />
                        )}
                      </ListItem>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-admin-muted">No tone-of-voice guideline yet.</p>
              )}
              <RemovalNotice removal={removal} />
            </div>
          </FieldGroup>
          <ItemFormRow
            title={formTitle(form.editing, nameOf, TONE_WORDS.entry)}
            hint="The name and guidance can change later; the ID is fixed once the guideline is added."
            editing={form.editing !== null}
            addLabel="Add tone of voice"
            refusal={refusal}
            reasonId={reasonId}
            onSubmit={submit}
            onCancel={cancel}
          >
            <FieldHint label="Name">
              <input
                maxLength={LABEL_MAX_LENGTH}
                ref={nameInput}
                className={`${fieldControlClasses} w-full`}
                value={form.fields.name}
                placeholder="Warm and precise"
                {...refusedProps(marked, "name", reasonId)}
                onChange={(event) => form.update({ name: event.target.value })}
              />
            </FieldHint>
            {form.editing !== null ? (
              <FixedKeyField label="ID" hint={TONE_ID_FIXED_HINT} value={form.fields.id} />
            ) : (
              // Keyed by the form's session, so the field's own memory of having been edited
              // never outlives the guideline it was typed for.
              <DerivedIdField
                key={form.session}
                label="ID"
                hint={DERIVED_KEBAB_RULE}
                value={form.fields.id}
                suggested={suggested.value}
                takenBase={suggested.takenBase}
                takenPlace={TONE_TAKEN_PLACE}
                monospace
                maxLength={SLUG_MAX_LENGTH}
                refusedBy={marked?.field === "id" ? reasonId : undefined}
                onChange={(id) => form.update({ id })}
              />
            )}
            <div className="col-span-full">
              <FieldHint label="Guidance">
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${textAreaClasses} w-full`}
                  value={form.fields.guidance}
                  {...refusedProps(marked, "guidance", reasonId)}
                  onChange={(event) => form.update({ guidance: event.target.value })}
                />
              </FieldHint>
            </div>
          </ItemFormRow>
        </FieldRows>
      </Card>
    </SetupPage>
  );
}
