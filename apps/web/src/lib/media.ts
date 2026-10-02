import type { MediaReferenceSchema, ShopMediaAssetSchema } from "@agent-lab/contracts";
import { MEDIA_MAX_BYTES, MEDIA_TOO_LARGE_RULE, MEDIA_TYPE_RULE, MEDIA_TYPES } from "./fieldRules";

/**
 * A product's images as the workspace names and shows them (ADR 0076). An entry's reference is
 * `asset:sha256:<hex>` naming an image the shop holds; the shop's listing (`listShopMedia`) is
 * what says its file name, type and size. A stored draft may still hold a written reference
 * from before uploads, which names no image and is shown as the text it is.
 */

const ASSET_REFERENCE = /^asset:sha256:([0-9a-f]{64})$/;

/** The hash an entry's reference names, or none for a written reference. */
export function assetOf(reference: string): string | null {
  return ASSET_REFERENCE.exec(reference)?.[1] ?? null;
}

/** The reference a draft writes for an image the shop holds. */
export function assetReference(sha256: string): string {
  return `asset:sha256:${sha256}`;
}

/** The shop's images by hash, for naming and describing a product's entries. */
export type ShopMediaLibrary = ReadonlyMap<string, ShopMediaAssetSchema>;

export function libraryOf(assets: readonly ShopMediaAssetSchema[]): ShopMediaLibrary {
  return new Map(assets.map((asset) => [asset.sha256, asset]));
}

/** What one entry is called on its item and on its controls. */
function baseName(entry: MediaReferenceSchema, library: ShopMediaLibrary): string {
  const sha256 = assetOf(entry.reference);
  if (sha256 === null) {
    return entry.reference;
  }
  return library.get(sha256)?.file_name ?? `image ${sha256.slice(0, 8)}`;
}

/**
 * Each entry's name, by reference: its image's file name, or — where two entries of the product
 * carry the same file name — "{file name} ({first eight hex of its hash})", so every Edit and
 * Remove on the list names one entry.
 */
export function mediaNames(
  media: readonly MediaReferenceSchema[],
  library: ShopMediaLibrary,
): Map<string, string> {
  const bases = media.map((entry) => baseName(entry, library));
  const counts = new Map<string, number>();
  for (const base of bases) {
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return new Map(
    media.map((entry, index) => {
      const base = bases[index];
      const sha256 = assetOf(entry.reference);
      const shared = (counts.get(base) ?? 0) > 1;
      return [
        entry.reference,
        shared && sha256 !== null ? `${base} (${sha256.slice(0, 8)})` : base,
      ];
    }),
  );
}

const TYPE_LABELS: Record<ShopMediaAssetSchema["content_type"], string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
};

export function mediaTypeLabel(contentType: ShopMediaAssetSchema["content_type"]): string {
  return TYPE_LABELS[contentType];
}

/** A size as the item says it: bytes under a kibibyte, then KB and MB to one decimal. */
export function formatByteSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** An image's type and size, as one item's detail says them after its alt text. */
export function mediaFacts(asset: ShopMediaAssetSchema): string {
  return `${mediaTypeLabel(asset.content_type)} · ${formatByteSize(asset.byte_size)}`;
}

/**
 * Why a file is refused before it is uploaded, in the lab's own words, or none.
 *
 * The browser's type is read from the name, so it is only the first filter: a file whose type
 * the browser does not know is left to the lab, which tells the type from the first bytes.
 */
export function localMediaRefusal(file: File): string | null {
  if (file.type !== "" && !(MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return MEDIA_TYPE_RULE;
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return MEDIA_TOO_LARGE_RULE;
  }
  return null;
}
