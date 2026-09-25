import type {
  ModelConnectionSource,
  ModelConnectionTestResponse,
  ModelEndpointOutcome,
  ProviderConnectionListResponse,
} from "@agent-lab/contracts";
import { describeProvider } from "./agents";

/**
 * The words and the prefilled endpoints the *Model provider* zone is drawn from (ADR 0052).
 *
 * Three tables live here, and each one is held to something outside itself.
 *
 * **The presets** are a label and a base URL, and deliberately nothing more. ADR 0052 is
 * explicit that they "live in the frontend, carry no contract change, and Custom is the
 * general case the other five are conveniences for": the lab records the provider as
 * `openai` whichever one is picked, because `openai` names *the protocol this lab has proven
 * it can speak* rather than the company. A preset that pretended to be a provider would
 * claim something `PROVEN_FRAMEWORKS` has not proven, which is the door ADR 0053 keeps.
 *
 * **The source table** and **the outcome table** are `Record`s over the contract's own
 * unions, so a member added to `openapi.yaml` and regenerated fails the typecheck here rather
 * than falling through to a page that renders nothing. `modelConnections.test.ts` then reads
 * the generated file and names the member, which is the arrangement `lib/enumLabels.ts` and
 * its sweep already use for the unions an operator reads as values. These two are not that:
 * neither member is ever rendered as a word of its own — each one *selects* a sentence — so
 * they are tables of prose here rather than label maps there.
 */

/** One prefilled endpoint and the name an operator recognises it by. */
export interface EndpointPreset {
  readonly id: string;
  readonly label: string;
  /** The endpoint picking this preset writes into the Base URL field. Empty for Custom. */
  readonly baseUrl: string;
  /** What this endpoint is, in one line, under the row's label. */
  readonly note: string;
}

/** The identifier of the general case: any endpoint the other five do not name. */
export const CUSTOM_PRESET_ID = "custom";

/**
 * The six the prototype draws (`Workspace.dc.html` :4003), in its order and its words.
 *
 * The notes are the prototype's, minus every clause about a model: the connection holds none
 * (ADR 0052), so a note promising one would describe a field this zone refuses to draw.
 * Custom is last and carries no endpoint, because it is what an unmatched base URL resolves
 * to rather than a sixth suggestion.
 */
export const ENDPOINT_PRESETS: readonly EndpointPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    note: "The hosted OpenAI API. This is what the build was proven against.",
  },
  {
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    note: "A model running on this machine. No key, no egress — useful for a run you do not want leaving the laptop.",
  },
  {
    id: "vllm",
    label: "vLLM",
    baseUrl: "http://localhost:8000/v1",
    note: "A self-hosted server on your own hardware. Point the base URL at the port it serves.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    note: "One key, many endpoints — including models whose native API this lab cannot speak.",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    note: "Hosted open-weight models behind an OpenAI-compatible endpoint.",
  },
  {
    id: CUSTOM_PRESET_ID,
    label: "Custom",
    baseUrl: "",
    note: "Anything else that speaks the OpenAI chat-completions API — a gateway, a proxy, a colleague's box.",
  },
] as const;

const CUSTOM_PRESET: EndpointPreset =
  ENDPOINT_PRESETS.find((preset) => preset.id === CUSTOM_PRESET_ID) ?? ENDPOINT_PRESETS[0];

/**
 * Which chip is lit, derived from the endpoint in the field rather than remembered beside it.
 *
 * Derived because the base URL is the only thing that is saved: a remembered chip and a typed
 * endpoint can disagree, and the page would then have two answers to *where is this pointed*.
 * Editing the field to a preset's endpoint lights that preset, which is the same behaviour
 * read from one value instead of two.
 *
 * The fold below is **not** the authority, and must never become one. `domain/model_connection.py`
 * decides what a stored endpoint is, refuses what it will not hold and answers 422; this only
 * decides which of six chips to draw. What it must not do is *disagree* with that module about
 * two spellings being one endpoint, because a chip lit for a URL the lab would store as a
 * different one is the page claiming a preset it does not hold — so it folds exactly what
 * `normalize_base_url` folds and nothing more, and anything it cannot read is Custom.
 */
