import type { ShopLogoViewSchema, ShopSummarySchema, SupportChannel } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LabApiError } from "../api/client";
import { createShop, deleteShop, listShops } from "../api/shops";
import { ButtonIcon } from "../components/ButtonIcon";
import { RemovalNotice } from "../components/ConfirmRemove";
import { CreatePage } from "../components/CreatePage";
import { CurrencyField } from "../components/CurrencyField";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { RemoveButton } from "../components/ItemList";
import { LocaleField } from "../components/LocaleField";
import { SearchField, SearchRow } from "../components/SearchField";
import { ShopBadge } from "../components/ShopBadge";
import { ShopDeleteConfirm } from "../components/ShopDeleteConfirm";
import { ShopLogoCard } from "../components/ShopLogoCard";
import { ToggleChipGroup } from "../components/ToggleChipGroup";
import { Card, PageHeader, PublicationPill } from "../components/WorkspaceChrome";
import type { Currency } from "../lib/currencies";
import { SLUG_MAX_LENGTH, uniqueSuggestion } from "../lib/entryIds";
import { optionsOf, SUPPORT_CHANNEL } from "../lib/enumLabels";
import {
  alreadyTakenMessage,
  KEBAB_PATTERN,
  LABEL_MAX_LENGTH,
  SHOP_NAME_RULE,
  SHOP_SLUG_RULE,
  SHOP_SLUG_TAKEN_PLACE,
} from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import { currencyForLocale, DEFAULT_LOCALE } from "../lib/locales";
import { forgetLastVisitedShop, readLastVisitedShop } from "../lib/preferences";
import { pythonStrip } from "../lib/pythonText";
import { useRemoval } from "../lib/removal";
import { shopSlugFromName } from "../lib/shop";
import { DELETING_SHOP, PUBLISHED_SHOP_KEPT } from "../lib/shopDeletion";
import {
  accentButtonClasses,
  fieldControlClasses,
  focusRingClasses,
  formatTimestamp,
  outlineButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
  tableScrollerClasses,
} from "../lib/ui";
import { AppShell } from "../shell/AppShell";

const SUPPORT_CHANNELS = optionsOf(SUPPORT_CHANNEL);

function deletedNotice(shop: ShopSummarySchema): string {
  return `Deleted ${shop.name} and everything it held.`;
}

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

/**
 * Every shop the lab holds, read once per mount.
 *
 * The index and the create page both need it — one to list, one to know which slugs are taken —
 * and neither is inside a workspace shell that could hold it for them, because `/shops` and
 * `/shops/new` are the two surfaces that exist before there is a shop to have a workspace for.
 */
function useShops() {
  const [shops, setShops] = useState<ShopSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const listed = (await listShops(signal)).shops;
    setShops(listed);
    setLoadError(null);
    return listed;
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

  /** Takes one shop out of the listing the page holds, before the read that confirms it. */
  const drop = useCallback((shopId: string) => {
    setShops((current) => current.filter((shop) => shop.shop_id !== shopId));
  }, []);

  return { shops, loading, loadError, reload, drop };
}

