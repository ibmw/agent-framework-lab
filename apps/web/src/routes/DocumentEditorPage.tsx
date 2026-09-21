import type { PolicySchema } from "@agent-lab/contracts";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { Field, FieldRows } from "../components/FieldHint";
import { Card, EditorSaveActions, PageHeader, VersionChips } from "../components/WorkspaceChrome";
import {
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
import { documentToolName } from "../lib/scenarios";
import {
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  readOnlyValueClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

const POLICY_KINDS = optionsOf(POLICY_KIND);

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
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid max-w-[790px] gap-4">
        <Card
          title="Document"
          footer={
            // The three lists this table presents each carried a Remove per row before this
            // slice, and a presentation is not where an author loses their only way to delete
            // a policy. One press, as every other Remove in this workspace still is; PLAN-UX
            // Slice 21 owns the second press and gives it to all of them together.
            <button
              className={destructiveSubtleButtonClasses}
              type="button"
              aria-label={`Remove ${documentTitle(document)}`}
              onClick={() => {
                edit(removeDocument(content, kind, document.id));
                navigate(documentsAt(shopId));
              }}
            >
              <ButtonIcon verb="delete" />
              Remove
            </button>
          }
        >
          <FieldRows>
            <Field label="Title" hint={DOCUMENT_TITLE_RULE}>
              <input
                className={fieldControlClasses}
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
                  className={fieldControlClasses}
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
                className={textAreaClasses}
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
