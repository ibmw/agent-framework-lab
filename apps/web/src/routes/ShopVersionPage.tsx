import type { MediaReferenceSchema, ShopVersionResponse } from "@agent-lab/contracts";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LabApiError } from "../api/client";
import { getShopVersion, shopMediaUrl } from "../api/shops";
import {
  Card,
  DefaultToneChip,
  EntryCard,
  EntryId,
  EntryKind,
  EntryText,
  Fingerprint,
  PageHeader,
  StatusPill,
} from "../components/WorkspaceChrome";
import {
  ATTRIBUTE_TYPE,
  labelOf,
  PAYMENT_METHOD_KIND,
  POLICY_KIND,
  PRODUCT_STATUS,
  SUPPORT_CHANNEL,
  VARIANT_AVAILABILITY,
} from "../lib/enumLabels";
import { assetOf, mediaNames } from "../lib/media";
import { ratingLabel, variantOptionLabel, variantPriceLabel } from "../lib/shop";
import {
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  formatTimestamp,
  mediaThumbnailClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/useShopWorkspace";
import { useShopLibrary } from "./useShopLibrary";

export function ShopVersionPage() {
  const { version = "" } = useParams();
  const { shopId } = useShopWorkspace();
  const [published, setPublished] = useState<ShopVersionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The shop's images, which name a frozen entry by its file. The publish gate let this version
  // name only images the shop held, and nothing removes one (ADR 0076), so its thumbnails are
  // drawn without waiting: only the file name waits for the listing.
  const { library } = useShopLibrary(shopId);

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
        // The draft this version was published from is edited from the overview, which is
        // where its Review and Publish are.
        back={{
          to: `/shops/${shopId}`,
          label: "Overview",
          kind: "published version",
          detail: (
            <>
              frozen {formatTimestamp(published.published_at)} · content fingerprint{" "}
              <Fingerprint value={published.content_fingerprint} />
            </>
          ),
        }}
      />

      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>
          {content.products.map((product) => (
            <Card
              key={product.handle}
              title={`${product.title} · ${labelOf(PRODUCT_STATUS, product.status)}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <EntryId value={product.handle} />
                <EntryKind value={product.category} />
              </div>
              <p className="text-[13px] text-admin-ink-soft">{product.description}</p>
              {product.options.length > 0 ? (
                <ul className="grid gap-1 text-[13px]">
                  {product.options.map((option) => (
                    <li key={option.key} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{option.name}</span>
                      <EntryId value={option.key} />
                      <span className="text-admin-muted">{option.values.join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
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
                      <td className={tableCellClasses}>
                        <StatusPill
                          tone="availability"
                          label={labelOf(VARIANT_AVAILABILITY, variant.availability)}
                        />
                      </td>
                      <td className={tableCellClasses}>{variant.stock_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {product.media.length > 0 ? (
                <FrozenMedia
                  media={product.media}
                  names={mediaNames(product.media, library)}
                  urlOf={(sha256) => shopMediaUrl(shopId, sha256)}
                />
              ) : null}
              <p className="text-[13px] text-admin-muted">{ratingLabel(product)}</p>
              {product.reviews.length > 0 ? (
                <ul className="grid gap-1 text-[13px]">
                  {product.reviews.map((review) => (
                    <li key={review.id} className="flex flex-wrap items-start gap-2">
                      <span className="font-semibold">{review.rating}★</span>
                      <span className="min-w-0 [overflow-wrap:anywhere] text-admin-ink-soft">
                        “{review.body}” — {review.author_display_name}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {product.attributes.length > 0 ? (
                <ul className="grid gap-1 text-[13px]">
                  {product.attributes.map((attribute) => (
                    <li key={attribute.key}>
                      <span className="font-semibold">{attribute.label}</span>{" "}
                      <EntryId value={attribute.key} />{" "}
                      <span className="text-admin-muted">
                        ({labelOf(ATTRIBUTE_TYPE, attribute.attribute_type)})
                      </span>{" "}
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
                kind: labelOf(POLICY_KIND, entry.kind),
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
                isDefault: entry.is_default,
                label: "Guidance",
                text: entry.guidance,
              }))}
              empty="This version froze no tone-of-voice guideline."
            />
          </Card>
        </div>

        <div className={editorPanelClasses}>
          <Card title="Shop identity">
            <dl className="grid gap-1 text-[13px]">
              {(
                [
                  ["Name", content.identity.name],
                  ["Slug", content.identity.slug],
                  ["Locale", content.identity.locale],
                  ["Currencies", content.identity.currencies.join(" · ")],
                  [
                    "Support channels",
                    content.identity.channels
                      .map((channel) => labelOf(SUPPORT_CHANNEL, channel))
                      .join(" · "),
                  ],
                ] as const
              ).map(([term, value]) => (
                <div key={term} className="flex items-baseline gap-2">
                  <dt className="w-32 shrink-0 text-admin-muted">{term}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere] text-admin-ink-soft">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Payment methods">
            <ul className="grid gap-2 text-[13px]">
              {content.payment_methods.map((method) => (
                <EntryCard
                  key={method.id}
                  title={method.name}
                  chips={
                    <>
                      <EntryKind value={labelOf(PAYMENT_METHOD_KIND, method.kind)} />
                      <EntryId value={method.id} />
                      <span className="text-[12px] text-admin-muted">
                        {method.enabled ? "enabled" : "disabled"}
                      </span>
                    </>
                  }
                />
              ))}
            </ul>
          </Card>
          <Card title="Fulfillment methods">
            <ul className="grid gap-2 text-[13px]">
              {content.fulfilment_methods.map((method) => (
                <EntryCard
                  key={method.id}
                  title={method.name}
                  chips={
                    <>
                      <span className="text-[12px] text-admin-muted">
                        {method.carrier} · {method.min_transit_days}–{method.max_transit_days} days
                      </span>
                      <EntryId value={method.id} />
                    </>
                  }
                />
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * A frozen product's images (Slice 41): each a 48px thumbnail, its alt text as `alt`, with the
 * file name and the alt text beside it. A written reference a version stored before uploads
 * (ADR 0076) stays the code it is, with no image. An image is drawn from its reference alone,
 * because a published version names only images the shop holds; its file name is the
 * listing's, and until that is read — or if it cannot be — the short hash names it.
 */
function FrozenMedia({
  media,
  names,
  urlOf,
}: {
  media: readonly MediaReferenceSchema[];
  names: ReadonlyMap<string, string>;
  urlOf: (sha256: string) => string;
}) {
  return (
    <ul className="grid gap-2 text-[13px]">
      {media.map((entry) => {
        const sha256 = assetOf(entry.reference);
        const url = sha256 === null ? null : urlOf(sha256);
        return (
          <li key={entry.reference} className="flex flex-wrap items-center gap-2.5">
            {url === null ? null : (
              <img src={url} alt={entry.alt_text} className={mediaThumbnailClasses} />
            )}
            {sha256 === null ? (
              <code className="min-w-0 [overflow-wrap:anywhere] font-mono text-[12px]">
                {entry.reference}
              </code>
            ) : (
              <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                {names.get(entry.reference) ?? entry.reference}
              </span>
            )}
            <span className="text-admin-muted">{entry.alt_text}</span>
          </li>
        );
      })}
    </ul>
  );
}

interface FrozenDocument {
  id: string;
  title: string;
  /** A policy's kind; the other collections are not classified. */
  kind?: string;
  /** The tone this version resolved `{{shop.tone_of_voice}}` to. */
  isDefault?: boolean;
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
              {entry.kind ? <EntryKind value={entry.kind} /> : null}
              <EntryId value={entry.id} />
              {entry.isDefault ? <DefaultToneChip /> : null}
            </>
          }
        >
          <EntryText label={entry.label} value={entry.text} />
        </EntryCard>
      ))}
    </ul>
  );
}
