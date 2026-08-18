import type {
  AgentFrameworkListResponse,
  ConversationResponse,
  GeneratedScenarioResponse,
} from "@agent-lab/contracts";
import { API_VERSION } from "@agent-lab/contracts";
import {
  ArrowRight,
  Check,
  Database,
  Fingerprint,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  Target,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  ConversationApiError,
  getConversation,
  listAgentFrameworks,
  startConversation,
} from "./api/conversations";
import {
  generateScenario,
  getGeneratedScenario,
  ScenarioApiError,
  type ScenarioReference,
} from "./api/scenarios";
import { SupportConversation } from "./SupportConversation";

const MAX_SEED = 4_294_967_295;
const panelClasses = "rounded-panel border border-lab-ink/20 bg-lab-paper/90 shadow-panel";
const fieldControlClasses =
  "min-h-13 w-full rounded-lg border border-lab-border bg-lab-paper px-3.5 text-lab-ink outline-none transition focus:border-lab-accent focus:ring-[3px] focus:ring-lab-accent/15 aria-invalid:border-lab-error disabled:cursor-not-allowed disabled:opacity-65";

interface ScenarioOption extends ScenarioReference {
  name: string;
  description: string;
  suggestedCustomerMessage: string;
  goal: string;
}

const scenarios: ScenarioOption[] = [
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

type RequestState = "idle" | "generating" | "retrieving";
type ResultSource = "generated" | "retrieved";
type ValidationField = "scenario" | "seed";

interface ValidationError {
  field: ValidationField;
  message: string;
}

function scenarioValue(scenario: ScenarioReference): string {
  return `${scenario.id}@${scenario.version}`;
}

function validateSeed(value: string): string | undefined {
  const normalized = value.trim();
  if (normalized === "") {
    return "Enter a seed to make this persona replayable.";
  }

  if (!/^\d+$/.test(normalized)) {
    return `Use decimal digits for a whole number from 0 to ${MAX_SEED.toLocaleString("en-US")}.`;
  }

  const seed = Number(normalized);
  if (seed > MAX_SEED) {
    return `Use a whole number from 0 to ${MAX_SEED.toLocaleString("en-US")}.`;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ScenarioApiError || error instanceof ConversationApiError) {
    return error.requestId ? `${error.message} (request ${error.requestId})` : error.message;
  }
  return "Could not reach the scenario API. Check the connection and try again.";
}

function PersonaResult({
  result,
  source,
  requestState,
  onRetrieve,
  onStartSupport,
  supportStarting,
  supportStarted,
}: {
  result: GeneratedScenarioResponse;
  source: ResultSource;
  requestState: RequestState;
  onRetrieve: () => void;
  onStartSupport: () => void;
  supportStarting: boolean;
  supportStarted: boolean;
}) {
  const { metadata, initial_state: initialState } = result;
  const { persona } = initialState;

  return (
    <section className={`${panelClasses} p-6 sm:p-8 lg:p-10`} aria-labelledby="persona-title">
      <div className="flex items-start justify-between gap-4 border-b border-lab-ink/15 pb-7">
        <div>
          <p className="mb-3 flex items-center gap-1.5 text-xs font-extrabold tracking-[0.11em] text-lab-success uppercase">
            <Check aria-hidden="true" size={14} />
            {source === "retrieved" ? "Retrieved from recorded inputs" : "Persona generated"}
          </p>
          <h2
            className="font-display mb-1.5 text-[clamp(2rem,4vw,3.3rem)] leading-tight font-medium tracking-[-0.04em]"
            id="persona-title"
          >
            {persona.display_name}
          </h2>
          <p className="m-0 text-lab-muted">{persona.email}</p>
        </div>
        <span className="rounded-md bg-lab-accent-soft px-2.5 py-1.5 font-mono text-xs font-bold text-lab-accent uppercase">
          {persona.locale}
        </span>
      </div>

      <div className="grid gap-8 py-7 sm:grid-cols-2">
        <div>
          <h3 className="mb-4 text-xs font-bold tracking-[0.06em] uppercase">Support profile</h3>
          <div className="flex flex-wrap gap-2">
            {persona.support_traits.map((trait) => (
              <span
                className="rounded-full border border-lab-ink/20 px-3 py-2 text-xs text-lab-ink-soft capitalize"
                key={trait}
              >
                {trait.replaceAll("_", " ")}
              </span>
            ))}
          </div>
          <dl className="mt-6 grid gap-2 min-[480px]:grid-cols-3 sm:grid-cols-1 lg:grid-cols-3">
            {[
              ["Products", initialState.products.length],
              ["Orders", initialState.orders.length],
              ["Order status", initialState.orders[0]?.status ?? "None"],
            ].map(([label, value]) => (
              <div className="rounded-lg bg-lab-subtle p-3" key={label}>
                <dt className="text-[0.68rem] text-lab-muted uppercase">{label}</dt>
                <dd className="mt-1 font-mono text-xs font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className="mb-4 flex items-center gap-2 text-xs font-bold tracking-[0.06em] uppercase">
            <Database aria-hidden="true" size={17} /> Replay context
          </h3>
          <dl className="grid gap-3">
            {[
              [
                "Scenario",
                scenarioValue({ id: metadata.scenario_id, version: metadata.scenario_version }),
              ],
              ["Seed", metadata.seed],
              ["Policy set", metadata.policy_set_version],
              ["Canonical schema", metadata.canonical_schema_version],
            ].map(([label, value]) => (
              <div
                className="flex items-baseline justify-between gap-4 border-b border-dashed border-lab-ink/15 pb-2"
                key={label}
              >
                <dt className="text-[0.68rem] text-lab-muted uppercase">{label}</dt>
                <dd className="mt-1 font-mono text-xs font-bold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="flex min-w-0 items-start gap-3 rounded-lg bg-lab-fingerprint p-3.5 text-lab-ink-soft">
        <Fingerprint className="shrink-0" aria-hidden="true" size={18} />
        <div className="min-w-0">
          <span className="mb-1 block text-[0.67rem] font-extrabold tracking-[0.06em] text-lab-muted uppercase">
            Initial-state SHA-256
          </span>
          <code className="block [overflow-wrap:anywhere] text-[0.7rem] leading-relaxed">
            {result.initial_state_hash}
          </code>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-lg border border-lab-border px-4 font-bold text-lab-ink-soft transition hover:bg-lab-subtle disabled:cursor-not-allowed disabled:opacity-65"
          type="button"
          onClick={onRetrieve}
          disabled={requestState !== "idle" || supportStarting}
        >
          <RotateCcw aria-hidden="true" size={16} />
          Retrieve recorded persona
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-lg bg-lab-ink px-4 font-bold text-lab-paper transition hover:bg-lab-ink-hover disabled:cursor-not-allowed disabled:opacity-65"
          type="button"
          onClick={onStartSupport}
          disabled={requestState !== "idle" || supportStarting || supportStarted}
        >
          {supportStarting ? (
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={16} />
          ) : supportStarted ? (
            <Check aria-hidden="true" size={16} />
          ) : (
            <MessageCircle aria-hidden="true" size={16} />
          )}
          {supportStarting
            ? "Starting support…"
            : supportStarted
              ? "Support conversation started"
              : "Start support conversation"}
        </button>
      </div>
    </section>
  );
}

export function App() {
  const [selectedScenario, setSelectedScenario] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [validationError, setValidationError] = useState<ValidationError>();
  const [requestError, setRequestError] = useState<string>();
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [result, setResult] = useState<GeneratedScenarioResponse>();
  const [resultSource, setResultSource] = useState<ResultSource>("generated");
  const [conversation, setConversation] = useState<ConversationResponse>();
  const [frameworks, setFrameworks] = useState<AgentFrameworkListResponse["frameworks"]>([]);
  const [supportStarting, setSupportStarting] = useState(false);

  useEffect(() => {
    const sessionId = window.localStorage.getItem("agent-lab-support-session");
    if (!sessionId) {
      return;
    }
    void getConversation(sessionId)
      .then(async (resumed) => {
        setConversation(resumed);
        const generated = await getGeneratedScenario(
          { id: resumed.scenario_id, version: resumed.scenario_version },
          resumed.seed,
        );
        setResult(generated);
        setResultSource("retrieved");
      })
      .catch(() => window.localStorage.removeItem("agent-lab-support-session"));
  }, []);

  const selectedOption = scenarios.find((scenario) => scenarioValue(scenario) === selectedScenario);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestError(undefined);

    if (!selectedOption) {
      setValidationError({
        field: "scenario",
        message: "Choose a scenario before generating a persona.",
      });
      return;
    }

    const seedError = validateSeed(seedInput);
    if (seedError) {
      setValidationError({ field: "seed", message: seedError });
      return;
    }

    setValidationError(undefined);
    setRequestState("generating");
    setResult(undefined);
    setConversation(undefined);
    setFrameworks([]);
    window.localStorage.removeItem("agent-lab-support-session");

    try {
      const generated = await generateScenario(selectedOption, Number(seedInput.trim()));
      setResult(generated);
      setResultSource("generated");
    } catch (error) {
      setRequestError(errorMessage(error));
    } finally {
      setRequestState("idle");
    }
  }

  async function handleRetrieve() {
    if (!result) {
      return;
    }

    const scenario = {
      id: result.metadata.scenario_id,
      version: result.metadata.scenario_version,
    };
    setRequestError(undefined);
    setRequestState("retrieving");

    try {
      const retrieved = await getGeneratedScenario(scenario, result.metadata.seed);
      setResult(retrieved);
      setResultSource("retrieved");
    } catch (error) {
      setRequestError(errorMessage(error));
    } finally {
      setRequestState("idle");
    }
  }

  async function handleStartSupport() {
    if (!result) {
      return;
    }
    setRequestError(undefined);
    setSupportStarting(true);
    try {
      const availableFrameworks = await listAgentFrameworks();
      setFrameworks(availableFrameworks.frameworks);
      const framework =
        availableFrameworks.frameworks.find(
          (candidate) => candidate.framework_id === "pydantic-ai" && candidate.available,
        ) ?? availableFrameworks.frameworks.find((candidate) => candidate.available);
      if (!framework) {
        throw new Error("No agent framework is available.");
      }
      const started = await startConversation({
        scenario_id: result.metadata.scenario_id,
        scenario_version: result.metadata.scenario_version,
        seed: result.metadata.seed,
        framework_id: framework.framework_id,
      });
      window.localStorage.setItem("agent-lab-support-session", started.id);
      setConversation(started);
    } catch (error) {
      setRequestError(errorMessage(error));
    } finally {
      setSupportStarting(false);
    }
  }

  const handleConversationUpdated = useCallback((updated: ConversationResponse) => {
    setConversation(updated);
  }, []);
  const activeScenario = conversation
    ? scenarios.find(
        (scenario) =>
          scenario.id === conversation.scenario_id &&
          scenario.version === conversation.scenario_version,
      )
    : undefined;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 pt-6 pb-20">
      <header className="flex items-center justify-between pb-12 md:pb-[4.5rem]">
        <a
          className="font-display text-xl font-bold tracking-[-0.04em] text-lab-ink no-underline"
          href="/"
          aria-label="Agent Framework Capability Lab home"
        >
          AF<span className="text-lab-accent">CL</span>
        </a>
        <span className="rounded-full border border-lab-ink/25 px-2.5 py-1.5 font-mono text-xs font-bold tracking-[0.08em] text-lab-ink-soft uppercase">
          API {API_VERSION}
        </span>
      </header>

      <section className="mb-12 max-w-[900px] md:mb-[4.5rem]" aria-labelledby="page-title">
        <p className="mb-3 text-xs font-extrabold tracking-[0.17em] text-lab-accent uppercase">
          Deterministic persona lab
        </p>
        <h1
          className="font-display mb-6 max-w-[850px] text-[clamp(3rem,8vw,7rem)] leading-[0.9] font-medium tracking-[-0.055em]"
          id="page-title"
        >
          Meet the customer before the agent.
        </h1>
        <p className="m-0 max-w-[730px] text-[clamp(1.05rem,1.7vw,1.28rem)] leading-relaxed text-lab-muted">
          Select a versioned retail scenario and record a seed. The same inputs always recreate the
          same fictional customer state—ready for support and explicitly confirmed actions.
        </p>
      </section>

      <div className="grid items-start gap-5 min-[821px]:grid-cols-[minmax(300px,0.76fr)_minmax(0,1.4fr)]">
        <section
          className={`${panelClasses} bg-lab-paper/80 p-6`}
          aria-labelledby="generator-title"
        >
          <div className="flex gap-4 border-b border-lab-ink/15 pb-6">
            <span className="font-mono text-xs font-extrabold text-lab-accent">01</span>
            <div>
              <h2 className="font-display mb-1 text-2xl font-medium" id="generator-title">
                Generate a persona
              </h2>
              <p className="m-0 text-sm leading-snug text-lab-muted">
                Choose the replay inputs for this sandbox.
              </p>
            </div>
          </div>

          <form className="grid gap-5 pt-6" onSubmit={handleGenerate} noValidate>
            <div className="grid gap-2">
              <label
                className="text-xs font-extrabold tracking-[0.04em] uppercase"
                htmlFor="scenario"
              >
                Scenario
              </label>
              <select
                className={fieldControlClasses}
                id="scenario"
                value={selectedScenario}
                onChange={(event) => {
                  setSelectedScenario(event.target.value);
                  setValidationError(undefined);
                }}
                aria-invalid={validationError?.field === "scenario" || undefined}
                aria-describedby={
                  validationError?.field === "scenario" ? "form-error" : "scenario-help"
                }
                disabled={requestState !== "idle"}
              >
                <option value="">Select a scenario</option>
                {scenarios.map((scenario) => (
                  <option key={scenarioValue(scenario)} value={scenarioValue(scenario)}>
                    {scenario.name} · {scenario.version}
                  </option>
                ))}
              </select>
              {selectedOption ? (
                <div
                  className="grid gap-2 rounded-lg border border-lab-accent/25 bg-lab-accent-soft/50 p-3.5"
                  id="scenario-help"
                >
                  <p className="m-0 text-sm font-bold leading-snug text-lab-ink">
                    {selectedOption.description}
                  </p>
                  <p className="m-0 flex items-start gap-1.5 text-sm leading-snug text-lab-ink-soft">
                    <Target
                      className="mt-0.5 shrink-0 text-lab-accent"
                      aria-hidden="true"
                      size={15}
                    />
                    <span>{selectedOption.goal}</span>
                  </p>
                </div>
              ) : (
                <p className="m-0 text-sm leading-snug text-lab-muted" id="scenario-help">
                  Scenario versions preserve their generation rules.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <label className="text-xs font-extrabold tracking-[0.04em] uppercase" htmlFor="seed">
                Seed
              </label>
              <input
                className={fieldControlClasses}
                id="seed"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 20260816"
                value={seedInput}
                onChange={(event) => {
                  setSeedInput(event.target.value);
                  setValidationError(undefined);
                }}
                aria-invalid={validationError?.field === "seed" || undefined}
                aria-describedby={validationError?.field === "seed" ? "form-error" : "seed-help"}
                disabled={requestState !== "idle"}
              />
              <p className="m-0 text-sm leading-snug text-lab-muted" id="seed-help">
                Decimal whole number from 0 to {MAX_SEED.toLocaleString("en-US")}.
              </p>
            </div>

            {validationError && (
              <p className="m-0 text-sm leading-snug text-lab-error" id="form-error" role="alert">
                {validationError.message}
              </p>
            )}

            <button
              className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-lg bg-lab-ink font-bold text-lab-paper transition hover:-translate-y-px hover:bg-lab-ink-hover disabled:cursor-not-allowed disabled:opacity-65"
              type="submit"
              disabled={requestState !== "idle" || supportStarting}
            >
              {requestState === "generating" ? (
                <>
                  <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={18} />
                  Generating…
                </>
              ) : (
                <>
                  Generate persona <ArrowRight aria-hidden="true" size={18} />
                </>
              )}
            </button>
          </form>
        </section>

        <div className="grid min-w-0 gap-4">
          {requestState !== "idle" && (
            <div
              className={`${panelClasses} flex items-center gap-3.5 p-4`}
              role="status"
              aria-live="polite"
            >
              <LoaderCircle
                className="shrink-0 motion-safe:animate-spin"
                aria-hidden="true"
                size={22}
              />
              <div className="flex flex-col items-start">
                <strong className="text-sm">
                  {requestState === "generating"
                    ? "Generating deterministic state…"
                    : "Retrieving recorded state…"}
                </strong>
                <span className="text-xs text-lab-muted">Using the versioned API contract.</span>
              </div>
            </div>
          )}

          {requestError && (
            <div
              className="flex flex-col items-start gap-1 rounded-panel border border-lab-error/30 bg-lab-error-soft p-4 text-lab-error shadow-panel"
              role="alert"
            >
              <strong className="text-sm">We couldn’t load the persona.</strong>
              <span className="text-xs">{requestError}</span>
            </div>
          )}

          {result && (
            <PersonaResult
              result={result}
              source={resultSource}
              requestState={requestState}
              onRetrieve={handleRetrieve}
              onStartSupport={handleStartSupport}
              supportStarting={supportStarting}
              supportStarted={conversation !== undefined}
            />
          )}

          {!result && requestState === "idle" && !requestError && (
            <section
              className={`${panelClasses} lab-grid relative flex min-h-[340px] flex-col items-center justify-center overflow-hidden p-5 text-center sm:min-h-[425px] sm:p-12`}
              aria-labelledby="empty-title"
            >
              <span className="absolute top-6 left-6 font-mono text-xs font-extrabold text-lab-accent">
                02
              </span>
              <div className="mb-6 grid size-[5.4rem] place-items-center rounded-full border border-lab-ink/20 bg-lab-paper/85 text-lab-accent">
                <Fingerprint aria-hidden="true" size={38} />
              </div>
              <h2
                className="font-display mb-3 max-w-[450px] text-[clamp(1.8rem,4vw,2.7rem)] leading-tight font-medium tracking-[-0.03em]"
                id="empty-title"
              >
                Your generated persona will appear here.
              </h2>
              <p className="m-0 max-w-[480px] leading-relaxed text-lab-muted">
                The result includes support traits, scenario metadata, and the fingerprint needed to
                verify an exact replay.
              </p>
            </section>
          )}
        </div>
      </div>

      {frameworks.length > 0 && (
        <fieldset className="mt-5 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Agent framework availability</legend>
          {frameworks.map((framework) => (
            <span
              className={`rounded-full border px-3 py-1.5 font-mono text-xs ${
                framework.available
                  ? "border-lab-success/40 text-lab-success"
                  : "border-lab-border text-lab-muted"
              }`}
              key={framework.framework_id}
              title={framework.unavailability_reason ?? undefined}
            >
              {framework.framework_id} · {framework.available ? "available" : "unsupported locally"}
            </span>
          ))}
        </fieldset>
      )}

      {conversation && (
        <SupportConversation
          key={`${conversation.id}:${conversation.turns.length === 0 ? "empty" : "active"}`}
          conversation={conversation}
          suggestedCustomerMessage={activeScenario?.suggestedCustomerMessage}
          scenarioGoal={activeScenario?.goal}
          order={
            activeScenario?.id === "retail-order-cancellation"
              ? result?.initial_state.orders[0]
              : undefined
          }
          onConversationUpdated={handleConversationUpdated}
        />
      )}
    </main>
  );
}
