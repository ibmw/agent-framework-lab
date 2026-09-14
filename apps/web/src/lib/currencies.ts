import type { ShopContentSchema } from "@agent-lab/contracts";

/**
 * What `Currency` in `domain/shop.py` permits; the contract is the only authority on it.
 *
 * The words each code is read in are `CURRENCY` in `lib/enumLabels.ts`, where every table over
 * a contract union lives.
 */
export type Currency = ShopContentSchema["identity"]["currencies"][number];
