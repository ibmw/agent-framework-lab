import type { ShopDocumentKind } from "@agent-lab/contracts";
import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { RemovalNotice } from "../components/ConfirmRemove";
import { CreatePage } from "../components/CreatePage";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldRows } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import {
  Card,
  EditorSaveActions,
  EntryKind,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import {
  appendDocument,
  DEFAULT_POLICY_KIND,
  DOCUMENT_KINDS,
  documentAt,
  documentIds,
  documentKindShape,
  documentsAt,
  newDocumentAt,
  type ShopDocument,
  shopDocuments,
} from "../lib/documents";
import { SLUG_MAX_LENGTH, slugify, uniqueSuggestion } from "../lib/entryIds";
import { labelOf, POLICY_KIND } from "../lib/enumLabels";
import {
  DOCUMENT_KIND_RULE,
  DOCUMENT_SLUG_RULE,
  DOCUMENT_TITLE_RULE,
  KEBAB_PATTERN,
  LABEL_MAX_LENGTH,
} from "../lib/fieldRules";
import { filterList } from "../lib/filters";
import { pythonStrip } from "../lib/pythonText";
import { useArrivedRemoval, useRemoval } from "../lib/removal";
import {
  fieldControlClasses,
  outlineButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
  tableScrollerClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

/**
 * The chip a filter is, which is also the value the address carries.
 *
 * `all`, plus the three kind slugs, so `?kind=guidelines` is both a legible address and the
 * chip that is pressed.
 */
type Filter = "all" | (typeof DOCUMENT_KINDS)[number]["slug"];

/**
 * The prototype's document chips, minus the one this lab has no figure for
 * (`Workspace.dc.html`:1538 and the `docFilters` table behind it).
 *
 * Four of the prototype's five. *Required by a scenario* is the fifth and is **not drawn**:
 * it counts the documents some scenario names as a context document, and the scenarios
 * listing this workspace holds carries `context_document_count` and no document at all
 * (`ScenarioSummarySchema`). Reading them would be one draft read per scenario, which is the
 * additive read ADR 0056 measured and refused, and a figure the payload lacks is not faked
 * (`docs/design-direction.md`, *Lists and counts*, where the departure is recorded).
 *
 * The other four count the three lists this table draws — the whole list, under the rule the
 * chip row states; the search narrows only the rows beneath.
 */
const FILTERS: FilterChipDefinition<Filter, ShopDocument>[] = [
  { id: "all", label: "All", kind: "all", matches: () => true },
  ...DOCUMENT_KINDS.map((entry) => ({
    id: entry.slug as Filter,
    label: entry.chip,
    kind: "document" as const,
    matches: (document: ShopDocument) => document.kind === entry.kind,
  })),
];

function isFilter(value: string | null): value is Filter {
  return value !== null && FILTERS.some((entry) => entry.id === value);
}

/**
 * The shop's policies, support guidelines and FAQ entries as one *Documents* table
 * (PLAN-UX Slice 16, `Workspace.dc.html`:1518).
 *
 * The three stay three lists in the payload: this is a presentation of `content.policies`,
 * `content.support_guidelines` and `content.faq`, and `lib/documents.ts` writes every row
 * back into the collection it came out of, in the slot it already held. Nothing in the shop's
 * canonical document or in its fingerprint moves because a table drew it.
 *
 * **The chip is in the address.** Every other index in this workspace keeps its filter in
 * component state; this one keeps it in `?kind=`, because `/setup/support` — the retired
 * guidelines page — redirects here *filtered to Guidelines* (ADR 0054), and a filter the
 * address names has to be the filter that is pressed. Pressing a chip replaces the history
 * entry rather than pushing one, so Back leaves the table instead of walking the chips.
 *
 * Neither the search box nor the chip row waits for a load, as the catalog's do not: this is
 * the shop draft, which `ShopWorkspace` already holds by the time the route renders.
 */
export function DocumentsPage() {
  const { shopId, content, preview, save, saving, discard, discarding, dirty, error } =
    useShopWorkspace();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  // The document editor's Remove lands here, and this is where it says what it removed.
  const removal = useRemoval(shopId);
  useArrivedRemoval(removal, discarding);
  const asked = params.get("kind");
  const filter: Filter = isFilter(asked) ? asked : "all";

  function select(next: Filter) {
    const rest = new URLSearchParams(params);
    if (next === "all") {
      rest.delete("kind");
    } else {
      rest.set("kind", next);
    }
    setParams(rest, { replace: true });
  }

  const documents = shopDocuments(content);
  // A document *Discard changes* put back is one the notice must stop saying was removed.
  for (const document of documents) {
    removal.present(`${document.kind}/${document.id}`);
  }
  // Title and slug, which is what the prototype's own document search reads (`d.title` and
  // `d.slug` in its `shownDocs` filter).
  const { chips, visible } = filterList(documents, FILTERS, filter, {
    query,
    fields: (document) => [document.title, document.id],
  });

  return (
    <>
      <PageHeader
        title="Policies & FAQ"
        chips={<VersionChips preview={preview} />}
        description="The documents an agent can only reach through tools, never in its prompt. A scenario records which reads it expects."
        actions={
          // *New document* stands beside the shop draft's Save and Discard, where the page's
          // create action stands on every other index, rather than on the card's header line
          // the prototype draws it on (`Workspace.dc.html`:1535) — the operator's request, and
          // a departure `docs/design-direction.md` records. It keeps the prototype's weights:
          // Save is this page's primary action, and *New document* the secondary beside it.
          <>
            <EditorSaveActions
              tone="accent"
              dirty={dirty}
              saving={saving}
              discarding={discarding}
              onSave={() => void save()}
              onDiscard={() => void discard()}
            />
            <Link className={outlineButtonClasses} to={newDocumentAt(shopId)}>
              <ButtonIcon verb="create" />
              New document
            </Link>
          </>
        }
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <section aria-label="Documents" className={`${surfaceClasses} overflow-hidden`}>
        <SearchRow title="What the agent can consult">
          <SearchField label="Search documents" onChange={setQuery} value={query} />
        </SearchRow>
        <div data-tour="document-kinds">
          <FilterChips
            legend="Filter documents"
            chips={chips}
            selected={filter}
            onSelect={select}
          />
        </div>
        {documents.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">
            This shop has no document yet. A policy, a guideline or an FAQ entry is what an agent
            can find through a tool.
          </p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">No document matches this view.</p>
        ) : (
          <div className={tableScrollerClasses}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Document</th>
                  <th className={tableHeadClasses}>Kind</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((document) => (
                  <tr key={`${document.kind}:${document.id}`}>
                    <td className={tableCellClasses}>
                      <Link
                        className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                        to={documentAt(shopId, document.kind, document.id)}
                      >
                        {document.title}
                      </Link>
                      <div className="font-mono text-admin-muted">{document.id}</div>
                    </td>
                    <td className={tableCellClasses}>
                      <EntryKind value={documentKindShape(document.kind).column} />
                      {document.policyKind === null ? null : (
                        <div className="text-admin-muted">
                          {labelOf(POLICY_KIND, document.policyKind)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <RemovalNotice removal={removal} />
      </section>
    </>
  );
}

/**
 * Creating a document is a page, and the kind is the question it exists to ask (ADR 0057).
 *
 * A document is a row of the shop draft, like a product — nothing to POST, nothing to be
 * refused, nothing to wait for — so this page writes by appending to the draft the shell
 * already holds. It is still a *page* rather than the product's append-and-open, because a
 * document is addressed by its kind **and** its slug and a kind cannot be answered
 * afterwards: moving one would carry the row between three collections, drop the
 * `PolicyKind` a policy carries and nothing else does, and break every scenario whose
 * context documents name `(kind, id)` — reported on the scenario's own gate and never on
 * this shop's, so the surface that caused it is the one that will not say so. ADR 0057 has
 * the reasoning.
 *
 * It uses `CreatePage` and not `useCreateThenComplete`: that hook is for a create the lab
 * makes with a `POST` and the page completes with a `PUT`, and there is no first write here
 * to complete. One press appends one row and lands in its editor, so nothing is owed and
 * nothing registers as unsaved work (ADR 0051).
 *
 * The body is not asked for. *A create form asks for what constrains the work that follows
 * and names where the rest lives* — the kind and the slug are what a scenario binds to and
 * cannot be moved later; the text is the work itself, and the card below says where it is
 * written.
 */
export function NewDocumentPage() {
  const { shopId, content, edit } = useShopWorkspace();
  const navigate = useNavigate();
  const formId = useId();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ShopDocumentKind>("policy");
  const [id, setId] = useState("");

  // Free of the ids of the *chosen* collection only: two collections may hold the same slug,
  // and the Kind row above is what decides which list this one has to miss.
  const taken = documentIds(content, kind);
  const suggested = uniqueSuggestion(slugify(title, ""), taken);

  const blockedBy =
    pythonStrip(title) === ""
      ? "The document needs a title: it is what the tool result is labeled with."
      : id === ""
        ? "The document needs a slug, which is how a scenario names the read."
        : taken.includes(id)
          ? `${id} is already in the draft.`
          : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedBy !== undefined) {
      return;
    }
    edit(
      appendDocument(content, {
        kind,
        id,
        // Stripped as Python strips it: `require_label` refuses a padded title.
        title: pythonStrip(title),
        body: "",
        policyKind: kind === "policy" ? DEFAULT_POLICY_KIND : null,
      }),
    );
    navigate(documentAt(shopId, kind, id));
  }

  return (
    <CreatePage
      backTo={documentsAt(shopId)}
      backLabel="Policies & FAQ"
      breadcrumb="creating a document"
      title={title}
      untitled="New document"
      formId={formId}
      createLabel="Create document"
      creating={false}
      creatingLabel="Creating…"
      blockedBy={blockedBy}
    >
      <form id={formId} className="grid gap-4" onSubmit={submit}>
        <Card title="Document">
          <FieldRows>
            <Field label="Title" hint={DOCUMENT_TITLE_RULE}>
              <input
                maxLength={LABEL_MAX_LENGTH}
                className={`${fieldControlClasses} w-full`}
                value={title}
                required
                placeholder="Returns policy"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            {/* A contract union, so a select (*The form language*), and asked here because
                it is half of the address this document answers at from now on. */}
            <Field label="Kind" hint={DOCUMENT_KIND_RULE}>
              <select
                className={`${fieldControlClasses} w-full`}
                value={kind}
                onChange={(event) => setKind(event.target.value as ShopDocumentKind)}
              >
                {DOCUMENT_KINDS.map((entry) => (
                  <option key={entry.kind} value={entry.kind}>
                    {entry.column}
                  </option>
                ))}
              </select>
            </Field>
            <DerivedIdField
              arrangement="row"
              label="Slug"
              hint={DOCUMENT_SLUG_RULE}
              value={id}
              suggested={suggested.value}
              taken={taken}
              takenBase={suggested.takenBase}
              takenPlace="in the draft"
              pattern={KEBAB_PATTERN}
              maxLength={SLUG_MAX_LENGTH}
              title={DOCUMENT_SLUG_RULE}
              placeholder="returns-policy"
              required
              onChange={setId}
            />
          </FieldRows>
        </Card>
        <Card title="Created as a draft">
          <p className="text-[13px] text-admin-muted">
            The document's text is written in its editor, which this lands in. It reaches an agent
            only when a run calls the tool that returns this collection, and it reaches an
            experiment only once the shop is published.
          </p>
        </Card>
      </form>
    </CreatePage>
  );
}
