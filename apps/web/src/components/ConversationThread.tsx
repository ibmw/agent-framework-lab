import type {
  AgentTurnSchema,
  ExperimentResponse,
  ExperimentRunSchema,
  MutationEventSchema,
  ParticipantTurnSchema,
  ToolEventSchema,
} from "@agent-lab/contracts";
import { labelOf, TOOL_OUTCOME } from "../lib/enumLabels";
import { describeFailure, TOOL_MARK } from "../lib/evidence";
import { chipClasses, sheetCallLineClasses, sheetCallListClasses } from "../lib/ui";

/**
 * What was said in a run, as the live bench draws it and the results' Conversation tab reads it.
 *
 * One rendering for both, so a reply read on the results is the reply the operator watched
 * arrive on the bench: each customer turn, then the attempts that answered it, each with the
 * calls it made on its way. Nothing here writes — the bench's composer and its Run button are
 * the bench's own, beside this thread, and the results draw it without them.
 *
 * The words are on screen and nowhere else: the timeline's stream carries no message body on
 * purpose (ADR 0027), and this reads the thread the experiment document already holds.
 */

/** One arm's thread: each customer turn followed by the attempts that answered it. */
export function ArmThread({
  experiment,
  run,
  divergent,
}: {
  experiment: ExperimentResponse;
  run: ExperimentRunSchema;
  divergent: Set<string>;
}) {
  const turns = experiment.turns
    .filter((turn) => turn.run_id === run.run_id)
    .sort((left, right) => left.ordinal - right.ordinal);
  return (
    <ol className="grid gap-3">
      {turns.map((turn) => (
        <li key={`${turn.run_id}:${turn.ordinal}`} className="grid gap-3">
          <ArmTurn experiment={experiment} run={run} turn={turn} divergent={divergent} />
        </li>
      ))}
    </ol>
  );
}

/** One customer turn on one arm, and every attempt that arm made at answering it. */
export function ArmTurn({
  experiment,
  run,
  turn,
  divergent,
}: {
  experiment: ExperimentResponse;
  run: ExperimentRunSchema;
  turn: ParticipantTurnSchema;
  divergent: Set<string>;
}) {
  return (
    <>
      <CustomerTurn turn={turn} divergent={divergent.has(turn.turn_id)} />
      <ArmAttempts experiment={experiment} run={run} turn={turn} calls="chips" />
    </>
  );
}

/**
 * Every attempt one arm made at answering one customer turn, without the turn itself: what the
 * results' Conversation draws in an arm's column, under the message it drew once across them
 * (ADR 0080).
 *
 * `calls` is how each attempt's calls are drawn: the bench's chips, side by side, or the sheet's
 * lines, one call a line, as the sheet draws every fact (sheet mockup :257–259). The words of a
 * call are the same either way.
 */
export function ArmAttempts({
  experiment,
  run,
  turn,
  calls,
}: {
  experiment: ExperimentResponse;
  run: ExperimentRunSchema;
  turn: ParticipantTurnSchema;
  calls: "chips" | "lines";
}) {
  return (
    <>
      {attemptsFor(experiment, run, turn.ordinal).map((attempt) => (
        <Attempt
          key={attempt.attempt}
          turn={attempt}
          events={eventsFor(experiment, run, attempt)}
          faults={faultsFor(experiment, run, attempt)}
          calls={calls}
        />
      ))}
      {passedOver(run, turn) ? (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
          No reply — the customer wrote again before this arm was run
        </p>
      ) : null}
    </>
  );
}

function CustomerTurn({ turn, divergent }: { turn: ParticipantTurnSchema; divergent: boolean }) {
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
        {turn.source === "trigger" ? "Trigger" : "Customer"}
        {divergent ? <span className={chipClasses.mark}>this arm only</span> : null}
      </p>
      <p className="break-words rounded-lg bg-admin-canvas px-3 py-2 text-[13px] leading-relaxed text-admin-ink">
        {turn.body}
      </p>
    </div>
  );
}

/**
 * One attempt: the calls it made, then what it answered — or why it did not.
 *
 * The tool strip comes first because that is the order it happened in, and because a failed
 * attempt's calls are the informative half of the failure.
 *
 * A scenario fault sits in that strip where it fired — after the call it followed — because
 * the agent did not ask for it and cannot see it, and a refusal further along the strip with
 * no visible cause is the one thing a fault must never look like.
 */
