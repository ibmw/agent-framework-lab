import type {
  SandboxSummarySchema,
  ToolArgumentSchema,
  ToolCallResponse,
  ToolContractSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { describeApiError } from "../api/client";
import { callSandboxTool, listToolContracts } from "../api/tools";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  surfaceClasses,
} from "../lib/ui";
import { Card, Fingerprint } from "./WorkspaceChrome";

const CONTRACTS_UNAVAILABLE = "The published tool set is unavailable.";

/**
 * What one arm's agent would be able to see, asked the way the agent will ask it.
 *
 * The design direction has no tool frame, so this follows the shell's resource conventions
 * beside the arms it reads. It exists because a read tool is where the sandbox stops being a
 * fingerprint and becomes a world someone can interrogate: an operator authoring the
 * incident can check that the stale address, the shipping policy, and the ticket thread are
 * all reachable — and that the persona and the hidden facts are not — before any agent is
 * pointed at it.
 *
 * There is no write control, because every tool published here is a read.
 */
export function SandboxToolConsole({ shopId, arm }: { shopId: string; arm: SandboxSummarySchema }) {
  const [contracts, setContracts] = useState<ToolContractSchema[]>([]);
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolCallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  /**
   * Which run the console is currently showing.
   *
   * Switching tools while a call is in flight would otherwise resolve the old call into the
   * new tool's panel — one tool's result displayed under another tool's form. Every run and
   * every switch claims the next token, and a resolution that no longer holds it is dropped.
   */
  const current = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    listToolContracts(controller.signal)
      .then((listed) => {
        setContracts(listed.tools);
        setSelected((current) => (current === "" ? (listed.tools[0]?.name ?? "") : current));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, CONTRACTS_UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, []);

  const contract = contracts.find((candidate) => candidate.name === selected) ?? null;

  const choose = (name: string) => {
    current.current += 1;
    setSelected(name);
    // Arguments belong to the tool that declared them; carrying them across would send one
    // tool's handle to another tool that never asked for it.
    setValues({});
    setResult(null);
    setError(null);
  };

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (contract === null) {
      return;
    }
    current.current += 1;
    const token = current.current;
    setWorking(true);
    setError(null);
    try {
      const answered = await callSandboxTool(shopId, arm.sandbox_id, {
        tool: contract.name,
        version: contract.version,
        arguments: values,
      });
      if (token === current.current) {
        setResult(answered);
      }
    } catch (cause: unknown) {
      if (token === current.current) {
        setResult(null);
        setError(describeApiError(cause, "This tool could not be run against the arm."));
      }
    } finally {
      if (token === current.current) {
        setWorking(false);
      }
    }
  };

  return (
    <Card
      title={`Read tools · ${arm.label}`}
      footer={
        <p className="text-xs text-admin-muted">
          Every tool here reads this arm's own state and the exact versions its snapshot pinned. The
          customer's persona and hidden facts are never served: they drive the simulated customer,
          not the support agent.
        </p>
      }
    >
      {error ? (
        <p role="alert" className="text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <form className="grid gap-3" onSubmit={run}>
        <label className={fieldLabelClasses}>
          Tool
          <select
            className={fieldControlClasses}
            value={selected}
            onChange={(event) => choose(event.target.value)}
          >
            {contracts.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name} · {candidate.version}
              </option>
            ))}
          </select>
        </label>

        {contract === null ? null : (
          <>
            <p className="text-[13px] text-admin-ink-soft">{contract.summary}</p>
            {contract.arguments.map((argument) => (
              <ArgumentField
                key={argument.name}
                argument={argument}
                value={values[argument.name] ?? ""}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [argument.name]: value }))
                }
              />
            ))}
            <div>
              <button className={accentButtonClasses} type="submit" disabled={working}>
                {working ? "Running…" : "Run tool"}
              </button>
            </div>
          </>
        )}
      </form>

      {result === null ? null : <ToolResult result={result} />}
    </Card>
  );
}

function ArgumentField({
  argument,
  value,
  onChange,
}: {
  argument: ToolArgumentSchema;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `tool-argument-${argument.name}`;
  return (
    <div className={fieldLabelClasses}>
      <label htmlFor={id}>
        {argument.name}
        {argument.required ? " (required)" : ""}
      </label>
      {argument.kind === "enum" ? (
        <select
          id={id}
          className={fieldControlClasses}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {/* An unfilled optional enum is a question the caller did not ask; an unfilled
              required one is a call the tool will refuse, so it does not read as "any". */}
          <option value="">{argument.required ? "Choose…" : "Any"}</option>
          {argument.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className={fieldControlClasses}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <span className="font-normal text-admin-muted">{argument.description}</span>
    </div>
  );
}

/**
 * The three outcomes kept apart, because they mean different things about who was wrong.
 *
 * A refusal is the tool declining a question it understood — the agent's to recover from. A
 * failure is the lab breaking, and it carries no explanation on purpose.
 */
function ToolResult({ result }: { result: ToolCallResponse }) {
  return (
    <div className="grid gap-2">
      <p className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border/60 px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft">
          <span aria-hidden>{result.outcome === "success" ? "✓" : "!"}</span> {result.outcome}
        </span>
        <span className="text-admin-muted">
          read at revision r{result.sandbox_revision} ·{" "}
          <Fingerprint value={result.state_fingerprint} />
        </span>
      </p>
      {result.refusal === null ? null : (
        <p className="text-[13px] text-lab-error">{result.refusal.message}</p>
      )}
      {result.outcome === "failed" ? (
        <p className="text-[13px] text-lab-error">
          The tool could not be completed. This is the lab's fault, not the agent's.
        </p>
      ) : null}
      {result.data === null ? null : (
        <section aria-label={`${result.tool} result`}>
          <pre
            className={`${surfaceClasses} max-h-96 overflow-auto p-3 text-xs text-admin-ink-soft`}
          >
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
