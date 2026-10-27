import type { DefinitionIssueSchema, ProductViewSchema } from "@agent-lab/contracts";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { shopMediaUrl } from "../api/shops";
import { ButtonIcon } from "../components/ButtonIcon";
import { RemovalNotice } from "../components/ConfirmRemove";
import { type FilterChipDefinition, FilterChips } from "../components/FilterChips";
import { RemoveButton } from "../components/ItemList";
import { ProductDeleteConfirm } from "../components/ProductDeleteConfirm";
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
import { assetOf } from "../lib/media";
import { type DraftProduct, productEntryState } from "../lib/productKeys";
import { useArrivedRemoval, useRemoval } from "../lib/removal";
import {
  issuesForProduct,
  NEW_PRODUCT_HANDLE,
  productTitle,
  ratingLabel,
  removeProduct,
} from "../lib/shop";
import {
  accentButtonClasses,
  catalogImageTileClasses,
  subtleButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
  tableScrollerClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";
import { useDuplicateProduct } from "./useDuplicateProduct";

function emptyProduct(key: string, handle: string): DraftProduct {
  return {
    key,
    handle,
    title: "",
    description: "",
    status: "draft",
    category: "",
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
  const {
    shopId,
    content,
    preview,
    edit,
    save,
    saving,
    discard,
    discarding,
    dirty,
    error,
    mintProductKey,
  } = useShopWorkspace();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // The row actions' Delete, and the editor header's, which lands here to say what it deleted.
  // Both notices are keyed by the product's key, which a discard gives back to a product it
  // restores: the notice clears exactly when that product is in the draft again, and outlives a
  // discard that restored nothing (ADR 0062). An armed row is still dropped by a discard.
  const removal = useRemoval(shopId, discarding, true);
  useArrivedRemoval(removal);
  const duplicate = useDuplicateProduct();
  // Every product in the draft, not only the rows the search and the chips leave drawn: a
  // product a discard put back is back whether or not this view shows it.
  for (const product of content.products) {
    removal.present(product.key);
  }

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
    // Its key is minted as it is appended, and the entry is stamped with it, so the editor
    // follows this product rather than whatever the address comes to spell (ADR 0061).
    const key = mintProductKey();
    edit({
      ...content,
      products: [...content.products, emptyProduct(key, handle)],
    });
    navigate(`/shops/${shopId}/products/${encodeURIComponent(handle)}`, {
      state: productEntryState(key),
    });
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
              <ButtonIcon verb="create" />
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
        <SearchRow title="Catalog">
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
          <div className={tableScrollerClasses}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={tableHeadClasses}>Product</th>
                  <th className={tableHeadClasses}>Status</th>
                  <th className={tableHeadClasses}>Variants</th>
                  <th className={tableHeadClasses}>Ratings</th>
                  <th className={tableHeadClasses}>Findings</th>
                  <th className={tableHeadClasses}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((product) => {
                  const findings = issuesForProduct(preview?.issues ?? [], product.handle);
                  const errors = findings.filter((issue) => issue.severity === "error").length;
                  const deletedNotice = `Deleted “${productTitle(product)}” from the draft.`;
                  if (removal.isArmed(product.key)) {
                    return (
                      <ProductDeleteConfirm
                        key={product.key}
                        product={product}
                        as="tr"
                        columns={6}
                        onConfirm={removal.confirm(
                          () => edit(removeProduct(content, product.key)),
                          deletedNotice,
                        )}
                        onKeep={removal.keep}
                      />
                    );
                  }
                  return (
                    <tr key={product.key}>
                      <td className={tableCellClasses}>
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <CatalogImage shopId={shopId} product={product} />
                          <div className="min-w-0">
                            <Link
                              className="font-semibold text-lab-ink underline-offset-2 hover:underline"
                              to={encodeURIComponent(product.handle)}
                              state={productEntryState(product.key)}
                            >
                              {productTitle(product)}
                            </Link>
                            <div className="text-admin-muted">{product.category}</div>
                          </div>
                        </div>
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
                      <td className={tableCellClasses}>
                        <span className="flex items-center justify-end gap-[11px]">
                          <button
                            className={subtleButtonClasses}
                            type="button"
                            aria-label={`Duplicate ${productTitle(product)}`}
                            onClick={duplicate(product.key)}
                          >
                            Duplicate
                          </button>
                          <RemoveButton
                            name={productTitle(product)}
                            label={`Delete ${productTitle(product)}`}
                            entryKey={product.key}
                            removal={removal}
                            notice={deletedNotice}
                            onRemove={() => edit(removeProduct(content, product.key))}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
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
 * A product's first image as a 30px tile before its title (Slice 41), as the shops index draws
 * a shop's logo before its name; a product with no uploaded image draws nothing in its place. Decorative,
 * as the shop's badge is: the title beside it names the row, and the alt text is read on the
 * product's Media card. A draft write takes only images the shop holds and nothing removes one
 * while the shop stands (ADR 0076), so an image reference here names an image the lab serves; a
 * written reference a draft held from before uploads is not an image and is passed over.
 */
function CatalogImage({ shopId, product }: { shopId: string; product: DraftProduct }) {
  // The first entry that is an image: a written reference before it is not one.
  const first = product.media.find((entry) => assetOf(entry.reference) !== null);
  const sha256 = first === undefined ? null : assetOf(first.reference);
  if (sha256 === null) {
    return null;
  }
  return <img src={shopMediaUrl(shopId, sha256)} alt="" className={catalogImageTileClasses} />;
}
