import type { SupportChannel, TicketSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { describeApiError } from "../api/client";
import { createTicket } from "../api/tickets";
import { ButtonIcon } from "../components/ButtonIcon";
import { CreatePage } from "../components/CreatePage";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { TicketStatusBadge } from "../components/TicketStatusBadge";
import { Card, PageHeader, PublicationPill } from "../components/WorkspaceChrome";
import { nextReference, SLUG_MAX_LENGTH } from "../lib/entryIds";
import { alreadyTakenMessage, REFERENCE_PATTERN, TICKET_REFERENCE_RULE } from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import { onlyChoiceNote, useSingleChoice } from "../lib/singleChoice";
import { channelLabel, originLabel } from "../lib/tickets";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

/** Completes "{reference} is already {…}." wherever a ticket reference is refused. */
const TICKET_REFERENCE_TAKEN_PLACE = "used by a ticket in this shop";

type Filter = "all" | "published" | "draft" | "open" | "resolved";

/**
 * The index's chips: All, the published subset and *Never published*, which every index whose
 * listing carries a published version draws, then the ticket's own two statuses.
 *
 * The prototype draws no chips on Tickets — its list is a column of the helpdesk — so these are
 * the ones the listing can count: `TicketSummarySchema` carries `latest_published_version` and
 * `status`, and nothing else a subset could be read off. Open and Resolved take the check — the
 * `published` kind, the classifier's `ok` (`lib/ui.ts`) — which is what the prototype's own
 * classifier (`filterKind`, `Workspace.dc.html` :5568) gives every label it does not otherwise
 * place, and what Orders' *Open* already takes.
 */
const FILTERS: FilterChipDefinition<Filter, TicketSummarySchema>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  {
    id: "published",
    label: "Published",
    kind: "published",
    matches: (ticket) => ticket.latest_published_version !== null,
  },
  {
    id: "draft",
    label: "Never published",
    kind: "draft",
    matches: (ticket) => ticket.latest_published_version === null,
  },
  { id: "open", label: "Open", kind: "published", matches: (ticket) => ticket.status === "open" },
  {
    id: "resolved",
    label: "Resolved",
    kind: "published",
    matches: (ticket) => ticket.status === "resolved",
  },
];

/**
 * `/shops/:shopId/tickets` — the shop's incidents, as every other index lists what it holds
 * (ADR 0073).
 *
 * The listing is the one the rail counts, read once by the shop's shell (ADR 0056), so the All
 * chip and the rail's figure are one number. Nothing here opens a ticket on the operator's
 * behalf: the index is where they choose one.
 */
