import type {
  FulfilmentMethodSchema,
  PaymentMethodSchema,
  ToneOfVoiceSchema,
} from "@agent-lab/contracts";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ButtonIcon } from "../components/ButtonIcon";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { CurrencyField } from "../components/CurrencyField";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldGroup, FieldHint, FieldRows } from "../components/FieldHint";
import { LocaleField } from "../components/LocaleField";
import { PrimaryAction, type Refusal, RefusalLine } from "../components/PrimaryAction";
import {
  Card,
  DefaultToneChip,
  EditorSaveActions,
  EntryCard,
  EntryEditNotice,
  EntryId,
  EntryKind,
  EntryText,
  IssueList,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import { entryEdit, useEntryEdit } from "../lib/entryEdit";
import { slugify, uniqueSuggestion } from "../lib/entryIds";
import { labelOf, optionsOf, PAYMENT_METHOD_KIND, SUPPORT_CHANNEL } from "../lib/enumLabels";
import {
  alreadyTakenMessage,
  DERIVED_KEBAB_RULE,
  KEBAB_PATTERN,
  SHOP_NAME_RULE,
  SHOP_SLUG_DETAIL_RULE,
  SHOP_SLUG_TAKEN_PLACE,
  TONE_DEFAULT_REMOVAL_RULE,
  TONE_NAME_RULE,
  TRANSIT_WINDOW_RULE,
} from "../lib/fieldRules";
import { consequenceOf, findingClauses, type Removal, useRemoval } from "../lib/removal";
import {
  accentButtonClasses,
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  textAreaClasses,
} from "../lib/ui";
import { HELD_VALUE_REASON, useRegisterUnsavedWork } from "../lib/unsavedWork";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const PAYMENT_KINDS = optionsOf(PAYMENT_METHOD_KIND);

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
  const { preview, save, saving, discard, discarding, dirty, error } = useShopWorkspace();
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">{children}</div>
        <Card title="Draft validation">
          <IssueList issues={preview?.issues ?? []} />
        </Card>
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
 * The authored fields of each of this page's six entry kinds, and the one function that turns
 * each set of them into the entry the draft stores.
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

/**
 * `enabled` is deliberately not here. It is the row's own chip-line toggle, which writes
 * straight to the draft and stays live while the row is open, so an edit must read it from
 * the entry as it stands at Save rather than from a copy taken when Edit was pressed — the
 * rule the variants table already follows, and the one a tone of voice follows for
 * `is_default`. Snapshotting it would silently revert a toggle made while the row was open.
 */
interface PaymentFields {
  name: string;
  kind: PaymentMethodSchema["kind"];
}

interface FulfilmentFields {
  name: string;
  carrier: string;
  min: number;
  max: number;
}

function paymentEntry(
  id: string,
  fields: PaymentFields & { enabled: boolean },
): PaymentMethodSchema {
  return { id, name: fields.name, kind: fields.kind, enabled: fields.enabled };
}

function paymentFields(entry: PaymentMethodSchema): PaymentFields {
  return { name: entry.name, kind: entry.kind };
}

function fulfilmentEntry(id: string, fields: FulfilmentFields): FulfilmentMethodSchema {
  return {
    id,
    name: fields.name,
    carrier: fields.carrier,
    min_transit_days: fields.min,
    max_transit_days: fields.max,
  };
}

function fulfilmentFields(entry: FulfilmentMethodSchema): FulfilmentFields {
  return {
    name: entry.name,
    carrier: entry.carrier,
    min: entry.min_transit_days,
    max: entry.max_transit_days,
  };
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

  // A shop must always answer on at least one channel, so the last checked box stays checked
  // instead of failing at save. `CurrencyField` holds the same rule for the currencies.
  function toggle<T extends string>(list: T[], value: T): T[] {
    if (!list.includes(value)) {
      return [...list, value];
    }
    return list.length === 1 ? list : list.filter((entry) => entry !== value);
  }

  function isLastSelected<T extends string>(list: readonly T[], value: T): boolean {
    return list.length === 1 && list[0] === value;
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
      <Card title="Shop identity">
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
          {/* `LocaleField` and `CurrencyField` each carry their own label and their own rule,
              so neither is wrapped in a row that would name it a second time. They are asked
              to draw themselves as rows instead, which is what keeps one card to one label
              typography and one unbroken run of dividing rules. */}
          <LocaleField
            arrangement="row"
            value={identity.locale}
            onChange={(locale) => edit({ ...content, identity: { ...identity, locale } })}
          />
          <CurrencyField
            arrangement="row"
            value={identity.currencies}
            onChange={(currencies) => edit({ ...content, identity: { ...identity, currencies } })}
          />
          {/* The set of boxes is one control with no element for a `for` to point at, so the
              row names it with `role="group"` and `aria-labelledby`. The rule about the last
              box belongs to the set, the way `CurrencyField`'s does: a box that cannot be
              clicked is not a place to read why. */}
          <FieldGroup
            label="Support channels"
            hint="A shop must answer somewhere. The last channel left on cannot be turned off."
          >
            <div className="flex flex-wrap gap-3 text-[13px]">
              {CHANNELS.map((channel) => (
                <label key={channel.value} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={identity.channels.includes(channel.value)}
                    disabled={isLastSelected(identity.channels, channel.value)}
                    onChange={() =>
                      edit({
                        ...content,
                        identity: {
                          ...identity,
                          channels: toggle([...identity.channels], channel.value),
                        },
                      })
                    }
                  />
                  {channel.label}
                </label>
              ))}
            </div>
          </FieldGroup>
        </FieldRows>
      </Card>

      <PaymentAndFulfilmentCards />
    </SetupPage>
  );
}

/** The Kind select a payment method wears, on the add form and in an open row alike. */
function PaymentKindField({
  value,
  onChange,
}: {
  value: PaymentMethodSchema["kind"];
  onChange: (kind: PaymentMethodSchema["kind"]) => void;
}) {
  return (
    <label className={fieldLabelClasses}>
      Kind
      <select
        className={`${fieldControlClasses} w-full`}
        value={value}
        onChange={(event) => onChange(event.target.value as PaymentMethodSchema["kind"])}
      >
        {PAYMENT_KINDS.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Whether a transit window is one the lab refuses to store: `FulfilmentMethod.__post_init__`
 * raises on a maximum shorter than the minimum, and on nothing else between the two.
 */
function transitInverted(value: FulfilmentFields): boolean {
  return value.max < value.min;
}

/**
 * Carrier and transit window, on the add form and in an open row alike — including the
 * refusal, which both paths therefore make in the same words and on the same control.
 *
 * The window is refused on **Max days**. The lab's sentence makes the maximum its subject, and
 * the maximum is the bound typed second, so the line appears under the control the operator
 * is in when the window turns over. It is the lab's own message (`TRANSIT_WINDOW_RULE`), at
 * the validation weight, in Max days' description, with Max days marked invalid; the add
 * form's Add and the open row's Save name this line rather than write the sentence twice
 * (ADR 0063, *Field's `extraId`*). Min days is not marked: the operator may mean either bound,
 * and the one line under the pair says which rule they broke.
 */
function FulfilmentFieldset({
  value,
  onChange,
  transitRefusalId,
}: {
  value: FulfilmentFields;
  onChange: (next: FulfilmentFields) => void;
  /** The id of the line that says the window is inverted, which the form's action names. */
  transitRefusalId: string;
}) {
  const inverted = transitInverted(value);
  return (
    <>
      <label className={fieldLabelClasses}>
        Carrier
        <input
          className={`${fieldControlClasses} w-full`}
          value={value.carrier}
          required
          onChange={(event) => onChange({ ...value, carrier: event.target.value })}
        />
      </label>
      <label className={fieldLabelClasses}>
        Min days
        <input
          type="number"
          min={0}
          className={`${fieldControlClasses} w-full`}
          value={value.min}
          onChange={(event) => onChange({ ...value, min: Number(event.target.value) })}
        />
      </label>
      <FieldHint
        label="Max days"
        extra={inverted ? TRANSIT_WINDOW_RULE : undefined}
        extraTone={inverted ? "error" : "muted"}
        extraId={transitRefusalId}
      >
        <input
          type="number"
          min={0}
          className={`${fieldControlClasses} w-full`}
          value={value.max}
          onChange={(event) => onChange({ ...value, max: Number(event.target.value) })}
        />
      </FieldHint>
    </>
  );
}

function PaymentAndFulfilmentCards() {
  const { shopId, content, edit } = useShopWorkspace();
  const [payment, setPayment] = useState<{ id: string } & PaymentFields>({
    id: "",
    name: "",
    kind: "card",
  });
  const [fulfilment, setFulfilment] = useState<{ id: string } & FulfilmentFields>({
    id: "",
    name: "",
    carrier: "",
    min: 1,
    max: 3,
  });
  const takenPaymentIds = content.payment_methods.map((method) => method.id);
  const takenFulfilmentIds = content.fulfilment_methods.map((method) => method.id);
  const paymentEditor = useEntryEdit<PaymentFields>(takenPaymentIds);
  const fulfilmentEditor = useEntryEdit<FulfilmentFields>(takenFulfilmentIds);
  const paymentNotice = useId();
  const paymentRemoval = useRemoval(shopId);
  const fulfilmentRemoval = useRemoval(shopId);
  const fulfilmentNotice = useId();
  // One line per window the page can hold open: the add form's, and the one open row's.
  const addTransitRefusalId = useId();
  const openTransitRefusalId = useId();
  const addTransitInverted = transitInverted(fulfilment);

  const paymentSuggested = uniqueSuggestion(slugify(payment.name, ""), takenPaymentIds);
  const fulfilmentSuggested = uniqueSuggestion(slugify(fulfilment.name, ""), takenFulfilmentIds);

  function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment.id || takenPaymentIds.includes(payment.id)) {
      return;
    }
    edit({
      ...content,
      payment_methods: [
        ...content.payment_methods,
        // A rail is added enabled; nothing on the form asks, and a disabled new rail would be
        // an answer the operator did not give.
        paymentEntry(payment.id, { ...payment, enabled: true }),
      ],
    });
    setPayment({ id: "", name: "", kind: "card" });
  }

  /**
   * The saved entry is replaced where it stands, so the list's order never moves — and
   * `enabled` is read off the entry as it stands rather than off the open fields, so a toggle
   * made on the chip line while the row was open survives Save.
   */
  function savePayment(id: string, fields: PaymentFields) {
    edit({
      ...content,
      payment_methods: content.payment_methods.map((entry) =>
        entry.id === id ? paymentEntry(id, { ...fields, enabled: entry.enabled }) : entry,
      ),
    });
  }

  function addFulfilment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The refused Add swallows its press; this is what refuses a submission that arrives
    // without one (ADR 0063).
    if (!fulfilment.id || takenFulfilmentIds.includes(fulfilment.id) || addTransitInverted) {
      return;
    }
    edit({
      ...content,
      fulfilment_methods: [
        ...content.fulfilment_methods,
        fulfilmentEntry(fulfilment.id, fulfilment),
      ],
    });
    setFulfilment({ id: "", name: "", carrier: "", min: 1, max: 3 });
  }

  function dropPayment(id: string) {
    edit({
      ...content,
      payment_methods: content.payment_methods.filter((entry) => entry.id !== id),
    });
  }

  function dropFulfilment(id: string) {
    edit({
      ...content,
      fulfilment_methods: content.fulfilment_methods.filter((entry) => entry.id !== id),
    });
  }

  function saveFulfilment(id: string, fields: FulfilmentFields) {
    edit({
      ...content,
      fulfilment_methods: content.fulfilment_methods.map((entry) =>
        entry.id === id ? fulfilmentEntry(id, fields) : entry,
      ),
    });
  }

  return (
    <>
      <Card title="Payment methods">
        <ul className="grid gap-2 text-[13px]">
          {content.payment_methods.map((method) =>
            paymentRemoval.isArmed(method.id) ? (
              <ConfirmRemove
                key={method.id}
                as="li"
                title={`Remove the payment method “${method.name}”?`}
                consequence={consequenceOf(
                  "The shop stops offering it once the draft is saved and published.",
                  findingClauses(["payment_method_missing_from_shop"]),
                  findingClauses([
                    method.enabled &&
                      !content.payment_methods.some(
                        (other) => other.id !== method.id && other.enabled,
                      ) &&
                      "shop_without_payment_method",
                  ]),
                  "Nothing is written until you save the draft, and a published shop version keeps it.",
                )}
                onConfirm={paymentRemoval.confirm(
                  () => dropPayment(method.id),
                  `Removed the payment method “${method.name}” from the draft.`,
                )}
                onKeep={paymentRemoval.keep}
              />
            ) : (
              <EntryCard
                key={method.id}
                title={method.name}
                chips={
                  <>
                    <EntryKind value={labelOf(PAYMENT_METHOD_KIND, method.kind)} />
                    <EntryId value={method.id} />
                    <label className="flex items-center gap-1.5 text-[12px] text-admin-muted">
                      <input
                        type="checkbox"
                        checked={method.enabled}
                        onChange={() =>
                          edit({
                            ...content,
                            payment_methods: content.payment_methods.map((entry) =>
                              entry.id === method.id
                                ? { ...entry, enabled: !entry.enabled }
                                : entry,
                            ),
                          })
                        }
                      />
                      enabled
                    </label>
                  </>
                }
                edit={entryEdit(
                  paymentEditor,
                  paymentNotice,
                  method.id,
                  method.name,
                  () => paymentFields(method),
                  (fields) => savePayment(method.id, fields),
                  (value, onChange) => (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className={fieldLabelClasses}>
                        Name
                        <input
                          className={`${fieldControlClasses} w-full`}
                          value={value.name}
                          required
                          onChange={(event) => onChange({ ...value, name: event.target.value })}
                        />
                      </label>
                      <PaymentKindField
                        value={value.kind}
                        onChange={(kind) => onChange({ ...value, kind })}
                      />
                    </div>
                  ),
                )}
                actions={
                  <RemoveButton
                    label={method.name}
                    removal={paymentRemoval}
                    entryKey={method.id}
                    notice={`Removed the payment method “${method.name}” from the draft.`}
                    onRemove={() => dropPayment(method.id)}
                  />
                }
              />
            ),
          )}
          {content.payment_methods.length === 0 ? (
            <li className="text-admin-muted">No payment method yet.</li>
          ) : null}
        </ul>
        <EntryEditNotice id={paymentNotice} label={paymentEditor.open?.label ?? null} />
        <RemovalNotice removal={paymentRemoval} />
        <form className={`${addFormClasses} sm:grid-cols-4`} onSubmit={addPayment}>
          <label className={fieldLabelClasses}>
            Name
            <input
              className={`${fieldControlClasses} w-full`}
              value={payment.name}
              required
              onChange={(event) => setPayment({ ...payment, name: event.target.value })}
            />
          </label>
          <DerivedIdField
            label="ID"
            hint={DERIVED_KEBAB_RULE}
            value={payment.id}
            suggested={paymentSuggested.value}
            taken={takenPaymentIds}
            takenBase={paymentSuggested.takenBase}
            takenPlace="in the draft"
            pattern={KEBAB_PATTERN}
            title={DERIVED_KEBAB_RULE}
            required
            onChange={(id) => setPayment({ ...payment, id })}
          />
          <PaymentKindField
            value={payment.kind}
            onChange={(kind) => setPayment({ ...payment, kind })}
          />
          <button className={`${accentButtonClasses} self-end`} type="submit">
            <ButtonIcon verb="create" />
            Add payment method
          </button>
        </form>
      </Card>

      <Card title="Fulfilment methods">
        <ul className="grid gap-2 text-[13px]">
          {content.fulfilment_methods.map((method) =>
            fulfilmentRemoval.isArmed(method.id) ? (
              <ConfirmRemove
                key={method.id}
                as="li"
                title={`Remove the fulfilment method “${method.name}”?`}
                consequence={consequenceOf(
                  "The shop stops offering it once the draft is saved and published.",
                  findingClauses(["fulfilment_method_missing_from_shop"]),
                  findingClauses([
                    content.fulfilment_methods.length === 1 && "shop_without_fulfilment_method",
                  ]),
                  "Nothing is written until you save the draft, and a published shop version keeps it.",
                )}
                onConfirm={fulfilmentRemoval.confirm(
                  () => dropFulfilment(method.id),
                  `Removed the fulfilment method “${method.name}” from the draft.`,
                )}
                onKeep={fulfilmentRemoval.keep}
              />
            ) : (
              <EntryCard
                key={method.id}
                title={method.name}
                chips={
                  <>
                    <span className="text-[12px] text-admin-muted">
                      {method.carrier} · {method.min_transit_days}–{method.max_transit_days} days
                    </span>
                    <EntryId value={method.id} />
                  </>
                }
                edit={entryEdit(
                  fulfilmentEditor,
                  fulfilmentNotice,
                  method.id,
                  method.name,
                  () => fulfilmentFields(method),
                  (fields) => saveFulfilment(method.id, fields),
                  (value, onChange) => (
                    <div className="grid items-start gap-2 sm:grid-cols-4">
                      <label className={fieldLabelClasses}>
                        Name
                        <input
                          className={`${fieldControlClasses} w-full`}
                          value={value.name}
                          required
                          onChange={(event) => onChange({ ...value, name: event.target.value })}
                        />
                      </label>
                      <FulfilmentFieldset
                        value={value}
                        onChange={onChange}
                        transitRefusalId={openTransitRefusalId}
                      />
                    </div>
                  ),
                  (value) =>
                    transitInverted(value)
                      ? { id: openTransitRefusalId, reason: TRANSIT_WINDOW_RULE }
                      : true,
                )}
                actions={
                  <RemoveButton
                    label={method.name}
                    removal={fulfilmentRemoval}
                    entryKey={method.id}
                    notice={`Removed the fulfilment method “${method.name}” from the draft.`}
                    onRemove={() => dropFulfilment(method.id)}
                  />
                }
              />
            ),
          )}
          {content.fulfilment_methods.length === 0 ? (
            <li className="text-admin-muted">No fulfilment method yet.</li>
          ) : null}
        </ul>
        <EntryEditNotice id={fulfilmentNotice} label={fulfilmentEditor.open?.label ?? null} />
        <RemovalNotice removal={fulfilmentRemoval} />
        {/* `items-start`: the transit sentence under Max days wraps in its narrow cell, and a
            stretched row would grow every sibling control with it. The open row's grid does
            the same. */}
        <form className={`${addFormClasses} items-start sm:grid-cols-5`} onSubmit={addFulfilment}>
          <label className={fieldLabelClasses}>
            Name
            <input
              className={`${fieldControlClasses} w-full`}
              value={fulfilment.name}
              required
              onChange={(event) => setFulfilment({ ...fulfilment, name: event.target.value })}
            />
          </label>
          <DerivedIdField
            label="ID"
            hint={DERIVED_KEBAB_RULE}
            value={fulfilment.id}
            suggested={fulfilmentSuggested.value}
            taken={takenFulfilmentIds}
            takenBase={fulfilmentSuggested.takenBase}
            takenPlace="in the draft"
            pattern={KEBAB_PATTERN}
            title={DERIVED_KEBAB_RULE}
            required
            onChange={(id) => setFulfilment({ ...fulfilment, id })}
          />
          <FulfilmentFieldset
            value={fulfilment}
            onChange={(next) => setFulfilment({ ...fulfilment, ...next })}
            transitRefusalId={addTransitRefusalId}
          />
          <PrimaryAction
            variant="accent"
            className="self-end"
            type="submit"
            refusal={
              addTransitInverted ? { id: addTransitRefusalId, reason: TRANSIT_WINDOW_RULE } : null
            }
          >
            <ButtonIcon verb="create" />
            Add fulfilment method
          </PrimaryAction>
        </form>
      </Card>
    </>
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
