import type { ShopMediaAssetSchema } from "@agent-lab/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeApiError } from "../api/client";
import { listShopMedia } from "../api/shops";
import { libraryOf, libraryOrder } from "../lib/media";

/**
 * The shop's images, as the Media card names its items by and its library offers them, and as
 * a frozen version names its images by (Slice 41): read when the surface opens and again after
 * each upload (Slice 40b). An upload is put first at once,
 * so the image just uploaded is named and offered before the listing that follows it answers.
 * Only the latest read lands, so a slow first listing never takes back an upload's.
 */
export function useShopLibrary(shopId: string) {
  const [state, setState] = useState<{
    assets: ShopMediaAssetSchema[];
    read: boolean;
    failure: string | null;
  }>({ assets: [], read: false, failure: null });
  const latest = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const reread = useCallback(() => {
    const reading = ++latest.current;
    const signal = controller.current?.signal;
    listShopMedia(shopId, signal)
      .then((listing) => {
        if (reading !== latest.current) {
          return;
        }
        setState({ assets: libraryOrder(listing.media), read: true, failure: null });
      })
      .catch((error: unknown) => {
        if (reading !== latest.current || signal?.aborted) {
          return;
        }
        // Unread, the items keep their hashes as names and say nothing they cannot know; the
        // library says it could not be read until a listing answers, and never empties itself.
        setState((now) => ({
          ...now,
          failure: describeApiError(error, "the lab did not answer."),
        }));
      });
  }, [shopId]);

  useEffect(() => {
    controller.current = new AbortController();
    setState({ assets: [], read: false, failure: null });
    reread();
    return () => controller.current?.abort();
  }, [reread]);

  return {
    ...state,
    library: libraryOf(state.assets),
    uploaded(asset: ShopMediaAssetSchema) {
      setState((now) => ({ ...now, assets: libraryOrder([asset, ...now.assets]) }));
      reread();
    },
  };
}
