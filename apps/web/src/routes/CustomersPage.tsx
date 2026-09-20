import type { CustomerProfileSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  attachCustomerProfileToShop,
  createCustomerProfile,
  listCustomerProfiles,
} from "../api/customerProfiles";
import { ButtonIcon } from "../components/ButtonIcon";
import { FieldHint } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { TourLaunch } from "../components/TourLaunch";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import { CUSTOMER_EMAIL_RULE, CUSTOMER_NAME_RULE, CUSTOMER_SINCE_RULE } from "../lib/fieldRules";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  outlineButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "The customer service is unavailable.";

function publishedLabel(profile: CustomerProfileSummarySchema): string {
  if (profile.latest_published_version === null) {
    return "Never published";
  }
  return `v${profile.latest_published_version} · ${profile.published_version_count} version(s)`;
}

type Filter = "all" | "published" | "draft" | "shared" | "noaddress";

/**
 * The prototype's customer chips, whole (`tmp/design-frames/Workspace.dc.html`:6908–6912).
 *
 * *Without a default address* is the one the refresh calls out by name, and it is the reason
 * this page wanted a chip row: an order's ship-to is a frozen copy of an address chosen from
 * the book, so a profile with no default is the shape of profile an order fixture stalls on.
 * The index already writes "no default" in the Addresses column; the chip is that column
 * counted and made pressable.
 */
const FILTERS: FilterChipDefinition<Filter, CustomerProfileSummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "published",
    label: "Published",
    kind: "published",
    matches: (profile) => profile.latest_published_version !== null,
  },
  {
    id: "draft",
    label: "Never published",
    kind: "draft",
    matches: (profile) => profile.latest_published_version === null,
  },
  {
    id: "shared",
    label: "Shared",
    kind: "referenced",
    matches: (profile) => profile.attached_shop_count > 1,
  },
  {
    id: "noaddress",
    label: "Without a default address",
    kind: "attention",
    matches: (profile) => profile.default_address_label === null,
  },
];

