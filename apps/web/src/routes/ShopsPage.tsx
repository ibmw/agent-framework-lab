import type { ShopSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LabApiError } from "../api/client";
import { createShop, listShops } from "../api/shops";
import { ButtonIcon } from "../components/ButtonIcon";
import { CurrencyField } from "../components/CurrencyField";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { LocaleField } from "../components/LocaleField";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import type { Currency } from "../lib/currencies";
import { uniqueSuggestion } from "../lib/entryIds";
import { KEBAB_PATTERN, SHOP_NAME_RULE, SHOP_SLUG_RULE } from "../lib/fieldRules";
import { currencyForLocale, DEFAULT_LOCALE } from "../lib/locales";
import { shopSlugFromName } from "../lib/shop";
import {
  accentButtonClasses,
  cardTitleClasses,
  fieldControlClasses,
  formatTimestamp,
  outlineButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { AppShell } from "../shell/AppShell";

/** A ready-made identity for the form, for an operator who came to see the product rather than
 * to name a shop. It fills the four fields and creates nothing: what gets written is still
 * whatever is in the form when *Create shop* is pressed, so the example can be read and edited
 * first, and pressing this by mistake costs nothing.
 *
 * Deliberately not `northstar-outfitters`, which `make seed` writes. That shop arrives published,
 * with a catalog, a scenario and a finished comparison behind it; this one is an empty draft. Two
 * different things under one name would make the shops list lie about which of them you are
 * looking at.
 *
 * It answers a name and a locale only. The slug and the currency are derived from those by the
 * same code that derives them while somebody types, so the example cannot drift into showing a
 * pairing the form itself would never suggest.
 */
const EXAMPLE_SHOP = {
  name: "Harbour Lane Supply",
  locale: "en-GB",
} as const satisfies Record<string, string>;

type Filter = "all" | "published" | "draft";

/** The prototype's shop chips, whole (`tmp/design-frames/Workspace.dc.html`:5750–5752). */
const FILTERS: FilterChipDefinition<Filter, ShopSummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "published",
    label: "Published",
    kind: "published",
    matches: (shop) => shop.latest_published_version !== null,
  },
  {
    id: "draft",
    label: "Never published",
    kind: "draft",
    matches: (shop) => shop.latest_published_version === null,
  },
];

