import type { CustomerProfileSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  attachCustomerProfileToShop,
  createCustomerProfile,
  listCustomerProfiles,
} from "../api/customerProfiles";
import { ButtonIcon } from "../components/ButtonIcon";
import { RemovalNotice } from "../components/ConfirmRemove";
import { CreatePage } from "../components/CreatePage";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { LocaleField } from "../components/LocaleField";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import { CUSTOMER_EMAIL_RULE, CUSTOMER_NAME_RULE, CUSTOMER_SINCE_RULE } from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import { todayInput } from "../lib/orders";
import { useArrivedRemoval, useRemoval } from "../lib/removal";
import { onlyChoiceNote, useSingleChoice } from "../lib/singleChoice";
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
import { useShopWorkspace } from "../shell/useShopWorkspace";

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
  // The attached profiles are the listing the rail counts, read once by the shop's shell
  // (ADR 0056). The cross-shop list beside it belongs to this page alone — it is what the
  // attach control offers and nothing else reads it — so it stays here.
  const { shopId, listings } = useShopWorkspace();
  const attached = listings.customers.rows;
  // A profile detached from its editor lands here, and this is where it says so. Attaching it
  // again puts the row back, which is what silences the notice.
  const removal = useRemoval(shopId);
  useArrivedRemoval(removal);
  for (const profile of attached) {
    removal.present(profile.profile_id);
  }
  const [everything, setEverything] = useState<CustomerProfileSummarySchema[]>([]);
  const [loadingEverything, setLoadingEverything] = useState(true);
  const [everythingError, setEverythingError] = useState<string | null>(null);
  const loading = listings.customers.loading || loadingEverything;
  const loadError = listings.customers.error ?? everythingError;
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  // What the disclosure's button controls, so a reader it tells "expanded" can be taken there.
  const attachPanelId = useId();
  const attachReasonId = useId();
  const [attachId, setAttachId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const readEverything = useCallback(async (signal?: AbortSignal) => {
    try {
      const all = await listCustomerProfiles(undefined, signal);
      if (signal?.aborted) {
        return;
      }
      setEverything(all.profiles);
      setEverythingError(null);
    } catch (cause: unknown) {
      if (!signal?.aborted) {
        setEverythingError(describeApiError(cause, UNAVAILABLE));
      }
    } finally {
      if (!signal?.aborted) {
        setLoadingEverything(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readEverything(controller.signal);
    return () => controller.abort();
  }, [readEverything]);

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The button already refuses this; a submission that arrives some other way does too.
    if (attachId === "") {
      return;
    }
    setAttaching(true);
    setAttachError(null);
    try {
      await attachCustomerProfileToShop(attachId, shopId);
      setAttachId("");
    } catch (cause: unknown) {
      setAttachError(describeApiError(cause, "The profile could not be attached."));
      setAttaching(false);
      return;
    }
    // Attaching changes what this shop's customer listing holds, so the listing the rail is
    // drawn from is read again (ADR 0056). The cross-shop list moves with it: the profile
    // that was just attached is no longer attachable.
    await Promise.all([listings.customers.refresh(), readEverything()]);
    setAttaching(false);
    setAttachOpen(false);
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
  // One profile left to attach is not a choice (ADR 0064).
  const onlyAttachable = useSingleChoice(
    attachable.map((profile) => profile.profile_id),
    attachId,
    setAttachId,
  );
  const attachNoteId = useId();
  // Why *Attach to this shop* will not go (ADR 0063): there is nothing left to attach, or
  // nothing has been chosen yet.
  const attachRefusal =
    attachable.length === 0
      ? "Every profile in the lab is already attached to this shop."
      : attachId === ""
        ? "Choose the profile to attach."
        : null;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Profiles attached to this shop. A profile — identity, persona, and address book — is reusable across shops; orders, tickets, and support history stay here."
        actions={
          <>
            {/* The prototype's secondary button in the header (`Workspace.dc.html`:1133). It
                opens the one control an attach needs — which profile — rather than a second
                create form, so the index keeps no side card. */}
            <button
              className={outlineButtonClasses}
              type="button"
              aria-expanded={attachOpen}
              aria-controls={attachPanelId}
              onClick={() => setAttachOpen((open) => !open)}
            >
              <ButtonIcon verb="create" />
              Attach existing
            </button>
            <Link className={accentButtonClasses} to="new">
              New customer
            </Link>
          </>
        }
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      {attachOpen ? (
        <div className="mb-4" id={attachPanelId}>
          <Card title="Attach an existing profile">
            <form className="flex flex-wrap items-end gap-3" onSubmit={attach}>
              <label className={`${fieldLabelClasses} min-w-[260px] flex-1`}>
                Profile
                <select
                  className={`${fieldControlClasses} w-full`}
                  aria-label="Profile to attach"
                  aria-describedby={onlyAttachable ? attachNoteId : undefined}
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
                {onlyAttachable ? (
                  <span id={attachNoteId} className="text-xs font-normal text-admin-muted">
                    {onlyChoiceNote("profile in the lab not yet attached to this shop")}
                  </span>
                ) : null}
              </label>
              <PrimaryAction
                variant="outline"
                type="submit"
                refusal={
                  attachRefusal === null ? null : { id: attachReasonId, reason: attachRefusal }
                }
                busy={attaching}
              >
                <ButtonIcon verb="create" />
                Attach to this shop
              </PrimaryAction>
              {attachRefusal === null ? null : (
                <RefusalLine id={attachReasonId} className="w-full">
                  {attachRefusal}
                </RefusalLine>
              )}
              {attachError ? (
                <p role="alert" className="w-full text-[13px] text-lab-error">
                  {attachError}
                </p>
              ) : null}
              <p className="w-full text-xs text-admin-muted">
                Attaching reuses the same profile. Its history in another shop never travels with
                it.
              </p>
            </form>
          </Card>
        </div>
      ) : null}

      <section className={`${surfaceClasses} overflow-hidden`}>
        {/* Only once there are rows to search and count. A chip is a filter, and a row of
            zeros over "Loading…" — or over a listing that failed — filters nothing and
            answers nothing; it is the stat band this slice exists to avoid, drawn at its
            least useful moment. The search box keeps the same company: a box that can only
            narrow nothing is a control that does nothing. Both arrive with the table they
            belong to; the title beside the box is the card's, drawn in every state. */}
        <SearchRow title="Attached to this shop">
          {loading || loadError ? null : (
            <SearchField label="Search by name or email" onChange={setQuery} value={query} />
          )}
        </SearchRow>
        {loading || loadError ? null : (
          <FilterChips
            legend="Filter customers"
            chips={chips}
            selected={filter}
            onSelect={setFilter}
          />
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
                    {profile.persona_traits.length === 0 ? "—" : profile.persona_traits.join(" · ")}
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
        <RemovalNotice removal={removal} />
      </section>
    </>
  );
}

/**
 * `/shops/:shopId/customers/new` — the profile, authored on a page
 * (`Workspace.dc.html`:1333).
 *
 * The four things that constrain what follows: who the customer is, how they are addressed,
 * and since when. The address book and the persona the prototype also draws here belong to
 * the editor this lands in — *A create form asks for what constrains the work that follows
 * and names where the rest lives* — and the profile's publish gate names both the moment the
 * operator arrives there.
 */
export function NewCustomerPage() {
  const { shopId, listings, content } = useShopWorkspace();
  const navigate = useNavigate();
  const formId = useId();
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [email, setEmail] = useState("");
  // The shop's own locale: a customer of a shop writes in its language until they are said to
  // write in another (ADR 0064).
  const [locale, setLocale] = useState(content.identity.locale);
  // Today on the operator's own calendar, which a date field shows and takes (ADR 0064).
  const [customerSince, setCustomerSince] = useState(todayInput);

  const displayName = [givenName.trim(), familyName.trim()].filter(Boolean).join(" ");
  const blockedBy =
    givenName.trim() === "" || familyName.trim() === ""
      ? "The profile needs a given name and a family name."
      : email.trim() === ""
        ? "The profile needs an email address: it is what identifies it wherever it is reused."
        : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedBy !== undefined) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    let profileId: string;
    try {
      const created = await createCustomerProfile({
        identity: {
          given_name: givenName,
          family_name: familyName,
          email,
          locale,
          phone: null,
        },
        customer_since: customerSince,
        shop_id: shopId,
      });
      profileId = created.profile_id;
    } catch (cause: unknown) {
      setCreateError(describeApiError(cause, "The profile could not be created."));
      setCreating(false);
      return;
    }
    // This shop now has a customer it did not have, so the listing the rail counts and the
    // index renders is read again before the operator lands in the editor (ADR 0056).
    await listings.customers.refresh();
    navigate(`/shops/${shopId}/customers/${profileId}`);
  }

  return (
    <CreatePage
      backTo={`/shops/${shopId}/customers`}
      backLabel="Customers"
      breadcrumb="creating a profile"
      title={displayName}
      untitled="New customer"
      formId={formId}
      createLabel="Create profile"
      creating={creating}
      creatingLabel="Creating…"
      blockedBy={blockedBy}
      error={createError}
    >
      <form id={formId} className="grid gap-4" onSubmit={submit}>
        <Card title="Identity">
          <FieldRows>
            <Field label="Given name" hint={CUSTOMER_NAME_RULE}>
              <input
                className={`${fieldControlClasses} w-full`}
                value={givenName}
                required
                placeholder="Maya"
                onChange={(event) => setGivenName(event.target.value)}
              />
            </Field>
            <Field label="Family name" hint={CUSTOMER_NAME_RULE}>
              <input
                className={`${fieldControlClasses} w-full`}
                value={familyName}
                required
                placeholder="Laurent"
                onChange={(event) => setFamilyName(event.target.value)}
              />
            </Field>
            <Field label="Email" hint={CUSTOMER_EMAIL_RULE}>
              <input
                className={`${fieldControlClasses} w-full`}
                type="email"
                value={email}
                required
                placeholder="maya.laurent@example.org"
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Customer since" hint={CUSTOMER_SINCE_RULE}>
              <input
                className={`${fieldControlClasses} w-full`}
                type="date"
                value={customerSince}
                required
                onChange={(event) => setCustomerSince(event.target.value)}
              />
            </Field>
            <LocaleField arrangement="row" value={locale} required onChange={setLocale} />
          </FieldRows>
        </Card>

        <Card title="What happens next">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            Every customer is fictional. The profile is created attached to this shop and
            unpublished: the address book and the behavioral persona are authored in the editor, and
            the publish gate names both until they are there.
          </p>
        </Card>
      </form>
    </CreatePage>
  );
}
