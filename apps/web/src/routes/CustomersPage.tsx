import type { CustomerProfileSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  attachCustomerProfileToShop,
  createCustomerProfile,
  listCustomerProfiles,
} from "../api/customerProfiles";
import { Card, PageHeader } from "../components/WorkspaceChrome";
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

export function CustomersPage() {
  const { shopId } = useShopWorkspace();
  const [attached, setAttached] = useState<CustomerProfileSummarySchema[]>([]);
  const [everything, setEverything] = useState<CustomerProfileSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  const [customerSince, setCustomerSince] = useState("2024-01-01");
  const [attachId, setAttachId] = useState("");

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const [scoped, all] = await Promise.all([
        listCustomerProfiles(shopId, signal),
        listCustomerProfiles(undefined, signal),
      ]);
      setAttached(scoped.profiles);
      setEverything(all.profiles);
    },
    [shopId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
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
    setError(null);
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
      await reload();
    } catch (cause: unknown) {
      setError(describeApiError(cause, "The profile could not be created."));
    } finally {
      setBusy(false);
    }
  }

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await attachCustomerProfileToShop(attachId, shopId);
      setAttachId("");
      await reload();
    } catch (cause: unknown) {
      setError(describeApiError(cause, "The profile could not be attached."));
    } finally {
      setBusy(false);
    }
  }

  const attachable = everything.filter(
    (profile) => !attached.some((row) => row.profile_id === profile.profile_id),
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Profiles attached to this shop. A profile — identity, persona, and address book — is reusable across shops; orders, tickets, and support history stay here."
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading customers…</p>
          ) : attached.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No customer is attached to this shop yet. Create one, or attach an existing profile.
            </p>
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
                {attached.map((profile) => (
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
              <label className={fieldLabelClasses}>
                Given name
                <input
                  className={fieldControlClasses}
                  value={givenName}
                  required
                  onChange={(event) => setGivenName(event.target.value)}
                />
              </label>
              <label className={fieldLabelClasses}>
                Family name
                <input
                  className={fieldControlClasses}
                  value={familyName}
                  required
                  onChange={(event) => setFamilyName(event.target.value)}
                />
              </label>
              <label className={fieldLabelClasses}>
                Email
                <input
                  className={fieldControlClasses}
                  type="email"
                  value={email}
                  required
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className={fieldLabelClasses}>
                Customer since
                <input
                  className={fieldControlClasses}
                  type="date"
                  value={customerSince}
                  required
                  onChange={(event) => setCustomerSince(event.target.value)}
                />
              </label>
              <button className={accentButtonClasses} type="submit" disabled={busy}>
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
              <button
                className={outlineButtonClasses}
                type="submit"
                disabled={busy || attachable.length === 0}
              >
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
