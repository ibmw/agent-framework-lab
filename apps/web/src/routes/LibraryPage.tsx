import type {
  ConversationSummaryResponse,
  GeneratedScenarioSummaryResponse,
} from "@agent-lab/contracts";
import { ChevronDown, Dices, LoaderCircle, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listAgentFrameworks, listAllConversations } from "../api/conversations";
import {
  deleteGeneratedScenario,
  generateScenario,
  listGeneratedScenarios,
  type PersonaLibraryQuery,
  ScenarioApiError,
} from "../api/scenarios";
import { VerticalBenchRail } from "../components/BenchRail";
import { Pagination } from "../components/Pagination";
import { ACTIVITY_WINDOWS, activeSinceFromWindow, PAGE_SIZES } from "../lib/filters";
import {
  comparePath,
  MAX_SEED,
  personaPath,
  scenarios,
  scenarioValue,
  validateSeed,
} from "../lib/scenarios";
import {
  accentButtonClasses,
  clearLastComparisonForPersona,
  clearLastConversationForPersona,
  fieldControlClasses,
  filterControlClasses,
  inkButtonClasses,
  LAST_CONVERSATION_KEY,
  outlineButtonClasses,
  panelClasses,
} from "../lib/ui";

type ValidationField = "scenario" | "seed";

interface ValidationError {
  field: ValidationField;
  message: string;
}

interface LibraryRow {
  key: string;
  persona: GeneratedScenarioSummaryResponse;
  frameworkId: string;
  conversationCount: number;
  sessionId?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof ScenarioApiError) {
    return error.requestId ? `${error.message} (request ${error.requestId})` : error.message;
  }
  return "Could not reach the scenario API. Check the connection and try again.";
}

