import type {
  AccountStatus,
  AddressSchema,
  BackgroundEntrySchema,
  BackgroundKind,
  CustomerProfileContentSchema,
  CustomerProfilePayloadSchema,
  CustomerProfilePreviewResponse,
  HiddenFactSchema,
  LoyaltyTier,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  attachCustomerProfileToShop,
  detachCustomerProfileFromShop,
  getCustomerProfileDraft,
  listCustomerProfileShops,
  previewCustomerProfileDraft,
  publishCustomerProfile,
  replaceCustomerProfileDraft,
  toProfilePayload,
} from "../api/customerProfiles";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipListField } from "../components/ChipListField";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { CountryField } from "../components/CountryField";
import { Field, FieldRows } from "../components/FieldHint";
import { LocaleField } from "../components/LocaleField";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import {
  Card,
  EditorSaveActions,
  EntryCard,
  EntryEditNotice,
  EntryId,
  EntryText,
  Fingerprint,
  GateCard,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { countryName } from "../lib/countries";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { entryEdit, useEntryEdit } from "../lib/entryEdit";
import { slugify, uniqueId } from "../lib/entryIds";
import { BACKGROUND_KIND, labelOf, optionsOf } from "../lib/enumLabels";
import {
  ACCOUNT_NOTES_RULE,
  ACCOUNT_STATUS_RULE,
  ADDRESS_FIELDS_RULE,
  CHIP_LABEL_MAX_LENGTH,
  CUSTOMER_EMAIL_RULE,
  CUSTOMER_NAME_RULE,
  CUSTOMER_PHONE_RULE,
  CUSTOMER_SINCE_RULE,
  LOYALTY_TIER_RULE,
  PERSONA_SUMMARY_RULE,
  PERSONA_TRAITS_RULE,
} from "../lib/fieldRules";
import { todayInput } from "../lib/orders";
import {
  consequenceOf,
  findingClauses,
  REMOVAL_FINDINGS,
  removedState,
  useRemoval,
} from "../lib/removal";
import {
  addFormClasses,
  destructiveSubtleButtonClasses,
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  fieldLabelClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const CLIENT: DefinitionClient<
  CustomerProfileContentSchema,
  CustomerProfilePayloadSchema,
  CustomerProfilePreviewResponse
> = {
  getDraft: getCustomerProfileDraft,
  previewDraft: previewCustomerProfileDraft,
  replaceDraft: replaceCustomerProfileDraft,
  publish: publishCustomerProfile,
  toPayload: toProfilePayload,
  unavailable: "The customer service is unavailable.",
};

const BACKGROUND_KINDS = optionsOf(BACKGROUND_KIND);

/**
 * The authored fields of the profile's two keyed lists, and the one builder each.
 *
 * The add form below a list and the open row inside it hold the same object and call the same
 * function, so the two paths cannot grow different payloads. The identifier is the builder's
 * first argument: it is derived once, when the entry is created, and an edit hands back the
 * one the entry already has — which is what makes an edit read as one updated entry rather
 * than a removal and an addition in the draft's change summary.
 */
interface BackgroundFields {
  kind: BackgroundKind;
  occurredOn: string;
  note: string;
}

interface HiddenFactFields {
  note: string;
  revealedWhen: string;
}

function backgroundEntry(id: string, fields: BackgroundFields): BackgroundEntrySchema {
  return { id, kind: fields.kind, occurred_on: fields.occurredOn, note: fields.note };
}

function hiddenFactEntry(id: string, fields: HiddenFactFields): HiddenFactSchema {
  return { id, note: fields.note, revealed_when: fields.revealedWhen };
}

/**
 * The background entry's three controls, on the add form and in an open row alike.
 *
 * The row carried them as three `aria-label`s and a date printed as a heading; PLAN-UX Slice 7
 * asks for visible labels where a row had only the accessible one, and the way a row gets them
 * is by asking its questions with the same words the add form asks them with.
 */
function BackgroundFieldset({
  value,
  onChange,
}: {
  value: BackgroundFields;
  onChange: (next: BackgroundFields) => void;
}) {
  return (
    <>
      <label className={fieldLabelClasses}>
        Kind
        <select
          className={`${fieldControlClasses} w-full`}
          value={value.kind}
          onChange={(event) => onChange({ ...value, kind: event.target.value as BackgroundKind })}
        >
          {BACKGROUND_KINDS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldLabelClasses}>
        Date
        <input
          className={`${fieldControlClasses} w-full`}
          type="date"
          value={value.occurredOn}
          onChange={(event) => onChange({ ...value, occurredOn: event.target.value })}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Note
        <input
          className={`${fieldControlClasses} w-full`}
          value={value.note}
          required
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </label>
    </>
  );
}

/** A hidden fact's two controls, on the add form and in an open row alike. */
function HiddenFactFieldset({
  value,
  onChange,
}: {
  value: HiddenFactFields;
  onChange: (next: HiddenFactFields) => void;
}) {
  return (
    <>
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Hidden fact
        <input
          className={`${fieldControlClasses} w-full`}
          value={value.note}
          required
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-48 flex-1`}>
        Revealed when
        <input
          className={`${fieldControlClasses} w-full`}
          placeholder="Revealed when…"
          value={value.revealedWhen}
          onChange={(event) => onChange({ ...value, revealedWhen: event.target.value })}
        />
      </label>
    </>
  );
}

/**
 * The customer editor, mounted afresh for every profile (ADR 0060).
 *
 * A move from one profile to another is otherwise the same page with a new parameter, and what
 * the page holds for the profile it was opened on — an attach or detach still in flight, the
 * controls a failed removal returns focus to, the attached-shops list a late answer rewrites —
 * would land on the next one: a detach of Maya failing after the operator opened Tomás put
 * focus on Tomás's own Detach. Keyed by the profile, the old page unmounts and its late answers
 * go nowhere. The unsaved-work guard is asked before the move, so a dirty profile still asks.
 */
export function CustomerEditorRoute() {
  const { profileId = "" } = useParams();
  return <CustomerEditorPage key={profileId} />;
}

export function CustomerEditorPage() {
  const { profileId = "" } = useParams();
  const { shopId, shops, listings } = useShopWorkspace();
  const publishReasonsId = useId();
  const editor = useDefinitionEditor(profileId, CLIENT, {
    label: "The customer profile draft has unsaved changes.",
    // The Customers index prints the row this editor is changing, and it renders the shell's
    // listing rather than reading its own (ADR 0056).
    afterSave: listings.customers.refresh,
  });
  const { content, preview, edit } = editor;
  const [attachedShops, setAttachedShops] = useState<string[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const backgroundEditor = useEntryEdit<BackgroundFields>(
    (content?.background ?? []).map((entry) => entry.id),
  );
  const hiddenFactEditor = useEntryEdit<HiddenFactFields>(
    (content?.hidden_facts ?? []).map((fact) => fact.id),
  );
  const addressEditor = useEntryEdit<AddressFields>(
    (content?.addresses ?? []).map((entry) => entry.id),
  );
  const addressNotice = useId();
  const openAddressRefusalId = useId();
  const backgroundNotice = useId();
  const hiddenFactNotice = useId();
  const navigate = useNavigate();
  const addressRemoval = useRemoval(profileId);
  const backgroundRemoval = useRemoval(profileId);
  const hiddenFactRemoval = useRemoval(profileId);
  const shopRemoval = useRemoval(profileId);
  // The shops an attach or a detach is in flight for, held twice: the ref answers a second
  // press in the same event, the state disables the control until the write settles.
  const pendingShops = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  // Whether this page is still the one on screen when a write it sent answers. A write that
  // settles after the operator has left — for another profile, which is a fresh page — must
  // not navigate them, set this page's state, or say anything.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reloadShops = useCallback(
    async (signal?: AbortSignal) => {
      setAttachedShops((await listCustomerProfileShops(profileId, signal)).shop_ids);
    },
    [profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    reloadShops(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setAttachError(describeApiError(cause, "The attached shops are unavailable."));
      }
    });
    return () => controller.abort();
  }, [reloadShops]);

  if (editor.loading) {
    return <p className="text-sm text-admin-muted">Loading customer…</p>;
  }

  if (!content) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {editor.error ?? "This customer could not be loaded."}
      </div>
    );
  }

  function addAddress(fields: AddressFields) {
    if (!content) {
      return;
    }
    const entry = addressEntry(
      uniqueId(
        slugify(fields.label),
        content.addresses.map((existing) => existing.id),
      ),
      fields,
      // The first address is the default, because a published profile must hold one.
      content.addresses.length === 0,
    );
    edit({ ...content, addresses: [...content.addresses, entry] });
  }

  function makeDefault(id: string) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      addresses: content.addresses.map((entry) => ({ ...entry, is_default: entry.id === id })),
    });
  }

  function removeAddress(id: string) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      addresses: content.addresses.filter((entry) => entry.id !== id),
    });
  }

  function editAccount(next: Partial<CustomerProfileContentSchema["account"]>) {
    if (!content) {
      return;
    }
    edit({ ...content, account: { ...content.account, ...next } });
  }

  /** The entry is replaced where it stands, with the ID it already had, so the list's order
   * never moves and the change summary reads one updated entry. */
  function saveBackground(id: string, fields: BackgroundFields) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      background: content.background.map((entry) =>
        entry.id === id ? backgroundEntry(id, fields) : entry,
      ),
    });
  }

  function removeBackground(id: string) {
    if (!content) {
      return;
    }
    edit({ ...content, background: content.background.filter((entry) => entry.id !== id) });
  }

  function saveHiddenFact(id: string, fields: HiddenFactFields) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      hidden_facts: content.hidden_facts.map((fact) =>
        fact.id === id ? hiddenFactEntry(id, fields) : fact,
      ),
    });
  }

  function removeHiddenFact(id: string) {
    if (!content) {
      return;
    }
    edit({ ...content, hidden_facts: content.hidden_facts.filter((fact) => fact.id !== id) });
  }

  /**
   * Attach or detach, answering whether the write landed — which is what a detach's notice
   * waits for (ADR 0060): a detach that failed says nothing, and this page's error says why.
   */
  async function toggleShop(targetShopId: string, attach: boolean): Promise<boolean> {
    // One write per shop at a time: a second press while the first is in flight would send a
    // second write and supersede the first one's refresh, which would then read as a failure.
    if (pendingShops.current.has(targetShopId)) {
      return false;
    }
    pendingShops.current.add(targetShopId);
    setPending((current) => [...current, targetShopId]);
    setAttachError(null);
    try {
      const response = attach
        ? await attachCustomerProfileToShop(profileId, targetShopId)
        : await detachCustomerProfileFromShop(profileId, targetShopId);
      // Customers lists this shop's profiles, so it is read again whichever way the attachment
      // moved, and whether or not this page is still on screen to see it (ADR 0056: a surface
      // that changed what a listing holds refreshes it) — the operator may be on that index
      // already. Awaited, so the index this page leaves for no longer lists the profile its
      // notice says was detached. The refresh is the workspace's, safe to call late (ADR 0059).
      const fresh = targetShopId === shopId ? await listings.customers.refresh() : true;
      if (!mounted.current) {
        return false;
      }
      setAttachedShops(response.shop_ids);
      if (targetShopId !== shopId) {
        return true;
      }
      if (attach) {
        return true;
      }
      if (!fresh) {
        // The detach landed and the list did not answer. Customers would still list the
        // profile beside a notice saying it was detached, so the page stays here and says
        // both halves of what happened.
        setAttachError(
          "The customer list could not be refreshed, so this page stays on the profile.",
        );
        return true;
      }
      // The profile is no longer one of this shop's customers, so this page — which is this
      // shop's view of it — has nothing left to stand on. Leaving goes through the one
      // unsaved-work guard like any other navigation (ADR 0051): an edit to the profile is
      // still an edit to something the lab holds, and is still asked about.
      navigate(`/shops/${shopId}/customers`, {
        state: removedState(
          `Detached ${content?.display_name ?? "the profile"} from this shop.`,
          profileId,
        ),
      });
      return true;
    } catch (cause: unknown) {
      if (mounted.current) {
        setAttachError(describeApiError(cause, "The attachment could not be changed."));
      }
      return false;
    } finally {
      pendingShops.current.delete(targetShopId);
      if (mounted.current) {
        setPending((current) => current.filter((id) => id !== targetShopId));
      }
    }
  }

  const otherShops = shops.filter((shop) => shop.shop_id !== shopId);

  return (
    <>
      <PageHeader
        title={content.display_name}
        chips={<VersionChips preview={preview} />}
        back={{ to: "..", label: "Customers", kind: "profile" }}
        description={
          <>
            Synthetic profile · customer since {content.account.customer_since}
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
                    void listings.customers.refresh();
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
                Published version {publishedVersion}. It is immutable; editing continues on the
                draft.
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
              <Field label="Given name" hint={CUSTOMER_NAME_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={content.identity.given_name}
                  onChange={(event) =>
                    edit({
                      ...content,
                      identity: { ...content.identity, given_name: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Family name" hint={CUSTOMER_NAME_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={content.identity.family_name}
                  onChange={(event) =>
                    edit({
                      ...content,
                      identity: { ...content.identity, family_name: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Email" hint={CUSTOMER_EMAIL_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  type="email"
                  value={content.identity.email}
                  onChange={(event) =>
                    edit({
                      ...content,
                      identity: { ...content.identity, email: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Phone" hint={CUSTOMER_PHONE_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  type="tel"
                  value={content.identity.phone ?? ""}
                  onChange={(event) =>
                    edit({
                      ...content,
                      identity: {
                        ...content.identity,
                        phone: event.target.value === "" ? null : event.target.value,
                      },
                    })
                  }
                />
              </Field>
              {/* `LocaleField` brings its own label and its own rule, so it is not wrapped in
                  a row that would give it a second one. It is asked to draw itself as a row
                  instead, which keeps this card to one label typography. */}
              <LocaleField
                arrangement="row"
                value={content.identity.locale}
                onChange={(locale) =>
                  edit({ ...content, identity: { ...content.identity, locale } })
                }
              />
            </FieldRows>
          </Card>

          <Card title="Account">
            <FieldRows>
              <Field label="Customer since" hint={CUSTOMER_SINCE_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  type="date"
                  value={content.account.customer_since}
                  onChange={(event) => editAccount({ customer_since: event.target.value })}
                />
              </Field>
              <Field label="Status" hint={ACCOUNT_STATUS_RULE}>
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.account.status}
                  onChange={(event) => editAccount({ status: event.target.value as AccountStatus })}
                >
                  <option value="active">Active</option>
                  <option value="dormant">Dormant</option>
                  <option value="closed">Closed</option>
                </select>
              </Field>
              <Field label="Loyalty tier" hint={LOYALTY_TIER_RULE}>
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={content.account.loyalty_tier}
                  onChange={(event) =>
                    editAccount({ loyalty_tier: event.target.value as LoyaltyTier })
                  }
                >
                  <option value="none">None</option>
                  <option value="silver">Silver</option>
                  <option value="gold">Gold</option>
                </select>
              </Field>
            </FieldRows>
            {/* A lone checkbox says what it means beside itself; a row would give it a label
                on the left and a tick on the right with nothing between them. It keeps the
                place it had, between the account's selects and its notes. */}
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={content.account.marketing_opt_in}
                onChange={(event) => editAccount({ marketing_opt_in: event.target.checked })}
              />
              Opted in to marketing
            </label>
            <FieldRows>
              <Field label="Account notes" hint={ACCOUNT_NOTES_RULE}>
                <textarea
                  className={`${textAreaClasses} w-full`}
                  value={content.account.notes}
                  onChange={(event) => editAccount({ notes: event.target.value })}
                />
              </Field>
            </FieldRows>
          </Card>

          <Card
            title="Address book"
            description={
              <>
                Orders select an entry and keep a frozen copy. Editing or removing an entry never
                rewrites existing orders, published scenarios, or snapshots.
              </>
            }
          >
            {content.addresses.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No address yet. A published profile must hold at least one, with one default.
              </p>
            ) : (
              <ul className="grid gap-2 text-[13px]">
                {content.addresses.map((entry) => {
                  const notice = `Removed the address “${entry.label}” from the draft.`;
                  if (addressRemoval.isArmed(entry.id)) {
                    return (
                      <ConfirmRemove
                        key={entry.id}
                        as="li"
                        title={`Remove the address “${entry.label}”?`}
                        consequence={consequenceOf(
                          findingClauses([
                            content.addresses.length === 1
                              ? "profile_without_address"
                              : entry.is_default && "address_book_without_default",
                            "shipping_address_source_removed",
                          ]),
                          "Published scenarios and snapshots are never rewritten. Nothing is written until you save the draft.",
                        )}
                        onConfirm={addressRemoval.confirm(() => removeAddress(entry.id), notice)}
                        onKeep={addressRemoval.keep}
                      />
                    );
                  }
                  return (
                    <EntryCard
                      key={entry.id}
                      title={entry.label}
                      chips={
                        <>
                          <EntryId value={entry.id} />
                          {entry.is_default ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-published px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-published-ink">
                              <span aria-hidden>●</span> Default
                            </span>
                          ) : null}
                        </>
                      }
                      edit={entryEdit(
                        addressEditor,
                        addressNotice,
                        entry.id,
                        entry.label,
                        () => addressFields(entry),
                        (fields) =>
                          edit({
                            ...content,
                            addresses: content.addresses.map((item) =>
                              item.id === entry.id
                                ? // Which entry is the default is *Make default*'s answer on
                                  // the row, never the form's: correcting a street must not
                                  // move it.
                                  addressEntry(entry.id, fields, entry.is_default)
                                : item,
                            ),
                          }),
                        (value, onChange) => {
                          const refused = addressRefusal(value);
                          return (
                            <>
                              <AddressFieldset asks="every" value={value} onChange={onChange} />
                              {refused === null ? null : (
                                <RefusalLine id={openAddressRefusalId}>{refused}</RefusalLine>
                              )}
                            </>
                          );
                        },
                        (value) => {
                          const refused = addressRefusal(value);
                          return refused === null
                            ? true
                            : { id: openAddressRefusalId, reason: refused };
                        },
                      )}
                      actions={
                        <>
                          {entry.is_default ? null : (
                            <button
                              className={subtleButtonClasses}
                              type="button"
                              aria-label={`Make ${entry.label} the default address`}
                              onClick={() => makeDefault(entry.id)}
                            >
                              <ButtonIcon verb="makeDefault" />
                              Make default
                            </button>
                          )}
                          <button
                            className={destructiveSubtleButtonClasses}
                            type="button"
                            aria-label={`Remove ${entry.label}`}
                            ref={addressRemoval.trigger(entry.id)}
                            onClick={addressRemoval.ask(
                              entry.id,
                              () => removeAddress(entry.id),
                              notice,
                            )}
                          >
                            <ButtonIcon verb="delete" />
                            Remove
                          </button>
                        </>
                      }
                    >
                      <p className="text-admin-ink-soft">{addressLine(entry)}</p>
                    </EntryCard>
                  );
                })}
              </ul>
            )}
            <EntryEditNotice id={addressNotice} label={addressEditor.open?.label ?? null} />
            <RemovalNotice removal={addressRemoval} />
            <AddressForm
              defaultCountry={countryForLocale(content.identity.locale)}
              recipient={content.display_name}
              onAdd={addAddress}
            />
          </Card>

          <Card
            title="Behavioral persona"
            description={
              <>
                Guides you and the future customer simulator. It is never injected into the support
                agent's prompt.
              </>
            }
          >
            <FieldRows>
              <Field label="Summary" hint={PERSONA_SUMMARY_RULE}>
                <textarea
                  className={`${textAreaClasses} w-full`}
                  value={content.persona.summary}
                  onChange={(event) =>
                    edit({
                      ...content,
                      persona: { ...content.persona, summary: event.target.value },
                    })
                  }
                />
              </Field>
            </FieldRows>
            {/* `ChipListField` is a `<fieldset>` with its own `<legend>` and its own hint on
                the control that takes the next value. Wrapping it would name it twice. */}
            <ChipListField
              legend="Traits"
              label="New trait"
              hint={PERSONA_TRAITS_RULE}
              maxLength={CHIP_LABEL_MAX_LENGTH}
              addLabel="Add trait"
              placeholder="mildly anxious"
              empty="No trait yet."
              values={content.persona.traits}
              takenPlace="a trait of this persona"
              onChange={(traits) => edit({ ...content, persona: { ...content.persona, traits } })}
            />
          </Card>

          <Card
            title="Background"
            description={
              <>
                Authored history that predates the sandbox. Orders and tickets belong to a shop and
                arrive with the order and ticket editors.
              </>
            }
          >
            {content.background.length === 0 ? (
              <p className="text-[13px] text-admin-muted">No background authored yet.</p>
            ) : (
              <ul className="grid gap-2 text-[13px]">
                {content.background.map((entry) =>
                  backgroundRemoval.isArmed(entry.id) ? (
                    <ConfirmRemove
                      key={entry.id}
                      as="li"
                      title={`Remove the ${entry.occurred_on} background entry?`}
                      consequence={consequenceOf(
                        "Its note leaves the profile's authored history, and the customer side of a simulation no longer has it to draw on.",
                        findingClauses([
                          content.background.length === 1 && "profile_without_background",
                        ]),
                        "Nothing is written until you save the draft; a published version keeps it.",
                      )}
                      onConfirm={backgroundRemoval.confirm(
                        () => removeBackground(entry.id),
                        `Removed the ${entry.occurred_on} background entry from the draft.`,
                      )}
                      onKeep={backgroundRemoval.keep}
                    />
                  ) : (
                    <EntryCard
                      key={entry.id}
                      title={`${entry.occurred_on} · ${labelOf(BACKGROUND_KIND, entry.kind)}`}
                      chips={<EntryId value={entry.id} />}
                      edit={entryEdit(
                        backgroundEditor,
                        backgroundNotice,
                        entry.id,
                        `${entry.occurred_on} · ${labelOf(BACKGROUND_KIND, entry.kind)}`,
                        () => ({
                          kind: entry.kind,
                          occurredOn: entry.occurred_on,
                          note: entry.note,
                        }),
                        (fields) => saveBackground(entry.id, fields),
                        (value, onChange) => (
                          <div className="flex flex-wrap items-end gap-2">
                            <BackgroundFieldset value={value} onChange={onChange} />
                          </div>
                        ),
                      )}
                      actions={
                        <button
                          className={destructiveSubtleButtonClasses}
                          type="button"
                          aria-label={`Remove the ${entry.occurred_on} background entry`}
                          ref={backgroundRemoval.trigger(entry.id)}
                          onClick={backgroundRemoval.ask(
                            entry.id,
                            () => removeBackground(entry.id),
                            `Removed the ${entry.occurred_on} background entry from the draft.`,
                          )}
                        >
                          <ButtonIcon verb="delete" />
                          Remove
                        </button>
                      }
                    >
                      <EntryText label="Note" value={entry.note} />
                    </EntryCard>
                  ),
                )}
              </ul>
            )}
            <EntryEditNotice id={backgroundNotice} label={backgroundEditor.open?.label ?? null} />
            <RemovalNotice removal={backgroundRemoval} />
            <BackgroundForm
              onAdd={(fields) =>
                edit({
                  ...content,
                  background: [
                    ...content.background,
                    backgroundEntry(
                      uniqueId(
                        slugify(fields.note.slice(0, 40)),
                        content.background.map((entry) => entry.id),
                      ),
                      fields,
                    ),
                  ],
                })
              }
            />
          </Card>

          <Card
            title="Hidden simulator facts"
            description={
              <>
                Known to the customer side of a simulation only. The support agent is never told
                them.
              </>
            }
          >
            {content.hidden_facts.length === 0 ? (
              <p className="text-[13px] text-admin-muted">No hidden fact authored yet.</p>
            ) : (
              <ul className="grid gap-2 text-[13px]">
                {content.hidden_facts.map((fact) =>
                  hiddenFactRemoval.isArmed(fact.id) ? (
                    <ConfirmRemove
                      key={fact.id}
                      as="li"
                      title={`Remove the hidden fact “${fact.note}”?`}
                      consequence="The customer side of a simulation no longer knows it, so nothing it would have revealed can come up. Nothing is written until you save the draft; a published version keeps it."
                      onConfirm={hiddenFactRemoval.confirm(
                        () => removeHiddenFact(fact.id),
                        `Removed the hidden fact “${fact.note}” from the draft.`,
                      )}
                      onKeep={hiddenFactRemoval.keep}
                    />
                  ) : (
                    <EntryCard
                      key={fact.id}
                      title={fact.note}
                      chips={<EntryId value={fact.id} />}
                      edit={entryEdit(
                        hiddenFactEditor,
                        hiddenFactNotice,
                        fact.id,
                        fact.note,
                        () => ({ note: fact.note, revealedWhen: fact.revealed_when }),
                        (fields) => saveHiddenFact(fact.id, fields),
                        (value, onChange) => (
                          <div className="flex flex-wrap items-end gap-2">
                            <HiddenFactFieldset value={value} onChange={onChange} />
                          </div>
                        ),
                      )}
                      actions={
                        <button
                          className={destructiveSubtleButtonClasses}
                          type="button"
                          aria-label={`Remove ${fact.note}`}
                          ref={hiddenFactRemoval.trigger(fact.id)}
                          onClick={hiddenFactRemoval.ask(
                            fact.id,
                            () => removeHiddenFact(fact.id),
                            `Removed the hidden fact “${fact.note}” from the draft.`,
                          )}
                        >
                          <ButtonIcon verb="delete" />
                          Remove
                        </button>
                      }
                    >
                      {fact.revealed_when ? (
                        <EntryText label="Revealed when" value={fact.revealed_when} />
                      ) : null}
                    </EntryCard>
                  ),
                )}
              </ul>
            )}
            <EntryEditNotice id={hiddenFactNotice} label={hiddenFactEditor.open?.label ?? null} />
            <RemovalNotice removal={hiddenFactRemoval} />
            <HiddenFactForm
              onAdd={(fields) =>
                edit({
                  ...content,
                  hidden_facts: [
                    ...content.hidden_facts,
                    hiddenFactEntry(
                      uniqueId(
                        slugify(fields.note.slice(0, 40)),
                        content.hidden_facts.map((fact) => fact.id),
                      ),
                      fields,
                    ),
                  ],
                })
              }
            />
          </Card>
        </div>

        <div className={editorPanelClasses}>
          <GateCard title="Publish gate" busy={editor.checking} dirty={editor.dirty}>
            <IssueList issues={preview?.issues ?? []} />
          </GateCard>

          <Card
            title="Attached shops"
            description={
              <>
                Identity, persona, and the address book travel with the profile; each shop's history
                stays its own.
              </>
            }
          >
            {attachError ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {attachError}
              </p>
            ) : null}
            <ul className="grid gap-2 text-[13px]">
              {shops
                .filter((shop) => attachedShops.includes(shop.shop_id))
                .map((shop) =>
                  shopRemoval.isArmed(shop.shop_id) ? (
                    <ConfirmRemove
                      key={shop.shop_id}
                      as="li"
                      title={`Detach ${content.display_name} from ${shop.name}?`}
                      consequence={
                        <>
                          The profile itself is kept, with its address book and its other shops.{" "}
                          {REMOVAL_FINDINGS.customer_not_attached_to_shop}
                          {shop.shop_id === shopId
                            ? " This page is this shop's view of the profile, so it returns to Customers."
                            : ""}
                        </>
                      }
                      confirmLabel="Detach"
                      destroys={false}
                      onConfirm={shopRemoval.confirm(
                        () => toggleShop(shop.shop_id, false),
                        endSentence(`Detached ${content.display_name} from ${shop.name}`),
                      )}
                      onKeep={shopRemoval.keep}
                    />
                  ) : (
                    <li key={shop.shop_id} className="flex items-center gap-2">
                      <span className="font-semibold">{shop.name}</span>
                      {shop.shop_id === shopId ? (
                        <span className="text-admin-muted">this shop</span>
                      ) : null}
                      <button
                        className={`${subtleButtonClasses} ml-auto`}
                        type="button"
                        aria-label={`Detach from ${shop.name}`}
                        disabled={pending.includes(shop.shop_id)}
                        ref={shopRemoval.trigger(shop.shop_id)}
                        onClick={shopRemoval.ask(
                          shop.shop_id,
                          () => toggleShop(shop.shop_id, false),
                          endSentence(`Detached ${content.display_name} from ${shop.name}`),
                        )}
                      >
                        Detach
                      </button>
                    </li>
                  ),
                )}
            </ul>
            <RemovalNotice removal={shopRemoval} />
            {otherShops
              .filter((shop) => !attachedShops.includes(shop.shop_id))
              .map((shop) => (
                <button
                  key={shop.shop_id}
                  className={subtleButtonClasses}
                  type="button"
                  onClick={() => void toggleShop(shop.shop_id, true)}
                >
                  <ButtonIcon verb="create" />
                  Attach to {shop.name}
                </button>
              ))}
          </Card>

          <Card title="What publishing freezes">
            <p className="text-[13px] text-admin-ink-soft">
              {preview?.latest_published_version === null
                ? "This profile has never been published. Tickets can only reference a published version."
                : `Published up to v${preview?.latest_published_version}. Publishing draft v${preview?.next_version} does not change any ticket, scenario, or snapshot that pinned an earlier version.`}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/** `fr-FR` implies France; a bare `fr` implies nothing, so the author states it. */
function countryForLocale(locale: string): string {
  const [, region] = locale.split("-");
  return region ?? "";
}

/**
 * The questions an address answers, as the add form below the book and an open row both hold
 * them. The two optional lines are held as text and stored as nothing when left empty.
 */
interface AddressFields {
  label: string;
  recipient: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  region: string;
  country: string;
}

function addressFields(entry: AddressSchema): AddressFields {
  return {
    label: entry.label,
    recipient: entry.recipient,
    line1: entry.line1,
    line2: entry.line2 ?? "",
    postalCode: entry.postal_code,
    city: entry.city,
    region: entry.region ?? "",
    country: entry.country,
  };
}

/**
 * The one function that turns an address's fields into the entry the book stores, called by the
 * add form and an open row's Save alike, so the two paths cannot write different payloads.
 *
 * Every text is stored trimmed — `AddressEntry` refuses padding (`require_label` in
 * `domain/content.py`) — and an optional line left empty is stored as none rather than as an
 * empty string the lab would refuse.
 */
function addressEntry(id: string, fields: AddressFields, isDefault: boolean): AddressSchema {
  const optional = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    id,
    label: fields.label.trim(),
    recipient: fields.recipient.trim(),
    line1: fields.line1.trim(),
    line2: optional(fields.line2),
    postal_code: fields.postalCode.trim(),
    city: fields.city.trim(),
    region: optional(fields.region),
    country: fields.country,
    is_default: isDefault,
  };
}

/** The fields an address cannot be stored without: `AddressEntry` refuses each empty or padded. */
function requiredAddressFields(fields: AddressFields): string[] {
  return [fields.label, fields.recipient, fields.line1, fields.postalCode, fields.city];
}

/**
 * Why the lab would refuse these fields when no field says so, or null — one answer for both
 * paths. A field left empty is not here: each is `required`, and the browser says that on the
 * field (ADR 0063, *Deliberately not here*). What `required` lets through is a field of nothing
 * but spaces, which `require_label` then refuses.
 */
function addressRefusal(fields: AddressFields): string | null {
  const padded = requiredAddressFields(fields).some((value) => value !== "" && value.trim() === "");
  return padded ? ADDRESS_FIELDS_RULE : null;
}

/** An entry read back on one line, as the order editor reads its frozen copy. */
function addressLine(entry: AddressSchema): string {
  return [
    entry.recipient,
    entry.line1,
    entry.line2,
    `${entry.postal_code} ${entry.city}`,
    entry.region,
    // Named, as the Country field reads its code back: `FR` and `FI` are one keystroke apart.
    countryName(entry.country) ?? entry.country,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * An address's questions, in the same words on the add form and in an open row. The add form
 * asks what a new entry cannot do without — the recipient is the customer until the entry is
 * corrected — and the open row asks every field the entry stores.
 */
function AddressFieldset({
  asks,
  value,
  onChange,
}: {
  asks: "new" | "every";
  value: AddressFields;
  onChange: (next: AddressFields) => void;
}) {
  const every = asks === "every";
  function text(label: string, key: keyof AddressFields, options: { optional?: boolean } = {}) {
    return (
      <label className={fieldLabelClasses}>
        {options.optional ? `${label} (optional)` : label}
        <input
          className={`${fieldControlClasses} w-full`}
          value={value[key]}
          required={!options.optional}
          placeholder={key === "label" ? "Home, Office, Parent's house…" : undefined}
          onChange={(event) => onChange({ ...value, [key]: event.target.value })}
        />
      </label>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {text("Label", "label")}
      {every ? text("Recipient", "recipient") : null}
      {text("Street", "line1")}
      {every ? text("Street line 2", "line2", { optional: true }) : null}
      {text("Postal code", "postalCode")}
      {text("City", "city")}
      {every ? text("Region", "region", { optional: true }) : null}
      <CountryField
        value={value.country}
        required
        onChange={(country) => onChange({ ...value, country })}
      />
    </div>
  );
}

function AddressForm({
  defaultCountry,
  recipient,
  onAdd,
}: {
  defaultCountry: string;
  /** Who a new entry ships to: the customer, until the entry is opened and corrected. */
  recipient: string;
  onAdd: (fields: AddressFields) => void;
}) {
  const refusalId = useId();
  const [typed, setTyped] = useState({ label: "", line1: "", postalCode: "", city: "" });
  // Null until the author types one, so the locale-derived default keeps following an
  // edit to the profile's locale instead of freezing at the first render's value.
  const [typedCountry, setTypedCountry] = useState<string | null>(null);
  const fields: AddressFields = {
    ...typed,
    recipient,
    line2: "",
    region: "",
    country: typedCountry ?? defaultCountry,
  };
  const refusal = addressRefusal(fields);

  return (
    <form
      className={addFormClasses}
      onSubmit={(event) => {
        event.preventDefault();
        // The button refuses the press and the browser holds an empty `required` field; a
        // submission that reaches the form another way is refused here too.
        // Only the four fields this form asks: the recipient is the customer's name, not a
        // field here, and an empty one is `addressRefusal`'s and the gate's to say.
        if (refusal !== null || Object.values(typed).includes("")) {
          return;
        }
        onAdd(fields);
        setTyped({ label: "", line1: "", postalCode: "", city: "" });
      }}
    >
      {/* Grouped so its fields never collide with an open row above, which asks the same
          questions in the same words. */}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-xs font-semibold text-admin-muted uppercase">
          Add an address
        </legend>
        <AddressFieldset
          asks="new"
          value={fields}
          onChange={(next) => {
            setTyped({
              label: next.label,
              line1: next.line1,
              postalCode: next.postalCode,
              city: next.city,
            });
            if (next.country !== fields.country) {
              setTypedCountry(next.country);
            }
          }}
        />
        <PrimaryAction
          variant="ink"
          className="justify-self-start"
          type="submit"
          refusal={refusal === null ? null : { id: refusalId, reason: refusal }}
        >
          <ButtonIcon verb="create" />
          Add address
        </PrimaryAction>
        {refusal === null ? null : <RefusalLine id={refusalId}>{refusal}</RefusalLine>}
      </fieldset>
    </form>
  );
}

function BackgroundForm({ onAdd }: { onAdd: (fields: BackgroundFields) => void }) {
  // Today, not a date in someone else's year. A background entry is authored history and its
  // day is a real choice, but the nearest plausible one is the day the author is standing in
  // — a fixed `2026-01-01` was a value nobody picked that every entry carried until noticed.
  const [fields, setFields] = useState<BackgroundFields>(() => ({
    kind: "purchase",
    occurredOn: todayInput(),
    note: "",
  }));

  return (
    <form
      className={addFormClasses}
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(fields);
        setFields({ ...fields, note: "" });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <BackgroundFieldset value={fields} onChange={setFields} />
        <PrimaryAction variant="ink" type="submit">
          <ButtonIcon verb="create" />
          Add entry
        </PrimaryAction>
      </div>
    </form>
  );
}

function HiddenFactForm({ onAdd }: { onAdd: (fields: HiddenFactFields) => void }) {
  const [fields, setFields] = useState<HiddenFactFields>({ note: "", revealedWhen: "" });

  return (
    <form
      className={addFormClasses}
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(fields);
        setFields({ note: "", revealedWhen: "" });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <HiddenFactFieldset value={fields} onChange={setFields} />
        <PrimaryAction variant="ink" type="submit">
          <ButtonIcon verb="create" />
          Add fact
        </PrimaryAction>
      </div>
    </form>
  );
}

/** A sentence's full stop, unless the name it ends on already carries one ("Supply Co."). */
function endSentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}
