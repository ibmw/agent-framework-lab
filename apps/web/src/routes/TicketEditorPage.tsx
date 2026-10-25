import type {
  ShopDocumentKind,
  SupportChannel,
  TicketAuthor,
  TicketContentSchema,
  TicketContextSchema,
  TicketOriginKind,
  TicketPreviewResponse,
  TicketStatus,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getTicketContext,
  getTicketDraft,
  previewTicketDraft,
  publishTicket,
  replaceTicketDraft,
} from "../api/tickets";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipListField } from "../components/ChipListField";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { Field, FieldGroup, FieldRows } from "../components/FieldHint";
import { RemoveButton } from "../components/ItemList";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { TicketStatusBadge } from "../components/TicketStatusBadge";
import {
  Card,
  EditorSaveActions,
  EntryId,
  Fingerprint,
  GateCard,
  IssueList,
  PageHeader,
  PublishButton,
  PublishReasons,
  StatusPill,
  VersionChips,
} from "../components/WorkspaceChrome";
import { type DefinitionClient, useDefinitionEditor } from "../lib/definitionEditor";
import { DOCUMENT_KINDS } from "../lib/documents";
import { optionsOf, TICKET_ORIGIN_KIND, TICKET_STATUS } from "../lib/enumLabels";
import {
  LABEL_MAX_LENGTH,
  TEXT_MAX_LENGTH,
  TICKET_TAG_MAX_LENGTH,
  TICKET_TAGS_RULE,
} from "../lib/fieldRules";
import { fromLocalInput, fulfilmentLabel, paymentLabel, toLocalInput } from "../lib/orders";
import { pythonStrip } from "../lib/pythonText";
import { useRefusalTouch } from "../lib/refusalTouch";
import { consequenceOf, REMOVAL_FINDINGS, type Removal, useRemoval } from "../lib/removal";
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
  toTicketRequest,
  unresolvedDocuments,
} from "../lib/tickets";
import {
  addFormClasses,
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  subtleButtonClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const UNAVAILABLE = "The ticket service is unavailable.";

/**
 * The two closed sets this page picks from, read from the contract-held tables rather than
 * retyped, so a member the contract gains reaches the select instead of being left out of it.
 */
const TICKET_STATUSES = optionsOf(TICKET_STATUS);

const ORIGIN_KINDS = optionsOf(TICKET_ORIGIN_KIND);

/**
 * `/shops/:shopId/tickets/:ticketId`, keyed by the ticket: moving to another of the customer's
 * tickets is a new editor, so nothing typed or armed on one — a composer's draft, a confirm —
 * follows the operator to the next.
 */
export function TicketEditorRoute() {
  const { ticketId = "" } = useParams();
  return <TicketEditorPage key={ticketId} ticketId={ticketId} />;
}

/**
 * One ticket, on the editor template (ADR 0073): the pinned header with Save and Publish, the
 * incident, its conversation and what it points at in the main column, and the gate, the
 * customer and what publishing freezes in the side panel.
 *
 * The thread authors *history*, not live replies: a run's conversation happens on the bench,
 * one independent thread per arm. That is why the composer writes "as the customer" and "as
 * past support" and nothing else (ADR 0016).
 */
function TicketEditorPage({ ticketId }: { ticketId: string }) {
  const { shopId, listings } = useShopWorkspace();
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
  const refreshTickets = listings.tickets.refresh;

  const refreshContext = useCallback(
    async (signal?: AbortSignal) => {
      setContext(await getTicketContext(shopId, ticketId, signal));
    },
    [shopId, ticketId],
  );

  // Two reads follow a saved ticket: the context beside it, and the listing the index renders
  // and the rail counts (ADR 0056). They belong to the editor rather than to its Save button,
  // because the navigation prompt saves this draft too (ADR 0051).
  const guard = useMemo(
    () => ({
      label: "The ticket draft has unsaved changes.",
      afterSave: async () => {
        // The context is not content: one that cannot be re-read never turns a successful save
        // into anything the operator has to answer.
        await refreshContext().catch(() => {});
        await refreshTickets();
      },
    }),
    [refreshContext, refreshTickets],
  );
  const publishReasonsId = useId();
  const editor = useDefinitionEditor(ticketId, client, guard);
  const { content, preview, edit } = editor;

  useEffect(() => {
    const controller = new AbortController();
    refreshContext(controller.signal).catch(() => {
      // The thread stays usable; the context is not content.
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
    <>
      <PageHeader
        // An emptied subject is still a ticket being edited, and an empty heading would leave
        // the page with nothing to read.
        title={content.subject.trim() === "" ? "Untitled ticket" : content.subject}
        chips={
          <>
            <EntryId value={content.reference} />
            <TicketStatusBadge status={content.status} />
            <VersionChips preview={preview} />
          </>
        }
        // The channel is the Channel row's own value and is not restated. The origin is, although
        // the Incident card's Origin and Product rows show it too: the header is where the specs
        // read the origin's product, resolved by its title or said to be unresolved.
        back={{
          to: `/shops/${shopId}/tickets`,
          label: "Tickets",
          kind: "ticket",
          detail: (
            <>
              from {originLabel(content.origin.kind)}
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
            </>
          ),
        }}
        actions={
          <>
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
              onRefusedPress={editor.publishTouch.touch}
              onPublish={() => {
                // The index prints the version a publish froze, off the shell's listing.
                void editor.publish().then((version) => {
                  setPublishedVersion(version);
                  if (version !== null) {
                    void refreshTickets();
                  }
                });
              }}
            />
          </>
        }
        reasons={
          <>
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
              touched={editor.publishTouch.touched}
            />
          </>
        }
        sticky
      />

      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>
          <IncidentCard content={content} context={context} onEdit={edit} />
          <Conversation
            scope={ticketId}
            content={content}
            customerName={context?.customer.display_name ?? "Customer"}
            onEdit={edit}
          />
          {context ? (
            <LinkedOrders scope={ticketId} content={content} context={context} onEdit={edit} />
          ) : null}
          {context ? (
            <SuggestedDocuments
              scope={ticketId}
              content={content}
              context={context}
              onEdit={edit}
            />
          ) : null}
        </div>

        <div className={editorPanelClasses}>
          <GateCard title="Publish gate" busy={editor.checking} dirty={editor.dirty}>
            <IssueList issues={preview?.issues ?? []} />
          </GateCard>
          {context ? <CustomerCard shopId={shopId} context={context} /> : null}
          <Card title="What publishing freezes">
            <p className="text-[13px] text-admin-ink-soft">
              {/* Nothing while the gate has not answered: no version is known to name. */}
              {preview === null
                ? null
                : preview.latest_published_version === null
                  ? `Publishing freezes the whole ticket as its first version: ${TICKET_FROZEN}. A scenario built on it freezes a published version, never the draft.`
                  : `Publishing freezes the whole ticket as v${preview.next_version}: ${TICKET_FROZEN}. It is published up to v${preview.latest_published_version}, and a scenario that froze an earlier version does not change.`}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * What a ticket version holds. Its linked orders are not among what is frozen: an order fixture
 * has no versions (`domain/order_fixture.py`), so the version holds which orders it links and
 * nothing of the orders themselves.
 */
const TICKET_FROZEN =
  "its customer at their newest published version, incident, conversation, suggested documents, and which orders it links";

function IncidentCard({
  content,
  context,
  onEdit,
}: {
  content: TicketContentSchema;
  context: TicketContextSchema | null;
  onEdit: (next: TicketContentSchema) => void;
}) {
  const originHandle = content.origin.product_handle;
  // A handle the shop no longer holds stays selected and says so; without an option of its
  // own the select would show "Select a product" over a value the draft still carries.
  const staleOriginHandle =
    context && originHandle !== null && productTitle(context.resources, originHandle) === null
      ? originHandle
      : null;

  return (
    <Card
      title="Incident"
      description="What happened, where the customer was when they wrote, and how the ticket is filed."
    >
      <FieldRows>
        <Field label="Subject" hint="The incident as the customer would describe it.">
          <input
            maxLength={LABEL_MAX_LENGTH}
            className={`${fieldControlClasses} w-full`}
            value={content.subject}
            onChange={(event) => onEdit({ ...content, subject: event.target.value })}
          />
        </Field>
        <Field label="Status">
          <select
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
        </Field>
        <Field
          label="Channel"
          hint="The channel the incident arrived on. Must be one the shop accepts."
        >
          <select
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
        </Field>
        <Field label="Opened from">
          <select
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
        </Field>
        {originNeedsProduct(content.origin.kind) ? (
          <Field label="Product">
            <select
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
          </Field>
        ) : null}
        {originNeedsOrder(content.origin.kind) ? (
          <Field label="Order">
            <select
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
          </Field>
        ) : null}
      </FieldRows>
      {/* `ChipListField` is a `<fieldset>` with its own `<legend>` and its own hint on the
          control that takes the next tag, as the customer's persona traits are drawn under
          their rows. Wrapping it in a row would name it twice. */}
      <ChipListField
        legend="Tags"
        label="New tag"
        hint={TICKET_TAGS_RULE}
        maxLength={TICKET_TAG_MAX_LENGTH}
        addLabel="Add tag"
        placeholder="address change"
        empty="No tag yet."
        placement="card"
        values={content.tags}
        normalize={normalizeTag}
        takenPlace="a tag on this ticket"
        onChange={(tags) => onEdit({ ...content, tags })}
      />
    </Card>
  );
}

/** Why *Add to thread* is refused with no message typed. */
const THREAD_BODY_EMPTY = "Write the message before adding it to the thread.";

/** Why *Add to thread* is refused once the time is cleared: the thread is ordered by it. */
const THREAD_SENT_AT_EMPTY = "Give the message the time it was sent; the thread is ordered by it.";

function Conversation({
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
  // A hint until the operator writes, picks an author, moves the time or presses *Add to
  // thread*, and again once a message has been added (ADR 0078).
  const addTouch = useRefusalTouch();
  const instant = fromLocalInput(sentAt);
  // Why *Add to thread* will not go (ADR 0063): said beside it, not left to a press that
  // silently does nothing. Neither field can say it — an empty box and a cleared time are
  // both valid states of those controls.
  const addRefusal =
    pythonStrip(body) === "" ? THREAD_BODY_EMPTY : instant === null ? THREAD_SENT_AT_EMPTY : null;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addRefusal !== null || instant === null) {
      return;
    }
    const addition = appendMessage(content, author, pythonStrip(body), instant);
    if (!addition.ok) {
      setRefused(addition.reason);
      return;
    }
    setRefused(null);
    onEdit(addition.content);
    setBody("");
    addTouch.reset();
  }

  return (
    <Card
      title="Conversation"
      description={
        <>
          The history every arm is handed with this ticket, then the first message a run starts
          from. Replies happen on the live bench, per run — each arm answers this message
          independently.
        </>
      }
    >
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

      {/* The composer is the card's add form, below the thread it adds to. */}
      <form
        className={addFormClasses}
        aria-label="Add a message to the thread"
        onSubmit={add}
        {...addTouch.watch}
      >
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
          maxLength={TEXT_MAX_LENGTH}
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
            className="flex-none whitespace-nowrap"
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
        {addRefusal === null ? null : (
          <RefusalLine id={addReasonId} touched={addTouch.touched}>
            {addRefusal}
          </RefusalLine>
        )}
      </form>
    </Card>
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
        </div>
      </div>
      {/* The message's trash stands at the end of its row, as an item's does (ADR 0075). */}
      <div className="ml-auto flex-none">
        <RemoveButton
          name={name}
          label={`Remove message from ${name} at ${messageTime(sentAt)}`}
          entryKey={id}
          removal={removal}
          notice={removedMessage(author, customerName, sentAt)}
          onRemove={onRemove}
        />
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

function LinkedOrders({
  scope,
  content,
  context,
  onEdit,
}: {
  /** The ticket, so a confirm never follows the operator to another one. */
  scope: string;
  content: TicketContentSchema;
  context: TicketContextSchema;
  onEdit: (next: TicketContentSchema) => void;
}) {
  const resolvable = new Set(context.resources.orders.map((order) => order.order_id));
  const unresolvable = content.linked_order_ids.filter((orderId) => !resolvable.has(orderId));
  const removal = useRemoval(scope);
  const ordersId = useId();
  // The last link, on an origin that names nothing, leaves the incident pointing at nothing.
  const pointsAtNothingWithout = (orderId: string) =>
    content.origin.product_handle === null &&
    content.origin.order_id === null &&
    content.linked_order_ids.every((entry) => entry === orderId);

  function toggleOrder(orderId: string) {
    onEdit({
      ...content,
      linked_order_ids: content.linked_order_ids.includes(orderId)
        ? content.linked_order_ids.filter((entry) => entry !== orderId)
        : [...content.linked_order_ids, orderId],
    });
  }

  return (
    <Card
      title="Linked orders"
      description="The customer's orders in this shop that the incident is about."
    >
      {/* The prototype draws the linked order as a read-out (`Workspace.dc.html` :2266–2289);
          the row's name is the card's own verb, each box saying whether its order is linked,
          as *Listed* does for a scenario's documents. The boxes keep the names their labels
          give them, which the specs check them by (rule 5); the amount, the statuses and the
          ship-to drawn beside a box are its description. A link the shop no longer resolves
          stays on the row beneath them with its Unlink. */}
      <FieldRows>
        <FieldGroup label="Linked">
          {context.resources.orders.length === 0 ? (
            <p className="text-[13px] text-admin-muted">
              This customer has no order in this shop yet.
            </p>
          ) : (
            <ul className="grid gap-2 text-[13px]">
              {context.resources.orders.map((order) => (
                <li key={order.order_id} className="grid gap-1">
                  <label className="flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={content.linked_order_ids.includes(order.order_id)}
                      aria-describedby={
                        order.shipping_label
                          ? `${ordersId}-${order.order_id}-summary ${ordersId}-${order.order_id}-ship-to`
                          : `${ordersId}-${order.order_id}-summary`
                      }
                      onChange={() => toggleOrder(order.order_id)}
                    />
                    {order.reference}
                  </label>
                  <span
                    id={`${ordersId}-${order.order_id}-summary`}
                    className="flex flex-wrap items-center gap-1.5 text-admin-muted"
                  >
                    {/* The spaces keep the description's words apart without moving the row:
                        the one between the pills is a whitespace-only run, which a flex
                        container does not draw, and the one after the currency collapses at the
                        end of its line. */}
                    {order.total_amount} {order.currency}{" "}
                    <StatusPill tone="payment" label={paymentLabel(order.payment_status)} />{" "}
                    <StatusPill
                      tone="fulfilment"
                      label={fulfilmentLabel(order.fulfilment_status)}
                    />
                  </span>
                  {order.shipping_label ? (
                    <span id={`${ordersId}-${order.order_id}-ship-to`} className="text-admin-muted">
                      ship-to: {order.shipping_label}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {/*
            A link the shop can no longer resolve — a deleted order, or one that moved to
            another customer — blocks publication, so it has to stay removable. Without a row
            of its own it would have no checkbox left to uncheck. And since no checkbox puts it
            back, unlinking it asks twice, as every editor removal does (ADR 0060); a resolved
            order stays its checkbox, which links it again.
          */}
          {unresolvable.length > 0 ? (
            <ul className="mt-2 grid gap-1.5 text-[13px]">
              {unresolvable.map((orderId) => {
                const unlink = () => toggleOrder(orderId);
                const notice = `Unlinked order ${orderId} from the draft.`;
                return removal.isArmed(orderId) ? (
                  <ConfirmRemove
                    key={orderId}
                    as="li"
                    title={`Unlink order ${orderId}?`}
                    consequence={consequenceOf(
                      "No order of this customer's matches it, so no checkbox links it again.",
                      pointsAtNothingWithout(orderId) &&
                        REMOVAL_FINDINGS.ticket_without_resource_reference,
                      "Nothing is written until you save the ticket, and a published version keeps it.",
                    )}
                    confirmLabel="Unlink"
                    destroys={false}
                    onConfirm={removal.confirm(unlink, notice)}
                    onKeep={removal.keep}
                  />
                ) : (
                  <li key={orderId} className="flex items-center gap-2">
                    <span className="text-lab-error">Unresolved order</span>
                    <code className="truncate text-admin-muted">{orderId}</code>
                    <button
                      className={`${subtleButtonClasses} ml-auto`}
                      type="button"
                      aria-label={`Unlink order ${orderId}`}
                      ref={removal.trigger(orderId)}
                      onClick={removal.ask(orderId, unlink, notice)}
                    >
                      Unlink
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </FieldGroup>
      </FieldRows>
      <RemovalNotice removal={removal} />
    </Card>
  );
}

function SuggestedDocuments({
  scope,
  content,
  context,
  onEdit,
}: {
  /** The ticket, so a confirm never follows the operator to another one. */
  scope: string;
  content: TicketContentSchema;
  context: TicketContextSchema;
  onEdit: (next: TicketContentSchema) => void;
}) {
  const staleDocuments = unresolvedDocuments(content.suggested_documents, context.resources);
  const removal = useRemoval(scope);
  // Grouped by kind, in the Documents table's order and under its chips' names, so a policy
  // and an FAQ entry that share a slug are never read as one document.
  const groups = DOCUMENT_KINDS.map((shape) => ({
    shape,
    documents: context.resources.documents.filter((document) => document.kind === shape.kind),
  })).filter((group) => group.documents.length > 0);

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

  return (
    <Card
      title="Suggested documents"
      description={
        <>
          Pre-fills a scenario's context documents when one is built on this ticket. The agent still
          has to reach them through a tool.
        </>
      }
    >
      {/* One `FieldGroup` row per kind, named by the kind's chip on the Documents table — the
          name each group was reached by as a legend — so a policy and an FAQ entry that share a
          slug stay apart. The boxes keep the titles their labels give them, which the specs
          check them by (rule 5). */}
      {groups.length === 0 ? (
        <p className="text-[13px] text-admin-muted">
          This shop has no policy, guideline, or FAQ entry yet.
        </p>
      ) : (
        <FieldRows>
          {groups.map(({ shape, documents }) => (
            <FieldGroup key={shape.kind} label={shape.chip}>
              <div className="grid gap-1.5 text-[13px]">
                {documents.map((document) => (
                  <label key={document.document_id} className="flex items-center gap-2">
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
                  </label>
                ))}
              </div>
            </FieldGroup>
          ))}
        </FieldRows>
      )}
      {/*
        A suggestion the shop no longer holds is warned about, as an unresolved order is
        refused, and it has no title to be named by — so it keeps a row of its own, named by
        its kind and slug, with the one action that resolves it. Removing it asks twice, as
        every editor removal does (ADR 0060): no checkbox puts it back, since the shop holds
        no document to check. It stands beneath the kinds' rows rather than in one: a kind's
        row is drawn only while the shop holds a document of that kind, so its kind may have no
        row left to hold it.
      */}
      {staleDocuments.length > 0 ? (
        <ul className="grid gap-1.5 text-[13px]">
          {staleDocuments.map((entry) => {
            const key = `${entry.kind}:${entry.document_id}`;
            const named = `${documentKindLabel(entry.kind)} ${entry.document_id}`;
            const remove = () => toggleDocument(entry.kind, entry.document_id);
            const notice = `Removed the suggested ${named} from the draft.`;
            return removal.isArmed(key) ? (
              <ConfirmRemove
                key={key}
                as="li"
                title={`Remove the suggested ${named}?`}
                consequence="A scenario built on this ticket no longer has it pre-filled. Nothing is written until you save the ticket, and a published version keeps it."
                onConfirm={removal.confirm(remove, notice)}
                onKeep={removal.keep}
              />
            ) : (
              <li key={key} className="flex items-center gap-2">
                <span className="text-lab-error">Unresolved document</span>
                <code className="truncate text-admin-muted">
                  {documentKindLabel(entry.kind)} · {entry.document_id}
                </code>
                <span className="ml-auto flex-none">
                  <RemoveButton
                    name={`suggested ${named}`}
                    entryKey={key}
                    removal={removal}
                    notice={notice}
                    onRemove={remove}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <RemovalNotice removal={removal} />
    </Card>
  );
}

/**
 * Who raised the ticket, read off the context and never edited here: the customer is fixed at
 * creation (ADR 0016). Their other tickets in this shop are part of who they are to this shop,
 * so they are listed inside the card rather than in a card of their own.
 */
function CustomerCard({ shopId, context }: { shopId: string; context: TicketContextSchema }) {
  const otherTicketsId = useId();
  return (
    <Card title="Customer">
      <p className="text-[13px] font-semibold text-lab-ink">
        {context.customer.display_name}
        {context.customer.latest_published_version === null ? null : (
          <span className="ml-1.5 text-[11px] font-normal text-admin-muted">
            · v{context.customer.latest_published_version}
          </span>
        )}
      </p>
      <p className="text-[12px] text-admin-muted">{context.customer.persona_traits.join(" · ")}</p>
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
            {context.customer.order_count} order(s) · {context.other_tickets.length + 1} ticket(s)
          </dd>
        </div>
      </dl>
      <Link
        className="text-[12px] font-semibold text-lab-ink"
        to={`/shops/${shopId}/customers/${context.customer.profile_id}`}
      >
        View customer
      </Link>
      {context.other_tickets.length > 0 ? (
        <section aria-labelledby={otherTicketsId} className="grid gap-1.5">
          <h3 id={otherTicketsId} className="text-xs font-semibold text-admin-muted">
            Other tickets from this customer
          </h3>
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
                  <TicketStatusBadge status={other.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}