function PersonaLibrary({ onPersonaDeleted }: { onPersonaDeleted: (path: string) => void }) {
  const navigate = useNavigate();
  const [personas, setPersonas] = useState<GeneratedScenarioSummaryResponse[]>([]);
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [frameworkOptions, setFrameworkOptions] = useState<string[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);

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

  function updateFilter(apply: () => void) {
    apply();
    setSelectedSessions([]);
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
    void (async () => {
      try {
        const result = await listGeneratedScenarios(query);
        if (!active) {
          return;
        }
        setPersonas(result.generations);
        setTotal(result.total);
        const conversations =
          result.generations.length === 0
            ? []
            : await listAllConversations(undefined, {
                scenarioId: query.scenarioId,
                scenarioVersion: query.scenarioVersion,
                frameworkId: query.frameworkId,
                activeSince: query.activeSince,
              }).catch(() => [] as ConversationSummaryResponse[]);
        if (!active) {
          return;
        }
        setRows(expandLibraryRows(joinPersonaConversations(result.generations, conversations)));
        setState("ready");
      } catch {
        if (active) {
          setState("error");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [query, reloadToken]);

  function toggleSession(sessionId: string | undefined) {
    if (!sessionId) {
      return;
    }
    setSelectedSessions((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : current.length >= 2
          ? [current[1], sessionId]
          : [...current, sessionId],
    );
  }

  const selectedRows = rows.filter(
    (row) => row.sessionId && selectedSessions.includes(row.sessionId),
  );
  const fingerprintsMatch =
    selectedRows.length === 2 &&
    selectedRows[0].persona.initial_state_hash === selectedRows[1].persona.initial_state_hash;
  const canCompare = selectedRows.length === 2 && fingerprintsMatch;

  function handleCompare() {
    if (!canCompare) {
      return;
    }
    const [first, second] = selectedRows;
    navigate(
      comparePath(
        {
          scenarioId: first.persona.scenario_id,
          scenarioVersion: first.persona.scenario_version,
          seed: first.persona.seed,
        },
        first.sessionId as string,
        second.sessionId as string,
      ),
    );
  }

  async function handleDelete(persona: GeneratedScenarioSummaryResponse) {
    setDeletingHash(persona.initial_state_hash);
    const path = personaPath({
      scenarioId: persona.scenario_id,
      scenarioVersion: persona.scenario_version,
      seed: persona.seed,
    });
    try {
      await deleteGeneratedScenario(
        { id: persona.scenario_id, version: persona.scenario_version },
        persona.seed,
      );
      onPersonaDeleted(path);
      setConfirmingHash(undefined);
      setSelectedSessions([]);
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

  const selectionHint =
    selectedRows.length === 0
      ? "Select two conversations to compare"
      : fingerprintsMatch
        ? "2 conversations selected · same fingerprint"
        : selectedRows.length === 2
          ? "2 conversations selected · fingerprints differ"
          : `${selectedRows.length} conversation selected`;

  return (
    <section
      className={`${panelClasses} scroll-mt-6 overflow-hidden`}
      aria-labelledby="library-title"
      id="library"
    >
      <div className="flex flex-wrap items-center gap-3.5 border-b border-lab-ink/15 px-[22px] py-4">
        <span className="font-mono text-xs font-extrabold text-lab-accent">02</span>
        <h2
          className="font-display m-0 text-[22px] font-medium tracking-[-0.03em]"
          id="library-title"
        >
          Persona library
        </h2>
        <span className="font-mono text-[11px] text-lab-muted">{selectionHint}</span>
        <button
          className={`${accentButtonClasses} ml-auto px-4 py-[9px] text-[13px]`}
          type="button"
          onClick={handleCompare}
          disabled={!canCompare}
        >
          Compare selected
        </button>
      </div>

      <div className="flex flex-wrap gap-2.5 border-b border-lab-ink/12 bg-lab-subtle px-[22px] py-3.5 min-[520px]:grid min-[520px]:grid-cols-2 lg:flex">
        <label
          className={`${filterControlClasses} min-h-10 flex-1 px-3 text-[13px] text-lab-ink-soft`}
        >
          <span className="sr-only">Filter by scenario</span>
          <select
            className="h-full w-full bg-transparent outline-none"
            value={scenarioFilter}
            aria-label="Filter by scenario"
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
        <label
          className={`${filterControlClasses} min-h-10 flex-1 px-3 text-[13px] text-lab-ink-soft`}
        >
          <span className="sr-only">Filter by framework</span>
          <select
            className="h-full w-full bg-transparent outline-none"
            value={frameworkFilter}
            aria-label="Filter by framework"
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
        <label
          className={`${filterControlClasses} min-h-10 flex-1 px-3 text-[13px] text-lab-ink-soft`}
        >
          <span className="sr-only">Active within</span>
          <select
            className="h-full w-full bg-transparent outline-none"
            value={windowFilter}
            aria-label="Active within"
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
        <label
          className={`${filterControlClasses} min-h-10 w-[120px] px-3 text-[13px] text-lab-ink-soft`}
        >
          <span className="sr-only">Per page</span>
          <select
            className="h-full w-full bg-transparent outline-none"
            value={pageSize}
            aria-label="Per page"
            onChange={(event) => updateFilter(() => setPageSize(Number(event.target.value)))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </label>
      </div>

      {state === "loading" && (
        <p className="flex items-center gap-2 px-[22px] py-6 text-sm text-lab-muted" role="status">
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" size={16} />
          Loading personas…
        </p>
      )}

      {state === "error" && (
        <p className="px-[22px] py-6 text-sm text-lab-error" role="alert">
          The persona library could not be loaded.
        </p>
      )}

      {state === "ready" && personas.length === 0 && (
        <p className="px-[22px] py-6 text-sm text-lab-muted">
          No personas yet. Generate one to start building your library.
        </p>
      )}

      {state === "ready" && rows.length > 0 && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-[34px_1fr_190px_130px_120px_110px_40px] bg-lab-subtle px-[22px] py-[11px] text-[10px] font-extrabold tracking-[0.08em] text-lab-muted uppercase">
            <span />
            <span>Persona</span>
            <span>Scenario</span>
            <span>Seed</span>
            <span>Framework</span>
            <span>Conversations</span>
            <span className="sr-only">Actions</span>
          </div>
          {rows.map((row, index) => {
            const path = personaPath({
              scenarioId: row.persona.scenario_id,
              scenarioVersion: row.persona.scenario_version,
              seed: row.persona.seed,
            });
            const confirming = confirmingHash === row.persona.initial_state_hash;
            const firstOfPersona =
              rows.findIndex(
                (candidate) =>
                  candidate.persona.initial_state_hash === row.persona.initial_state_hash,
              ) === index;
            if (confirming && !firstOfPersona) {
              return null;
            }
            const checked = Boolean(row.sessionId && selectedSessions.includes(row.sessionId));
            return (
              <div
                className={`grid min-w-[720px] grid-cols-[34px_1fr_190px_130px_120px_110px_40px] items-center px-[22px] py-[13px] text-[13px] hover:bg-lab-paper ${
                  index === rows.length - 1 ? "" : "border-b border-lab-ink/10"
                }`}
                key={row.key}
              >
                {confirming ? (
                  <div className="col-span-7 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-lab-muted">
                      Delete {row.persona.display_name} and {row.persona.conversation_count}{" "}
                      {row.persona.conversation_count === 1 ? "conversation" : "conversations"}?
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        className="min-h-9 rounded-lg border border-lab-border px-3 text-sm font-bold text-lab-ink-soft transition hover:bg-lab-paper disabled:opacity-60"
                        type="button"
                        onClick={() => setConfirmingHash(undefined)}
                        disabled={deletingHash === row.persona.initial_state_hash}
                      >
                        Cancel
                      </button>
                      <button
                        className="min-h-9 rounded-lg bg-lab-error px-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                        type="button"
                        onClick={() => handleDelete(row.persona)}
                        disabled={deletingHash === row.persona.initial_state_hash}
                      >
                        {deletingHash === row.persona.initial_state_hash
                          ? "Deleting…"
                          : "Confirm persona delete"}
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="grid size-[15px] place-items-center">
                      <input
                        className="size-[15px] rounded border-lab-border accent-lab-ink"
                        type="checkbox"
                        checked={checked}
                        disabled={!row.sessionId}
                        aria-label={`Select ${row.persona.display_name} ${row.frameworkId} conversation`}
                        onChange={() => toggleSession(row.sessionId)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </label>
                    <Link
                      className="min-w-0 text-lab-ink no-underline hover:text-lab-ink-hover"
                      to={path}
                    >
                      {row.persona.display_name}{" "}
                      <span className="font-mono text-[11px] text-lab-muted">
                        · {row.persona.locale}
                      </span>
                      <span className="sr-only">
                        {row.persona.scenario_id}@{row.persona.scenario_version} · seed{" "}
                        {row.persona.seed}
                      </span>
                    </Link>
                    <span className="font-mono text-xs">{row.persona.scenario_id}</span>
                    <span className="font-mono text-xs text-lab-muted">{row.persona.seed}</span>
                    <span className="font-mono text-xs">{row.frameworkId}</span>
                    <span className="font-mono text-xs">{row.conversationCount}</span>
                    <button
                      className="grid size-9 place-items-center rounded-lg text-lab-muted transition hover:bg-lab-error-soft hover:text-lab-error"
                      type="button"
                      aria-label={`Delete persona ${row.persona.display_name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmingHash(row.persona.initial_state_hash);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {state === "ready" && (
        <div className="px-[22px] pb-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            noun="persona"
            label="Persona library pages"
            onPageChange={(nextPage) => {
              setSelectedSessions([]);
              setPage(nextPage);
            }}
          />
        </div>
      )}
    </section>
  );
}

function personaConversationKey(persona: {
  scenario_id: string;
  scenario_version: string;
  seed: number;
}): string {
  return `${persona.scenario_id}:${persona.scenario_version}:${persona.seed}`;
}

function joinPersonaConversations(
  personas: GeneratedScenarioSummaryResponse[],
  conversations: ConversationSummaryResponse[],
): {
  persona: GeneratedScenarioSummaryResponse;
  conversations: ConversationSummaryResponse[];
}[] {
  const byPersona = new Map<string, ConversationSummaryResponse[]>();
  for (const conversation of conversations) {
    const key = personaConversationKey(conversation);
    const current = byPersona.get(key) ?? [];
    current.push(conversation);
    byPersona.set(key, current);
  }
  return personas.map((persona) => ({
    persona,
    conversations: byPersona.get(personaConversationKey(persona)) ?? [],
  }));
}

function expandLibraryRows(
  groups: {
    persona: GeneratedScenarioSummaryResponse;
    conversations: ConversationSummaryResponse[];
  }[],
): LibraryRow[] {
  return groups.flatMap(({ persona, conversations }) => {
    if (conversations.length === 0) {
      return [
        {
          key: `${persona.initial_state_hash}:none`,
          persona,
          frameworkId: "—",
          conversationCount: 0,
        },
      ];
    }
    const byFramework = new Map<string, ConversationSummaryResponse[]>();
    for (const conversation of conversations) {
      const current = byFramework.get(conversation.framework_id) ?? [];
      current.push(conversation);
      byFramework.set(conversation.framework_id, current);
    }
    return [...byFramework.entries()].map(([frameworkId, grouped]) => ({
      key: `${persona.initial_state_hash}:${frameworkId}`,
      persona,
      frameworkId,
      conversationCount: grouped.length,
      sessionId: grouped[0]?.id,
    }));
  });
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
    clearLastComparisonForPersona(path);
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
    <div className="grid gap-5">
      <section
        className={`${panelClasses} scroll-mt-6 overflow-hidden`}
        aria-labelledby="generator-title"
        id="generate"
      >
        <div className="flex">
          <VerticalBenchRail />
          <div className="flex min-w-0 flex-1 flex-col gap-6 px-8 py-8 max-[899px]:px-6">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs font-extrabold text-lab-accent">01</span>
                <h1
                  className="font-display m-0 text-[30px] font-medium tracking-[-0.035em]"
                  id="generator-title"
                >
                  Generate a persona
                </h1>
              </div>
              <p className="m-0 max-w-[640px] text-sm text-lab-muted">
                A scenario and a seed produce the same fictional customer state every time. Every
                framework is measured against that fingerprint.
              </p>
              {lastConversation && (
                <Link
                  className="text-sm font-semibold text-lab-ink-soft no-underline hover:text-lab-ink"
                  to={lastConversation}
                >
                  Resume your last conversation
                </Link>
              )}
            </div>

            <form className="grid gap-6" onSubmit={handleGenerate} noValidate>
              <div className="grid gap-3.5 min-[640px]:grid-cols-[1.4fr_1fr]">
                <div className="grid gap-[7px]">
                  <label
                    className="text-[11px] font-extrabold tracking-[0.06em] text-lab-muted uppercase"
                    htmlFor="scenario"
                  >
                    Scenario
                  </label>
                  <div className="relative">
                    <select
                      className={`${fieldControlClasses} appearance-none pr-10`}
                      id="scenario"
                      value={selectedScenario}
                      onChange={(event) => {
                        setSelectedScenario(event.target.value);
                        setValidationError(undefined);
                      }}
                      aria-invalid={validationError?.field === "scenario" || undefined}
                      aria-describedby={
                        validationError?.field === "scenario" ? "form-error" : undefined
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
                    <ChevronDown
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-lab-muted"
                    />
                  </div>
                </div>
                <div className="grid gap-[7px]">
                  <label
                    className="text-[11px] font-extrabold tracking-[0.06em] text-lab-muted uppercase"
                    htmlFor="seed"
                  >
                    Seed
                  </label>
                  <input
                    className={`${fieldControlClasses} font-mono`}
                    id="seed"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 4211987"
                    value={seedInput}
                    onChange={(event) => {
                      setSeedInput(event.target.value);
                      setValidationError(undefined);
                    }}
                    aria-invalid={validationError?.field === "seed" || undefined}
                    aria-describedby={
                      validationError?.field === "seed" ? "form-error" : "seed-help"
                    }
                    disabled={generating}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button className={inkButtonClasses} type="submit" disabled={generating}>
                  {generating ? (
                    <>
                      <LoaderCircle
                        className="motion-safe:animate-spin"
                        aria-hidden="true"
                        size={18}
                      />
                      Generating…
                    </>
                  ) : (
                    "Generate persona"
                  )}
                </button>
                <button
                  className={outlineButtonClasses}
                  type="button"
                  onClick={() => {
                    setSeedInput(String(Math.floor(Math.random() * (MAX_SEED + 1))));
                    setValidationError(undefined);
                  }}
                  disabled={generating}
                >
                  <Dices aria-hidden="true" className="shrink-0" size={16} /> Random seed
                </button>
                <span className="text-[13px] text-lab-muted" id="seed-help">
                  0 to {MAX_SEED.toLocaleString("en-US")}
                </span>
              </div>

              {validationError && (
                <p className="m-0 text-sm text-lab-error" id="form-error" role="alert">
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
            </form>
          </div>
        </div>
      </section>

      <PersonaLibrary onPersonaDeleted={handlePersonaDeleted} />
    </div>
  );
}
