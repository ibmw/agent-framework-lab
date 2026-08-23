import type { ShopSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createShop, listShops, ShopApiError } from "../api/shops";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { AppShell } from "../shell/AppShell";

const CURRENCIES = ["EUR", "USD", "GBP"] as const;

export function ShopsPage() {
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [locale, setLocale] = useState("en-GB");
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("EUR");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listShops(controller.signal)
      .then((response) => setShops(response.shops))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof ShopApiError ? cause.message : "The lab is unavailable.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const created = await createShop({
        name,
        slug,
        locale,
        currencies: [currency],
        channels: ["chat"],
      });
      navigate(`/shops/${created.shop_id}`);
    } catch (cause: unknown) {
      setError(cause instanceof ShopApiError ? cause.message : "The shop could not be created.");
      setCreating(false);
    }
  }

  return (
    <AppShell shops={shops}>
      <PageHeader
        title="Shops"
        description="Every shop is a synthetic simulation environment. Publishing a shop freezes an immutable version that scenarios and experiments pin."
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          <h2 className="border-b border-admin-border px-4 py-3 text-sm font-semibold">
            All shops
          </h2>
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading shops…</p>
          ) : shops.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No shops yet. Create the first one to start authoring a catalog.
            </p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Shop</th>
                  <th className={tableHeadClasses}>Published</th>
                  <th className={tableHeadClasses}>Draft updated</th>
                </tr>
              </thead>
              <tbody>
                {shops.map((shop) => (
                  <tr key={shop.shop_id}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={`/shops/${shop.shop_id}`}
                      >
                        {shop.name}
                      </Link>
                      <div className="text-admin-muted">{shop.slug}</div>
                    </td>
                    <td className={tableCellClasses}>
                      {shop.latest_published_version === null
                        ? "Never published"
                        : `v${shop.latest_published_version} · ${shop.published_version_count} version(s)`}
                    </td>
                    <td className={tableCellClasses}>{formatTimestamp(shop.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <Card title="Create a shop">
          <form className="grid gap-3" onSubmit={submit}>
            <label className={fieldLabelClasses}>
              Name
              <input
                className={fieldControlClasses}
                value={name}
                required
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={fieldLabelClasses}>
              Slug
              <input
                className={fieldControlClasses}
                value={slug}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase kebab-case, for example northstar-outfitters"
                onChange={(event) => setSlug(event.target.value)}
              />
            </label>
            <label className={fieldLabelClasses}>
              Locale
              <input
                className={fieldControlClasses}
                value={locale}
                required
                pattern="[a-z]{2}(-[A-Z]{2})?"
                title="For example en or en-GB"
                onChange={(event) => setLocale(event.target.value)}
              />
            </label>
            <label className={fieldLabelClasses}>
              Currency
              <select
                className={fieldControlClasses}
                value={currency}
                onChange={(event) => setCurrency(event.target.value as (typeof CURRENCIES)[number])}
              >
                {CURRENCIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button className={accentButtonClasses} type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create shop"}
            </button>
            <p className="text-xs text-admin-muted">
              A new shop starts as an empty draft. Catalog and support content are added in the
              workspace, then published together.
            </p>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
