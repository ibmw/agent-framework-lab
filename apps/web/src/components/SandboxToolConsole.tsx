import type {
  SandboxSummarySchema,
  SupportIdentitySummarySchema,
  ToolArgumentSchema,
  ToolCallRequest,
  ToolCallResponse,
  ToolContractSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { describeApiError } from "../api/client";
import { listSupportIdentities } from "../api/supportIdentities";
import { callSandboxTool, listToolContracts } from "../api/tools";
import { labelOf, TOOL_OUTCOME } from "../lib/enumLabels";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  surfaceClasses,
} from "../lib/ui";
import { Card, Fingerprint } from "./WorkspaceChrome";

const CONTRACTS_UNAVAILABLE = "The published tool set is unavailable.";
const IDENTITIES_UNAVAILABLE = "The published support identities are unavailable.";
/** The tool an apply confirms, so a proposal result can offer the second step directly. */
const ADDRESS_CHANGE_APPLY = "orders.apply_address_change";

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
 * A write tool adds two things a read does not need, and both are visible here on purpose.
 * It runs under a published support identity, chosen beside the tool rather than typed into an
 * argument, because an agent that could name its own actor would be choosing its own
 * permissions. And it is proposed before it is applied, so the operator sees the change as the
 * agent will: two steps, with the confirmation binding the second to exactly the first.
 */