function Attempt({
  turn,
  events,
  faults,
  calls,
}: {
  turn: AgentTurnSchema;
  events: ToolEventSchema[];
  faults: MutationEventSchema[];
  calls: "chips" | "lines";
}) {
  const lines = calls === "lines";
  return (
    <div className="grid gap-1">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">
        Agent
        {turn.attempt > 1 ? <span className={chipClasses.mark}>attempt {turn.attempt}</span> : null}
      </p>
      {events.length > 0 || faults.length > 0 ? (
        <ul className={lines ? sheetCallListClasses : "flex flex-wrap gap-1.5"}>
          {interleave(events, faults).map((entry) =>
            "tool" in entry ? (
              <li
                key={`call:${entry.ordinal}:${entry.attempt}:${entry.sequence}`}
                className={lines ? sheetCallLineClasses : `${chipClasses.quiet} gap-1`}
                title={`${entry.tool} ${entry.version} → ${labelOf(TOOL_OUTCOME, entry.outcome)}`}
              >
                <span aria-hidden="true">{`${TOOL_MARK[entry.outcome]} `}</span>
                {entry.tool} → {labelOf(TOOL_OUTCOME, entry.outcome)}
                {entry.revision_after > entry.revision_before ? " · moved this arm" : ""}
              </li>
            ) : (
              <li
                key={`fault:${entry.mutation_id}`}
                className={lines ? `${chipClasses.mark} justify-self-start` : chipClasses.mark}
                title={`${entry.mutation_id} · ${entry.timing} · ${entry.target}`}
              >
                scenario fault · moved this arm
              </li>
            ),
          )}
        </ul>
      ) : null}
      {turn.outcome === "answered" ? (
        <p className="break-words rounded-lg border border-admin-border px-3 py-2 text-[13px] leading-relaxed text-admin-ink">
          {turn.body}
        </p>
      ) : (
        <p className="rounded-lg border border-lab-error/40 px-3 py-2 text-[13px] text-lab-error">
          This attempt produced no reply: {describeFailure(turn.failure)}.
        </p>
      )}
    </div>
  );
}

function attemptsFor(
  experiment: ExperimentResponse,
  run: ExperimentRunSchema,
  ordinal: number,
): AgentTurnSchema[] {
  return experiment.agent_turns
    .filter((turn) => turn.run_id === run.run_id && turn.ordinal === ordinal)
    .sort((left, right) => left.attempt - right.attempt);
}

function eventsFor(
  experiment: ExperimentResponse,
  run: ExperimentRunSchema,
  turn: AgentTurnSchema,
): ToolEventSchema[] {
  return experiment.tool_events
    .filter(
      (event) =>
        event.run_id === run.run_id &&
        event.ordinal === turn.ordinal &&
        event.attempt === turn.attempt,
    )
    .sort((left, right) => left.sequence - right.sequence);
}

function faultsFor(
  experiment: ExperimentResponse,
  run: ExperimentRunSchema,
  turn: AgentTurnSchema,
): MutationEventSchema[] {
  return experiment.mutation_events
    .filter(
      (event) =>
        event.run_id === run.run_id &&
        event.ordinal === turn.ordinal &&
        event.attempt === turn.attempt,
    )
    .sort((left, right) => left.after_calls - right.after_calls);
}

/**
 * The calls and the faults in the order the arm met them.
 *
 * A fault records how many calls had already been made when it fired, so it sits before the
 * call of that sequence: the world moved, and then the agent asked its next question against
 * what the fault left behind.
 */
function interleave(
  events: ToolEventSchema[],
  faults: MutationEventSchema[],
): (ToolEventSchema | MutationEventSchema)[] {
  const ordered: (ToolEventSchema | MutationEventSchema)[] = [];
  for (const event of events) {
    ordered.push(...faults.filter((fault) => fault.after_calls === event.sequence));
    ordered.push(event);
  }
  return [...ordered, ...faults.filter((fault) => fault.after_calls >= events.length)];
}

/**
 * Whether this arm moved past a customer turn without ever answering it.
 *
 * A membership test against the ordinals the standing names, not a rule this page keeps: an
 * operator may send a second message before running the agent on the first, and the arm then
 * answers the conversation as it stands rather than the question the customer moved on from
 * (ADR 0026). Which turns those were is the backend's reading — deriving it here again would
 * be the second reading the standing exists to remove, and would be free to disagree with the
 * sentence printed above the same thread.
 */
function passedOver(run: ExperimentRunSchema, turn: ParticipantTurnSchema): boolean {
  return run.standing.unanswered.includes(turn.ordinal);
}