export function CustomersPage() {
  const { shopId } = useShopWorkspace();
  const [attached, setAttached] = useState<CustomerProfileSummarySchema[]>([]);
  const [everything, setEverything] = useState<CustomerProfileSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  const [customerSince, setCustomerSince] = useState("2024-01-01");
  const [attachId, setAttachId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const [scoped, all] = await Promise.all([
        listCustomerProfiles(shopId, signal),
        listCustomerProfiles(undefined, signal),
      ]);
      setAttached(scoped.profiles);
      setEverything(all.profiles);
      setLoadError(null);
    },
    [shopId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  async function addProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      await createCustomerProfile({
        identity: {
          given_name: givenName,
          family_name: familyName,
          email,
          locale: "en-GB",
          phone: null,
        },
        customer_since: customerSince,
        shop_id: shopId,
      });
      setGivenName("");
      setFamilyName("");
      setEmail("");
    } catch (cause: unknown) {
      setCreateError(describeApiError(cause, "The profile could not be created."));
      setBusy(false);
      return;
    }
    try {
      await reload();
    } catch (cause: unknown) {
      setLoadError(describeApiError(cause, UNAVAILABLE));
    } finally {
      setBusy(false);
    }
  }

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAttachError(null);
    try {
      await attachCustomerProfileToShop(attachId, shopId);
      setAttachId("");
    } catch (cause: unknown) {
      setAttachError(describeApiError(cause, "The profile could not be attached."));
      setBusy(false);
      return;
    }
    try {
      await reload();
    } catch (cause: unknown) {
      setLoadError(describeApiError(cause, UNAVAILABLE));
    } finally {
      setBusy(false);
    }
  }

  // Name or email, the pair the prototype's customers search reads (its `shownCustomers`
  // filter) and the pair its placeholder names.
  const { chips, visible } = filterList(attached, FILTERS, filter, {
    query,
    fields: (profile) => [profile.display_name, profile.email],
  });

  const attachable = everything.filter(
    (profile) => !attached.some((row) => row.profile_id === profile.profile_id),
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Profiles attached to this shop. A profile — identity, persona, and address book — is reusable across shops; orders, tickets, and support history stay here."
        actions={<TourLaunch id="customers" />}
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          {/* Only once there are rows to search and count. A chip is a filter, and a row of
              zeros over "Loading…" — or over a listing that failed — filters nothing and
              answers nothing; it is the stat band this slice exists to avoid, drawn at its
              least useful moment. The search box keeps the same company: a box that can only
              narrow nothing is a control that does nothing. Both arrive with the table they
              belong to. */}
          {loading || loadError ? null : (
            <>
              <SearchRow>
                <SearchField label="Search by name or email" onChange={setQuery} value={query} />
              </SearchRow>
              <FilterChips
                legend="Filter customers"
                chips={chips}
                selected={filter}
                onSelect={setFilter}
              />
            </>
          )}
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading customers…</p>
          ) : attached.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No customer is attached to this shop yet. Create one, or attach an existing profile.
            </p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">No customer matches this view.</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Customer</th>
                  <th className={tableHeadClasses}>Persona</th>
                  <th className={tableHeadClasses}>Addresses</th>
                  <th className={tableHeadClasses}>Shops</th>
                  <th className={tableHeadClasses}>Published</th>
                  <th className={tableHeadClasses}>Draft updated</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((profile) => (
                  <tr key={profile.profile_id}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={profile.profile_id}
                      >
                        {profile.display_name}
                      </Link>
                      <div className="text-admin-muted">{profile.email}</div>
                    </td>
                    <td className={tableCellClasses}>
                      {profile.persona_traits.length === 0
                        ? "—"
                        : profile.persona_traits.join(" · ")}
                    </td>
                    <td className={tableCellClasses}>
                      {profile.address_count}
                      {profile.default_address_label
                        ? ` · default: ${profile.default_address_label}`
                        : " · no default"}
                    </td>
                    <td className={tableCellClasses}>{profile.attached_shop_count}</td>
                    <td className={tableCellClasses}>{publishedLabel(profile)}</td>
                    <td className={tableCellClasses}>{formatTimestamp(profile.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="grid content-start gap-4">
          <Card title="New customer">
            <form className="grid gap-3" onSubmit={addProfile}>
              <FieldHint label="Given name" hint={CUSTOMER_NAME_RULE}>
                <input
                  className={fieldControlClasses}
                  value={givenName}
                  required
                  placeholder="Maya"
                  onChange={(event) => setGivenName(event.target.value)}
                />
              </FieldHint>
              <FieldHint label="Family name" hint={CUSTOMER_NAME_RULE}>
                <input
                  className={fieldControlClasses}
                  value={familyName}
                  required
                  placeholder="Laurent"
                  onChange={(event) => setFamilyName(event.target.value)}
                />
              </FieldHint>
              <FieldHint label="Email" hint={CUSTOMER_EMAIL_RULE}>
                <input
                  className={fieldControlClasses}
                  type="email"
                  value={email}
                  required
                  placeholder="maya.laurent@example.org"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FieldHint>
              <FieldHint label="Customer since" hint={CUSTOMER_SINCE_RULE}>
                <input
                  className={fieldControlClasses}
                  type="date"
                  value={customerSince}
                  required
                  onChange={(event) => setCustomerSince(event.target.value)}
                />
              </FieldHint>
              {createError ? (
                <p role="alert" className="text-[13px] text-lab-error">
                  {createError}
                </p>
              ) : null}
              <button className={accentButtonClasses} type="submit" disabled={busy}>
                <ButtonIcon verb="save" />
                Create and attach
              </button>
              <p className="text-xs text-admin-muted">
                Every customer is fictional. The address book and persona are added in the editor,
                then published together.
              </p>
            </form>
          </Card>

          <Card title="Attach existing profile">
            <form className="grid gap-3" onSubmit={attach}>
              <label className={fieldLabelClasses}>
                Profile
                <select
                  className={fieldControlClasses}
                  aria-label="Profile to attach"
                  value={attachId}
                  required
                  onChange={(event) => setAttachId(event.target.value)}
                >
                  <option value="">Select a profile</option>
                  {attachable.map((profile) => (
                    <option key={profile.profile_id} value={profile.profile_id}>
                      {profile.display_name} · {profile.email}
                    </option>
                  ))}
                </select>
              </label>
              {attachError ? (
                <p role="alert" className="text-[13px] text-lab-error">
                  {attachError}
                </p>
              ) : null}
              <button
                className={outlineButtonClasses}
                type="submit"
                disabled={busy || attachable.length === 0}
              >
                <ButtonIcon verb="create" />
                Attach to this shop
              </button>
              <p className="text-xs text-admin-muted">
                Attaching reuses the same profile. Its history in another shop never travels with
                it.
              </p>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
