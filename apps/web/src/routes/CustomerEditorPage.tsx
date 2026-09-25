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
import { Link, useNavigate, useParams } from "react-router-dom";
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
import {
  Card,
  EditorSaveActions,
  EntryCard,
  EntryEditNotice,
  EntryId,
  EntryText,
  Fingerprint,
  IssueList,
  PageHeader,
  PublishReasons,
  VersionChips,
} from "../components/WorkspaceChrome";
import { canPublish, type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { entryEdit, useEntryEdit } from "../lib/entryEdit";
import { slugify, uniqueId } from "../lib/entryIds";
import { BACKGROUND_KIND, labelOf, optionsOf } from "../lib/enumLabels";
import {
  ACCOUNT_NOTES_RULE,
  ACCOUNT_STATUS_RULE,
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
  accentButtonClasses,
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  inkButtonClasses,
  subtleButtonClasses,
  surfaceClasses,
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
          className={fieldControlClasses}
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
          className={fieldControlClasses}
          type="date"
          value={value.occurredOn}
          onChange={(event) => onChange({ ...value, occurredOn: event.target.value })}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Note
        <input
          className={fieldControlClasses}
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
          className={fieldControlClasses}
          value={value.note}
          required
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-48 flex-1`}>
        Revealed when
        <input
          className={fieldControlClasses}
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

  function addAddress(draft: NewAddress) {
    if (!content) {
      return;
    }
    const entry: AddressSchema = {
      id: uniqueId(
        slugify(draft.label),
        content.addresses.map((existing) => existing.id),
      ),
      label: draft.label,
      // The recipient is the customer unless the author says otherwise; every other field
      // is authored, never invented, so a new entry is never a plausible-looking fiction.
      recipient: content.display_name,
      line1: draft.line1,
      line2: null,
      postal_code: draft.postalCode,
      city: draft.city,
      region: null,
      country: draft.country,
      is_default: content.addresses.length === 0,
    };
    edit({ ...content, addresses: [...content.addresses, entry] });
  }

  function updateAddress(id: string, next: Partial<AddressSchema>) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      addresses: content.addresses.map((entry) =>
        entry.id === id ? { ...entry, ...next } : entry,
      ),
    });
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
        description={
          <>
            <Link className="font-semibold text-lab-ink" to=".." relative="path">
              Customers
            </Link>{" "}
            · synthetic profile · customer since {content.account.customer_since}
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
            <button
              className={accentButtonClasses}
              type="button"
              onClick={() => {
                // A frozen version is printed by the index this editor was opened from, and
                // that index renders the shell's listing (ADR 0056).
                void editor.publish().then((version) => {
                  setPublishedVersion(version);
                  if (version !== null) {
                    void listings.customers.refresh();
                  }
                });
              }}
              disabled={editor.publishing || !canPublish(preview, editor.dirty)}
            >
              <ButtonIcon verb="publish" />
              {editor.publishing ? "Publishing…" : `Publish v${preview?.next_version ?? 1}`}
            </button>
          </>
        }
      />

      {editor.error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {editor.error}
        </p>
      ) : null}
      <div className="mb-4 grid gap-1">
        <PublishReasons preview={preview} dirty={editor.dirty} />
      </div>
      {publishedVersion !== null ? (
        <p role="status" className="mb-4 text-[13px] text-lab-success">
          Published version {publishedVersion}. It is immutable; editing continues on the draft.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-4">
          <Card title="Identity">
            <FieldRows>
              <Field label="Given name" hint={CUSTOMER_NAME_RULE}>
                <input
                  className={fieldControlClasses}
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
                  className={fieldControlClasses}
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
                  className={fieldControlClasses}
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
                  className={fieldControlClasses}
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
                  className={fieldControlClasses}
                  type="date"
                  value={content.account.customer_since}
                  onChange={(event) => editAccount({ customer_since: event.target.value })}
                />
              </Field>
              <Field label="Status" hint={ACCOUNT_STATUS_RULE}>
                <select
                  className={fieldControlClasses}
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
                  className={fieldControlClasses}
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
                  className={textAreaClasses}
                  value={content.account.notes}
                  onChange={(event) => editAccount({ notes: event.target.value })}
                />
              </Field>
            </FieldRows>
          </Card>

          <Card
            title="Address book"
            footer={
              <p className="text-xs text-admin-muted">
                Orders select an entry and keep a frozen copy. Editing or removing an entry never
                rewrites existing orders, published scenarios, or snapshots.
              </p>
            }
          >
            {content.addresses.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                No address yet. A published profile must hold at least one, with one default.
              </p>
            ) : (
              <ul className="grid gap-3">
                {content.addresses.map((entry) =>
                  addressRemoval.isArmed(entry.id) ? (
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
                      onConfirm={addressRemoval.confirm(
                        () => removeAddress(entry.id),
                        `Removed the address “${entry.label}” from the draft.`,
                      )}
                      onKeep={addressRemoval.keep}
                    />
                  ) : (
                    <li key={entry.id} className={`${surfaceClasses} grid gap-2 p-3`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          aria-label={`Label for ${entry.id}`}
                          className={`${fieldControlClasses} max-w-56`}
                          value={entry.label}
                          onChange={(event) =>
                            updateAddress(entry.id, { label: event.target.value })
                          }
                        />
                        {entry.is_default ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-published px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-published-ink">
                            <span aria-hidden>●</span> Default
                          </span>
                        ) : (
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
                          className={`${destructiveSubtleButtonClasses} ml-auto`}
                          type="button"
                          aria-label={`Remove ${entry.label}`}
                          ref={addressRemoval.trigger(entry.id)}
                          onClick={addressRemoval.ask(
                            entry.id,
                            () => removeAddress(entry.id),
                            `Removed the address “${entry.label}” from the draft.`,
                          )}
                        >
                          <ButtonIcon verb="delete" />
                          Remove
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className={fieldLabelClasses}>
                          Recipient
                          <input
                            className={fieldControlClasses}
                            value={entry.recipient}
                            onChange={(event) =>
                              updateAddress(entry.id, { recipient: event.target.value })
                            }
                          />
                        </label>
                        <label className={fieldLabelClasses}>
                          Street
                          <input
                            className={fieldControlClasses}
                            value={entry.line1}
                            onChange={(event) =>
                              updateAddress(entry.id, { line1: event.target.value })
                            }
                          />
                        </label>
                        <label className={fieldLabelClasses}>
                          Postal code
                          <input
                            className={fieldControlClasses}
                            value={entry.postal_code}
                            onChange={(event) =>
                              updateAddress(entry.id, { postal_code: event.target.value })
                            }
                          />
                        </label>
                        <label className={fieldLabelClasses}>
                          Street line 2
                          <input
                            className={fieldControlClasses}
                            value={entry.line2 ?? ""}
                            onChange={(event) =>
                              updateAddress(entry.id, {
                                line2: event.target.value === "" ? null : event.target.value,
                              })
                            }
                          />
                        </label>
                        <label className={fieldLabelClasses}>
                          City
                          <input
                            className={fieldControlClasses}
                            value={entry.city}
                            onChange={(event) =>
                              updateAddress(entry.id, { city: event.target.value })
                            }
                          />
                        </label>
                        <label className={fieldLabelClasses}>
                          Region
                          <input
                            className={fieldControlClasses}
                            value={entry.region ?? ""}
                            onChange={(event) =>
                              updateAddress(entry.id, {
                                region: event.target.value === "" ? null : event.target.value,
                              })
                            }
                          />
                        </label>
                        <CountryField
                          value={entry.country}
                          onChange={(country) => updateAddress(entry.id, { country })}
                        />
                      </div>
                    </li>
                  ),
                )}
              </ul>
            )}
            <RemovalNotice removal={addressRemoval} />
            <AddressForm
              defaultCountry={countryForLocale(content.identity.locale)}
              onAdd={addAddress}
            />
          </Card>

          <Card
            title="Behavioral persona"
            footer={
              <p className="text-xs text-admin-muted">
                Guides you and the future customer simulator. It is never injected into the support
                agent's prompt.
              </p>
            }
          >
            <FieldRows>
              <Field label="Summary" hint={PERSONA_SUMMARY_RULE}>
                <textarea
                  className={textAreaClasses}
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
            footer={
              <p className="text-xs text-admin-muted">
                Authored history that predates the sandbox. Orders and tickets belong to a shop and
                arrive with the order and ticket editors.
              </p>
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
            footer={
              <p className="text-xs text-admin-muted">
                Known to the customer side of a simulation only. The support agent is never told
                them.
              </p>
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

        <div className="grid content-start gap-4">
          <Card title="Publish gate">
            <IssueList issues={preview?.issues ?? []} />
          </Card>

          <Card title="Attached shops">
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
            <p className="text-xs text-admin-muted">
              Identity, persona, and the address book travel with the profile; each shop's history
              stays its own.
            </p>
          </Card>

          <Card title="Freezing">
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

interface NewAddress {
  label: string;
  line1: string;
  postalCode: string;
  city: string;
  country: string;
}

/** `fr-FR` implies France; a bare `fr` implies nothing, so the author states it. */
function countryForLocale(locale: string): string {
  const [, region] = locale.split("-");
  return region ?? "";
}

function AddressForm({
  defaultCountry,
  onAdd,
}: {
  defaultCountry: string;
  onAdd: (draft: NewAddress) => void;
}) {
  const [label, setLabel] = useState("");
  const [line1, setLine1] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  // Null until the author types one, so the locale-derived default keeps following an
  // edit to the profile's locale instead of freezing at the first render's value.
  const [typedCountry, setTypedCountry] = useState<string | null>(null);
  const country = typedCountry ?? defaultCountry;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onAdd({ label, line1, postalCode, city, country });
        setLabel("");
        setLine1("");
        setPostalCode("");
        setCity("");
      }}
    >
      {/* Grouped so its fields never collide with the entries above, which use the same
          field names. */}
      <fieldset className="flex flex-wrap items-end gap-2">
        <legend className="mb-1 text-xs font-semibold text-admin-muted uppercase">
          Add an address
        </legend>
        <label className={fieldLabelClasses}>
          Label
          <input
            className={fieldControlClasses}
            value={label}
            required
            placeholder="Home, Office, Parent's house…"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className={`${fieldLabelClasses} min-w-48 flex-1`}>
          Street
          <input
            className={fieldControlClasses}
            value={line1}
            required
            onChange={(event) => setLine1(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Postal code
          <input
            className={fieldControlClasses}
            value={postalCode}
            required
            onChange={(event) => setPostalCode(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          City
          <input
            className={fieldControlClasses}
            value={city}
            required
            onChange={(event) => setCity(event.target.value)}
          />
        </label>
        <div className="min-w-44">
          <CountryField value={country} required onChange={setTypedCountry} />
        </div>
        <button className={inkButtonClasses} type="submit">
          <ButtonIcon verb="create" />
          Add address
        </button>
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
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(fields);
        setFields({ ...fields, note: "" });
      }}
    >
      <BackgroundFieldset value={fields} onChange={setFields} />
      <button className={inkButtonClasses} type="submit">
        <ButtonIcon verb="create" />
        Add entry
      </button>
    </form>
  );
}

function HiddenFactForm({ onAdd }: { onAdd: (fields: HiddenFactFields) => void }) {
  const [fields, setFields] = useState<HiddenFactFields>({ note: "", revealedWhen: "" });

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(fields);
        setFields({ note: "", revealedWhen: "" });
      }}
    >
      <HiddenFactFieldset value={fields} onChange={setFields} />
      <button className={inkButtonClasses} type="submit">
        <ButtonIcon verb="create" />
        Add fact
      </button>
    </form>
  );
}

/** A sentence's full stop, unless the name it ends on already carries one ("Supply Co."). */
function endSentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}
