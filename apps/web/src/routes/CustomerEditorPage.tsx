import type {
  AccountStatus,
  AddressSchema,
  BackgroundKind,
  CustomerProfileContentSchema,
  CustomerProfilePayloadSchema,
  CustomerProfilePreviewResponse,
  HiddenFactSchema,
  LoyaltyTier,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { LocaleField } from "../components/LocaleField";
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
import { slugify, uniqueId } from "../lib/entryIds";
import { BACKGROUND_KIND, labelOf, optionsOf } from "../lib/enumLabels";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  inkButtonClasses,
  outlineButtonClasses,
  subtleButtonClasses,
  surfaceClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

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

export function CustomerEditorPage() {
  const { profileId = "" } = useParams();
  const { shopId, shops } = useShopWorkspace();
  const editor = useDefinitionEditor(profileId, CLIENT);
  const { content, preview, edit } = editor;
  const [attachedShops, setAttachedShops] = useState<string[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [trait, setTrait] = useState("");

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

  function updateBackground(id: string, note: string) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      background: content.background.map((entry) => (entry.id === id ? { ...entry, note } : entry)),
    });
  }

  function removeBackground(id: string) {
    if (!content) {
      return;
    }
    edit({ ...content, background: content.background.filter((entry) => entry.id !== id) });
  }

  function updateHiddenFact(id: string, next: Partial<HiddenFactSchema>) {
    if (!content) {
      return;
    }
    edit({
      ...content,
      hidden_facts: content.hidden_facts.map((fact) =>
        fact.id === id ? { ...fact, ...next } : fact,
      ),
    });
  }

  function removeHiddenFact(id: string) {
    if (!content) {
      return;
    }
    edit({ ...content, hidden_facts: content.hidden_facts.filter((fact) => fact.id !== id) });
  }

  function addTrait(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content || content.persona.traits.includes(trait)) {
      return;
    }
    edit({
      ...content,
      persona: { ...content.persona, traits: [...content.persona.traits, trait] },
    });
    setTrait("");
  }

  async function toggleShop(targetShopId: string, attach: boolean) {
    setAttachError(null);
    try {
      const response = attach
        ? await attachCustomerProfileToShop(profileId, targetShopId)
        : await detachCustomerProfileFromShop(profileId, targetShopId);
      setAttachedShops(response.shop_ids);
    } catch (cause: unknown) {
      setAttachError(describeApiError(cause, "The attachment could not be changed."));
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldLabelClasses}>
                Given name
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
              </label>
              <label className={fieldLabelClasses}>
                Family name
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
              </label>
              <label className={fieldLabelClasses}>
                Email
                <input
                  className={fieldControlClasses}
                  value={content.identity.email}
                  onChange={(event) =>
                    edit({
                      ...content,
                      identity: { ...content.identity, email: event.target.value },
                    })
                  }
                />
              </label>
              <label className={fieldLabelClasses}>
                Phone
                <input
                  className={fieldControlClasses}
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
              </label>
              <LocaleField
                value={content.identity.locale}
                onChange={(locale) =>
                  edit({ ...content, identity: { ...content.identity, locale } })
                }
              />
            </div>
          </Card>

          <Card title="Account">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldLabelClasses}>
                Customer since
                <input
                  className={fieldControlClasses}
                  type="date"
                  value={content.account.customer_since}
                  onChange={(event) => editAccount({ customer_since: event.target.value })}
                />
              </label>
              <label className={fieldLabelClasses}>
                Status
                <select
                  className={fieldControlClasses}
                  value={content.account.status}
                  onChange={(event) => editAccount({ status: event.target.value as AccountStatus })}
                >
                  <option value="active">Active</option>
                  <option value="dormant">Dormant</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className={fieldLabelClasses}>
                Loyalty tier
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
              </label>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={content.account.marketing_opt_in}
                onChange={(event) => editAccount({ marketing_opt_in: event.target.checked })}
              />
              Opted in to marketing
            </label>
            <label className={fieldLabelClasses}>
              Account notes
              <textarea
                className={textAreaClasses}
                value={content.account.notes}
                onChange={(event) => editAccount({ notes: event.target.value })}
              />
            </label>
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
                {content.addresses.map((entry) => (
                  <li key={entry.id} className={`${surfaceClasses} grid gap-2 p-3`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label={`Label for ${entry.id}`}
                        className={`${fieldControlClasses} max-w-56`}
                        value={entry.label}
                        onChange={(event) => updateAddress(entry.id, { label: event.target.value })}
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
                          Make default
                        </button>
                      )}
                      <button
                        className={`${subtleButtonClasses} ml-auto`}
                        type="button"
                        aria-label={`Remove ${entry.label}`}
                        onClick={() => removeAddress(entry.id)}
                      >
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
                      <label className={fieldLabelClasses}>
                        Country
                        <input
                          className={fieldControlClasses}
                          value={entry.country}
                          onChange={(event) =>
                            updateAddress(entry.id, { country: event.target.value.toUpperCase() })
                          }
                        />
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
            <label className={fieldLabelClasses}>
              Summary
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
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {content.persona.traits.map((entry) => (
                <button
                  key={entry}
                  className={subtleButtonClasses}
                  type="button"
                  onClick={() =>
                    edit({
                      ...content,
                      persona: {
                        ...content.persona,
                        traits: content.persona.traits.filter((value) => value !== entry),
                      },
                    })
                  }
                >
                  {entry} ✕
                </button>
              ))}
            </div>
            <form className="flex flex-wrap items-end gap-2" onSubmit={addTrait}>
              <label className={fieldLabelClasses}>
                New trait
                <input
                  className={fieldControlClasses}
                  value={trait}
                  required
                  onChange={(event) => setTrait(event.target.value)}
                />
              </label>
              <button className={inkButtonClasses} type="submit">
                Add trait
              </button>
            </form>
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
              <ul className="grid gap-2">
                {content.background.map((entry) => (
                  <li key={entry.id} className="grid gap-1 text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {entry.occurred_on} · {labelOf(BACKGROUND_KIND, entry.kind)}
                      </span>
                      <button
                        className={`${subtleButtonClasses} ml-auto`}
                        type="button"
                        onClick={() => removeBackground(entry.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      aria-label={`Background note for ${entry.occurred_on}`}
                      className={fieldControlClasses}
                      value={entry.note}
                      onChange={(event) => updateBackground(entry.id, event.target.value)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <BackgroundForm
              onAdd={(kind, occurredOn, note) =>
                edit({
                  ...content,
                  background: [
                    ...content.background,
                    {
                      id: uniqueId(
                        slugify(note.slice(0, 40)),
                        content.background.map((entry) => entry.id),
                      ),
                      kind,
                      occurred_on: occurredOn,
                      note,
                    },
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
                {content.hidden_facts.map((fact) => (
                  <li key={fact.id} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`Hidden fact ${fact.id}`}
                        className={fieldControlClasses}
                        value={fact.note}
                        onChange={(event) =>
                          updateHiddenFact(fact.id, { note: event.target.value })
                        }
                      />
                      <button
                        className={subtleButtonClasses}
                        type="button"
                        onClick={() => removeHiddenFact(fact.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      aria-label={`Reveal condition for ${fact.id}`}
                      className={fieldControlClasses}
                      placeholder="Revealed when…"
                      value={fact.revealed_when}
                      onChange={(event) =>
                        updateHiddenFact(fact.id, { revealed_when: event.target.value })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            <HiddenFactForm
              onAdd={(note, revealedWhen) =>
                edit({
                  ...content,
                  hidden_facts: [
                    ...content.hidden_facts,
                    {
                      id: uniqueId(
                        slugify(note.slice(0, 40)),
                        content.hidden_facts.map((fact) => fact.id),
                      ),
                      note,
                      revealed_when: revealedWhen,
                    },
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
                .map((shop) => (
                  <li key={shop.shop_id} className="flex items-center gap-2">
                    <span className="font-semibold">{shop.name}</span>
                    {shop.shop_id === shopId ? (
                      <span className="text-admin-muted">this shop</span>
                    ) : null}
                    <button
                      className={`${subtleButtonClasses} ml-auto`}
                      type="button"
                      onClick={() => void toggleShop(shop.shop_id, false)}
                    >
                      Detach
                    </button>
                  </li>
                ))}
            </ul>
            {otherShops
              .filter((shop) => !attachedShops.includes(shop.shop_id))
              .map((shop) => (
                <button
                  key={shop.shop_id}
                  className={subtleButtonClasses}
                  type="button"
                  onClick={() => void toggleShop(shop.shop_id, true)}
                >
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
        <label className={fieldLabelClasses}>
          Country
          <input
            className={`${fieldControlClasses} max-w-20`}
            value={country}
            required
            pattern="[A-Z]{2}"
            title="Uppercase ISO 3166-1 alpha-2, for example FR"
            onChange={(event) => setTypedCountry(event.target.value.toUpperCase())}
          />
        </label>
        <button className={inkButtonClasses} type="submit">
          Add address
        </button>
      </fieldset>
    </form>
  );
}

function BackgroundForm({
  onAdd,
}: {
  onAdd: (kind: BackgroundKind, occurredOn: string, note: string) => void;
}) {
  const [kind, setKind] = useState<BackgroundKind>("purchase");
  const [occurredOn, setOccurredOn] = useState("2026-01-01");
  const [note, setNote] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(kind, occurredOn, note);
        setNote("");
      }}
    >
      <label className={fieldLabelClasses}>
        Kind
        <select
          className={fieldControlClasses}
          value={kind}
          onChange={(event) => setKind(event.target.value as BackgroundKind)}
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
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Note
        <input
          className={fieldControlClasses}
          value={note}
          required
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button className={inkButtonClasses} type="submit">
        Add entry
      </button>
    </form>
  );
}

function HiddenFactForm({ onAdd }: { onAdd: (note: string, revealedWhen: string) => void }) {
  const [note, setNote] = useState("");
  const [revealedWhen, setRevealedWhen] = useState("");

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd(note, revealedWhen);
        setNote("");
        setRevealedWhen("");
      }}
    >
      <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
        Hidden fact
        <input
          className={fieldControlClasses}
          value={note}
          required
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <label className={`${fieldLabelClasses} min-w-48 flex-1`}>
        Revealed when
        <input
          className={fieldControlClasses}
          value={revealedWhen}
          onChange={(event) => setRevealedWhen(event.target.value)}
        />
      </label>
      <button className={inkButtonClasses} type="submit">
        Add fact
      </button>
    </form>
  );
}
