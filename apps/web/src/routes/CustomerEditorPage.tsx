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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { Field, FieldGroup, FieldHint, FieldRows } from "../components/FieldHint";
import { EditButton, ItemFormRow, ListItem, RemoveButton } from "../components/ItemList";
import { LocaleField } from "../components/LocaleField";
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
import { countryName } from "../lib/countries";
import {
  ADDRESS_FORM_FIELDS,
  type AddressField,
  type AddressFields,
  addressEntry,
  addressFields,
  addressRefusal,
  type BackgroundFields,
  BLANK_ADDRESS,
  backgroundEntry,
  backgroundFields,
  backgroundName,
  backgroundRefusal,
  type HiddenFactFields,
  hiddenFactEntry,
  hiddenFactFields,
  hiddenFactRefusal,
  resolvedAddress,
} from "../lib/customerEntries";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
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
  LABEL_MAX_LENGTH,
  LOYALTY_TIER_RULE,
  PERSONA_SUMMARY_RULE,
  PERSONA_TRAITS_RULE,
  TEXT_MAX_LENGTH,
} from "../lib/fieldRules";
import {
  formTitle,
  type ItemFormWords,
  refusedProps,
  useEditButtons,
  useFocusAfterCommit,
  useItemForm,
} from "../lib/itemForm";
import { todayInput } from "../lib/orders";
import { pythonStrip } from "../lib/pythonText";
import {
  consequenceOf,
  findingClauses,
  REMOVAL_FINDINGS,
  removedState,
  useRemoval,
} from "../lib/removal";
import {
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
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
  const navigate = useNavigate();
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

  function editAccount(next: Partial<CustomerProfileContentSchema["account"]>) {
    if (!content) {
      return;
    }
    edit({ ...content, account: { ...content.account, ...next } });
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
        // The line says what no row below does: the draft's fingerprint. "Synthetic profile" said
        // the kind again, and the customer-since date is the Customer since row's own value.
        back={{
          to: "..",
          label: "Customers",
          kind: "profile",
          detail: preview ? (
            <>
              draft fingerprint <Fingerprint value={preview.content_fingerprint} />
            </>
          ) : null,
        }}
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
              onRefusedPress={editor.publishTouch.touch}
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
              touched={editor.publishTouch.touched}
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
                  maxLength={LABEL_MAX_LENGTH}
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
                  maxLength={LABEL_MAX_LENGTH}
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
                  maxLength={LABEL_MAX_LENGTH}
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
              {/* A lone checkbox is a row of its own, its label on the left, as the lab
                  settings' preferences are; "Opted in to marketing" is the name the label gives
                  it. It keeps the place it had, between the account's selects and its notes. */}
              <Field label="Opted in to marketing">
                <input
                  type="checkbox"
                  checked={content.account.marketing_opt_in}
                  onChange={(event) => editAccount({ marketing_opt_in: event.target.checked })}
                />
              </Field>
              <Field label="Account notes" hint={ACCOUNT_NOTES_RULE}>
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
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
            <FieldRows>
              <AddressBook profileId={profileId} content={content} edit={edit} />
            </FieldRows>
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
                  maxLength={TEXT_MAX_LENGTH}
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
              placement="card"
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
            <FieldRows>
              <BackgroundList profileId={profileId} content={content} edit={edit} />
            </FieldRows>
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
            <FieldRows>
              <HiddenFacts profileId={profileId} content={content} edit={edit} />
            </FieldRows>
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
              {/* Nothing while the gate has not answered: no version is known to name. */}
              {preview === null
                ? null
                : preview.latest_published_version === null
                  ? `Publishing freezes the whole profile as its first version: ${PROFILE_FROZEN}. Tickets can only reference a published version.`
                  : `Publishing freezes the whole profile as v${preview.next_version}: ${PROFILE_FROZEN}. It is published up to v${preview.latest_published_version}, and a ticket, scenario, or snapshot that pinned an earlier version does not change.`}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * What a profile version holds, by the names of the cards that author it: everything on the
 * page but the attached shops, which are the lab's record of where the profile is used rather
 * than part of it.
 */
const PROFILE_FROZEN =
  "identity, account, address book, behavioral persona, background and hidden simulator facts";

/** `fr-FR` implies France; a bare `fr` implies nothing, so the author states it. */
function countryForLocale(locale: string): string {
  const [, region] = locale.split("-");
  return region ?? "";
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

const ADDRESS_WORDS: ItemFormWords = { form: "Address book", entry: "an address", record: "draft" };
const BACKGROUND_WORDS: ItemFormWords = {
  form: "Background",
  entry: "a background entry",
  record: "draft",
};
const HIDDEN_FACT_WORDS: ItemFormWords = {
  form: "Hidden simulator facts",
  entry: "a hidden fact",
  record: "draft",
};

/** The labels the address form asks by, in the words the book asked them in before. */
const ADDRESS_LABELS: Record<AddressField, string> = {
  label: "Label",
  recipient: "Recipient",
  line1: "Street",
  line2: "Street line 2",
  postalCode: "Postal code",
  city: "City",
  region: "Region",
  country: "Country",
};

/**
 * The address book, as items, and the one form that adds an entry or edits the one chosen
 * (ADR 0074). Which entry is the default is the list's answer — the pill beside the name and
 * *Make default* on the item, as `Workspace.dc.html` :2888–2891 draws them — never the form's:
 * correcting a street must not move it, and the first entry added becomes it, because a
 * published profile must hold one. While adding, the form asks what a new entry cannot do
 * without: it ships to the customer, and its country follows the profile's locale until the
 * author types one.
 */
function AddressBook({
  profileId,
  content,
  edit,
}: {
  profileId: string;
  content: CustomerProfileContentSchema;
  edit: (next: CustomerProfileContentSchema) => void;
}) {
  const addresses = content.addresses;
  const ids = addresses.map((entry) => entry.id);
  const entryOf = (id: string) => addresses.find((entry) => entry.id === id) as AddressSchema;
  const nameOf = (id: string) => addresses.find((entry) => entry.id === id)?.label ?? id;
  const form = useItemForm<AddressFields>({
    blank: BLANK_ADDRESS,
    ids,
    words: ADDRESS_WORDS,
    nameOf,
    formOf: (id) => addressFields(entryOf(id)),
    typedOf: (fields) => fields.label,
  });
  const removal = useRemoval(profileId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const firstField = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const defaultPillId = useId();
  const mode = form.editing === null ? "adding" : "editing";
  const resolved = resolvedAddress(form.fields, {
    recipient: form.editing === null ? content.display_name : undefined,
    country: countryForLocale(content.identity.locale),
  });
  const refusal = addressRefusal(resolved, mode);
  // A field is marked by the refusal only once the form is touched (ADR 0078).
  const touched = form.touch.touched;

  // *Make default* is not drawn on the default, so the press removes the button that had
  // focus. Focus goes to the new default's pencil, the control that stays on the item it
  // pressed, which the pill describes — so a reader hears the entry is now the default.
  function makeDefault(id: string) {
    edit({
      ...content,
      addresses: addresses.map((entry) => ({ ...entry, is_default: entry.id === id })),
    });
    focusAfterCommit(() => editButtons.get(id));
  }

  function drop(id: string) {
    edit({ ...content, addresses: addresses.filter((entry) => entry.id !== id) });
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
          addresses: addresses.map((entry) =>
            entry.id === editing ? addressEntry(entry.id, resolved, entry.is_default) : entry,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      const id = uniqueId(slugify(pythonStrip(resolved.label)), ids);
      edit({
        ...content,
        addresses: [...addresses, addressEntry(id, resolved, addresses.length === 0)],
      });
    }
    form.reset();
  }

  function text(field: Exclude<AddressField, "country">) {
    const optional = field === "line2" || field === "region";
    return (
      <FieldHint key={field} label={ADDRESS_LABELS[field]} optional={optional}>
        <input
          maxLength={LABEL_MAX_LENGTH}
          ref={field === "label" ? firstField : undefined}
          className={`${fieldControlClasses} w-full`}
          value={form.fields[field]}
          placeholder={field === "label" ? "Home, Office, Parent's house…" : undefined}
          {...refusedProps(refusal, field, reasonId, touched)}
          onChange={(event) => form.update({ [field]: event.target.value })}
        />
      </FieldHint>
    );
  }

  return (
    <>
      <FieldGroup label="Entries" hint={ADDRESS_ENTRIES_HINT}>
        <div className="grid gap-2">
          {addresses.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {addresses.map((entry) => {
                const notice = `Removed the address “${entry.label}” from the draft.`;
                if (removal.isArmed(entry.id)) {
                  return (
                    <ConfirmRemove
                      key={entry.id}
                      as="li"
                      title={`Remove the address “${entry.label}”?`}
                      consequence={consequenceOf(
                        findingClauses([
                          addresses.length === 1
                            ? "profile_without_address"
                            : entry.is_default && "address_book_without_default",
                          "shipping_address_source_removed",
                        ]),
                        "Published scenarios and snapshots are never rewritten. Nothing is written until you save the draft.",
                      )}
                      onConfirm={removal.confirm(() => drop(entry.id), notice)}
                      onKeep={removal.keep}
                    />
                  );
                }
                return (
                  <ListItem
                    key={entry.id}
                    name={entry.label}
                    id={entry.id}
                    detail={addressLine(entry)}
                    tag={
                      entry.is_default ? <DefaultPill id={`${defaultPillId}-${entry.id}`} /> : null
                    }
                    editing={form.editing === entry.id}
                  >
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
                    <EditButton
                      name={entry.label}
                      buttonRef={editButtons.ref(entry.id)}
                      describedBy={entry.is_default ? `${defaultPillId}-${entry.id}` : undefined}
                      onEdit={() => {
                        form.begin(entry.id, addressFields(entry));
                        focusAfterCommit(() => firstField.current);
                      }}
                    />
                    <RemoveButton
                      name={entry.label}
                      entryKey={entry.id}
                      removal={removal}
                      notice={notice}
                      onRemove={() => drop(entry.id)}
                    />
                  </ListItem>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-admin-muted">
              No address yet. A published profile must hold at least one.
            </p>
          )}
          <RemovalNotice removal={removal} />
        </div>
      </FieldGroup>
      <ItemFormRow
        title={formTitle(form.editing, nameOf, ADDRESS_WORDS.entry)}
        hint={
          form.editing === null
            ? `A new entry ships to the customer${pythonStrip(content.display_name) === "" ? "" : `, ${content.display_name}`}; edit it to name another recipient.`
            : undefined
        }
        editing={form.editing !== null}
        addLabel="Add address"
        refusal={refusal}
        reasonId={reasonId}
        touch={form.touch}
        onSubmit={submit}
        onCancel={() => {
          const editing = form.editing;
          form.reset();
          if (editing !== null) {
            focusAfterCommit(() => editButtons.get(editing));
          }
        }}
      >
        {ADDRESS_FORM_FIELDS[mode].map((field) =>
          field === "country" ? (
            <CountryField
              key={field}
              value={resolved.country}
              refused={refusedProps(refusal, "country", reasonId, touched)}
              onChange={(country) => form.update({ country })}
            />
          ) : (
            text(field)
          ),
        )}
      </ItemFormRow>
    </>
  );
}

/**
 * The prototype's rule for *Entries* (`Workspace.dc.html` :2880), as the lab holds it: the gate
 * refuses a book without a default at publication, and the first entry added becomes it.
 */
const ADDRESS_ENTRIES_HINT =
  "Exactly one is the default before the profile can publish; the first entry added becomes it.";

function DefaultPill({ id }: { id: string }) {
  return (
    <span
      id={id}
      className="inline-flex items-center gap-1.5 self-center rounded-full bg-admin-published px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-published-ink"
    >
      <span aria-hidden>●</span> Default
    </span>
  );
}

/**
 * The profile's background, as items, and the one form that adds an entry or edits the one
 * chosen (ADR 0074). The form opens on a purchase today — the nearest plausible day is the one
 * the author is standing in, where a fixed date was a value nobody picked — with the note left
 * to the author.
 */
function BackgroundList({
  profileId,
  content,
  edit,
}: {
  profileId: string;
  content: CustomerProfileContentSchema;
  edit: (next: CustomerProfileContentSchema) => void;
}) {
  const background = content.background;
  const ids = background.map((entry) => entry.id);
  const entryOf = (id: string) =>
    background.find((entry) => entry.id === id) as BackgroundEntrySchema;
  const nameOf = (id: string) => {
    const entry = background.find((candidate) => candidate.id === id);
    return entry === undefined ? id : backgroundName(entry, labelOf(BACKGROUND_KIND, entry.kind));
  };
  const today = todayInput();
  const blank = useMemo<BackgroundFields>(
    () => ({ kind: "purchase", occurredOn: today, note: "" }),
    [today],
  );
  const form = useItemForm<BackgroundFields>({
    blank,
    ids,
    words: BACKGROUND_WORDS,
    nameOf,
    formOf: (id) => backgroundFields(entryOf(id)),
    typedOf: (fields) => fields.note,
  });
  const removal = useRemoval(profileId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const kindSelect = useRef<HTMLSelectElement>(null);
  const reasonId = useId();
  const refusal = backgroundRefusal(form.fields);
  // A field is marked by the refusal only once the form is touched (ADR 0078).
  const touched = form.touch.touched;

  function drop(id: string) {
    edit({ ...content, background: background.filter((entry) => entry.id !== id) });
  }

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      if (form.dirty) {
        edit({
          ...content,
          background: background.map((entry) =>
            entry.id === editing ? backgroundEntry(entry.id, form.fields) : entry,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      const id = uniqueId(slugify(pythonStrip(form.fields.note).slice(0, 40)), ids);
      edit({ ...content, background: [...background, backgroundEntry(id, form.fields)] });
    }
    form.reset();
  }

  return (
    <>
      <FieldGroup label="History">
        <div className="grid gap-2">
          {background.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {background.map((entry) => {
                const notice = `Removed the ${entry.occurred_on} background entry from the draft.`;
                if (removal.isArmed(entry.id)) {
                  return (
                    <ConfirmRemove
                      key={entry.id}
                      as="li"
                      title={`Remove the ${entry.occurred_on} background entry?`}
                      consequence={consequenceOf(
                        "Its note leaves the profile's authored history, and the customer side of a simulation no longer has it to draw on.",
                        findingClauses([background.length === 1 && "profile_without_background"]),
                        "Nothing is written until you save the draft; a published version keeps it.",
                      )}
                      onConfirm={removal.confirm(() => drop(entry.id), notice)}
                      onKeep={removal.keep}
                    />
                  );
                }
                const name = nameOf(entry.id);
                return (
                  <ListItem
                    key={entry.id}
                    name={name}
                    id={entry.id}
                    detail={entry.note}
                    editing={form.editing === entry.id}
                  >
                    <EditButton
                      name={name}
                      buttonRef={editButtons.ref(entry.id)}
                      onEdit={() => {
                        form.begin(entry.id, backgroundFields(entry));
                        focusAfterCommit(() => kindSelect.current);
                      }}
                    />
                    <RemoveButton
                      name={name}
                      label={`Remove the ${entry.occurred_on} background entry`}
                      entryKey={entry.id}
                      removal={removal}
                      notice={notice}
                      onRemove={() => drop(entry.id)}
                    />
                  </ListItem>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-admin-muted">No background authored yet.</p>
          )}
          <RemovalNotice removal={removal} />
        </div>
      </FieldGroup>
      <ItemFormRow
        title={formTitle(form.editing, nameOf, BACKGROUND_WORDS.entry)}
        editing={form.editing !== null}
        addLabel="Add entry"
        refusal={refusal}
        reasonId={reasonId}
        touch={form.touch}
        onSubmit={submit}
        onCancel={() => {
          const editing = form.editing;
          form.reset();
          if (editing !== null) {
            focusAfterCommit(() => editButtons.get(editing));
          }
        }}
      >
        <FieldHint label="Kind">
          <select
            ref={kindSelect}
            className={`${fieldControlClasses} w-full`}
            value={form.fields.kind}
            onChange={(event) => form.update({ kind: event.target.value as BackgroundKind })}
          >
            {BACKGROUND_KINDS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </FieldHint>
        <FieldHint label="Date">
          <input
            className={`${fieldControlClasses} w-full`}
            type="date"
            value={form.fields.occurredOn}
            {...refusedProps(refusal, "occurredOn", reasonId, touched)}
            onChange={(event) => form.update({ occurredOn: event.target.value })}
          />
        </FieldHint>
        <div className="col-span-full">
          <FieldHint label="Note">
            <input
              maxLength={TEXT_MAX_LENGTH}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.note}
              {...refusedProps(refusal, "note", reasonId, touched)}
              onChange={(event) => form.update({ note: event.target.value })}
            />
          </FieldHint>
        </div>
      </ItemFormRow>
    </>
  );
}

const BLANK_HIDDEN_FACT: HiddenFactFields = { note: "", revealedWhen: "" };

/**
 * The profile's hidden simulator facts, as items, and the one form that adds a fact or edits
 * the one chosen (ADR 0074).
 */
function HiddenFacts({
  profileId,
  content,
  edit,
}: {
  profileId: string;
  content: CustomerProfileContentSchema;
  edit: (next: CustomerProfileContentSchema) => void;
}) {
  const facts = content.hidden_facts;
  const ids = facts.map((fact) => fact.id);
  const factOf = (id: string) => facts.find((fact) => fact.id === id) as HiddenFactSchema;
  const nameOf = (id: string) => facts.find((fact) => fact.id === id)?.note ?? id;
  const form = useItemForm<HiddenFactFields>({
    blank: BLANK_HIDDEN_FACT,
    ids,
    words: HIDDEN_FACT_WORDS,
    nameOf,
    formOf: (id) => hiddenFactFields(factOf(id)),
    typedOf: (fields) => fields.note,
  });
  const removal = useRemoval(profileId);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const factInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = hiddenFactRefusal(form.fields);
  // A field is marked by the refusal only once the form is touched (ADR 0078).
  const touched = form.touch.touched;

  function drop(id: string) {
    edit({ ...content, hidden_facts: facts.filter((fact) => fact.id !== id) });
  }

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      if (form.dirty) {
        edit({
          ...content,
          hidden_facts: facts.map((fact) =>
            fact.id === editing ? hiddenFactEntry(fact.id, form.fields) : fact,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      const id = uniqueId(slugify(pythonStrip(form.fields.note).slice(0, 40)), ids);
      edit({ ...content, hidden_facts: [...facts, hiddenFactEntry(id, form.fields)] });
    }
    form.reset();
  }

  return (
    <>
      <FieldGroup label="Facts">
        <div className="grid gap-2">
          {facts.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {facts.map((fact) => {
                const notice = `Removed the hidden fact “${fact.note}” from the draft.`;
                if (removal.isArmed(fact.id)) {
                  return (
                    <ConfirmRemove
                      key={fact.id}
                      as="li"
                      title={`Remove the hidden fact “${fact.note}”?`}
                      consequence="The customer side of a simulation no longer knows it, so nothing it would have revealed can come up. Nothing is written until you save the draft; a published version keeps it."
                      onConfirm={removal.confirm(() => drop(fact.id), notice)}
                      onKeep={removal.keep}
                    />
                  );
                }
                return (
                  <ListItem
                    key={fact.id}
                    name={fact.note}
                    id={fact.id}
                    detail={fact.revealed_when ? `Revealed when ${fact.revealed_when}` : null}
                    editing={form.editing === fact.id}
                  >
                    <EditButton
                      name={fact.note}
                      buttonRef={editButtons.ref(fact.id)}
                      onEdit={() => {
                        form.begin(fact.id, hiddenFactFields(fact));
                        focusAfterCommit(() => factInput.current);
                      }}
                    />
                    <RemoveButton
                      name={fact.note}
                      entryKey={fact.id}
                      removal={removal}
                      notice={notice}
                      onRemove={() => drop(fact.id)}
                    />
                  </ListItem>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-admin-muted">No hidden fact authored yet.</p>
          )}
          <RemovalNotice removal={removal} />
        </div>
      </FieldGroup>
      <ItemFormRow
        title={formTitle(form.editing, nameOf, HIDDEN_FACT_WORDS.entry)}
        editing={form.editing !== null}
        addLabel="Add fact"
        refusal={refusal}
        reasonId={reasonId}
        touch={form.touch}
        onSubmit={submit}
        onCancel={() => {
          const editing = form.editing;
          form.reset();
          if (editing !== null) {
            focusAfterCommit(() => editButtons.get(editing));
          }
        }}
      >
        <FieldHint label="Hidden fact">
          <input
            maxLength={TEXT_MAX_LENGTH}
            ref={factInput}
            className={`${fieldControlClasses} w-full`}
            value={form.fields.note}
            {...refusedProps(refusal, "note", reasonId, touched)}
            onChange={(event) => form.update({ note: event.target.value })}
          />
        </FieldHint>
        <FieldHint label="Revealed when" optional>
          <input
            maxLength={TEXT_MAX_LENGTH}
            className={`${fieldControlClasses} w-full`}
            value={form.fields.revealedWhen}
            onChange={(event) => form.update({ revealedWhen: event.target.value })}
          />
        </FieldHint>
      </ItemFormRow>
    </>
  );
}

/** A sentence's full stop, unless the name it ends on already carries one ("Supply Co."). */
function endSentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}
