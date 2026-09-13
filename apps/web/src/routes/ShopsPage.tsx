import type { ShopSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LabApiError } from "../api/client";
import { createShop, listShops } from "../api/shops";
import { FieldHint } from "../components/FieldHint";
import { LocaleField } from "../components/LocaleField";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import { CURRENCIES, type Currency } from "../lib/currencies";
import { KEBAB_PATTERN, SHOP_SLUG_RULE } from "../lib/fieldRules";
import { currencyForLocale, DEFAULT_LOCALE } from "../lib/locales";
import { shopSlugFromName } from "../lib/shop";
import {
  accentButtonClasses,
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

export function ShopsPage() {
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [locale, setLocale] = useState(DEFAULT_LOCALE.tag);
  const [currency, setCurrency] = useState<Currency>(DEFAULT_LOCALE.currency);
  const [creating, setCreating] = useState(false);
  const [filled, setFilled] = useState(false);
  // The slug follows the name until somebody answers the slug themselves, and then it stops:
  // a field that overwrote a deliberate answer on the next keystroke in another field would be
  // worse than one that never helped. Emptying it hands it back, which is the way out for a
  // reader who edited it and wants the suggestion again without reloading the page.
  const [slugEdited, setSlugEdited] = useState(false);
  // The currency follows the locale on the same terms, and stops for the same reason. It has no
  // way back, because a dropdown cannot be emptied the way the slug can: choosing a currency is
  // the last word on it, and the way to hand it back is to reload the empty form.
  const [currencyEdited, setCurrencyEdited] = useState(false);

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) {
      setSlug(shopSlugFromName(value));
    }
  }

  function changeSlug(value: string) {
    setSlug(value);
    setSlugEdited(value !== "");
  }

  function changeLocale(value: string) {
    setLocale(value);
    const suggested = currencyForLocale(value);
    // Nothing is proposed for a locale the shortlist does not name, so a hand-typed `is-IS`
    // leaves the currency where it stands rather than reaching for the nearest guess.
    if (!currencyEdited && suggested) {
      setCurrency(suggested);
    }
  }

  function changeCurrency(value: string) {
    setCurrency(value as Currency);
    setCurrencyEdited(true);
  }

  function fillWithExample() {
    setName(EXAMPLE_SHOP.name);
    setSlug(shopSlugFromName(EXAMPLE_SHOP.name));
    setLocale(EXAMPLE_SHOP.locale);
    setCurrency(currencyForLocale(EXAMPLE_SHOP.locale) ?? DEFAULT_LOCALE.currency);
    // The example's slug and currency are what its name and locale derive, so this is filling
    // the pairs in rather than answering either: renaming or relocating the example afterwards
    // still carries them along.
    setSlugEdited(false);
    setCurrencyEdited(false);
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
    setCreating(true);
    setFormError(null);
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
      setFormError(cause instanceof LabApiError ? cause.message : "The shop could not be created.");
      setCreating(false);
    }
  }

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

        <div id="create-shop">
          <Card title="Create a shop">
            <form className="grid gap-3" onSubmit={submit}>
              <FieldHint
                label="Name"
                hint="The shop's public name. Publishing freezes it with the rest of the shop."
              >
                <input
                  className={fieldControlClasses}
                  value={name}
                  required
                  maxLength={200}
                  placeholder="Harbour Lane Supply"
                  onChange={(event) => changeName(event.target.value)}
                />
              </FieldHint>
              <FieldHint label="Slug" hint={SHOP_SLUG_RULE}>
                <input
                  className={fieldControlClasses}
                  value={slug}
                  required
                  pattern={KEBAB_PATTERN}
                  title={SHOP_SLUG_RULE}
                  placeholder="harbour-lane-supply"
                  onChange={(event) => changeSlug(event.target.value)}
                />
              </FieldHint>
              <LocaleField value={locale} required onChange={changeLocale} />
              <FieldHint label="Currency" hint="The shop starts with this one currency.">
                <select
                  className={fieldControlClasses}
                  value={currency}
                  onChange={(event) => changeCurrency(event.target.value)}
                >
                  {CURRENCIES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} — {option.label}
                    </option>
                  ))}
                </select>
              </FieldHint>
              {formError ? (
                <p role="alert" className="text-[13px] text-lab-error">
                  {formError}
                </p>
              ) : null}
              <button className={accentButtonClasses} type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create shop"}
              </button>
              <p className="text-xs text-admin-muted">
                A new shop starts as an empty draft. Catalog and support content are added in the
                workspace, then published together.
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
