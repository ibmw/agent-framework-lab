import type { ExperimentRunSchema, FieldChangeSchema } from "@agent-lab/contracts";

/**
 * How the results read an arm's state diff: grouped, summarised, and set beside the other
 * arms'. A presentation of `ArmStateDiffSchema` and nothing more — every path the backend
 * served stays on the page (ADR 0035), and nothing here decides what changed.
 */

/** One first-segment group of an order's changed paths: `shipping_address`, `events`. */
export interface DiffGroup {
  key: string;
  /** The segment in words: `shipping_address` reads "shipping address". */
  label: string;
  /** Whether the segment is a list, whose entries are counted rather than its fields. */
  list: boolean;
  changes: FieldChangeSchema[];
  /** For a list: how many of its entries arrived, left, or changed in place. */
  added: number;
  removed: number;
  changed: number;
}

const FIRST_SEGMENT = /^([^.[]+)(\[\d+\])?/;

/**
 * A segment whose word an operator reads in American spelling (PLAN-UX Milestone 13) where the
 * contract keeps its own: the group's `key` and every path stay as the record spells them.
 */
const GROUP_LABELS: Readonly<Record<string, string>> = { fulfilment: "fulfillment" };

/**
 * An order's changes grouped by the first segment of their paths, the largest group first.
 *
 * Ordered by how many fields moved rather than alphabetically, so the group that carries the
 * change leads; a list group follows the field groups, because it reads as a count of entries
 * rather than as fields. Ties keep the order the backend served.
 */
export function groupChanges(changes: readonly FieldChangeSchema[]): DiffGroup[] {
  const groups = new Map<string, { list: boolean; changes: FieldChangeSchema[] }>();
  for (const change of changes) {
    const match = FIRST_SEGMENT.exec(change.path);
    const key = match?.[1] ?? change.path;
    const group = groups.get(key) ?? { list: false, changes: [] };
    group.list = group.list || match?.[2] !== undefined;
    group.changes.push(change);
    groups.set(key, group);
  }
  const built = [...groups.entries()].map(([key, group]): DiffGroup => {
    const entries = group.list ? entriesOf(group.changes) : [];
    return {
      key,
      label: GROUP_LABELS[key] ?? key.replaceAll("_", " "),
      list: group.list,
      changes: group.changes,
      added: entries.filter((entry) => entry.every((change) => change.before === null)).length,
      removed: entries.filter((entry) => entry.every((change) => change.after === null)).length,
      changed: entries.filter(
        (entry) =>
          !entry.every((change) => change.before === null) &&
          !entry.every((change) => change.after === null),
      ).length,
    };
  });
  return built
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        Number(a.group.list) - Number(b.group.list) ||
        b.group.changes.length - a.group.changes.length ||
        a.index - b.index,
    )
    .map(({ group }) => group);
}

