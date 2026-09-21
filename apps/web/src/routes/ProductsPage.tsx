import type { DefinitionIssueSchema, ProductViewSchema } from "@agent-lab/contracts";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { SearchField, SearchRow } from "../components/SearchField";
import {
  EditorSaveActions,
  PageHeader,
  StatusPill,
  VersionChips,
} from "../components/WorkspaceChrome";
import { uniqueId } from "../lib/entryIds";
import { labelOf, PRODUCT_STATUS } from "../lib/enumLabels";
import { filterList } from "../lib/filters";
import { issuesForProduct, productTitle, ratingLabel } from "../lib/shop";
import { accentButtonClasses, surfaceClasses, tableCellClasses, tableHeadClasses } from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";

/**
 * The handle a brand-new product is addressed by, before it has a title to derive one from.
 *
 * The prototype appends a record with an empty handle and lets the editor ask for one
 * (:6931); this workspace addresses a product editor *by* its handle, so a product with no
 * handle has no address and cannot be opened. The draft's own handles decide the suffix, so a
 * second unnamed product is `new-product-2` rather than a collision.
 */
const NEW_PRODUCT_HANDLE = "new-product";

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
  const { shopId, content, preview, edit, save, saving, discard, discarding, dirty, error } =
    useShopWorkspace();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  /**
   * Products are the one create in the workspace that is not a page (PLAN-UX Slice 12).
   *
   * A product has no identity of its own to answer for: it is a row of the shop draft the
   * shell already holds, so there is nothing to POST, nothing to be refused and nothing to
   * wait for. The prototype appends a draft product and opens its editor (:6931), and so does
   * this — which also moves the rail's figure in the same commit, because that figure is
   * `draft.products.length` and not a listing at all (ADR 0056).
   *
   * The draft is left dirty and unsaved, which is the editor's own subject: the editor draws
   * the shop draft's Save, and `shopDraftIsSavableAt` covers `/products/:handle`, so the
   * navigation asks nothing (ADR 0051).
   */
  function newProduct() {
    const handle = uniqueId(
      NEW_PRODUCT_HANDLE,
      content.products.map((product) => product.handle),
    );
    edit({
      ...content,
      products: [...content.products, emptyProduct(handle, "", "")],
    });
    navigate(`/shops/${shopId}/products/${handle}`);
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
            <EditorSaveActions
              tone="outline"
              dirty={dirty}
              saving={saving}
              discarding={discarding}
              onSave={() => void save()}
              onDiscard={() => void discard()}
            />
            <button
              className={accentButtonClasses}
              type="button"
              data-tour="new-product"
              onClick={newProduct}
            >
              New product
            </button>
          </>
        }
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

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
                        {productTitle(product)}
                      </Link>
                      <div className="text-admin-muted">{product.category}</div>
                    </td>
                    <td className={tableCellClasses}>
                      <StatusPill tone="product" label={labelOf(PRODUCT_STATUS, product.status)} />
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
    </>
  );
}
