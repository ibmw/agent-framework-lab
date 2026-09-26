import type { MouseEvent } from "react";
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { type DraftProduct, productEntryState, type ShopDraft } from "../lib/productKeys";
import { duplicateProduct, findProduct } from "../lib/shop";
import { useShopWorkspace } from "../shell/useShopWorkspace";

/**
 * Duplicate, from the product editor's header or a catalog row (ADR 0062): a draft copy is
 * appended and its editor opened, where its name is answered — the landing *New product* has.
 *
 * One copy per intent, guarded where it appends:
 *
 * - The second click of a double-click is a repeat of the first (`detail > 1`). By the time it
 *   lands the page may already stand on the copy — a new mount, with a Duplicate of its own
 *   under the pointer — so no state of the page that answered the first click can hold it back.
 * - A press answered by a draft this hook has already appended a copy to, or by the draft it
 *   appended it from, is the same intent: it makes no second copy, and goes to the one made —
 *   which is also what a press does after the unsaved-work prompt kept the operator where they
 *   were. Any other edit to the draft in between makes the next press a new intent.
 */
export function useDuplicateProduct(): (key: string) => (event: MouseEvent) => void {
  const { shopId, content, edit, mintProductKey } = useShopWorkspace();
  const navigate = useNavigate();
  const made = useRef<{ from: ShopDraft; to: ShopDraft; copy: DraftProduct } | null>(null);

  function open(copy: DraftProduct) {
    navigate(`/shops/${shopId}/products/${encodeURIComponent(copy.handle)}`, {
      state: productEntryState(copy.key),
    });
  }

  return (key) => (event) => {
    if (event.detail > 1) {
      return;
    }
    const last = made.current;
    if (last !== null && (content === last.from || content === last.to)) {
      if (content === last.to && findProduct(content, last.copy.key) !== undefined) {
        open(last.copy);
      }
      return;
    }
    const duplicated = duplicateProduct(content, key, mintProductKey);
    if (duplicated === null) {
      return;
    }
    made.current = { from: content, to: duplicated.content, copy: duplicated.copy };
    edit(duplicated.content);
    open(duplicated.copy);
  };
}
