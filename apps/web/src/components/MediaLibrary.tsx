import type { ShopMediaAssetSchema } from "@agent-lab/contracts";
import { useId } from "react";
import { libraryNames, libraryOptionName, mediaFacts } from "../lib/media";
import { mediaLibraryThumbnailClasses, mediaLibraryTileClasses } from "../lib/ui";

/** What the library says when the shop holds no image yet. */
const LIBRARY_EMPTY = "No image uploaded to this shop yet.";

/** What an image this product already shows says on its tile. */
const LIBRARY_HELD = "Already an image of this product";

/** What the library says when this product already shows every image the shop holds. */
const LIBRARY_ALL_HELD = "Every image of this shop is already this product's.";

/**
 * The shop's library in the Media card's *Image* field (Slice 40b, ADR 0076): every image the
 * shop holds, newest first, each a radio named "{file name}, {type}, {size}" over its 72px
 * thumbnail, so one image serves several products without being uploaded again. Picking one
 * chooses it as an upload would; nothing is requested.
 *
 * An image this product's entries already show is marked and not choosable. It is `disabled`
 * rather than `aria-disabled`, as the picker is while it uploads: the picker is unavailable for
 * a moment under a reader's focus, where a held image is never choosable in this form, and a
 * native radio group's arrow keys pass over a disabled radio and would check an `aria-disabled`
 * one. Should the form hold one all the same — an upload the lab answered with bytes this
 * product shows — it is still not checked: a group whose checked radio is disabled has no tab
 * stop in Chromium or Firefox, and the keyboard would lose the library. The drop zone shows
 * the image and the form's own refusal says why (ADR 0076).
 */
export function MediaLibrary({
  assets,
  read,
  failure,
  held,
  chosen,
  urlOf,
  onPick,
}: {
  /** The shop's images, newest first. */
  assets: readonly ShopMediaAssetSchema[];
  /** A listing has answered, so an empty library is known to be empty. */
  read: boolean;
  /** Why the listing could not be read, while none has been. */
  failure: string | null;
  /** The references this product's entries show. */
  held: readonly string[];
  /** The reference the form holds, or "". */
  chosen: string;
  urlOf: (sha256: string) => string;
  onPick: (asset: ShopMediaAssetSchema) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const names = libraryNames(assets);

  if (assets.length === 0 && !read && failure === null) {
    // Not read yet: saying it is empty would be a guess.
    return null;
  }

  return (
    <div className="grid gap-1.5">
      <span id={labelId} className="text-[12.5px] font-semibold text-admin-ink-soft">
        This shop's images
      </span>
      {failure !== null && !read ? (
        <p className="text-[13px] font-normal text-admin-muted">
          {`This shop's images could not be read: ${failure}`}
        </p>
      ) : null}
      {assets.length > 0 ? (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
        >
          {assets.map((asset) => {
            const name = names.get(asset.sha256) ?? asset.file_name;
            const isHeld = held.includes(asset.reference);
            const markId = `${id}-${asset.sha256}-held`;
            return (
              <label key={asset.sha256} className={mediaLibraryTileClasses}>
                <input
                  type="radio"
                  className="sr-only"
                  name={`${id}-image`}
                  aria-label={libraryOptionName(asset, name)}
                  aria-describedby={isHeld ? markId : undefined}
                  checked={!isHeld && chosen === asset.reference}
                  disabled={isHeld}
                  onChange={() => onPick(asset)}
                />
                {/* The radio's name says what it is; the image adds nothing to read. */}
                <img src={urlOf(asset.sha256)} alt="" className={mediaLibraryThumbnailClasses} />
                {/* Said by the radio's name already: hidden, so browse mode reads it once. */}
                <span
                  aria-hidden="true"
                  className="min-w-0 font-semibold text-admin-ink [overflow-wrap:anywhere]"
                >
                  {name}
                </span>
                <span aria-hidden="true">{mediaFacts(asset)}</span>
                {isHeld ? <span id={markId}>{LIBRARY_HELD}</span> : null}
              </label>
            );
          })}
        </div>
      ) : read ? (
        <p className="text-[13px] font-normal text-admin-muted">{LIBRARY_EMPTY}</p>
      ) : null}
      {assets.length > 0 && assets.every((asset) => held.includes(asset.reference)) ? (
        <p className="text-[13px] font-normal text-admin-muted">{LIBRARY_ALL_HELD}</p>
      ) : null}
    </div>
  );
}