export function presetForBaseUrl(baseUrl: string): EndpointPreset {
  const folded = foldEndpoint(baseUrl);
  if (folded === null) {
    return CUSTOM_PRESET;
  }
  return (
    ENDPOINT_PRESETS.find(
      (preset) => preset.baseUrl !== "" && foldEndpoint(preset.baseUrl) === folded,
    ) ?? CUSTOM_PRESET
  );
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = { http: 80, https: 443 };

/** `MAX_BASE_URL_LENGTH` in `domain/model_connection.py`: longer is refused, so is no preset. */
const MAX_BASE_URL_LENGTH = 2048;

/**
 * Python's `str.isspace()` set, which `str.strip()` removes and JavaScript's `trim()` does not
 * match: it includes the four information separators `\x1c`–`\x1f` and NEL `\x85`, and it
 * excludes the byte-order mark `\ufeff`, which `trim()` removes and the server keeps.
 */
const PYTHON_WHITESPACE =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PYTHON_STRIP = new RegExp(`^[${PYTHON_WHITESPACE}]+|[${PYTHON_WHITESPACE}]+$`, "g");

/** The C0 controls and space `urlsplit` strips from the front of a URL before it parses one. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching these controls is the point.
const URLSPLIT_LSTRIP = /^[\x00-\x20]+/;

/** `value` with what Python's `str.strip()` removes taken off both ends, as the server strips it. */
export function pythonStrip(value: string): string {
  return value.replace(PYTHON_STRIP, "");
}

/**
 * Whether saving the endpoint in the field would leave the lab holding what it holds: a trailing
 * slash, a shouted host or `:443` is the same endpoint and nothing to save. Only the typed side
 * is folded. The stored side is the lab's own spelling, and folding it too would call a value
 * the server would now store differently — one saved before its fold reached a fixed point —
 * the same as itself. Where the fold cannot read the typed side, it is compared as written once the server's strip
 * has taken whitespace off its ends.
 */
export function sameEndpoint(typed: string, stored: string): boolean {
  const folded = foldEndpoint(typed);
  return folded === null ? pythonStrip(typed) === stored : folded === stored;
}

/** Scheme, authority, path, query, fragment — the five parts `urlsplit` reads, in its order. */
const URL_PARTS = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/s;

/**
 * The spelling `normalize_base_url` would store, or `null` where it would store nothing a
 * preset could be.
 *
 * Folded, as the server folds them: surrounding whitespace in Python's own sense of it, then
 * the leading C0 controls and spaces `urlsplit` strips, and tab, CR and LF wherever they fall;
 * a value over the column's 2048 characters, which the server refuses; the scheme's and the host's case,
 * a host's trailing dots, a default port and a zero-padded one (the server reads the port as
 * an integer), an empty `?` or `#`, and trailing slashes on the path. **Not** folded, because
 * the server keeps them: the path's case, an inner `//`, a dot segment and a percent-escape —
 * which is why this is a hand parse rather than `new URL()`, which resolves the last two and
 * would light a chip for an endpoint the lab stores as something else.
 *
 * An IP literal is never canonicalised here, because no preset is spelled as one: whatever
 * form the server stores it in, it is not a preset's host. A bracketed host is answered
 * `null` for the same reason, which also covers the `[localhost]` the server refuses.
 */
export function foldEndpoint(baseUrl: string): string | null {
  // Repeated to a fixed point, as `normalize_base_url` is: cutting trailing slashes can expose
  // whitespace the strip would have removed, so `…/v1 /` is stored as `…/v1`.
  let current = foldOnce(baseUrl);
  while (current !== null) {
    const again = foldOnce(current);
    if (again === current) {
      return current;
    }
    current = again;
  }
  return null;
}

/** One pass of the fold; `foldEndpoint` repeats it until it changes nothing. */
function foldOnce(baseUrl: string): string | null {
  const candidate = pythonStrip(baseUrl);
  // Counted in code points, as Python's `len` counts them, rather than in UTF-16 units.
  if (candidate === "" || [...candidate].length > MAX_BASE_URL_LENGTH) {
    return null;
  }
  const parts = URL_PARTS.exec(candidate.replace(URLSPLIT_LSTRIP, "").replace(/[\t\n\r]/g, ""));
  if (parts === null) {
    return null;
  }
  const [, rawScheme, authority, path, query = "", fragment = ""] = parts;
  const scheme = rawScheme.toLowerCase();
  const defaultPort = DEFAULT_PORTS[scheme];
  // A lone `?` or `#` is an empty query or fragment, which the server drops; anything after
  // one is refused there, so it is no preset here.
  if (defaultPort === undefined || query.length > 1 || fragment.length > 1) {
    return null;
  }
  if (authority.includes("@") || authority.startsWith("[")) {
    return null;
  }
  const colon = authority.lastIndexOf(":");
  const host = (colon === -1 ? authority : authority.slice(0, colon))
    .toLowerCase()
    .replace(/\.+$/, "");
  const rawPort = colon === -1 ? "" : authority.slice(colon + 1);
  // A host outside ASCII is never a preset's, whatever case folding makes of it. A colon left
  // in the host is a second port, which the server refuses; a bracketed IPv6 host, the one place
  // a colon belongs, has already been answered above.
  if (
    host === "" ||
    host.includes(":") ||
    !/^[\x21-\x7e]+$/.test(host) ||
    !/^[0-9]*$/.test(rawPort)
  ) {
    return null;
  }
  const port = rawPort === "" ? null : Number.parseInt(rawPort, 10);
  if (port !== null && port > 65535) {
    return null;
  }
  const written = port === null || port === defaultPort ? host : `${host}:${port}`;
  return `${scheme}://${written}${path.replace(/\/+$/, "")}`;
}

/** What the zone says about one probe: the tone of the chip, and the sentence on it. */
export interface ProbeReading {
  readonly tone: "good" | "bad";
  readonly sentence: string;
}

/**
 * The three answers `POST …/test` may give, and the whole of what the zone says about each.
 *
 * Every sentence is about *this* call at *this* moment and says nothing that outlives it: the
 * route stores nothing, because "a stored green tick would be read as a promise the lab cannot
 * keep" (ADR 0052), and copy that read as a standing verdict would put that promise back on
 * the page the route refused to put it in the database.
 *
 * The upstream body is never here because it is never served — only the class of the status,
 * which is appended where one came back.
 */
const PROBE_SENTENCES: Readonly<Record<ModelEndpointOutcome, ProbeReading>> = {
  reachable: { tone: "good", sentence: "Answered and accepted the key" },
  refused: { tone: "bad", sentence: "Answered and rejected the key" },
  unreachable: { tone: "bad", sentence: "Nothing usable answered" },
};

/** Every outcome the table spells, for the sweep that holds it to the contract. */
export const PROBE_OUTCOMES = Object.keys(PROBE_SENTENCES) as ModelEndpointOutcome[];

/**
 * One probe, read out: the tone of the chip and the one sentence written on it.
 *
 * The round trip is always written, because it is the only quantity the answer carries. The
 * status class is written where one came back and left out where nothing answered, so that an
 * endpoint which said 404 is told apart from a host that said nothing at all.
 */
export function describeProbe(result: ModelConnectionTestResponse): ProbeReading {
  const reading = PROBE_SENTENCES[result.outcome];
  const status = result.status_class === null ? "" : ` · ${result.status_class}`;
  return {
    tone: reading.tone,
    sentence: `${reading.sentence} · ${result.latency_ms} ms${status}`,
  };
}

/** What the read-only zone says about which answer of the resolution chain is in force. */
export interface SourceReading {
  /** The sentence naming what won, written as a fact about configuration and never about a key. */
  readonly sentence: string;
  /**
   * What to do about it, where there is something to do. `null` where the state is simply
   * what the operator asked for and needs no remedy.
   */
  readonly remedy: string | null;
}

/**
 * Four answers, because the chain has four states and two of them are the same run mode.
 *
 * ADR 0052's *Decision* says "`/settings` states which of the two is in force"; its amendment
 * of 2026-09-22 narrows that to four and says why. `saved_unreadable` is the member the
 * narrowing exists for: a key is stored, the lab cannot open it, every advance refuses, and
 * `key_configured` — which reports a key's *presence* and never its readability — cannot tell
 * an operator any of that. So it is the one member here that carries a remedy, and the remedy
 * is the one ADR 0052 names: save the key again.
 *
 * Nothing here is derivable back into a fact about a secret. Which *configuration* won is not
 * a fact about what it contains.
 */
const SOURCE_SENTENCES: Readonly<Record<ModelConnectionSource, SourceReading>> = {
  saved: {
    sentence:
      "The connection saved in Model provider above is in force. It wins over the environment, which stays the bootstrap for a lab that has saved none.",
    remedy: null,
  },
  saved_unreadable: {
    sentence:
      "A connection is saved and this lab cannot read its key back, so it reaches nothing. The saved connection still wins — falling through to the environment would send the environment's key to the endpoint you pointed somewhere else — and it wins as an offline lab.",
    remedy:
      "Save the key again in Model provider above, under the AGENT_LAB_CREDENTIAL_KEY this API is running with.",
  },
  environment: {
    sentence:
      "No connection is saved, so AGENT_LAB_OPENAI_API_KEY from the API's environment is in force, at the OpenAI endpoint that key is issued for.",
    remedy: null,
  },
  none: {
    sentence:
      "No connection is saved and AGENT_LAB_OPENAI_API_KEY is not set, so this lab reaches no provider at all.",
    remedy: "Save a connection in Model provider above, which needs no restart.",
  },
};

/** Every source the table spells, for the sweep that holds it to the contract. */
export const CONNECTION_SOURCES = Object.keys(SOURCE_SENTENCES) as ModelConnectionSource[];

/** Which answer of the resolution chain won, read out. */
export function describeSource(source: ModelConnectionSource): SourceReading {
  return SOURCE_SENTENCES[source];
}

/**
 * What the *Model provider* zone says, above its form, about the answer in force — for the two
 * sources where the form alone would mislead.
 *
 * A lab with no saved connection opens the zone on Custom and an empty Base URL, which reads as
 * *this lab is pointed nowhere* whether or not the environment is pointing it somewhere. So the
 * zone says which it is, in its own place rather than only inside the collapsed read-out below.
 * `saved` needs nothing: the form *is* what is in force. `saved_unreadable` is said on the API
 * key row instead, because that is the row an operator acts on to remedy it (ADR 0052).
 */
const ZONE_SENTENCES: Readonly<Record<ModelConnectionSource, string | null>> = {
  saved: null,
  saved_unreadable: null,
  environment:
    "Nothing is saved here yet, so the lab runs on AGENT_LAB_OPENAI_API_KEY from the API's environment, at the OpenAI endpoint that key is issued for. A connection saved here takes over from it, with no restart.",
  none: "Nothing is saved here yet and the API's environment holds no key, so this lab reaches no provider. A connection saved here takes effect with no restart.",
};

/** The zone's own line about what is in force, or `null` where its form already says it. */
export function describeZoneSource(source: ModelConnectionSource): string | null {
  return ZONE_SENTENCES[source];
}

/**
 * Whether each answer of the resolution chain reaches a provider: `ResolvedConnection
 * .reaches_provider` in `application/model_connections.py`, which is set exactly for `saved`
 * and `environment`. A saved key the lab cannot decrypt reaches nothing — ADR 0052 has it win
 * "as an offline lab" — so it is unreachable here as it is at the advance.
 *
 * A `Record` over the contract union, so a fifth source fails the typecheck rather than
 * falling through to an answer nobody chose.
 */
const SOURCE_REACHES: Readonly<Record<ModelConnectionSource, boolean>> = {
  saved: true,
  saved_unreadable: false,
  environment: true,
  none: false,
};

/**
 * The provider `getLabStatus`'s `connection_source` is about.
 *
 * The contract does not say, so it is named here from the code that decides it: the route's
 * resolution is `ModelConnectionResolver(…).resolve(OPENAI_PROVIDER)` in `presentation/api.py`
 * (`resolve_connection`). The source is only applied to a provider carrying this id, so a lab
 * whose one connectable provider were anything else would get silence rather than another
 * provider's answer. Held to the API through `apps/api/tests/fixtures/lab_status_provider.json`,
 * which `test_gate_and_connection.py` asserts behaviourally.
 */
export const LAB_STATUS_PROVIDER = "openai";

/**
 * The providers this lab holds no usable connection for, right now — or `null` where the two
 * reads cannot say.
 *
 * Read from the two resources that already exist rather than from a new one (ADR 0053 changes
 * no contract). `listModelConnections` names every provider that *can* hold a connection; a
 * provider it does not name is either the declared control, which reaches nothing and so
 * always runs, or one the publish gate already refuses, and neither is this note's business.
 * `getLabStatus` says which answer of the chain is in force, and that answer is the one the
 * API resolves for the one connectable provider — the same resolution the registry composes a
 * runtime from, so a note drawn from it cannot disagree with the 422 an advance would give.
 *
 * The source is not keyed by provider, so it can only be attributed while exactly one provider
 * is connectable and it is the one the route resolves, `LAB_STATUS_PROVIDER` — which is true
 * today and true for the reason ADR 0052 gives. Otherwise the answer is `null`, and every
 * surface says nothing rather than guess which provider the source was about.
 */
export function unreachableProviders(
  connections: ProviderConnectionListResponse,
  source: ModelConnectionSource,
): ReadonlySet<string> | null {
  if (connections.providers.length === 0) {
    return new Set();
  }
  const [only, ...others] = connections.providers;
  if (others.length > 0 || only.provider_id !== LAB_STATUS_PROVIDER) {
    return null;
  }
  return SOURCE_REACHES[source] ? new Set() : new Set([only.provider_id]);
}

/**
 * What the workspace says beside a provider this lab cannot reach (ADR 0053).
 *
 * **A note, never a finding.** It is not a publish-gate sentence and must never be written
 * into `preview.issues` or into `lib/fieldRules.ts`: the gate is machine-independent by
 * construction and has no such sentence, and `fieldRules.test.ts` asserts that neither the
 * mirrored set nor any Python module carries this one. A configuration naming a provider the
 * lab is not pointed at is valid and publishable; it is only unrunnable *here*, and the
 * authority for that is the advance, which refuses with 422 `agent_runtime_unavailable`.
 *
 * The provider is named rather than written as "this provider", so that the same sentence
 * reads beside the Provider field and beside experiment setup's Start, where no field is near.
 */
export function unreachableProviderNote(providerLabel: string): string {
  return `Published configurations naming ${providerLabel} cannot be advanced here until the lab has a connection for it.`;
}

/**
 * Why a control that starts or derives an experiment will not, or `""` when nothing stops it
 * (ADR 0053 and its amendment): setup's Start, Replay, and Fork.
 *
 * `providers` are the ones the arms it would run name, one per arm, with `null` for an arm
 * whose provider is not known — not yet read, or unreadable — which says nothing rather than
 * something. One sentence per provider, so two arms on one unreachable provider are one
 * reason rather than two. A lab whose reach is not known (`null`) blocks nothing.
 */
export function unreachableArmsNote(
  providers: readonly (string | null)[],
  unreachable: ReadonlySet<string> | null,
): string {
  if (unreachable === null) {
    return "";
  }
  return [
    ...new Set(
      providers.filter(
        (provider): provider is string => provider !== null && unreachable.has(provider),
      ),
    ),
  ]
    .map((provider) => unreachableProviderNote(describeProvider(provider)))
    .join(" ");
}