export function TicketsPage() {
  const { shopId, listings } = useShopWorkspace();
  const tickets = listings.tickets.rows;
  const loading = listings.tickets.loading;
  const listError = listings.tickets.error;
  const customers = listings.customers;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  // Subject, reference and customer: what an operator knows an incident by.
  const { chips, visible } = filterList(tickets, FILTERS, filter, {
    query,
    fields: (ticket) => [ticket.subject, ticket.reference, ticket.customer_display_name],
  });

  const noCustomer = !customers.loading && customers.error === null && customers.rows.length === 0;

  return (
    <>
      <PageHeader
        title="Tickets"
        description="One customer's incident each: the history a run is handed and the first message every arm receives. A scenario is built on a published ticket."
        actions={
          <Link className={accentButtonClasses} to="new">
            <ButtonIcon verb="create" />
            New ticket
          </Link>
        }
      />

      <section className={`${surfaceClasses} overflow-hidden`}>
        {/* A failed or unfinished listing draws no search and no chips: a box and a row of
            zeros over nothing narrow nothing, and a chip's figure is the listing's. */}
        <SearchRow title="Raised in this shop">
          {loading || listError ? null : (
            <SearchField
              label="Search by subject, reference or customer"
              onChange={setQuery}
              value={query}
            />
          )}
        </SearchRow>
        {loading || listError ? null : (
          <FilterChips
            legend="Filter tickets"
            chips={chips}
            selected={filter}
            onSelect={setFilter}
          />
        )}
        {listError ? (
          // Its failure and nothing else: a listing that could not be read has not said the
          // shop holds no ticket.
          <p role="alert" className="p-4 text-[13px] text-lab-error">
            {listError}
          </p>
        ) : loading ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading tickets…</p>
        ) : tickets.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            No ticket in this shop yet. A ticket is raised by a customer attached to this shop
            {noCustomer ? (
              <>
                , and none is attached yet —{" "}
                <Link
                  className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                  to={`/shops/${shopId}/customers`}
                >
                  attach or create one in Customers
                </Link>
                .
              </>
            ) : (
              "."
            )}
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">No ticket matches this view.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={tableHeadClasses}>Ticket</th>
                <th className={tableHeadClasses}>Customer</th>
                <th className={tableHeadClasses}>Channel</th>
                <th className={tableHeadClasses}>Status</th>
                <th className={tableHeadClasses}>Published</th>
                <th className={tableHeadClasses}>Draft updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ticket) => (
                <tr key={ticket.ticket_id}>
                  <td className={tableCellClasses}>
                    <Link
                      className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                      to={`/shops/${shopId}/tickets/${ticket.ticket_id}`}
                    >
                      {ticket.subject}
                    </Link>
                    <div className="font-mono text-[12px] text-admin-muted">{ticket.reference}</div>
                  </td>
                  <td className={tableCellClasses}>{ticket.customer_display_name}</td>
                  <td className={tableCellClasses}>
                    {channelLabel(ticket.channel)}
                    <div className="text-admin-muted">from {originLabel(ticket.origin_kind)}</div>
                  </td>
                  <td className={tableCellClasses}>
                    <TicketStatusBadge status={ticket.status} />
                  </td>
                  <td className={tableCellClasses}>
                    <PublicationPill record={ticket} />
                  </td>
                  <td className={tableCellClasses}>{formatTimestamp(ticket.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/**
 * `/shops/:shopId/tickets/new` — a ticket, opened on a page (ADR 0073).
 *
 * The four things the lab fixes or asks at creation: the incident's subject, the customer who
 * raised it — fixed for good (ADR 0016, *The customer is fixed at creation*) — the channel it
 * arrived on and the reference scenarios name it by. The thread is the editor's: a ticket is
 * created with no message, and the publish gate names the first message until it is written.
 */
export function NewTicketPage() {
  const { shopId, listings, content } = useShopWorkspace();
  const navigate = useNavigate();
  const formId = useId();
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [channel, setChannel] = useState<SupportChannel>(content.identity.channels[0] ?? "chat");
  const [reference, setReference] = useState("");

  const ticketsLoading = listings.tickets.loading;
  const ticketsError = listings.tickets.error;
  const taken = listings.tickets.rows.map((ticket) => ticket.reference);
  // The same attached profiles the Customers index lists and the rail counts.
  const customers = listings.customers.rows;
  // One attached customer is not a choice (ADR 0064).
  const onlyCustomer = useSingleChoice(
    customers.map((customer) => customer.profile_id),
    customerId,
    setCustomerId,
  );
  const loading = ticketsLoading || listings.customers.loading;

  // The next free reference, once the listing that decides which is free has answered — and
  // not while a create is on its way, whose re-read is about to move it. A listing that
  // *failed* suggests nothing, and the field stays open so a ticket can be named by hand.
  const suggestedReference =
    ticketsLoading || ticketsError !== null || creating ? "" : nextReference("T", taken);

  // Why Create will not go, in the order the operator meets the questions (ADR 0063).
  const blockedBy = loading
    ? "Reading what this shop already holds…"
    : customers.length === 0
      ? listings.customers.error !== null
        ? "The customers attached to this shop could not be read, and a ticket is raised by one of them."
        : "Attach a customer to this shop first — a ticket is raised by a customer the shop has."
      : subject.trim() === ""
        ? "The ticket needs a subject: the incident as the customer would describe it."
        : customerId === ""
          ? "Choose the customer who raised the ticket."
          : reference === ""
            ? "The ticket needs a reference before it can be created."
            : taken.includes(reference)
              ? alreadyTakenMessage(reference, TICKET_REFERENCE_TAKEN_PLACE)
              : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The button already refuses this; a submission that arrives some other way does too.
    if (blockedBy !== undefined || creating) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    let ticketId: string;
    try {
      const created = await createTicket(shopId, {
        reference,
        subject: subject.trim(),
        customer_profile_id: customerId,
        channel,
      });
      ticketId = created.ticket_id;
    } catch (cause: unknown) {
      setCreateError(describeApiError(cause, "The ticket could not be created."));
      setCreating(false);
      return;
    }
    // This shop now holds a ticket it did not, so the listing the rail counts and the index
    // renders is read again before the operator lands in the editor (ADR 0056). A read that
    // fails says so on the index; the ticket exists and is opened all the same.
    await listings.tickets.refresh();
    navigate(`/shops/${shopId}/tickets/${ticketId}`);
  }

  return (
    <CreatePage
      backTo={`/shops/${shopId}/tickets`}
      backLabel="Tickets"
      breadcrumb="opening an incident"
      title={subject.trim()}
      untitled="New ticket"
      formId={formId}
      createLabel="Create ticket"
      creating={creating}
      creatingLabel="Creating…"
      blockedBy={blockedBy}
      error={createError ?? ticketsError}
    >
      <form id={formId} className="grid gap-4" onSubmit={submit}>
        <Card title="Incident">
          <FieldRows>
            <Field label="Subject" hint="The incident as the customer would describe it.">
              <input
                className={`${fieldControlClasses} w-full`}
                value={subject}
                required
                placeholder="Wrong address concern"
                onChange={(event) => setSubject(event.target.value)}
              />
            </Field>
            <Field
              label="Customer"
              hint={`Only customers attached to this shop can raise a ticket here. The customer is fixed at creation.${onlyCustomer ? ` ${onlyChoiceNote("customer attached to this shop")}` : ""}`}
            >
              <select
                className={`${fieldControlClasses} w-full`}
                value={customerId}
                required
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Select a customer</option>
                {customers.map((customer) => (
                  <option key={customer.profile_id} value={customer.profile_id}>
                    {customer.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Channel"
              hint="The channel the incident arrived on. Must be one the shop accepts."
            >
              <select
                className={`${fieldControlClasses} w-full`}
                value={channel}
                onChange={(event) => setChannel(event.target.value as SupportChannel)}
              >
                {content.identity.channels.map((entry) => (
                  <option key={entry} value={entry}>
                    {channelLabel(entry)}
                  </option>
                ))}
              </select>
            </Field>
            <DerivedIdField
              arrangement="row"
              label="Reference"
              hint={TICKET_REFERENCE_RULE}
              value={reference}
              suggested={suggestedReference}
              // Only while a suggestion is on its way: the listing, or a create whose re-read is
              // about to change which reference is free.
              pending={ticketsLoading || creating}
              taken={taken}
              takenPlace={TICKET_REFERENCE_TAKEN_PLACE}
              pattern={REFERENCE_PATTERN}
              maxLength={SLUG_MAX_LENGTH}
              title={TICKET_REFERENCE_RULE}
              placeholder="T-2042"
              required
              normalize={(value) => value.toUpperCase()}
              onChange={setReference}
            />
          </FieldRows>
        </Card>

        <Card title="Created as a draft">
          <p className="text-[13px] leading-relaxed text-admin-ink-soft">
            The ticket is created unpublished and with no message. Its thread is written in the
            editor this lands in: the prior support history, and the first message every arm
            receives at experiment start — the publish gate names it until it is there. Live replies
            are never written here; they happen on the bench, per run.
          </p>
        </Card>
      </form>
    </CreatePage>
  );
}
