import type { DefinitionIssueSchema, ProductViewSchema } from "@agent-lab/contracts";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import { type FilterChipDefinition, FilterChips, filterList } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import { TourLaunch } from "../components/TourLaunch";
import {
  Card,
  EditorSaveActions,
  PageHeader,
  StatusPill,
  VersionChips,
} from "../components/WorkspaceChrome";
import { slugify, uniqueSuggestion } from "../lib/entryIds";
import { labelOf, PRODUCT_STATUS } from "../lib/enumLabels";
import { KEBAB_PATTERN, PRODUCT_CATEGORY_RULE, PRODUCT_HANDLE_RULE } from "../lib/fieldRules";
import { issuesForProduct, ratingLabel } from "../lib/shop";
import {
  accentButtonClasses,
  fieldControlClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

function emptyProduct(handle: string, title: string, category: string): ProductViewSchema {
  return {
    handle,
    title,
    description: "",
    status: "draft",
    category,
    options: [],
    variants: [],
    media: [],
    attributes: [],
    reviews: [],
    ratings: { review_count: 0, average_rating: null },
  };
}

type Filter = "all" | "active" | "draft" | "issues";

/**
 * The prototype's product chips, whole (`tmp/design-frames/Workspace.dc.html`:4775–4780).
 *
 * *Needs attention* counts the Findings column rather than a second reading of it: the same
 * `issuesForProduct` the rows draw from, so a product the table calls clear can never be in
 * the chip's number. The findings arrive with the draft preview, so the count is 0 until that
 * lands — which is the same moment the column itself stops saying "Clear" for everything.
 *
 * The seven server-backed indexes withhold their chip row until the listing lands, because a
 * row of zeros over "Loading…" filters nothing. This page does not, and deliberately: the
 * catalog is the shop draft, which is already in hand when the route renders, so the table is
 * there from the first frame and three of the four chips filter it correctly at once.
 * Withholding the row for the fourth would make it appear *after* the table it labels, and
 * *Needs attention 0* is not a wrong answer in the meantime — it is the same answer the
 * Findings column beside it is giving.
 *
 * `archived` has no chip, as in the prototype. It is reachable through *All*, which is where
 * a status nobody filters for belongs.
 */
function productFilters(
  issues: DefinitionIssueSchema[],
): FilterChipDefinition<Filter, ProductViewSchema>[] {
  return [
    { id: "all", label: "All", kind: "all", matches: () => true },
    {
      id: "active",
      label: "Active",
      kind: "published",
      matches: (product) => product.status === "active",
    },
    {
      id: "draft",
      label: "Draft",
      kind: "draft",
      matches: (product) => product.status === "draft",
    },
    {
      id: "issues",
      label: "Needs attention",
      kind: "attention",
      matches: (product) => issuesForProduct(issues, product.handle).length > 0,
    },
  ];
}

export function ProductsPage() {
  const { content, preview, edit, save, saving, discard, discarding, dirty, error } =
    useShopWorkspace();
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const takenHandles = content.products.map((product) => product.handle);
  // Sorted and de-duplicated, so the list reads as a vocabulary rather than as the order
  // products happened to be added in. A product with no category yet offers nothing.
  const draftCategories = [
    ...new Set(content.products.map((product) => product.category).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
  const { value: suggestedHandle, takenBase: takenHandleBase } = uniqueSuggestion(
    slugify(title, ""),
    takenHandles,
  );

  function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!handle || takenHandles.includes(handle)) {
      return;
    }
    edit({
      ...content,
      products: [...content.products, emptyProduct(handle, title, category)],
    });
    setHandle("");
    setTitle("");
    setCategory("");
  }

  // The title alone, which is what the prototype's products search reads (`p.title` in its
  // `shownProducts` filter).
  const { chips, visible } = filterList(
    content.products,
    productFilters(preview?.issues ?? []),
    filter,
    { query, fields: (product) => [product.title] },
  );

  return (
    <>
      <PageHeader
        title="Products"
        chips={<VersionChips preview={preview} />}
        description="The product editor edits the shop draft. Publishing the shop freezes the catalog."
        actions={
          <>
            <TourLaunch id="products" />
            <EditorSaveActions
              tone="accent"
              dirty={dirty}
              saving={saving}
              discarding={discarding}
              onSave={() => void save()}
              onDiscard={() => void discard()}
            />
          </>
        }
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${surfaceClasses} overflow-hidden`} data-tour="product-index">
          {/* Not gated on a load, as the chip row beside it is not: this catalog is the shop
              draft, already in hand when the route renders. */}
          <SearchRow>
            <SearchField label="Search products" onChange={setQuery} value={query} />
          </SearchRow>
          <FilterChips
            legend="Filter products"
            chips={chips}
            selected={filter}
            onSelect={setFilter}
          />
          {content.products.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              This shop sells nothing yet. A published shop must sell at least one product.
            </p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">No product matches this view.</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Product</th>
                  <th className={tableHeadClasses}>Status</th>
                  <th className={tableHeadClasses}>Variants</th>
                  <th className={tableHeadClasses}>Ratings</th>
                  <th className={tableHeadClasses}>Findings</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((product) => {
                  const findings = issuesForProduct(preview?.issues ?? [], product.handle);
                  const errors = findings.filter((issue) => issue.severity === "error").length;
                  return (
                    <tr key={product.handle}>
                      <td className={tableCellClasses}>
                        <Link
                          className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                          to={product.handle}
                        >
                          {product.title}
                        </Link>
                        <div className="text-admin-muted">{product.category}</div>
                      </td>
                      <td className={tableCellClasses}>
                        <StatusPill
                          tone="product"
                          label={labelOf(PRODUCT_STATUS, product.status)}
                        />
                      </td>
                      <td className={tableCellClasses}>{product.variants.length}</td>
                      <td className={tableCellClasses}>{ratingLabel(product)}</td>
                      <td className={tableCellClasses}>
                        {errors > 0 ? (
                          <span className="font-semibold text-lab-error">
                            {errors} error{errors === 1 ? "" : "s"}
                          </span>
                        ) : findings.length > 0 ? (
                          <span className="text-admin-draft-ink">
                            {findings.length} warning{findings.length === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-lab-success">Clear</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <Card title="Add a product">
          <form className="grid gap-3" onSubmit={addProduct}>
            <FieldHint label="Title" hint="The name customers and the catalog see.">
              <input
                className={fieldControlClasses}
                value={title}
                required
                placeholder="Alpine Shell Jacket"
                onChange={(event) => setTitle(event.target.value)}
              />
            </FieldHint>
            {/*
             * A datalist rather than a select: a catalog's first product has no category to
             * pick from, and the second is usually a new one too. The draft's own categories
             * are offered because reaching for "Jackets" when the draft already holds
             * "jackets" is how one catalog ends up with two of everything — `CountryField`'s
             * reasoning, over a set this shop wrote rather than a register.
             */}
            <FieldHint label="Category" hint={PRODUCT_CATEGORY_RULE}>
              <input
                className={fieldControlClasses}
                list="product-categories"
                value={category}
                required
                placeholder="Jackets"
                autoComplete="off"
                onChange={(event) => setCategory(event.target.value)}
              />
            </FieldHint>
            <datalist id="product-categories">
              {draftCategories.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
            <DerivedIdField
              label="Handle"
              hint={PRODUCT_HANDLE_RULE}
              value={handle}
              suggested={suggestedHandle}
              taken={takenHandles}
              takenBase={takenHandleBase}
              takenPlace="in the draft"
              pattern={KEBAB_PATTERN}
              title={PRODUCT_HANDLE_RULE}
              placeholder="alpine-shell-jacket"
              required
              onChange={setHandle}
            />
            <button className={accentButtonClasses} type="submit">
              <ButtonIcon verb="save" />
              Add to draft
            </button>
            <p className="text-xs text-admin-muted">
              New products start without variants; add options and variants in the editor, then save
              the draft.
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}
