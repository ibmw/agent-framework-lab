import type { SandboxPinSchema } from "@agent-lab/contracts";

type DefinitionType = SandboxPinSchema["definition_type"];

/**
 * Where a pinned version is read from: the editor of the draft that produced it (ADR 0068).
 *
 * A published version is immutable and, except for the shop's, has no page of its own — every
 * editor shows the draft, and every version of a definition was cut from that one draft. So a
 * version chip on the results opens the editor of what it pinned, which is where a reviewer
 * reads what the version says and what has moved on since. The shop is the exception because
 * it does have a page per published version (`/shops/:shopId/versions/:version`), and a page
 * that shows the pinned version itself beats one that shows the draft it came from.
 *
 * The shop-scoped editors are addressed under the shop the run belongs to, which is the shop
 * every one of its pins resolved in. One entry per member of the contract's union, so a
 * definition type the contract gains is a type error here rather than a chip that links
 * nowhere.
 */
const PATHS: Readonly<
  Record<DefinitionType, (pin: { id: string; version: number; shopId: string }) => string>
> = {
  shop: ({ id, version }) => `/shops/${id}/versions/${version}`,
  customer_profile: ({ id, shopId }) => `/shops/${shopId}/customers/${id}`,
  ticket: ({ id, shopId }) => `/shops/${shopId}/tickets/${id}`,
  scenario: ({ id, shopId }) => `/shops/${shopId}/scenarios/${id}`,
  support_identity: ({ id }) => `/lab/support-identities/${id}`,
  objective_block: ({ id }) => `/lab/objective-blocks/${id}`,
  mutation_block: ({ id }) => `/lab/mutation-blocks/${id}`,
  agent_configuration: ({ id }) => `/lab/agent-configurations/${id}`,
  judge_configuration: ({ id }) => `/lab/judges/${id}`,
};

/** The page a pinned version of a known definition type links to, in the run's shop. */
export function definitionPath(
  type: DefinitionType,
  id: string,
  version: number,
  shopId: string,
): string {
  return PATHS[type]({ id, version, shopId });
}

/**
 * The page a pinned version links to, in the shop the run was made in — or null for a type
 * this module does not know. The experiment record carries its pins' type as a free string
 * (`ResolvedDefinitionSchema`), so a type the lab adds before this table does is drawn as the
 * plain chip it was rather than as a link to nowhere.
 */
export function versionPath(
  type: string,
  id: string,
  version: number,
  shopId: string,
): string | null {
  return Object.hasOwn(PATHS, type)
    ? definitionPath(type as DefinitionType, id, version, shopId)
    : null;
}

/** Every definition type this module links, for the sweep that holds it to the contract. */
export const LINKED_DEFINITION_TYPES = Object.keys(PATHS) as DefinitionType[];
