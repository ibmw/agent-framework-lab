import type { GeneratedScenarioSummaryResponse } from "@agent-lab/contracts";
import {
  ArrowRight,
  Dices,
  Fingerprint,
  LoaderCircle,
  MessageCircle,
  Target,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAgentFrameworks } from "../api/conversations";
import {
  deleteGeneratedScenario,
  generateScenario,
  listGeneratedScenarios,
  type PersonaLibraryQuery,
  ScenarioApiError,
} from "../api/scenarios";
import { Pagination } from "../components/Pagination";
import { ACTIVITY_WINDOWS, activeSinceFromWindow, PAGE_SIZES } from "../lib/filters";
import { MAX_SEED, personaPath, scenarios, scenarioValue, validateSeed } from "../lib/scenarios";
import {
  clearLastConversationForPersona,
  fieldControlClasses,
  filterControlClasses,
  filterLabelClasses,
  formatActivity,
  LAST_CONVERSATION_KEY,
  panelClasses,
} from "../lib/ui";

type ValidationField = "scenario" | "seed";

interface ValidationError {
  field: ValidationField;
  message: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof ScenarioApiError) {
    return error.requestId ? `${error.message} (request ${error.requestId})` : error.message;
  }
  return "Could not reach the scenario API. Check the connection and try again.";
}

interface PersonaLibraryProps {
  onPersonaDeleted: (path: string) => void;
}

