import type {
  ShopDocumentKind,
  SupportChannel,
  TicketAuthor,
  TicketContentSchema,
  TicketContextSchema,
  TicketOriginKind,
  TicketPreviewResponse,
  TicketStatus,
  TicketSummarySchema,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import {
  createTicket,
  getTicketContext,
  getTicketDraft,
  previewTicketDraft,
  publishTicket,
  replaceTicketDraft,
} from "../api/tickets";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipListField } from "../components/ChipListField";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import {
  Card,
  EditorSaveActions,
  Fingerprint,
  HeaderReport,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  StatusPill,
  VersionChips,
} from "../components/WorkspaceChrome";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { nextReference } from "../lib/entryIds";
import { optionsOf, TICKET_ORIGIN_KIND, TICKET_STATUS } from "../lib/enumLabels";
import {
  alreadyTakenMessage,
  REFERENCE_PATTERN,
  TICKET_REFERENCE_RULE,
  TICKET_TAG_MAX_LENGTH,
  TICKET_TAGS_RULE,
} from "../lib/fieldRules";
import { fromLocalInput, fulfilmentLabel, paymentLabel, toLocalInput } from "../lib/orders";
import { consequenceOf, REMOVAL_FINDINGS, type Removal, useRemoval } from "../lib/removal";
import { onlyChoiceNote, useSingleChoice } from "../lib/singleChoice";
import { clearStickyHeader, stickyInsetHeaderClasses } from "../lib/stickyHeader";
import {
  appendMessage,
  authorLabel,
  channelLabel,
  documentKindLabel,
  initials,
  messageDay,
  messageTime,
  normalizeTag,
  originLabel,
  originNeedsOrder,
  originNeedsProduct,
  productTitle,
  removeMessage,
  retargetOrigin,
  statusLabel,
  toTicketRequest,
  unresolvedDocuments,
} from "../lib/tickets";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  subtleButtonClasses,
  surfaceClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const UNAVAILABLE = "The ticket service is unavailable.";

/** Completes "{reference} is already {…}." wherever a ticket reference is refused. */
const TICKET_REFERENCE_TAKEN_PLACE = "used by a ticket in this shop";

type Filter = "open" | "resolved" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

/**
 * The two closed sets this page picks from, read from the contract-held tables rather than
 * retyped, so a member the contract gains reaches the select instead of being left out of it.
 */
const TICKET_STATUSES = optionsOf(TICKET_STATUS);

const ORIGIN_KINDS = optionsOf(TICKET_ORIGIN_KIND);

function matches(ticket: TicketSummarySchema, filter: Filter): boolean {
  return filter === "all" || ticket.status === filter;
}

/**
 * Frame 3 — the helpdesk workspace: ticket list, conversation thread, context panel.
 *
 * The composer authors *history*, not live replies: a run's conversation happens on the
 * Bench, one independent thread per arm. That is why the role switch offers "as the
 * customer" and "as a past support agent" and nothing else.
 */