export function ShopsPage() {
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [locale, setLocale] = useState(DEFAULT_LOCALE.tag);
  const [currencies, setCurrencies] = useState<Currency[]>([DEFAULT_LOCALE.currency]);
  const [creating, setCreating] = useState(false);
  const [filled, setFilled] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // One token for both derived fields: the example answers a name and a locale, and both the
  // slug and the currencies are things those two derive, so they resume together.
  const [exampleFill, setExampleFill] = useState(0);
  const takenSlugs = shops.map((shop) => shop.slug);
  const { value: suggestedSlug, takenBase: takenSlugBase } = uniqueSuggestion(
    shopSlugFromName(name),
    takenSlugs,
  );

  function fillWithExample() {
    setName(EXAMPLE_SHOP.name);
    setSlug(shopSlugFromName(EXAMPLE_SHOP.name));
    setLocale(EXAMPLE_SHOP.locale);
    setCurrencies([currencyForLocale(EXAMPLE_SHOP.locale) ?? DEFAULT_LOCALE.currency]);
    // The example's slug and currency are what its name and locale derive, so this is filling
    // the pairs in rather than answering either: renaming or relocating the example afterwards
    // still carries them along.
    setExampleFill((token) => token + 1);
    setFilled(true);
  }

  const reload = useCallback(async (signal?: AbortSignal) => {
    setShops((await listShops(signal)).shops);
    setLoadError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(cause instanceof LabApiError ? cause.message : "The lab is unavailable.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slug || takenSlugs.includes(slug)) {
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const created = await createShop({
        name,
        slug,
        locale,
        currencies,
        channels: ["chat"],
      });
      navigate(`/shops/${created.shop_id}`);
    } catch (cause: unknown) {
      setFormError(cause instanceof LabApiError ? cause.message : "The shop could not be created.");
      setCreating(false);
    }
  }

  // Name or slug, the two the prototype's shops search reads (`Workspace.dc.html`, the
  // `shownShops` filter) and the two this table prints in its first column.
  const { chips, visible } = filterList(shops, FILTERS, filter, {
    query,
    fields: (shop) => [shop.name, shop.slug],
  });

  return (
    <AppShell shops={shops}>
      <PageHeader
        title="Shops"
        description="Every shop is a synthetic simulation environment. Publishing a shop freezes an immutable version that scenarios and experiments pin."
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className={`${surfaceClasses} overflow-hidden`}>
          {/* The card header `Card` draws, open-coded because the filter row has to sit
              between the title and the table. The title itself is the shared one, and so is
              the row: this is the one card in this workspace with a title for the search box
              to sit opposite, which is where the prototype puts it, so the title goes into
              `SearchRow` rather than the row being spelled a second time here. */}
          <SearchRow>
            <h2 className={cardTitleClasses}>All shops</h2>
            {loading || loadError ? null : (
              <SearchField label="Search shops" onChange={setQuery} value={query} />
            )}
          </SearchRow>
          {/* Only once there are rows to count. A chip is a filter, and a row of zeros over
              "Loading…" — or over a listing that failed — filters nothing and answers nothing;
              it is the stat band this slice exists to avoid, drawn at its least useful moment.
              The row arrives with the table it belongs to. */}
          {loading || loadError ? null : (
            <FilterChips
              legend="Filter shops"
              chips={chips}
              selected={filter}
              onSelect={setFilter}
            />
          )}
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading shops…</p>
          ) : shops.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              No shops yet. Create the first one to start authoring a catalog.
            </p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">No shop matches this view.</p>
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
                {visible.map((shop) => (
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

        <div id="create-shop">
          <Card title="Create a shop">
            <form className="grid gap-3" onSubmit={submit}>
              <FieldHint label="Name" hint={SHOP_NAME_RULE}>
                <input
                  className={fieldControlClasses}
                  value={name}
                  required
                  maxLength={200}
                  placeholder="Harbour Lane Supply"
                  onChange={(event) => setName(event.target.value)}
                />
              </FieldHint>
              <DerivedIdField
                // A new key remounts the field so its follow/edited state resets — React's
                // way to reset state when the example fill replaces the source
                // (https://react.dev/learn/preserving-and-resetting-state).
                key={`slug-${exampleFill}`}
                label="Slug"
                hint={SHOP_SLUG_RULE}
                value={slug}
                suggested={suggestedSlug}
                taken={takenSlugs}
                takenBase={takenSlugBase}
                takenPlace="used by another shop"
                pattern={KEBAB_PATTERN}
                title={SHOP_SLUG_RULE}
                placeholder="harbour-lane-supply"
                required
                onChange={setSlug}
              />
              <LocaleField value={locale} required onChange={setLocale} />
              <CurrencyField
                // Remounted with the slug, so the example fill hands the suggestion back.
                // Its own key: two siblings under one key are one element to React, and the
                // second would replace the first.
                key={`currencies-${exampleFill}`}
                value={currencies}
                suggested={currencyForLocale(locale)}
                onChange={setCurrencies}
              />
              {formError ? (
                <p role="alert" className="text-[13px] text-lab-error">
                  {formError}
                </p>
              ) : null}
              <button className={accentButtonClasses} type="submit" disabled={creating}>
                <ButtonIcon verb="save" />
                {creating ? "Creating…" : "Create shop"}
              </button>
              <p className="text-xs text-admin-muted">
                A new shop starts as an empty draft that answers on chat. Catalog and support
                content are added in the workspace, then published together; email and phone are
                added under Shop details.
              </p>
              {/* Below the control it assists rather than beside it: this fills the form in, so it
                  reads as an alternative to typing the four fields, not as a second way to
                  create. `type="button"` because everything else in this form submits it. */}
              <div className="grid gap-1.5 border-t border-admin-border pt-3">
                <button
                  className={outlineButtonClasses}
                  type="button"
                  disabled={creating}
                  onClick={fillWithExample}
                >
                  Use an example shop
                </button>
                <p className="text-xs text-admin-muted" role="status">
                  {filled
                    ? `Filled in ${EXAMPLE_SHOP.name}. Change anything you like — nothing is created until you press Create shop.`
                    : "Fills the fields above with a ready-made shop, for when you want to look around rather than name one. It creates nothing on its own."}
                </p>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