/** A list group's changes, one array per entry (`events[3]`, `events[4]`). */
function entriesOf(changes: readonly FieldChangeSchema[]): FieldChangeSchema[][] {
  const entries = new Map<string, FieldChangeSchema[]>();
  for (const change of changes) {
    const entry = /^[^.[]+\[\d+\]/.exec(change.path)?.[0] ?? change.path;
    entries.set(entry, [...(entries.get(entry) ?? []), change]);
  }
  return [...entries.values()];
}

/** One group in the summary's words: "fulfillment", or "2 events added". */
function groupPhrase(group: DiffGroup): string {
  if (!group.list) {
    return group.label;
  }
  const counts = [
    [group.added, "added"],
    [group.removed, "removed"],
    [group.changed, "changed"],
  ] as const;
  return counts
    .filter(([count]) => count > 0)
    .map(([count, verb], index) => {
      if (index > 0) {
        return `${count} ${verb}`;
      }
      const noun =
        count === 1 && group.label.endsWith("s") ? group.label.slice(0, -1) : group.label;
      return `${count} ${noun} ${verb}`;
    })
    .join(", ");
}

/** The line an order's diff opens with: "3 groups changed: shipping address, fulfillment, 2 events added". */
export function summarizeGroups(groups: readonly DiffGroup[]): string {
  const noun = groups.length === 1 ? "group" : "groups";
  return `${groups.length} ${noun} changed: ${groups.map(groupPhrase).join(", ")}`;
}

/**
 * The canonical instant every timestamp in a state document is written as: UTC, RFC 3339,
 * six fractional digits (ADR 0007; `canonical_timestamp` and `require_utc_timestamp` in the
 * API).
 */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function isCanonicalInstant(value: string | null): boolean {
  return value !== null && CANONICAL_INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * The fields a run's own clock writes. A run moves an order through exactly two writers, and
 * each stamps the moment it ran rather than a moment anyone chose: a scenario fault
 * (`advance_fulfilment`, `domain/mutation.py`) writes `fulfilment.shipped_at` and its event's
 * `occurred_at`, and an address change (`apply_address_change`, `domain/address_change.py`)
 * writes `shipping_address.selected_at` and its event's `occurred_at`, both from
 * `self._clock.now()`. Two arms that did the same thing did it at different moments.
 *
 * A list kept by hand, and deliberately in the direction that fails loud: the day a third writer
 * stamps a clock elsewhere, its field reads as a difference until it is named here, and a date
 * an agent chooses is never set aside because it looks like a timestamp.
 */
const CLOCK_WRITTEN =
  /^(events\[\d+\]\.occurred_at|fulfilment\.shipped_at|shipping_address\.selected_at)$/;

/**
 * The name an address change gives the order event it writes: `address-change-` and the first
 * twelve hex digits of its confirmation (`CONFIRMATION_EVENT_DIGITS`,
 * `application/sandbox_actions.py`), a SHA-256 that covers the arm's own state fingerprint
 * (`confirmation_of`). It is the one event name that differs per arm by construction; a fault's
 * event is named after the fault (`mutation-<id>`) and is the same in every arm, so two
 * different fault names at one index are two different events and read as a difference.
 */
const ADDRESS_CHANGE_EVENT = /^address-change-[0-9a-f]{12}$/;

/**
 * How a row's values compare across the arms.
 *
 * - `same`: every arm's value is the same on both sides.
 * - `timestamp`: a field the run's clock writes, and on each side that differs every arm holds
 *   a canonical instant. Shown for every arm, not compared.
 * - `identifier`: an order event's ID where every arm's differing value is an address change's
 *   minted name. Shown for every arm, not compared; the event's kind and summary still are.
 * - `differs`: anything else, including a moment on one arm against a field that is not set on
 *   another, because absent and present are different facts.
 */
export type Assessment = "same" | "timestamp" | "identifier" | "differs";

export function assess(
  path: string,
  before: (string | null)[],
  after: (string | null)[],
): Assessment {
  const varying = [before, after].filter((values) => new Set(values).size > 1);
  if (varying.length === 0) {
    return "same";
  }
  const all = (test: (value: string | null) => boolean) =>
    varying.every((values) => values.every(test));
  if (CLOCK_WRITTEN.test(path) && all(isCanonicalInstant)) {
    return "timestamp";
  }
  if (
    /^events\[\d+\]\.id$/.test(path) &&
    all((value) => value !== null && ADDRESS_CHANGE_EVENT.test(value))
  ) {
    return "identifier";
  }
  return "differs";
}

/** One path, each arm's value on both sides, and how they compare. */
export interface ComparedRow {
  path: string;
  before: (string | null)[];
  after: (string | null)[];
  assessment: Assessment;
}

/** One order as every arm left it. */
export interface ComparedOrder {
  orderId: string;
  reference: string;
  /** Every arm, in the experiment's order, with that order's changes grouped. */
  arms: { run: ExperimentRunSchema; groups: DiffGroup[]; count: number }[];
  /** Present when every arm changed the same set of paths: the groups as rows across arms. */
  table: { key: string; label: string; rows: ComparedRow[] }[] | null;
  /** How many distinct paths moved in this order, over every arm. */
  fields: number;
  /**
   * Where the arms changed different paths: for each arm, the paths it changed that some other
   * arm did not, a list entry or a field group folded to `events[3].*` or `fulfilment.*` when
   * every path under it is one of them.
   */
  unshared: { run: ExperimentRunSchema; paths: string[] }[];
}

/**
 * The paths in `mine` that are not in every set of `all`, folded to `prefix.*` where this arm
 * changed several paths under one entry or group and no other arm changed anything under it —
 * so "Only Arm A changed events[3].*" is never said of an entry another arm also touched.
 */
function unsharedPaths(
  mine: readonly string[],
  all: readonly Set<string>[],
  others: readonly Set<string>[],
): string[] {
  const unshared = new Set(mine.filter((path) => !all.every((set) => set.has(path))));
  const folded: string[] = [];
  const seen = new Set<string>();
  for (const path of mine) {
    if (!unshared.has(path)) {
      continue;
    }
    const entry = /^[^.[]+\[\d+\]/.exec(path)?.[0];
    const group = /^[^.[]+/.exec(path)?.[0] ?? path;
    const prefix = entry ?? (path.includes(".") ? group : path);
    const under = mine.filter((other) => other === prefix || other.startsWith(`${prefix}.`));
    const touchedElsewhere = others.some((set) =>
      [...set].some((other) => other === prefix || other.startsWith(`${prefix}.`)),
    );
    const whole =
      under.length > 1 && !touchedElsewhere && under.every((other) => unshared.has(other));
    const name = whole ? `${prefix}.*` : path;
    if (!seen.has(name)) {
      seen.add(name);
      folded.push(name);
    }
  }
  return folded;
}

/**
 * Each order any arm moved, read across the arms. Paired by order ID, as the backend pairs the
 * states it diffs (ADR 0035). The arms sit side by side only when they changed exactly the same
 * paths; otherwise a row would hold a value against a field one arm never touched, which reads
 * as a difference the diff does not say, so each arm keeps its own column.
 */
export function compareOrders(runs: readonly ExperimentRunSchema[]): ComparedOrder[] {
  const orders = new Map<string, string>();
  for (const run of runs) {
    for (const order of run.state_diff.orders) {
      if (!orders.has(order.order_id)) {
        orders.set(order.order_id, order.reference);
      }
    }
  }
  return [...orders.entries()].map(([orderId, reference]) => {
    const changesOf = runs.map(
      (run) => run.state_diff.orders.find((order) => order.order_id === orderId)?.changes ?? [],
    );
    const pathSets = changesOf.map((changes) => [...changes.map((c) => c.path)].sort().join("\n"));
    const sameSet = pathSets.every((set) => set === pathSets[0]);
    const arms = runs.map((run, index) => {
      const changes = changesOf[index] ?? [];
      return { run, groups: groupChanges(changes), count: changes.length };
    });
    const fields = new Set(changesOf.flatMap((changes) => changes.map((c) => c.path))).size;
    const table = sameSet
      ? (arms[0]?.groups ?? []).map((group) => ({
          key: group.key,
          label: group.label,
          rows: group.changes.map((change): ComparedRow => {
            const values = changesOf.map((changes) =>
              changes.find((candidate) => candidate.path === change.path),
            );
            const before = values.map((value) => value?.before ?? null);
            const after = values.map((value) => value?.after ?? null);
            return {
              path: change.path,
              before,
              after,
              assessment: assess(change.path, before, after),
            };
          }),
        }))
      : null;
    const sets = changesOf.map((changes) => new Set(changes.map((c) => c.path)));
    const unshared = sameSet
      ? []
      : arms
          .map(({ run }, index) => ({
            run,
            paths: unsharedPaths(
              (changesOf[index] ?? []).map((c) => c.path),
              sets,
              sets.filter((_, other) => other !== index),
            ),
          }))
          .filter(({ paths }) => paths.length > 0);
    return { orderId, reference, arms, table, fields, unshared };
  });
}
