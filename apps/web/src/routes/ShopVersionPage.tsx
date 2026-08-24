import type { ShopVersionResponse } from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LabApiError } from "../api/client";
import { getShopVersion } from "../api/shops";
import { Card, Fingerprint, PageHeader } from "../components/WorkspaceChrome";
import { ratingLabel, variantOptionLabel, variantPriceLabel } from "../lib/shop";
import { formatTimestamp, tableCellClasses, tableHeadClasses } from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

export function ShopVersionPage() {
  const { version = "" } = useParams();
  const { shopId } = useShopWorkspace();
  const [published, setPublished] = useState<ShopVersionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getShopVersion(shopId, Number(version), controller.signal)
      .then(setPublished)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof LabApiError ? cause.message : "That version is unavailable.");
        }
      });
    return () => controller.abort();
  }, [shopId, version]);

  if (error) {
    return (
      <>
        <PageHeader title={`Version ${version}`} />
        <p role="alert" className="text-[13px] text-lab-error">
          {error}
        </p>
      </>
    );
  }

  if (!published) {
    return (
      <>
        <PageHeader title={`Version ${version}`} />
        <p className="text-[13px] text-admin-muted">Loading published version…</p>
      </>
    );
  }

  const content = published.content;

  return (
    <>
      <PageHeader
        title={`${content.identity.name} · v${published.version}`}
        chips={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-published px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-published-ink">
            <span aria-hidden>●</span> published · read only
          </span>
        }
        description={
          <>
            Frozen {formatTimestamp(published.published_at)} · content fingerprint{" "}
            <Fingerprint value={published.content_fingerprint} /> ·{" "}
            <Link className="font-semibold text-lab-ink" to="../..">
              back to the draft
            </Link>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          {content.products.map((product) => (
            <Card key={product.handle} title={`${product.title} · ${product.status}`}>
              <p className="text-[13px] text-admin-ink-soft">{product.description}</p>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={tableHeadClasses}>SKU</th>
                    <th className={tableHeadClasses}>Options</th>
                    <th className={tableHeadClasses}>Price</th>
                    <th className={tableHeadClasses}>Availability</th>
                    <th className={tableHeadClasses}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((variant) => (
                    <tr key={variant.sku}>
                      <td className={tableCellClasses}>{variant.sku}</td>
                      <td className={tableCellClasses}>{variantOptionLabel(variant)}</td>
                      <td className={tableCellClasses}>{variantPriceLabel(variant)}</td>
                      <td className={tableCellClasses}>{variant.availability}</td>
                      <td className={tableCellClasses}>{variant.stock_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[13px] text-admin-muted">{ratingLabel(product)}</p>
              {product.attributes.length > 0 ? (
                <ul className="grid gap-1 text-[13px]">
                  {product.attributes.map((attribute) => (
                    <li key={attribute.key}>
                      <span className="font-semibold">{attribute.label}</span>{" "}
                      <span className="text-admin-muted">({attribute.attribute_type})</span>{" "}
                      {attribute.value}
                      {attribute.unit ? ` ${attribute.unit}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>

        <div className="grid content-start gap-4">
          <Card title="Support knowledge">
            <p className="text-[13px] text-admin-ink-soft">
              {content.policies.length} policy document(s), {content.faq.length} FAQ entr
              {content.faq.length === 1 ? "y" : "ies"}, {content.support_guidelines.length} support
              guideline(s).
            </p>
            <p className="text-[13px] text-admin-muted">
              Default tone of voice: {content.default_tone_of_voice_id ?? "none"}
            </p>
          </Card>
          <Card title="Commerce configuration">
            <ul className="grid gap-1 text-[13px] text-admin-ink-soft">
              {content.payment_methods.map((method) => (
                <li key={method.id}>
                  {method.name} · {method.kind} · {method.enabled ? "enabled" : "disabled"}
                </li>
              ))}
              {content.fulfilment_methods.map((method) => (
                <li key={method.id}>
                  {method.name} · {method.carrier} · {method.min_transit_days}–
                  {method.max_transit_days} days
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
