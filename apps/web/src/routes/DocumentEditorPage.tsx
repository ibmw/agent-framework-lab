import type { PolicySchema, ShopDocumentKind } from "@agent-lab/contracts";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { ConfirmRemove } from "../components/ConfirmRemove";
import { Field, FieldRows } from "../components/FieldHint";
import { Card, EditorSaveActions, PageHeader, VersionChips } from "../components/WorkspaceChrome";
import {
  documentIds,
  documentKindFromSlug,
  documentKindShape,
  documentsAt,
  documentTitle,
  findDocument,
  removeDocument,
  replaceDocument,
  type ShopDocument,
  wordCount,
} from "../lib/documents";
import { optionsOf, POLICY_KIND } from "../lib/enumLabels";
import {
  DOCUMENT_BODY_RULE,
  DOCUMENT_KIND_FIXED_RULE,
  DOCUMENT_SLUG_FIXED_RULE,
  DOCUMENT_TITLE_RULE,
} from "../lib/fieldRules";
import { findingClauses, type RemovalFinding, removedState, useRemoval } from "../lib/removal";
import { documentToolName } from "../lib/scenarios";
import {
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  readOnlyValueClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const POLICY_KINDS = optionsOf(POLICY_KIND);

/** The gate finding a shop raises once it holds none of a kind (`domain/shop.py`). */
const LAST_OF_KIND: Record<ShopDocumentKind, RemovalFinding> = {
  policy: "shop_without_policy",
  faq_entry: "shop_without_faq",
  support_guideline: "shop_without_support_guideline",
};

/**
 * One shop document, on a page of its own (`Workspace.dc.html`:3163).
 *
 * This is the surface the Documents table opens instead of the edit-in-place row the three
 * lists used to carry: a policy's body is three paragraphs, and three paragraphs are what a
 * page is for. It edits the shop draft, so it draws the draft's own Save and Discard exactly
 * as the product editor beside it does, and `shopDraftIsSavableAt` already reaches every
 * address under `/setup`.
 *
 * **Slug and Kind are values, not questions.** The prototype draws both read-only and says
 * "Set at creation" under the slug; this workspace agrees for a reason of its own, which is
 * that the pair *is* the document's identity — `ContextDocumentSchema` is `{kind,
 * document_id}` — so moving either would make this a different document to every scenario
 * that had named it, and the finding would land on those scenarios' gates rather than on
 * this shop's, which says nothing about them (ADR 0057). A saved entry's identifier is displayed and never asked
 * (`docs/design-direction.md`, *The form language*), and here the identifier is two rows.
 *
 * A **policy's own subject** — Returns, Shipping — is a different question and stays a select:
 * it is a field of the policy rather than part of its name, and the collection it does not
 * belong to has no column for it.
 */
export function DocumentEditorPage() {
  const { kind: addressed = "", docId = "" } = useParams();
  const { shopId, content, preview, edit, save, saving, discard, discarding, dirty, error } =
    useShopWorkspace();
  const navigate = useNavigate();
  // Scoped to the document, so a confirm never follows the operator to another one.
  const removal = useRemoval(`${addressed}/${docId}`);
  const kind = documentKindFromSlug(addressed);
  const document = kind === null ? undefined : findDocument(content, kind, docId);

  if (!document || kind === null) {
    return (
      <>
        <PageHeader title="Document not found" />
        <p className="text-[13px] text-admin-muted">
          This draft has no <code>{addressed}</code> document <code>{docId}</code>.{" "}
          <Link className="font-semibold text-lab-ink" to={documentsAt(shopId)}>
            Back to Policies &amp; FAQ
          </Link>
        </p>
      </>
    );
  }

  function update(next: ShopDocument) {
    edit(replaceDocument(content, next));
  }

  const words = wordCount(document.body);

  function drop() {
    if (!document || kind === null) {
      return;
    }
    edit(removeDocument(content, kind, document.id));
    // This page is about to unmount, so the table it returns to says what was removed.
    navigate(documentsAt(shopId), {
      state: removedState(
        `Removed “${documentTitle(document)}” from the draft.`,
        `${kind}/${document.id}`,
      ),
    });
  }

  return (
    <>
      <PageHeader
        // A document is created with a title, but the field can be emptied afterwards and an
        // empty `<h1>` leaves the page with nothing to read — the stand-in the catalog's
        // untitled product already uses, for the same reason.
        title={documentTitle(document)}
        chips={<VersionChips preview={preview} />}
        description={`Editing the shop draft · ${documentKindShape(kind).column}`}
        actions={
          <EditorSaveActions
            tone="accent"
            dirty={dirty}
            saving={saving}
            discarding={discarding}
            onSave={() => void save()}
            onDiscard={() => void discard()}
          />
        }
        reasons={
          error ? (
            <p role="alert" className="text-[13px] text-lab-error">
              {error}
            </p>
          ) : null
        }
        sticky
      />

      <div className="grid max-w-[790px] gap-4">
        <Card
          title="Document"
          footer={
            // The three lists this table presents each carried a Remove per row before it,
            // and a presentation is not where an author loses their only way to delete a
            // policy. The second press stands in the footer the Remove stood in (ADR 0060),
            // and the move back to the table is inside the shop draft's reach, so the one
            // unsaved-work guard has nothing to ask (ADR 0051).
            removal.isArmed(document.id) ? (
              <ConfirmRemove
                title={`Remove “${documentTitle(document)}” from the shop?`}
                consequence={
                  <>
                    Agents can no longer read it through{" "}
                    <code className="font-mono">{documentToolName(kind)}</code> once the draft is
                    published.{" "}
                    {findingClauses([
                      "context_document_missing_from_shop",
                      "suggested_document_missing_from_shop",
                      documentIds(content, kind).length === 1 && LAST_OF_KIND[kind],
                    ])}{" "}
                    Nothing is written until you save the draft, and a published shop version keeps
                    it.
                  </>
                }
                // No notice of its own: this page unmounts, and the table it lands on says what
                // was removed (`removedState` in `drop`).
                onConfirm={removal.confirm(drop, null)}
                onKeep={removal.keep}
              />
            ) : (
              <button
                className={destructiveSubtleButtonClasses}
                type="button"
                aria-label={`Remove ${documentTitle(document)}`}
                ref={removal.trigger(document.id)}
                onClick={removal.ask(document.id, drop, null)}
              >
                <ButtonIcon verb="delete" />
                Remove
              </button>
            )
          }
        >
          <FieldRows>
            <Field label="Title" hint={DOCUMENT_TITLE_RULE}>
              <input
                className={`${fieldControlClasses} w-full`}
                value={document.title}
                required
                onChange={(event) => update({ ...document, title: event.target.value })}
              />
            </Field>
            {/* Not controls, and deliberately: the pair is this document's identity, so
                what is drawn is the value the prototype draws. `output` rather than a
                paragraph, because a `Field`'s label is `for`-bound and only a labelable
                element can carry the binding — the same element the two derived rows on New
                scenario already use. */}
            <Field label="Slug" hint={DOCUMENT_SLUG_FIXED_RULE}>
              <output className={`${readOnlyValueClasses} font-mono`}>{document.id}</output>
            </Field>
            <Field label="Kind" hint={DOCUMENT_KIND_FIXED_RULE}>
              <output className={readOnlyValueClasses}>{documentKindShape(kind).column}</output>
            </Field>
            {document.policyKind === null ? null : (
              <Field label="Policy kind">
                <select
                  className={`${fieldControlClasses} w-full`}
                  value={document.policyKind}
                  onChange={(event) =>
                    update({
                      ...document,
                      policyKind: event.target.value as PolicySchema["kind"],
                    })
                  }
                >
                  {POLICY_KINDS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </FieldRows>
        </Card>

        <Card title="Body">
          <FieldRows>
            <Field
              label="Content"
              hint={DOCUMENT_BODY_RULE}
              // The prototype's own line under the field. A figure read off what is in the
              // box rather than a promise about it: no gate counts a document's words.
              extra={`${words} word${words === 1 ? "" : "s"}`}
            >
              <textarea
                className={`${textAreaClasses} w-full`}
                rows={9}
                value={document.body}
                required
                onChange={(event) => update({ ...document, body: event.target.value })}
              />
            </Field>
          </FieldRows>
        </Card>

        <Card title="Never in the prompt">
          <p className="text-[13px] text-admin-muted">
            Nothing here is injected into an agent's prompt: a run reads this document only by
            calling <code className="font-mono">{documentToolName(kind)}</code>. If it never calls
            the tool, it never read the document — and that is the difference most comparisons turn
            on.
          </p>
        </Card>
      </div>
    </>
  );
}
