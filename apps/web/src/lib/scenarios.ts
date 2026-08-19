export const MAX_SEED = 4_294_967_295;

/** Matches the four-item catalog in `scenario_generation.py`; generation always selects two. */
export const CATALOG_SIZE = 4;

export interface ScenarioReference {
  id: string;
  version: string;
}

export interface ScenarioOption extends ScenarioReference {
  name: string;
  description: string;
  suggestedCustomerMessage: string;
  goal: string;
}

export const scenarios: ScenarioOption[] = [
  {
    id: "retail-profile",
    version: "v1",
    name: "Retail customer profile",
    description: "A fictional customer, two products, and one paid order.",
    suggestedCustomerMessage: "Hi, could you tell me which orders and products are on my account?",
    goal: "You're a customer who wants a clear picture of your account. Start by asking what products and orders are on file, then follow up on whatever is unclear — an order's status, a product's price, or how many items you have. You're done once you understand your account.",
  },
  {
    id: "retail-order-cancellation",
    version: "v1",
    name: "Safe order cancellation",
    description: "A paid order that can be cancelled only after exact confirmation.",
    suggestedCustomerMessage: "Hi, I'd like to cancel my paid order. Can you help me?",
    goal: "You're a customer who wants to cancel your paid order. Ask the agent to cancel it and confirm which order you mean. Then use the Safe order action panel to Propose, Confirm, and Execute — the order only changes after you confirm the exact action.",
  },
];

export function scenarioValue(scenario: ScenarioReference): string {
  return `${scenario.id}@${scenario.version}`;
}

export function findScenarioOption(
  scenarioId: string,
  scenarioVersion: string,
): ScenarioOption | undefined {
  return scenarios.find(
    (scenario) => scenario.id === scenarioId && scenario.version === scenarioVersion,
  );
}

export function validateSeed(value: string): string | undefined {
  const normalized = value.trim();
  if (normalized === "") {
    return "Enter a seed to make this persona replayable.";
  }
  if (!/^\d+$/.test(normalized)) {
    return `Use decimal digits for a whole number from 0 to ${MAX_SEED.toLocaleString("en-US")}.`;
  }
  if (Number(normalized) > MAX_SEED) {
    return `Use a whole number from 0 to ${MAX_SEED.toLocaleString("en-US")}.`;
  }
}

export interface PersonaRef {
  scenarioId: string;
  scenarioVersion: string;
  seed: number;
}

const REF_SEPARATOR = "~";

export function encodePersonaRef(ref: PersonaRef): string {
  return [ref.scenarioId, ref.scenarioVersion, ref.seed].join(REF_SEPARATOR);
}

export function decodePersonaRef(raw: string | undefined): PersonaRef | null {
  if (!raw) {
    return null;
  }
  const parts = raw.split(REF_SEPARATOR);
  if (parts.length !== 3) {
    return null;
  }
  const [scenarioId, scenarioVersion, seedText] = parts;
  if (!scenarioId || !scenarioVersion || !/^\d+$/.test(seedText)) {
    return null;
  }
  const seed = Number(seedText);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_SEED) {
    return null;
  }
  return { scenarioId, scenarioVersion, seed };
}

export function personaPath(ref: PersonaRef): string {
  return `/personas/${encodePersonaRef(ref)}`;
}

export function conversationPath(ref: PersonaRef, conversationId: string): string {
  return `${personaPath(ref)}/conversations/${conversationId}`;
}

export function comparePath(ref: PersonaRef, a: string, b: string): string {
  const params = new URLSearchParams({ a, b });
  return `${personaPath(ref)}/compare?${params.toString()}`;
}

export function formatMoney(amount: string, currency: string): string {
  const symbols: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
  const symbol = symbols[currency];
  return symbol ? `${symbol}${amount}` : `${amount} ${currency}`;
}

export function truncateHash(hash: string): string {
  if (hash.length <= 20) {
    return hash;
  }
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

export function parseConversationPath(
  path: string | null,
): { personaPath: string; conversationId: string } | null {
  if (!path) {
    return null;
  }
  const match = path.match(/^(\/personas\/[^/]+)\/conversations\/([^/?#]+)/);
  if (!match) {
    return null;
  }
  return { personaPath: match[1], conversationId: match[2] };
}
