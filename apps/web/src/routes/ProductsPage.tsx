import type { ProductViewSchema } from "@agent-lab/contracts";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { TourLaunch } from "../components/TourLaunch";
import { Card, PageHeader, VersionChips } from "../components/WorkspaceChrome";
import { issuesForProduct, ratingLabel } from "../lib/shop";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
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

export function ProductsPage() {
  const { content, preview, edit, save, saving, dirty, error } = useShopWorkspace();
  const [handle, setHandle] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");

  function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    edit({
      ...content,
      products: [...content.products, emptyProduct(handle, title, category)],
    });
    setHandle("");
    setTitle("");
    setCategory("");
  }

  return (
    <>
      <PageHeader
        title="Products"
        chips={<VersionChips preview={preview} />}
        description="The product editor edits the shop draft. Publishing the shop freezes the catalog."
        actions={
          <>
            <TourLaunch id="products" />
            <button
              className={accentButtonClasses}
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : dirty ? "Save draft" : "Saved"}
            </button>
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
          {content.products.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">
              This shop sells nothing yet. A published shop must sell at least one product.
            </p>
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
                {content.products.map((product) => {
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
                      <td className={tableCellClasses}>{product.status}</td>
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
            <label className={fieldLabelClasses}>
              Handle
              <input
                className={fieldControlClasses}
                value={handle}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lowercase kebab-case, for example alpine-shell-jacket"
                onChange={(event) => setHandle(event.target.value)}
              />
            </label>
            <label className={fieldLabelClasses}>
              Title
              <input
                className={fieldControlClasses}
                value={title}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className={fieldLabelClasses}>
              Category
              <input
                className={fieldControlClasses}
                value={category}
                required
                onChange={(event) => setCategory(event.target.value)}
              />
            </label>
            <button className={accentButtonClasses} type="submit">
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
