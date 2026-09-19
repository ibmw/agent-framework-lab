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
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { describeApiError } from "../api/client";
import { listCustomerProfiles } from "../api/customerProfiles";
import {
  createTicket,
  getTicketContext,
  getTicketDraft,
  listTickets,
  previewTicketDraft,
  publishTicket,
  replaceTicketDraft,
} from "../api/tickets";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipListField } from "../components/ChipListField";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import { TourLaunch } from "../components/TourLaunch";
import {
  Card,
  canPublish,
  EditorSaveActions,
  Fingerprint,
  IssueList,
  PageHeader,
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
import {
  appendMessage,
  authorLabel,
  channelLabel,
  documentKindLabel,
  documentOptions,
  initials,
  messageDay,
  messageTime,
  normalizeTag,
  originLabel,
  originNeedsOrder,
  originNeedsProduct,
  removeMessage,
  retargetOrigin,
  statusLabel,
  toTicketRequest,
} from "../lib/tickets";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  outlineButtonClasses,
  subtleButtonClasses,
  surfaceClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

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
  const { shopId } = useShopWorkspace();
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [listError, setListError] = useState<string | null>(null);
  /** The ticket a create on this page is opening, while its navigation is in flight. */
  const opening = useRef<string | null>(null);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      setTickets((await listTickets(shopId, signal)).tickets);
      setListError(null);
    },
    [shopId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setListError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  const visible = useMemo(
    () => tickets.filter((ticket) => matches(ticket, filter)),
    [tickets, filter],
  );

  // Stable, because the editor beside the list builds its guard from it: an `onSaved` rebuilt
  // every render would rebuild the guard, and with it the editor's own `save`.
  const onTicketSaved = useCallback(() => {
    reload().catch(() => {
      // The list keeps what it has; the save itself landed and said so.
    });
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
      {/* The page's own header, like every other surface in the workspace. This screen used to
          put its name inside the list panel, which left it the one page whose title and tour
          control sat somewhere different from everywhere else. */}
      <PageHeader
        title="Tickets"
        description="An incident as it arrived: the thread, the customer it is about, and the order it concerns. A scenario is composed on a published ticket."
        actions={<TourLaunch id="tickets" />}
      />
      <div className="grid min-h-0 gap-4 xl:grid-cols-[262px_minmax(0,1fr)]">
        <section className={`${surfaceClasses} overflow-hidden`} aria-label="Tickets">
          <div className="flex items-center gap-2 border-b border-admin-border px-3 py-2.5">
            <h2 className="text-sm font-bold">Tickets</h2>
            <label className="ml-auto text-xs">
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
              try {
                await reload();
              } catch (cause: unknown) {
                setListError(describeApiError(cause, UNAVAILABLE));
              }
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
  const { content } = useShopWorkspace();
  const [reference, setReference] = useState("");
  const [subject, setSubject] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [channel, setChannel] = useState<SupportChannel>(content.identity.channels[0] ?? "chat");
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
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

  useEffect(() => {
    const controller = new AbortController();
    void listCustomerProfiles(shopId, controller.signal)
      .then((listed) => {
        setCustomers(
          listed.profiles.map((profile) => ({
            id: profile.profile_id,
            name: profile.display_name,
          })),
        );
      })
      .catch(() => {
        // The picker simply stays empty; the form explains why below.
      });
    return () => controller.abort();
  }, [shopId]);

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
          className={fieldControlClasses}
          value={subject}
          required
          placeholder="Wrong address concern"
          onChange={(event) => setSubject(event.target.value)}
        />
      </FieldHint>
      <FieldHint
        label="Customer"
        hint="Only customers attached to this shop can raise a ticket here."
      >
        <select
          className={fieldControlClasses}
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
          className={fieldControlClasses}
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
        <header className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold tracking-tight">
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
              <button
                className={accentButtonClasses}
                type="button"
                onClick={() => {
                  void editor.publish().then((version) => setPublishedVersion(version));
                }}
                disabled={editor.publishing || !canPublish(preview, editor.dirty)}
              >
                <ButtonIcon verb="publish" />
                {editor.publishing ? "Publishing…" : `Publish v${preview?.next_version ?? 1}`}
              </button>
            </div>
          </div>
          <p className="text-[13px] text-admin-muted">
            {channelLabel(content.channel)} · from {originLabel(content.origin.kind)}
            {content.origin.product_handle ? ` ${content.origin.product_handle}` : ""}
            {preview ? (
              <>
                {" "}
                · draft fingerprint <Fingerprint value={preview.content_fingerprint} />
              </>
            ) : null}
          </p>
        </header>

        {editor.error ? (
          <p role="alert" className="text-[13px] text-lab-error">
            {editor.error}
          </p>
        ) : null}
        <div className="grid gap-1">
          <PublishReasons preview={preview} dirty={editor.dirty} />
        </div>
        {publishedVersion !== null ? (
          <p role="status" className="text-[13px] text-lab-success">
            Published version {publishedVersion}. A scenario built on this ticket freezes this exact
            version.
          </p>
        ) : null}

        <Thread
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

function Thread({
  content,
  customerName,
  onEdit,
}: {
  content: TicketContentSchema;
  customerName: string;
  onEdit: (next: TicketContentSchema) => void;
}) {
  const [author, setAuthor] = useState<TicketAuthor>("customer");
  const [body, setBody] = useState("");
  const [sentAt, setSentAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [refused, setRefused] = useState<string | null>(null);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instant = fromLocalInput(sentAt);
    if (!body.trim() || instant === null) {
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
        {content.history.map((entry) => (
          <Bubble
            key={entry.id}
            author={entry.author}
            customerName={customerName}
            body={entry.body}
            sentAt={entry.sent_at}
            onRemove={() => onEdit(removeMessage(content, entry.id))}
          />
        ))}

        <Divider label="Trigger — sent to every arm at experiment start" strong />
        {content.trigger ? (
          <Bubble
            author={content.trigger.author}
            customerName={customerName}
            body={content.trigger.body}
            sentAt={content.trigger.sent_at}
            badge="first message"
            onRemove={() => onEdit(removeMessage(content, content.trigger?.id ?? ""))}
          />
        ) : (
          <p className="text-[13px] text-admin-muted">
            No first message yet. A published ticket must carry the message every arm receives.
          </p>
        )}
        <p className="text-xs text-admin-muted">
          Replies happen on the Bench, per run — each arm answers this message independently.
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
          className={textAreaClasses}
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
          <button className={outlineButtonClasses} type="submit">
            <ButtonIcon verb="create" />
            Add to thread
          </button>
          <p className="text-xs text-admin-muted">
            Adds fixture history to this ticket — not a live reply. The newest message from the
            customer becomes the trigger.
          </p>
        </div>
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

function Bubble({
  author,
  customerName,
  body,
  sentAt,
  badge,
  onRemove,
}: {
  author: TicketAuthor;
  customerName: string;
  body: string;
  sentAt: string;
  badge?: string;
  onRemove: () => void;
}) {
  const name = author === "customer" ? customerName : authorLabel(author);
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
            onClick={onRemove}
          >
            <ButtonIcon verb="delete" />
            Remove
          </button>
        </div>
      </div>
    </article>
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
  const documents = context ? documentOptions(context.resources) : [];
  const resolvable = new Set((context?.resources.orders ?? []).map((order) => order.order_id));
  const unresolvable = content.linked_order_ids.filter((orderId) => !resolvable.has(orderId));

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
            className={fieldControlClasses}
            value={content.subject}
            onChange={(event) => onEdit({ ...content, subject: event.target.value })}
          />
        </label>
        <label className={fieldLabelClasses}>
          Status
          <select
            aria-label="Status"
            className={fieldControlClasses}
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
            className={fieldControlClasses}
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
            className={fieldControlClasses}
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
              className={fieldControlClasses}
              value={content.origin.product_handle ?? ""}
              onChange={(event) =>
                onEdit({
                  ...content,
                  origin: { ...content.origin, product_handle: event.target.value || null },
                })
              }
            >
              <option value="">Select a product</option>
              {(context?.resources.product_handles ?? []).map((handle) => (
                <option key={handle} value={handle}>
                  {handle}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {originNeedsOrder(content.origin.kind) ? (
          <label className={fieldLabelClasses}>
            Order
            <select
              aria-label="Order"
              className={fieldControlClasses}
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
          {documents.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              This shop has no policy, guideline, or FAQ entry yet.
            </p>
          ) : (
            <ul className="grid gap-1.5 text-[12px]">
              {documents.map((document) => (
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
                    <span className="font-semibold">{document.document_id}</span>
                    <span className="text-admin-muted">{documentKindLabel(document.kind)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
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