export function SandboxToolConsole({
  shopId,
  arm,
  onArmMoved,
}: {
  shopId: string;
  arm: SandboxSummarySchema;
  onArmMoved?: () => void;
}) {
  const [contracts, setContracts] = useState<ToolContractSchema[]>([]);
  const [identities, setIdentities] = useState<SupportIdentitySummarySchema[]>([]);
  /**
   * Kept apart from `error`, which belongs to the call the operator just made.
   *
   * Identities are fetched on mount whether or not a write is ever selected, so a failure
   * there written into the shared slot would tell someone running a read that their read
   * broke. It is surfaced only where it actually blocks something.
   */
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [acting, setActing] = useState("");
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

  useEffect(() => {
    const controller = new AbortController();
    listSupportIdentities(controller.signal)
      .then((listed) => {
        // Only a published version can act: a write authorizes against frozen permissions,
        // never against a draft that can grant itself another one a moment later.
        // Only a published version can act: a write authorizes against frozen permissions,
        // never against a draft that can grant itself another one a moment later.
        setIdentities(
          listed.identities.filter((identity) => identity.latest_published_version !== null),
        );
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setIdentityError(describeApiError(cause, IDENTITIES_UNAVAILABLE));
        }
      });
    return () => controller.abort();
  }, []);

  const contract = contracts.find((candidate) => candidate.name === selected) ?? null;
  const writes = contract?.effect === "write";
  const identity = identities.find((candidate) => candidate.identity_id === acting) ?? null;

  const choose = (name: string) => {
    current.current += 1;
    setSelected(name);
    // Arguments belong to the tool that declared them; carrying them across would send one
    // tool's handle to another tool that never asked for it.
    setValues({});
    setResult(null);
    setError(null);
  };

  const send = async (command: ToolCallRequest, moves: boolean) => {
    current.current += 1;
    const token = current.current;
    setWorking(true);
    setError(null);
    try {
      const answered = await callSandboxTool(shopId, arm.sandbox_id, command);
      if (token === current.current) {
        setResult(answered);
      }
      // The arms table shows a revision and a fingerprint, and a successful write has just
      // moved both. Told rather than refetched here: the console does not own that list.
      if (moves && answered.outcome === "success") {
        onArmMoved?.();
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

  const actor = () =>
    identity === null || identity.latest_published_version === null
      ? null
      : { support_identity_id: identity.identity_id, version: identity.latest_published_version };

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (contract === null) {
      return;
    }
    if (writes && actor() === null) {
      // Refused here rather than at the server, which answers this as an error: a write with
      // nobody acting is a call the console should not have been able to build.
      setError("Choose the published support identity this change is made under.");
      return;
    }
    await send(
      {
        tool: contract.name,
        version: contract.version,
        arguments: values,
        actor: writes ? actor() : null,
      },
      writes,
    );
  };

  const applyProposal = async (confirmation: string) => {
    const apply = contracts.find((candidate) => candidate.name === ADDRESS_CHANGE_APPLY);
    if (apply === undefined || actor() === null) {
      return;
    }
    await send(
      {
        tool: apply.name,
        version: apply.version,
        // The confirmation is the whole of the second step: it names the change, so nothing
        // the operator could retype comes between the proposal and what is applied.
        arguments: { confirmation },
        actor: actor(),
      },
      true,
    );
  };

  return (
    <Card
      title={`Tools · ${arm.label}`}
      footer={
        <p className="text-xs text-admin-muted">
          Every tool here works on this arm's own state and the exact versions its snapshot pinned.
          The customer's persona and hidden facts are never served: they drive the simulated
          customer, not the support agent. A write changes this arm and no other, and only under an
          identity permitted to make it.
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
            // The label wraps the control, so its text picks up every option; the explicit
            // name is what keeps the select addressable by "Tool" alone.
            aria-label="Tool"
            className={fieldControlClasses}
            value={selected}
            onChange={(event) => choose(event.target.value)}
          >
            {contracts.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name} · {candidate.version}
                {candidate.effect === "write" ? " · write" : ""}
              </option>
            ))}
          </select>
        </label>

        {!writes ? null : (
          <div className={fieldLabelClasses}>
            {/* The description sits outside the label, as the argument fields do: inside it,
                it would become part of the control's accessible name. */}
            <label htmlFor="tool-actor">Acting support identity</label>
            <select
              id="tool-actor"
              className={fieldControlClasses}
              value={acting}
              onChange={(event) => setActing(event.target.value)}
            >
              <option value="">Choose…</option>
              {identities.map((candidate) => (
                <option key={candidate.identity_id} value={candidate.identity_id}>
                  {candidate.name} · v{candidate.latest_published_version}
                </option>
              ))}
            </select>
            <span className="font-normal text-admin-muted">
              A write is authorized against this identity's permissions. It sits beside the tool
              rather than among its arguments, because an agent that could name its own actor would
              be choosing its own permissions.
            </span>
            {identityError === null ? null : (
              <span role="alert" className="font-normal text-lab-error">
                {identityError}
              </span>
            )}
          </div>
        )}

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

      {result === null ? null : (
        <ToolResult result={result} onApply={working ? undefined : applyProposal} />
      )}
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
 * failure is the lab breaking, and it carries no explanation on purpose. A stale write arrives
 * here as a refusal too, and that is the point: the world moved under the agent, which is
 * something to notice and retry rather than a failure of the lab.
 */
function ToolResult({
  result,
  onApply,
}: {
  result: ToolCallResponse;
  onApply?: (confirmation: string) => void;
}) {
  const confirmation = proposedConfirmation(result);
  return (
    <div className="grid gap-2">
      <p className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border/60 px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft">
          <span aria-hidden>{result.outcome === "success" ? "✓" : "!"}</span>{" "}
          {labelOf(TOOL_OUTCOME, result.outcome)}
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
      {confirmation === null || onApply === undefined ? null : (
        <div>
          {/* Two visible steps, as the agent will take them. The button carries the
              confirmation the proposal answered with, so what is applied is exactly what
              was proposed rather than anything retyped in between. */}
          <button
            className={accentButtonClasses}
            type="button"
            onClick={() => onApply(confirmation)}
          >
            Apply this change
          </button>
        </div>
      )}
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

/**
 * The confirmation of a proposal that has not been applied yet, or nothing.
 *
 * Read off the result rather than off the tool name: `applied` is stated in the document
 * precisely so a proposal and the result of applying it are told apart by one field.
 */
function proposedConfirmation(result: ToolCallResponse): string | null {
  if (result.outcome !== "success" || result.data === null) {
    return null;
  }
  const { confirmation, applied } = result.data;
  return typeof confirmation === "string" && applied === false ? confirmation : null;
}