function PersonaLibrary({ onPersonaDeleted }: PersonaLibraryProps) {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState<GeneratedScenarioSummaryResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [frameworkOptions, setFrameworkOptions] = useState<string[]>([]);

  const [scenarioFilter, setScenarioFilter] = useState("");
  const [frameworkFilter, setFrameworkFilter] = useState("");
  const [windowFilter, setWindowFilter] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [confirmingHash, setConfirmingHash] = useState<string>();
  const [deletingHash, setDeletingHash] = useState<string>();

  useEffect(() => {
    let active = true;
    listAgentFrameworks()
      .then((response) => {
        if (active) {
          setFrameworkOptions(response.frameworks.map((framework) => framework.framework_id));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Changing any filter or the page size returns to the first page.
  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  const query = useMemo<PersonaLibraryQuery>(() => {
    const [scenarioId, scenarioVersion] = scenarioFilter
      ? scenarioFilter.split("@")
      : [undefined, undefined];
    return {
      scenarioId,
      scenarioVersion,
      frameworkId: frameworkFilter || undefined,
      activeSince: activeSinceFromWindow(windowFilter),
      pageSize,
      page,
    };
  }, [scenarioFilter, frameworkFilter, windowFilter, pageSize, page]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken forces a manual refetch after a delete
  useEffect(() => {
    let active = true;
    setState("loading");
    listGeneratedScenarios(query)
      .then((result) => {
        if (active) {
          setPersonas(result.generations);
          setTotal(result.total);
          setState("ready");
        }
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [query, reloadToken]);

  async function handleDelete(persona: GeneratedScenarioSummaryResponse) {
    setDeletingHash(persona.initial_state_hash);
    const ref = {
      id: persona.scenario_id,
      version: persona.scenario_version,
    };
    const path = personaPath({
      scenarioId: persona.scenario_id,
      scenarioVersion: persona.scenario_version,
      seed: persona.seed,
    });
    try {
      await deleteGeneratedScenario(ref, persona.seed);
      onPersonaDeleted(path);
      setConfirmingHash(undefined);
      if (personas.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        setReloadToken((token) => token + 1);
      }
    } catch {
      setState("error");
    } finally {
      setDeletingHash(undefined);
    }
  }

  return (
    <section className={`${panelClasses} p-6`} aria-labelledby="library-title">
      <div className="flex gap-4 border-b border-lab-ink/15 pb-6">
        <span className="font-mono text-xs font-extrabold text-lab-accent">02</span>
        <div>
          <h2 className="font-display mb-1 text-2xl font-medium" id="library-title">
            Persona library
          </h2>
          <p className="m-0 text-sm leading-snug text-lab-muted">
            Revisit a persona to resume or start another conversation.
          </p>
        </div>
      </div>

      <div className="grid gap-3 pt-6 min-[520px]:grid-cols-2">
        <label className={filterLabelClasses}>
          Filter by scenario
          <select
            className={filterControlClasses}
            value={scenarioFilter}
            onChange={(event) => updateFilter(() => setScenarioFilter(event.target.value))}
          >
            <option value="">All scenarios</option>
            {scenarios.map((scenario) => (
              <option key={scenarioValue(scenario)} value={scenarioValue(scenario)}>
                {scenario.name} · {scenario.version}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabelClasses}>
          Filter by framework
          <select
            className={filterControlClasses}
            value={frameworkFilter}
            onChange={(event) => updateFilter(() => setFrameworkFilter(event.target.value))}
          >
            <option value="">All frameworks</option>
            {frameworkOptions.map((framework) => (
              <option key={framework} value={framework}>
                {framework}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabelClasses}>
          Active within
          <select
            className={filterControlClasses}
            value={windowFilter}
            onChange={(event) => updateFilter(() => setWindowFilter(event.target.value))}
          >
            <option value="">Any time</option>
            {ACTIVITY_WINDOWS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabelClasses}>
          Per page
          <select
            className={filterControlClasses}
            value={pageSize}
            onChange={(event) => updateFilter(() => setPageSize(Number(event.target.value)))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state === "loading" && (
        <p className="flex items-center gap-2 pt-6 text-sm text-lab-muted" role="status">
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={16} />
          Loading personas…
        </p>
      )}

      {state === "error" && (
        <p className="pt-6 text-sm text-lab-error" role="alert">
          The persona library could not be loaded.
        </p>
      )}

      {state === "ready" && personas.length === 0 && (
        <p className="pt-6 text-sm text-lab-muted">
          No personas yet. Generate one to start building your library.
        </p>
      )}

      {state === "ready" && personas.length > 0 && (
        <ul className="grid gap-2 pt-6">
          {personas.map((persona) => (
            <li
              className="flex items-center gap-2 rounded-lg border border-lab-border bg-lab-subtle p-2"
              key={persona.initial_state_hash}
            >
              {confirmingHash === persona.initial_state_hash ? (
                <div className="flex w-full flex-wrap items-center justify-between gap-3 px-2 py-1">
                  <span className="text-sm text-lab-muted">
                    Delete {persona.display_name} and {persona.conversation_count}{" "}
                    {persona.conversation_count === 1 ? "conversation" : "conversations"}?
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      className="min-h-9 rounded-lg border border-lab-border px-3 text-sm font-bold text-lab-ink-soft transition hover:bg-lab-paper disabled:opacity-60"
                      type="button"
                      onClick={() => setConfirmingHash(undefined)}
                      disabled={deletingHash === persona.initial_state_hash}
                    >
                      Cancel
                    </button>
                    <button
                      className="min-h-9 rounded-lg bg-lab-error px-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                      type="button"
                      onClick={() => handleDelete(persona)}
                      disabled={deletingHash === persona.initial_state_hash}
                    >
                      {deletingHash === persona.initial_state_hash
                        ? "Deleting…"
                        : "Confirm persona delete"}
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <button
                    className="grid min-w-0 flex-1 gap-1 rounded-md px-2 py-1 text-left transition hover:bg-lab-paper"
                    type="button"
                    onClick={() =>
                      navigate(
                        personaPath({
                          scenarioId: persona.scenario_id,
                          scenarioVersion: persona.scenario_version,
                          seed: persona.seed,
                        }),
                      )
                    }
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-bold text-lab-ink">{persona.display_name}</span>
                      <span className="rounded-full bg-lab-accent-soft px-2 py-0.5 font-mono text-[0.68rem] font-bold text-lab-accent">
                        {persona.conversation_count}{" "}
                        {persona.conversation_count === 1 ? "conversation" : "conversations"}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-lab-muted">
                      <span>
                        {persona.scenario_id}@{persona.scenario_version} · seed {persona.seed}
                      </span>
                      <span>Active {formatActivity(persona.last_activity_at)}</span>
                    </span>
                  </button>
                  <button
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-lab-muted transition hover:bg-lab-error-soft hover:text-lab-error"
                    type="button"
                    aria-label={`Delete persona ${persona.display_name}`}
                    onClick={() => setConfirmingHash(persona.initial_state_hash)}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {state === "ready" && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          noun="persona"
          label="Persona library pages"
          onPageChange={setPage}
        />
      )}
    </section>
  );
}

export function LibraryPage() {
  const navigate = useNavigate();
  const [selectedScenario, setSelectedScenario] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [validationError, setValidationError] = useState<ValidationError>();
  const [requestError, setRequestError] = useState<string>();
  const [generating, setGenerating] = useState(false);
  const [lastConversation, setLastConversation] = useState<string | null>(() =>
    typeof window !== "undefined" ? window.localStorage.getItem(LAST_CONVERSATION_KEY) : null,
  );

  const selectedOption = scenarios.find((scenario) => scenarioValue(scenario) === selectedScenario);

  function handlePersonaDeleted(path: string) {
    if (clearLastConversationForPersona(path)) {
      setLastConversation(null);
    }
  }

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
    setGenerating(true);
    const seed = Number(seedInput.trim());
    try {
      await generateScenario(selectedOption, seed);
      navigate(
        personaPath({
          scenarioId: selectedOption.id,
          scenarioVersion: selectedOption.version,
          seed,
        }),
      );
    } catch (error) {
      setRequestError(errorMessage(error));
      setGenerating(false);
    }
  }

  return (
    <>
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
        {lastConversation && (
          <a
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg border border-lab-border px-4 font-bold text-lab-ink-soft transition hover:bg-lab-subtle"
            href={lastConversation}
            onClick={(event) => {
              event.preventDefault();
              navigate(lastConversation);
            }}
          >
            <MessageCircle aria-hidden="true" size={16} /> Resume your last conversation
          </a>
        )}
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
                disabled={generating}
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
              <div className="flex gap-2">
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
                  disabled={generating}
                />
                <button
                  className="inline-flex min-h-13 shrink-0 items-center gap-2 rounded-lg border border-lab-border px-3.5 font-bold text-lab-ink-soft transition hover:bg-lab-subtle disabled:opacity-65"
                  type="button"
                  onClick={() => {
                    setSeedInput(String(Math.floor(Math.random() * (MAX_SEED + 1))));
                    setValidationError(undefined);
                  }}
                  disabled={generating}
                >
                  <Dices aria-hidden="true" size={16} /> Randomize
                </button>
              </div>
              <p className="m-0 text-sm leading-snug text-lab-muted" id="seed-help">
                Decimal whole number from 0 to {MAX_SEED.toLocaleString("en-US")}.
              </p>
            </div>

            {validationError && (
              <p className="m-0 text-sm leading-snug text-lab-error" id="form-error" role="alert">
                {validationError.message}
              </p>
            )}

            {requestError && (
              <div
                className="flex flex-col items-start gap-1 rounded-lg border border-lab-error/30 bg-lab-error-soft p-4 text-lab-error"
                role="alert"
              >
                <strong className="text-sm">We couldn’t load the persona.</strong>
                <span className="text-xs">{requestError}</span>
              </div>
            )}

            <button
              className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-lg bg-lab-ink font-bold text-lab-paper transition hover:-translate-y-px hover:bg-lab-ink-hover disabled:cursor-not-allowed disabled:opacity-65"
              type="submit"
              disabled={generating}
            >
              {generating ? (
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

        <div className="grid min-w-0 content-start gap-4">
          <PersonaLibrary onPersonaDeleted={handlePersonaDeleted} />
          <section
            className={`${panelClasses} lab-grid relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden p-8 text-center`}
            aria-hidden="true"
          >
            <div className="mb-4 grid size-[4.4rem] place-items-center rounded-full border border-lab-ink/20 bg-lab-paper/85 text-lab-accent">
              <Fingerprint size={30} />
            </div>
            <p className="m-0 max-w-[420px] text-sm leading-relaxed text-lab-muted">
              Every generated persona is deterministic: the same scenario and seed always recreate
              the same fictional customer, replayable from its fingerprint.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