export function TicketsPage() {
  // The listing this page renders is the one the rail counts, read once by the shop's shell
  // and read again here whenever this page changes what it lists (ADR 0056).
  const { shopId, listings } = useShopWorkspace();
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const tickets = listings.tickets.rows;
  const loading = listings.tickets.loading;
  const listError = listings.tickets.error;
  const [filter, setFilter] = useState<Filter>("all");
  /** The ticket a create on this page is opening, while its navigation is in flight. */
  const opening = useRef<string | null>(null);

  const reload = listings.tickets.refresh;

  const visible = useMemo(
    () => tickets.filter((ticket) => matches(ticket, filter)),
    [tickets, filter],
  );

  // Stable, because the editor beside the list builds its guard from it: an `onSaved` rebuilt
  // every render would rebuild the guard, and with it the editor's own `save`.
  const onTicketSaved = useCallback(() => {
    void reload();
  }, [reload]);

  // The list is a way in rather than a waiting room: an operator who opens Tickets is shown the
  // one they touched last instead of an empty pane telling them to pick something. Only when no
  // ticket is named — a reader who navigated to one, or who filtered until nothing matched, is
  // not moved — and `replace`, so the way back out is the page they came from and not this
  // redirect happening again.
  //
  // It must also stay out of the way of a ticket this page has just created, which the create
  // opens itself. The effect is scheduled from the render that the reloaded list produces, and
  // in that render `ticketId` is still undefined even though the create's navigation is already
  // on its way — so without `opening` it fires every single time a ticket is created and sends a
  // second navigation after the first. A ref rather than state, because an effect cannot read a
  // flag it is racing; the effect clears it as soon as a ticket is named.
  useEffect(() => {
    if (ticketId !== undefined) {
      opening.current = null;
      return;
    }
    if (opening.current !== null || loading || visible.length === 0) {
      return;
    }
    const latest = visible.reduce((newest, ticket) =>
      ticket.updated_at > newest.updated_at ? ticket : newest,
    );
    navigate(`/shops/${shopId}/tickets/${latest.ticket_id}`, { replace: true });
  }, [ticketId, loading, visible, navigate, shopId]);

  return (
    <>
      {/* The page's own header, spanning the list and the ticket beside it, with the count
          the frame draws under the title (`Workspace.dc.html` :2174) — the whole listing, as
          the rail counts it, and absent while that listing is in flight or failed (*Lists and
          counts*). The frame puts the two lines at the head of the list column; here they are
          the page header every other surface has, so the title and the tour control sit where
          they sit everywhere else, and the list below it no longer names itself a second time. */}
      <PageHeader
        title="Tickets"
        description={loading || listError ? undefined : `${tickets.length} in this shop`}
      />
      <div className="grid min-h-0 gap-4 xl:grid-cols-[262px_minmax(0,1fr)]">
        <section className={`${surfaceClasses} overflow-hidden`} aria-label="Tickets">
          <div className="flex items-center gap-2 border-b border-admin-border px-3 py-2.5">
            <label className="text-xs">
              <span className="sr-only">Filter tickets</span>
              <select
                aria-label="Filter tickets"
                className="h-7 rounded-md border border-admin-border bg-admin-surface px-1.5 text-[12px] font-semibold text-admin-ink-soft"
                value={filter}
                onChange={(event) => setFilter(event.target.value as Filter)}
              >
                {FILTERS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} ({tickets.filter((ticket) => matches(ticket, entry.id)).length})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {listError ? (
            <p role="alert" className="p-3 text-[13px] text-lab-error">
              {listError}
            </p>
          ) : null}

          {loading ? (
            <p className="p-3 text-[13px] text-admin-muted">Loading tickets…</p>
          ) : visible.length === 0 ? (
            <p className="p-3 text-[13px] text-admin-muted">
              No ticket here yet. A ticket is one customer's incident — a scenario is built on it.
            </p>
          ) : (
            <ul className="grid">
              {visible.map((ticket) => (
                <li key={ticket.ticket_id}>
                  <Link
                    // Absolute, like every other link out of this page. `relative="path"` ties
                    // a link to how many segments the URL happens to have: this one resolved
                    // correctly from `/shops/X/tickets` and, once a ticket was open, sent the
                    // operator to `/shops/X/tickets/tickets/…` — out of the shop entirely.
                    to={`/shops/${shopId}/tickets/${ticket.ticket_id}`}
                    className={`grid gap-1 border-b border-admin-border/60 px-3 py-2.5 text-[13px] no-underline ${
                      ticket.ticket_id === ticketId ? "bg-[#e8f0ed]" : "hover:bg-admin-canvas"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-admin-border text-[10px] font-bold text-admin-ink-soft">
                        {initials(ticket.customer_display_name)}
                      </span>
                      <span className="font-semibold text-lab-ink">
                        {ticket.customer_display_name}
                      </span>
                      <span className="ml-auto text-[11px] text-admin-muted">
                        {ticket.opened_at ? messageDay(ticket.opened_at).slice(5) : "—"}
                      </span>
                    </div>
                    <div className="font-semibold text-admin-ink">{ticket.subject}</div>
                    <div className="truncate text-admin-muted">{ticket.preview}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-admin-muted">
                      <StatusBadge status={ticket.status} />
                      <span>{channelLabel(ticket.channel).toLowerCase()}</span>
                      <span>·</span>
                      <span>{originLabel(ticket.origin_kind)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <NewTicketForm
            shopId={shopId}
            taken={tickets.map((ticket) => ticket.reference)}
            ready={!loading && !listError}
            loading={loading}
            onCreated={async (created) => {
              opening.current = created;
              await reload();
              navigate(`/shops/${shopId}/tickets/${created}`);
            }}
          />
        </section>

        {ticketId ? (
          <TicketWorkspace shopId={shopId} ticketId={ticketId} onSaved={onTicketSaved} />
        ) : (
          <p className="text-[13px] text-admin-muted">
            {loading ? "Loading tickets…" : "No tickets yet. Open one to start an incident."}
          </p>
        )}
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-admin-border/60 px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
      <span aria-hidden>{status === "open" ? "◐" : "●"}</span> {statusLabel(status)}
    </span>
  );
}

function NewTicketForm({
  shopId,
  taken,
  ready,
  loading,
  onCreated,
}: {
  shopId: string;
  taken: readonly string[];
  /** The list has been read, so which references are free is known. */
  ready: boolean;
  /** The list is still coming: the reference field waits for it rather than being typed into. */
  loading: boolean;
  onCreated: (ticketId: string) => Promise<void>;
}) {
  const { content, listings } = useShopWorkspace();
  const [reference, setReference] = useState("");
  const [subject, setSubject] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [channel, setChannel] = useState<SupportChannel>(content.identity.channels[0] ?? "chat");
  // The same attached profiles the Customers index lists and the rail counts. The picker
  // simply stays empty when that listing failed; the form explains why below.
  const customers = listings.customers.rows.map((profile) => ({
    id: profile.profile_id,
    name: profile.display_name,
  })); // One attached customer is not a choice (ADR 0064).
  const onlyCustomer = useSingleChoice(
    customers.map((customer) => customer.id),
    customerId,
    setCustomerId,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A create in flight is about to change the list, so which reference is free is unknown
  // again until the reload it triggers lands — the same state the page opens in, down to the
  // field being nobody's, and closed the same way. `busy` spans the create *and* the reload,
  // which `reload` itself does not report through `loading`.
  const settling = loading || busy;
  const suggestedReference = ready && !busy ? nextReference("T", taken) : "";

  // "The ticket needs a reference" is only true while one is still being worked out. Once the
  // list lands the field holds one, and an alert that outlived its own reason is worse than no
  // alert at all. A create failure is set long after this has settled, so it survives.
  useEffect(() => {
    if (!loading) {
      setError(null);
    }
  }, [loading]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Said rather than swallowed. The field's own `required` and custom validity hold both of
    // these back most of the time — but not while it is disabled, which bars it from
    // constraint validation altogether, and not in the commit where it holds a suggestion this
    // form has not been told about yet. Returning in silence there left "Open ticket" doing
    // nothing at all, with nothing on screen to explain it.
    if (!reference) {
      setError("The ticket needs a reference before it can be opened.");
      return;
    }
    if (taken.includes(reference)) {
      setError(alreadyTakenMessage(reference, TICKET_REFERENCE_TAKEN_PLACE));
      return;
    }
    setBusy(true);
    setError(null);
    let createdId: string;
    try {
      const created = await createTicket(shopId, {
        reference,
        subject,
        customer_profile_id: customerId,
        channel,
      });
      setReference("");
      setSubject("");
      createdId = created.ticket_id;
    } catch (cause: unknown) {
      setError(describeApiError(cause, "The ticket could not be opened."));
      setBusy(false);
      return;
    }
    try {
      await onCreated(createdId);
    } catch {
      // The ticket exists. Listing and navigation errors must not read as a failed open.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid gap-2 border-t border-admin-border p-3" onSubmit={submit}>
      <h2 className="text-xs font-bold tracking-wide text-admin-muted uppercase">New ticket</h2>
      <FieldHint label="Subject" hint="The incident as the customer would describe it.">
        <input
          className={`${fieldControlClasses} w-full`}
          value={subject}
          required
          placeholder="Wrong address concern"
          onChange={(event) => setSubject(event.target.value)}
        />
      </FieldHint>
      <FieldHint
        label="Customer"
        hint={`Only customers attached to this shop can raise a ticket here.${onlyCustomer ? ` ${onlyChoiceNote("customer attached to this shop")}` : ""}`}
      >
        <select
          className={`${fieldControlClasses} w-full`}
          value={customerId}
          required
          onChange={(event) => setCustomerId(event.target.value)}
        >
          <option value="">Select a customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </FieldHint>
      <FieldHint
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
      </FieldHint>
      <DerivedIdField
        label="Reference"
        hint={TICKET_REFERENCE_RULE}
        value={reference}
        suggested={suggestedReference}
        // Only while a suggestion is on its way. A list that *failed* leaves none to wait for,
        // and the field stays usable so a ticket can still be named by hand.
        pending={settling}
        taken={taken}
        takenPlace={TICKET_REFERENCE_TAKEN_PLACE}
        pattern={REFERENCE_PATTERN}
        title={TICKET_REFERENCE_RULE}
        placeholder="T-2042"
        required
        normalize={(value) => value.toUpperCase()}
        onChange={setReference}
      />
      {error ? (
        <p role="alert" className="text-[12px] text-lab-error">
          {error}
        </p>
      ) : null}
      <button className={accentButtonClasses} type="submit" disabled={busy}>
        <ButtonIcon verb="save" />
        {busy ? "Opening…" : "Open ticket"}
      </button>
      <p className="text-xs text-admin-muted">The first message is authored in the thread.</p>
    </form>
  );
}

function TicketWorkspace({
  shopId,
  ticketId,
  onSaved,
}: {
  shopId: string;
  ticketId: string;
  onSaved: () => void;
}) {
  // Memoized on the shop, not rebuilt per render: the client is a dependency of the
  // editor's load effect, and a new object each render would reload the draft forever.
  const client = useMemo<
    DefinitionClient<TicketContentSchema, ReturnType<typeof toTicketRequest>, TicketPreviewResponse>
  >(
    () => ({
      getDraft: (id, signal) => getTicketDraft(shopId, id, signal),
      previewDraft: (id, signal) => previewTicketDraft(shopId, id, signal),
      replaceDraft: (id, payload) => replaceTicketDraft(shopId, id, payload),
      publish: (id) => publishTicket(shopId, id),
      toPayload: toTicketRequest,
      unavailable: UNAVAILABLE,
    }),
    [shopId],
  );
  const [context, setContext] = useState<TicketContextSchema | null>(null);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

  const refreshContext = useCallback(
    async (signal?: AbortSignal) => {
      setContext(await getTicketContext(shopId, ticketId, signal));
    },
    [shopId, ticketId],
  );

  // Two reads follow a saved ticket: the context panel beside the thread, and the list this
  // editor sits next to. They belong to the editor rather than to its Save button, because the
  // navigation prompt saves this draft too — and unlike the shop switcher it does not need the
  // operator to leave the page to go stale, since the list and the related-ticket links move
  // between tickets inside this one.
  const guard = useMemo(
    () => ({
      label: "The ticket draft has unsaved changes.",
      afterSave: async () => {
        // The panel is context, not content: a panel that cannot be re-read never turns a
        // successful save into anything the operator has to answer.
        await refreshContext().catch(() => {});
        onSaved();
      },
    }),
    [refreshContext, onSaved],
  );
  const publishReasonsId = useId();
  const editor = useDefinitionEditor(ticketId, client, guard);
  const { content, preview, edit } = editor;

  useEffect(() => {
    const controller = new AbortController();
    setPublishedVersion(null);
    refreshContext(controller.signal).catch(() => {
      // The thread stays usable; the panel is context, not content.
    });
    return () => controller.abort();
  }, [refreshContext]);

  if (editor.loading) {
    return <p className="text-sm text-admin-muted">Loading ticket…</p>;
  }

  if (!content) {
    return (
      <div role="alert" className="text-sm text-lab-error">
        {editor.error ?? "This ticket could not be loaded."}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-4">
        {/* The ticket's own header, pinned like every editor's and what its actions report
            said beside them. It is held within this column, so Save and Publish stay in reach
            down the thread — and down the whole page only at 2xl, where the context panel
            stands beside the column rather than under it (ADR 0066). */}
        <header ref={clearStickyHeader} className={`${stickyInsetHeaderClasses} grid gap-2`}>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* The thread's own subject, the one heading the prototype draws between a
                page title and a card title: Georgia 19px 700, no tracking
                (`Workspace.dc.html`:2200). */}
            <h2 className="font-display text-[19px] font-bold">
              {content.reference} · {content.subject}
            </h2>
            <StatusBadge status={content.status} />
            <VersionChips preview={preview} />
            <div className="ml-auto flex items-center gap-2">
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
                onPublish={() => {
                  void editor.publish().then((version) => setPublishedVersion(version));
                }}
              />
            </div>
          </div>
          <HeaderReport>
            {editor.error ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {editor.error}
              </p>
            ) : null}
            {publishedVersion !== null ? (
              <p role="status" className="text-[13px] text-lab-success">
                Published version {publishedVersion}. A scenario built on this ticket freezes this
                exact version.
              </p>
            ) : null}
            <PublishReasons
              id={publishReasonsId}
              preview={preview}
              dirty={editor.dirty}
              checking={editor.checking}
            />
          </HeaderReport>
          <p className="text-[13px] text-admin-muted">
            {channelLabel(content.channel)} · from {originLabel(content.origin.kind)}
            {content.origin.product_handle ? (
              <>
                {" "}
                <OriginProduct handle={content.origin.product_handle} context={context} />
              </>
            ) : null}
            {preview ? (
              <>
                {" "}
                · draft fingerprint <Fingerprint value={preview.content_fingerprint} />
              </>
            ) : null}
          </p>
        </header>

        <Thread
          scope={ticketId}
          content={content}
          customerName={context?.customer.display_name ?? "Customer"}
          onEdit={edit}
        />

        <Card title="Validation">
          <IssueList issues={preview?.issues ?? []} />
        </Card>
      </div>

      <ContextPanel shopId={shopId} content={content} context={context} onEdit={edit} />
    </div>
  );
}

/** Why *Add to thread* is refused with no message typed. */
const THREAD_BODY_EMPTY = "Write the message before adding it to the thread.";

/** Why *Add to thread* is refused once the time is cleared: the thread is ordered by it. */
const THREAD_SENT_AT_EMPTY = "Give the message the time it was sent; the thread is ordered by it.";

function Thread({
  scope,
  content,
  customerName,
  onEdit,
}: {
  /** The ticket, so a confirm never follows the operator to another one. */
  scope: string;
  content: TicketContentSchema;
  customerName: string;
  onEdit: (next: TicketContentSchema) => void;
}) {
  const [author, setAuthor] = useState<TicketAuthor>("customer");
  const [body, setBody] = useState("");
  const [sentAt, setSentAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [refused, setRefused] = useState<string | null>(null);
  const removal = useRemoval(scope);
  const addReasonId = useId();
  const instant = fromLocalInput(sentAt);
  // Why *Add to thread* will not go (ADR 0063): said beside it, not left to a press that
  // silently does nothing. Neither field can say it — an empty box and a cleared time are
  // both valid states of those controls.
  const addRefusal =
    body.trim() === "" ? THREAD_BODY_EMPTY : instant === null ? THREAD_SENT_AT_EMPTY : null;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addRefusal !== null || instant === null) {
      return;
    }
    const addition = appendMessage(content, author, body.trim(), instant);
    if (!addition.ok) {
      setRefused(addition.reason);
      return;
    }
    setRefused(null);
    onEdit(addition.content);
    setBody("");
  }

  return (
    <section className={`${surfaceClasses} overflow-hidden`} aria-label="Ticket thread">
      <div className="grid gap-3 p-4">
        {content.history.length > 0 ? (
          <Divider label={`${messageDay(content.history[0].sent_at)} · prior support history`} />
        ) : null}
        {content.history.map((entry) =>
          removal.isArmed(entry.id) ? (
            <ConfirmRemove
              key={entry.id}
              title={`Remove the message from ${messageAuthor(entry.author, customerName)} at ${messageTime(entry.sent_at)}?`}
              consequence="It leaves the prior support history every arm is handed with this ticket. Nothing is written until you save the ticket, and a published version keeps it."
              onConfirm={removal.confirm(
                () => onEdit(removeMessage(content, entry.id)),
                removedMessage(entry.author, customerName, entry.sent_at),
              )}
              onKeep={removal.keep}
            />
          ) : (
            <Bubble
              key={entry.id}
              id={entry.id}
              author={entry.author}
              customerName={customerName}
              body={entry.body}
              sentAt={entry.sent_at}
              removal={removal}
              onRemove={() => onEdit(removeMessage(content, entry.id))}
            />
          ),
        )}

        <Divider label="Trigger — sent to every arm at experiment start" strong />
        {content.trigger && removal.isArmed(content.trigger.id) ? (
          <ConfirmRemove
            title={`Remove the first message, from ${messageAuthor(content.trigger.author, customerName)} at ${messageTime(content.trigger.sent_at)}?`}
            consequence={consequenceOf(
              REMOVAL_FINDINGS.ticket_without_trigger,
              "Nothing is written until you save the ticket, and a published version keeps it.",
            )}
            onConfirm={removal.confirm(
              () => onEdit(removeMessage(content, content.trigger?.id ?? "")),
              removedMessage(content.trigger.author, customerName, content.trigger.sent_at),
            )}
            onKeep={removal.keep}
          />
        ) : content.trigger ? (
          <Bubble
            id={content.trigger.id}
            author={content.trigger.author}
            customerName={customerName}
            body={content.trigger.body}
            sentAt={content.trigger.sent_at}
            badge="first message"
            removal={removal}
            onRemove={() => onEdit(removeMessage(content, content.trigger?.id ?? ""))}
          />
        ) : (
          <p className="text-[13px] text-admin-muted">
            No first message yet. A published ticket must carry the message every arm receives.
          </p>
        )}
        <RemovalNotice removal={removal} />
        <p className="text-xs text-admin-muted">
          Replies happen on the live bench, per run — each arm answers this message independently.
        </p>
      </div>

      <form className="grid gap-2 border-t border-admin-border p-4" onSubmit={add}>
        <div className="flex flex-wrap items-center gap-2">
          {(["customer", "support_agent"] as TicketAuthor[]).map((role) => (
            <button
              key={role}
              type="button"
              aria-pressed={author === role}
              className={
                author === role
                  ? `${subtleButtonClasses} border-lab-ink bg-[#e8f0ed] text-lab-ink`
                  : subtleButtonClasses
              }
              onClick={() => setAuthor(role)}
            >
              {role === "customer" ? `as ${customerName}` : "as past support"}
            </button>
          ))}
          <label className="ml-auto text-xs font-semibold text-admin-muted">
            <span className="sr-only">Sent at</span>
            <input
              aria-label="Sent at"
              type="datetime-local"
              className="h-8 rounded-md border border-admin-border bg-admin-surface px-2 text-[12px]"
              value={sentAt}
              onChange={(event) => setSentAt(event.target.value)}
            />
          </label>
        </div>
        <textarea
          aria-label="Add a history message"
          className={`${textAreaClasses} w-full`}
          placeholder="Add a history message…"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {refused ? (
          <p role="alert" className="text-xs text-lab-error">
            {refused}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <PrimaryAction
            variant="outline"
            type="submit"
            refusal={addRefusal === null ? null : { id: addReasonId, reason: addRefusal }}
          >
            <ButtonIcon verb="create" />
            Add to thread
          </PrimaryAction>
          <p className="text-xs text-admin-muted">
            Adds fixture history to this ticket — not a live reply. The newest message from the
            customer becomes the trigger.
          </p>
        </div>
        {addRefusal === null ? null : <RefusalLine id={addReasonId}>{addRefusal}</RefusalLine>}
      </form>
    </section>
  );
}

function Divider({ label, strong = false }: { label: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-[10.5px] font-bold tracking-wider uppercase ${
          strong ? "text-lab-accent" : "text-admin-muted"
        }`}
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-admin-border" />
    </div>
  );
}

/** What the thread's notice line says once a message has gone. */
function removedMessage(author: TicketAuthor, customerName: string, sentAt: string): string {
  return `Removed ${messageAuthor(author, customerName)}'s message of ${messageTime(sentAt)} from the draft.`;
}

/** Who a message is from, as the bubble names them. */
function messageAuthor(author: TicketAuthor, customerName: string): string {
  return author === "customer" ? customerName : authorLabel(author);
}

function Bubble({
  id,
  author,
  customerName,
  body,
  sentAt,
  badge,
  removal,
  onRemove,
}: {
  id: string;
  author: TicketAuthor;
  customerName: string;
  body: string;
  sentAt: string;
  badge?: string;
  /** The thread's second press (ADR 0060), which this message is armed under by its ID. */
  removal: Removal;
  onRemove: () => void;
}) {
  const name = messageAuthor(author, customerName);
  return (
    <article className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-admin-border text-[10px] font-bold text-admin-ink-soft">
        {initials(name)}
      </span>
      <div className="min-w-0 grid gap-1">
        <div className="rounded-xl rounded-tl-sm bg-admin-canvas px-3 py-2 text-[13px] leading-relaxed">
          {body}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-admin-muted">
          <span>{name}</span>
          <span>·</span>
          <span>{messageTime(sentAt)}</span>
          {badge ? (
            <span className="rounded-full bg-lab-accent/12 px-1.5 py-0.5 font-semibold text-lab-accent">
              {badge}
            </span>
          ) : null}
          <button
            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-lab-error"
            type="button"
            aria-label={`Remove message from ${name} at ${messageTime(sentAt)}`}
            ref={removal.trigger(id)}
            onClick={removal.ask(id, onRemove, removedMessage(author, customerName, sentAt))}
          >
            <ButtonIcon verb="delete" />
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * The product a product-page origin names, by its title once the context says what it is.
 *
 * Until the context arrives the handle is all there is, and it is the truth. After, a handle
 * the shop draft no longer holds is named as unresolved rather than passed off as a title.
 */
function OriginProduct({
  handle,
  context,
}: {
  handle: string;
  context: TicketContextSchema | null;
}) {
  if (context === null) {
    return <>{handle}</>;
  }
  const title = productTitle(context.resources, handle);
  if (title !== null) {
    return <>{title}</>;
  }
  return (
    <>
      <code>{handle}</code> <span className="text-lab-error">(unresolved)</span>
    </>
  );
}

function ContextPanel({
  shopId,
  content,
  context,
  onEdit,
}: {
  /** Every link out of this panel is written from the shop down, not from the current URL up. */
  shopId: string;
  content: TicketContentSchema;
  context: TicketContextSchema | null;
  onEdit: (next: TicketContentSchema) => void;
}) {
  const resolvable = new Set((context?.resources.orders ?? []).map((order) => order.order_id));
  const unresolvable = content.linked_order_ids.filter((orderId) => !resolvable.has(orderId));
  const staleDocuments = context
    ? unresolvedDocuments(content.suggested_documents, context.resources)
    : [];
  const originHandle = content.origin.product_handle;
  // A handle the shop no longer holds stays selected and says so; without an option of its
  // own the select would show "Select a product" over a value the draft still carries.
  const staleOriginHandle =
    context && originHandle !== null && productTitle(context.resources, originHandle) === null
      ? originHandle
      : null;

  function toggleDocument(kind: ShopDocumentKind, documentId: string) {
    const present = content.suggested_documents.some(
      (entry) => entry.kind === kind && entry.document_id === documentId,
    );
    onEdit({
      ...content,
      suggested_documents: present
        ? content.suggested_documents.filter(
            (entry) => !(entry.kind === kind && entry.document_id === documentId),
          )
        : [...content.suggested_documents, { kind, document_id: documentId }],
    });
  }

  function toggleOrder(orderId: string) {
    onEdit({
      ...content,
      linked_order_ids: content.linked_order_ids.includes(orderId)
        ? content.linked_order_ids.filter((entry) => entry !== orderId)
        : [...content.linked_order_ids, orderId],
    });
  }

  return (
    <aside className="grid content-start gap-4">
      <Card title="Ticket details">
        <label className={fieldLabelClasses}>
          Subject
          <input
            className={`${fieldControlClasses} w-full`}
            value={content.subject}
            onChange={(event) => onEdit({ ...content, subject: event.target.value })}
          />
        </label>
        <label className={fieldLabelClasses}>
          Status
          <select
            aria-label="Status"
            className={`${fieldControlClasses} w-full`}
            value={content.status}
            onChange={(event) => onEdit({ ...content, status: event.target.value as TicketStatus })}
          >
            {TICKET_STATUSES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Channel
          <select
            aria-label="Channel"
            className={`${fieldControlClasses} w-full`}
            value={content.channel}
            onChange={(event) =>
              onEdit({ ...content, channel: event.target.value as SupportChannel })
            }
          >
            {(context?.resources.channels ?? [content.channel]).map((entry) => (
              <option key={entry} value={entry}>
                {channelLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabelClasses}>
          Opened from
          <select
            aria-label="Opened from"
            className={`${fieldControlClasses} w-full`}
            value={content.origin.kind}
            onChange={(event) =>
              onEdit({
                ...content,
                origin: retargetOrigin(event.target.value as TicketOriginKind, content.origin),
              })
            }
          >
            {ORIGIN_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        {originNeedsProduct(content.origin.kind) ? (
          <label className={fieldLabelClasses}>
            Product
            <select
              aria-label="Product"
              className={`${fieldControlClasses} w-full`}
              value={content.origin.product_handle ?? ""}
              onChange={(event) =>
                onEdit({
                  ...content,
                  origin: { ...content.origin, product_handle: event.target.value || null },
                })
              }
            >
              <option value="">Select a product</option>
              {(context?.resources.products ?? []).map((product) => (
                <option key={product.handle} value={product.handle}>
                  {product.title}
                </option>
              ))}
              {staleOriginHandle !== null ? (
                <option value={staleOriginHandle}>{staleOriginHandle} (unresolved)</option>
              ) : null}
            </select>
          </label>
        ) : null}
        {originNeedsOrder(content.origin.kind) ? (
          <label className={fieldLabelClasses}>
            Order
            <select
              aria-label="Order"
              className={`${fieldControlClasses} w-full`}
              value={content.origin.order_id ?? ""}
              onChange={(event) =>
                onEdit({
                  ...content,
                  origin: { ...content.origin, order_id: event.target.value || null },
                })
              }
            >
              <option value="">Select an order</option>
              {(context?.resources.orders ?? []).map((order) => (
                <option key={order.order_id} value={order.order_id}>
                  {order.reference}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ChipListField
          legend="Tags"
          label="New tag"
          hint={TICKET_TAGS_RULE}
          maxLength={TICKET_TAG_MAX_LENGTH}
          addLabel="Add tag"
          placeholder="address change"
          empty="No tag yet."
          values={content.tags}
          normalize={normalizeTag}
          takenPlace="a tag on this ticket"
          onChange={(tags) => onEdit({ ...content, tags })}
        />
      </Card>

      {context ? (
        <Card title="Customer">
          <p className="text-[13px] font-semibold text-lab-ink">
            {context.customer.display_name}
            {context.customer.latest_published_version === null ? null : (
              <span className="ml-1.5 text-[11px] font-normal text-admin-muted">
                · v{context.customer.latest_published_version}
              </span>
            )}
          </p>
          <p className="text-[12px] text-admin-muted">
            {context.customer.persona_traits.join(" · ")}
          </p>
          <dl className="grid gap-1 text-[12px]">
            <div className="flex justify-between gap-2">
              <dt className="text-admin-muted">Email</dt>
              <dd className="truncate">{context.customer.email}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-admin-muted">Default address</dt>
              <dd>{context.customer.default_address_label ?? "None"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-admin-muted">This shop</dt>
              <dd>
                {context.customer.order_count} order(s) · {context.other_tickets.length + 1}{" "}
                ticket(s)
              </dd>
            </div>
          </dl>
          <Link
            className="text-[12px] font-semibold text-lab-ink"
            to={`/shops/${shopId}/customers/${context.customer.profile_id}`}
          >
            View customer
          </Link>
        </Card>
      ) : null}

      {context ? (
        <Card title="Linked objects">
          {context.resources.orders.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              This customer has no order in this shop yet.
            </p>
          ) : (
            <ul className="grid gap-2 text-[12px]">
              {context.resources.orders.map((order) => (
                <li key={order.order_id} className="grid gap-1">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={content.linked_order_ids.includes(order.order_id)}
                      onChange={() => toggleOrder(order.order_id)}
                    />
                    {order.reference}
                  </label>
                  <span className="flex flex-wrap items-center gap-1.5 text-admin-muted">
                    {order.total_amount} {order.currency}
                    <StatusPill tone="payment" label={paymentLabel(order.payment_status)} />
                    <StatusPill
                      tone="fulfilment"
                      label={fulfilmentLabel(order.fulfilment_status)}
                    />
                  </span>
                  {order.shipping_label ? (
                    <span className="text-admin-muted">ship-to: {order.shipping_label}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {/*
            A link the shop can no longer resolve — a deleted order, or one that moved to
            another customer — blocks publication, so it has to stay removable. Without a row
            of its own it would have no checkbox left to uncheck.
          */}
          {unresolvable.length > 0 ? (
            <ul className="grid gap-1.5 text-[12px]">
              {unresolvable.map((orderId) => (
                <li key={orderId} className="flex items-center gap-2">
                  <span className="text-lab-error">Unresolved order</span>
                  <code className="truncate text-admin-muted">{orderId}</code>
                  <button
                    className={`${subtleButtonClasses} ml-auto`}
                    type="button"
                    aria-label={`Unlink order ${orderId}`}
                    onClick={() => toggleOrder(orderId)}
                  >
                    Unlink
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {context ? (
        <Card title="Suggested documents">
          {context.resources.documents.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              This shop has no policy, guideline, or FAQ entry yet.
            </p>
          ) : (
            <ul className="grid gap-1.5 text-[12px]">
              {context.resources.documents.map((document) => (
                <li key={`${document.kind}:${document.document_id}`}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={content.suggested_documents.some(
                        (entry) =>
                          entry.kind === document.kind &&
                          entry.document_id === document.document_id,
                      )}
                      onChange={() => toggleDocument(document.kind, document.document_id)}
                    />
                    <span className="font-semibold">{document.title}</span>
                    <span className="text-admin-muted">{documentKindLabel(document.kind)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {/*
            A suggestion the shop no longer holds blocks publication, as an unresolved order
            does, and it has no title to be named by — so it keeps a row of its own, named by
            its kind and slug, with the one action that resolves it.
          */}
          {staleDocuments.length > 0 ? (
            <ul className="grid gap-1.5 text-[12px]">
              {staleDocuments.map((entry) => (
                <li key={`${entry.kind}:${entry.document_id}`} className="flex items-center gap-2">
                  <span className="text-lab-error">Unresolved document</span>
                  <code className="truncate text-admin-muted">
                    {documentKindLabel(entry.kind)} · {entry.document_id}
                  </code>
                  <button
                    className={`${subtleButtonClasses} ml-auto`}
                    type="button"
                    aria-label={`Remove suggested ${documentKindLabel(entry.kind)} ${entry.document_id}`}
                    onClick={() => toggleDocument(entry.kind, entry.document_id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-admin-muted">
            Pre-fills a scenario's context documents when one is built on this ticket. The agent
            still has to reach them through a tool.
          </p>
        </Card>
      ) : null}

      {context && context.other_tickets.length > 0 ? (
        <Card title="Other tickets from this customer">
          <ul className="grid gap-1.5 text-[12px]">
            {context.other_tickets.map((other) => (
              <li key={other.ticket_id} className="flex items-center gap-2">
                <Link
                  className="font-semibold text-lab-ink"
                  to={`/shops/${shopId}/tickets/${other.ticket_id}`}
                >
                  {other.reference}
                </Link>
                <span className="truncate text-admin-muted">{other.subject}</span>
                <span className="ml-auto">
                  <StatusBadge status={other.status} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </aside>
  );
}
