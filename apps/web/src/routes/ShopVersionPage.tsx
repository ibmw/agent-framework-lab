import type { ShopVersionResponse } from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LabApiError } from "../api/client";
import { getShopVersion } from "../api/shops";
import {
  Card,
  EntryCard,
  EntryId,
  EntryText,
  Fingerprint,
  PageHeader,
} from "../components/WorkspaceChrome";
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
                      <EntryId value={attribute.key} />{" "}
                      <span className="text-admin-muted">({attribute.attribute_type})</span>{" "}
                      {attribute.value}
                      {attribute.unit ? ` ${attribute.unit}` : ""}
                      {attribute.choices.length > 0 ? (
                        <span className="text-admin-muted">
                          {" "}
                          one of {attribute.choices.join(", ")}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}

          <Card title="Policies">
            <DocumentList
              entries={content.policies.map((entry) => ({
                id: entry.id,
                title: entry.title,
                kind: entry.kind,
                label: "Body",
                text: entry.body,
              }))}
              empty="This version froze no policy."
            />
          </Card>

          <Card title="FAQ">
            <DocumentList
              entries={content.faq.map((entry) => ({
                id: entry.id,
                title: entry.question,
                label: "Answer",
                text: entry.answer,
              }))}
              empty="This version froze no FAQ entry."
            />
          </Card>

          <Card title="Support guidelines">
            <DocumentList
              entries={content.support_guidelines.map((entry) => ({
                id: entry.id,
                title: entry.title,
                label: "Body",
                text: entry.body,
              }))}
              empty="This version froze no support guideline."
            />
          </Card>

          <Card title="Tone of voice">
            <DocumentList
              entries={content.tone_of_voice_guidelines.map((entry) => ({
                id: entry.id,
                title: entry.name,
                kind: entry.is_default ? "shop default" : undefined,
                label: "Guidance",
                text: entry.guidance,
              }))}
              empty="This version froze no tone-of-voice guideline."
            />
          </Card>
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
                  {method.name} · {method.kind} · {method.enabled ? "enabled" : "disabled"} ·{" "}
                  <EntryId value={method.id} />
                </li>
              ))}
              {content.fulfilment_methods.map((method) => (
                <li key={method.id}>
                  {method.name} · {method.carrier} · {method.min_transit_days}–
                  {method.max_transit_days} days · <EntryId value={method.id} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

interface FrozenDocument {
  id: string;
  title: string;
  /** A classification worth naming beside the title: a policy kind, the default tone. */
  kind?: string;
  label: string;
  text: string;
}

/**
 * The frozen documents an agent could read at this version, shown in full. A published
 * version that reported only how many documents it held could not be compared against the
 * draft that succeeded it, which is the whole point of freezing one.
 */
function DocumentList({ entries, empty }: { entries: FrozenDocument[]; empty: string }) {
  if (entries.length === 0) {
    return <p className="text-[13px] text-admin-muted">{empty}</p>;
  }
  return (
    <ul className="grid gap-2">
      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          title={entry.title}
          chips={
            <>
              {entry.kind ? (
                <span className="rounded bg-admin-canvas px-1.5 py-0.5 text-[11px] text-admin-muted">
                  {entry.kind}
                </span>
              ) : null}
              <EntryId value={entry.id} />
            </>
          }
        >
          <EntryText label={entry.label} value={entry.text} />
        </EntryCard>
      ))}
    </ul>
  );
}