export function ShopsPage() {
  const { shops, loading, loadError, reload, drop } = useShops();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // One subject — the lab's shops — so no scope: the confirm stands on one row at a time.
  const removal = useRemoval();
  const keptLineId = useId();
  const deleting = useRef(false);
  // The shop whose delete is in flight: its trash is held meanwhile (ADR 0063), so the row does
  // not look idle and cannot arm the confirm again.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  // Bumped when a refusal leaves no trash to hand focus back to; the alert takes it instead.
  const [focusAlert, setFocusAlert] = useState(0);
  useEffect(() => {
    if (focusAlert > 0) {
      alertRef.current?.focus();
    }
  }, [focusAlert]);

  /**
   * The delete, once the confirm has been answered (ADR 0077). It is a write, so the notice
   * waits for it (ADR 0060): the row leaves the listing the page holds, the stored last-visited
   * shop is forgotten when it named this one, and the listing is read again so the index — and
   * the switcher the next workspace draws from its own read — says only what remains. A refusal
   * says the lab's reason over the table and walks the confirm back.
   */
  async function remove(shop: ShopSummarySchema): Promise<boolean> {
    if (deleting.current) {
      // One delete at a time: a second press while the first is in flight sends nothing.
      return false;
    }
    deleting.current = true;
    setDeletingId(shop.shop_id);
    setDeleteError(null);
    try {
      await deleteShop(shop.shop_id);
    } catch (cause: unknown) {
      setDeleteError(
        cause instanceof LabApiError ? cause.message : "The shop could not be deleted.",
      );
      // What the lab now holds, whichever way the refusal went: a shop published or deleted
      // elsewhere since this listing was read is drawn as it is.
      const listed = await reload().catch(() => null);
      deleting.current = false;
      setDeletingId(null);
      // The walk-back returns focus to the trash that asked; a trash now held (the shop was
      // published) or gone (it was deleted elsewhere) cannot take it, so the alert does.
      const now = listed?.find((entry) => entry.shop_id === shop.shop_id);
      if (listed !== null && (now === undefined || now.latest_published_version !== null)) {
        setFocusAlert((count) => count + 1);
      }
      return false;
    }
    if (readLastVisitedShop() === shop.shop_id) {
      forgetLastVisitedShop();
    }
    drop(shop.shop_id);
    deleting.current = false;
    setDeletingId(null);
    // Read again for what else moved; the row is already gone, so a failed read changes nothing.
    void reload().catch(() => undefined);
    return true;
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
        actions={
          <Link className={accentButtonClasses} to="/shops/new">
            <ButtonIcon verb="create" />
            New shop
          </Link>
        }
      />

      <section className={`${surfaceClasses} overflow-hidden`}>
        <SearchRow title="In this lab">
          {loading || loadError ? null : (
            <SearchField label="Search shops" onChange={setQuery} value={query} />
          )}
        </SearchRow>
        {/* Only once there are rows to count. A chip is a filter, and a row of zeros over
            "Loading…" — or over a listing that failed — filters nothing and answers nothing;
            it is the stat band this slice exists to avoid, drawn at its least useful moment.
            The row arrives with the table it belongs to. */}
        {loading || loadError ? null : (
          <FilterChips legend="Filter shops" chips={chips} selected={filter} onSelect={setFilter} />
        )}
        {loadError ? (
          // Its failure and nothing else: a listing that could not be read has not said the
          // lab holds no shop.
          <p role="alert" className="p-4 text-[13px] text-lab-error">
            {loadError}
          </p>
        ) : loading ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading shops…</p>
        ) : shops.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            No shops yet. Create the first one to start authoring a catalog.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">No shop matches this view.</p>
        ) : (
          <div className={tableScrollerClasses}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Shop</th>
                  <th className={tableHeadClasses}>Published</th>
                  <th className={tableHeadClasses}>Draft updated</th>
                  <th className={tableHeadClasses}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((shop) =>
                  removal.isArmed(shop.shop_id) ? (
                    <ShopDeleteConfirm
                      key={shop.shop_id}
                      shopId={shop.shop_id}
                      name={shop.name}
                      columns={4}
                      onConfirm={removal.confirm(() => remove(shop), deletedNotice(shop))}
                      onKeep={removal.keep}
                    />
                  ) : (
                    <tr key={shop.shop_id}>
                      <td className={tableCellClasses}>
                        {/* The frame's row (`Workspace.dc.html`:179): the badge, then the name
                          over the slug. The badge is drawn for every shop — its logo, or its
                          initials — so the names start on one line down the column. */}
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <ShopBadge name={shop.name} logo={shop.logo} size={30} />
                          <div className="min-w-0">
                            <Link
                              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                              to={`/shops/${shop.shop_id}`}
                            >
                              {shop.name}
                            </Link>
                            <div className="text-admin-muted">{shop.slug}</div>
                          </div>
                        </div>
                      </td>
                      <td className={tableCellClasses}>
                        <PublicationPill record={shop} />
                      </td>
                      <td className={tableCellClasses}>{formatTimestamp(shop.updated_at)}</td>
                      <td className={tableCellClasses}>
                        {/* The only place a shop is deleted from (ADR 0077). */}
                        <span className="flex items-center justify-end">
                          <RemoveButton
                            name={shop.name}
                            label={`Delete ${shop.name}`}
                            entryKey={shop.shop_id}
                            removal={removal}
                            notice={deletedNotice(shop)}
                            held={
                              deletingId === shop.shop_id
                                ? DELETING_SHOP
                                : shop.latest_published_version !== null
                                  ? PUBLISHED_SHOP_KEPT
                                  : undefined
                            }
                            describedBy={keptLineId}
                            onRemove={() => remove(shop)}
                          />
                        </span>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        {/* Said once under the table rather than per row, and named by every held trash. */}
        {!loading &&
        !loadError &&
        visible.some((shop) => shop.latest_published_version !== null) ? (
          <p id={keptLineId} className="px-4 py-3 text-[13px] text-admin-muted">
            {PUBLISHED_SHOP_KEPT}
          </p>
        ) : null}
        {deleteError ? (
          <p
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className={`px-4 py-3 text-[13px] text-lab-error ${focusRingClasses}`}
          >
            {deleteError}
          </p>
        ) : null}
        <RemovalNotice removal={removal} />
      </section>
    </AppShell>
  );
}

/**
 * `/shops/new` — the create page the shops index used to hold as a side card
 * (`Workspace.dc.html`:212).
 *
 * Identity, Commerce and Channels, on the fields Slices 2 and 4 built. It lands in the new
 * shop's workspace, which reads the shop list itself, so there is no rail figure here to move:
 * `/shops` draws no rail at all.
 *
 * The Logo card sits between Identity and Commerce, where the prototype draws it, and opens on
 * no logo: a mark nobody picked is not a choice the lab can make for the operator (ADR 0070).
 */
export function NewShopPage() {
  const navigate = useNavigate();
  const { shops, loading, loadError } = useShops();
  const formId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [locale, setLocale] = useState(DEFAULT_LOCALE.tag);
  const [currencies, setCurrencies] = useState<Currency[]>([DEFAULT_LOCALE.currency]);
  const [channels, setChannels] = useState<SupportChannel[]>(["chat"]);
  const [logo, setLogo] = useState<ShopLogoViewSchema | null>(null);
  const [creating, setCreating] = useState(false);
  const [filled, setFilled] = useState(false);
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

  // Which slugs are taken is what the listing still has to say, so a create before it lands
  // could write one that is already used — the refusal would come from the lab rather than
  // from the form, which is the one thing `DerivedIdField` exists to prevent.
  const blockedBy =
    pythonStrip(name) === ""
      ? "The shop needs a name before it can be created."
      : loading
        ? "Reading which slugs are already used…"
        : slug === ""
          ? "The shop needs a slug before it can be created."
          : takenSlugs.includes(slug)
            ? alreadyTakenMessage(slug, SHOP_SLUG_TAKEN_PLACE)
            : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedBy !== undefined) {
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const created = await createShop(
        {
          // Stripped as Python strips it: `require_label` refuses a padded name.
          name: pythonStrip(name),
          slug,
          locale,
          currencies,
          channels,
        },
        logo,
      );
      navigate(`/shops/${created.shop_id}`);
    } catch (cause: unknown) {
      setFormError(cause instanceof LabApiError ? cause.message : "The shop could not be created.");
      setCreating(false);
    }
  }

  return (
    <AppShell shops={shops}>
      <CreatePage
        backTo="/shops"
        backLabel="All shops"
        breadcrumb="creating a shop"
        title={name}
        untitled="New shop"
        formId={formId}
        createLabel="Create shop"
        creating={creating}
        creatingLabel="Creating…"
        blockedBy={blockedBy}
        error={formError ?? loadError}
      >
        <form id={formId} className="grid gap-4" onSubmit={submit}>
          <Card title="Identity">
            <FieldRows>
              <Field label="Name" hint={SHOP_NAME_RULE}>
                <input
                  className={`${fieldControlClasses} w-full`}
                  value={name}
                  required
                  maxLength={LABEL_MAX_LENGTH}
                  placeholder="Harbour Lane Supply"
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <DerivedIdField
                // A new key remounts the field so its follow/edited state resets — React's
                // way to reset state when the example fill replaces the source
                // (https://react.dev/learn/preserving-and-resetting-state).
                key={`slug-${exampleFill}`}
                arrangement="row"
                label="Slug"
                hint={SHOP_SLUG_RULE}
                value={slug}
                suggested={suggestedSlug}
                pending={loading}
                taken={takenSlugs}
                takenBase={takenSlugBase}
                takenPlace={SHOP_SLUG_TAKEN_PLACE}
                pattern={KEBAB_PATTERN}
                maxLength={SLUG_MAX_LENGTH}
                title={SHOP_SLUG_RULE}
                placeholder="harbour-lane-supply"
                required
                onChange={setSlug}
              />
            </FieldRows>
          </Card>

          <ShopLogoCard name={name} logo={logo} onChange={setLogo} />

          <Card title="Commerce">
            <FieldRows>
              <LocaleField arrangement="row" value={locale} required onChange={setLocale} />
              <CurrencyField
                // Remounted with the slug, so the example fill hands the suggestion back.
                // Its own key: two siblings under one key are one element to React, and the
                // second would replace the first.
                key={`currencies-${exampleFill}`}
                arrangement="row"
                value={currencies}
                suggested={currencyForLocale(locale)}
                onChange={setCurrencies}
              />
            </FieldRows>
          </Card>

          {/* Shop details' own group: the create request carries the channels, so the page
              asks here what it used to fix at chat and send the operator on to change. */}
          <Card title="Channels">
            <p className="text-[13px] text-admin-muted">
              A shop must always answer on at least one.
            </p>
            <FieldRows>
              <ToggleChipGroup
                arrangement="row"
                label="Answers on"
                hint="A new shop answers on chat unless you choose otherwise. The last channel left on stays on, and Shop details changes them once it exists."
                options={SUPPORT_CHANNELS.map((channel) => ({
                  value: channel.value,
                  label: channel.label,
                }))}
                value={channels}
                keepOne="A shop answers on at least one channel."
                onChange={setChannels}
              />
            </FieldRows>
            <p className="text-xs text-admin-muted">
              The shop is created as an empty draft. Nothing is published and no experiment can read
              it until a catalog is authored and a first version published.
            </p>
          </Card>

          {/* The prototype's own side card (`Workspace.dc.html`:375), in the one column this
              layout draws. `type="button"` because everything else in this form submits it. */}
          <Card title="In a hurry?">
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
          </Card>
        </form>
      </CreatePage>
    </AppShell>
  );
}
