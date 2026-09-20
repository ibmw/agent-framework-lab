import type {
  AgentConfigurationSummarySchema,
  BlockSummarySchema,
  CustomerProfileSummarySchema,
  JudgeConfigurationSummarySchema,
  OrderSummarySchema,
  ScenarioSummarySchema,
  SupportIdentitySummarySchema,
  TicketSummarySchema,
} from "@agent-lab/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listAgentConfigurations } from "../api/agentConfigurations";
import { mutationBlocks, objectiveBlocks } from "../api/blocks";
import { describeApiError } from "../api/client";
import { listCustomerProfiles } from "../api/customerProfiles";
import { listExperimentHistory } from "../api/experiments";
import { listJudgeConfigurations } from "../api/judgeConfigurations";
import { listOrders } from "../api/orders";
import { listScenarios } from "../api/scenarios";
import { listSupportIdentities } from "../api/supportIdentities";
import { listTickets } from "../api/tickets";

/**
 * One read the workspace holds on behalf of every surface that needs it (ADR 0056).
 *
 * `value` is `null` until the first answer lands, and stays whatever it last was if a later
 * read fails: an index that has rows on screen keeps them and says what went wrong, rather
 * than emptying itself over a refresh nobody asked to see.
 */
export interface Reading<Value> {
  value: Value | null;
  /** True until a read settles. A refresh does not raise it; a superseding read can. */
  loading: boolean;
  error: string | null;
  /** Read it again. For a surface that has just changed what the read answers. */
  refresh: () => Promise<void>;
}

/**
 * A listing the rail counts and an index renders, from one read.
 *
 * `count` is the figure the rail draws and observes the chip row's rule
 * (`docs/design-direction.md`, *Lists and counts*): the whole list, absent while the listing
 * is in flight or failed, and never faked. Zero is a real count and is drawn.
 */
export interface Listing<Row> {
  rows: Row[];
  loading: boolean;
  error: string | null;
  count: number | null;
  refresh: () => Promise<void>;
}

/** A figure that is not the length of anything this shell holds — history's total. */
export interface Total {
  count: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function useReading<Value>(
  load: (signal?: AbortSignal) => Promise<Value>,
  unavailable: string,
): Reading<Value> {
  const [value, setValue] = useState<Value | null>(null);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Counts the reads this holder has started, so a response can say whether it is still the
   * one being waited for — the token `useDefinitionEditor.discard` already answers the same
   * question with.
   *
   * A controller per handler-fired read, aborted when `load` changes, would cover the case
   * that prompted this: a save on the orders editor whose refresh outlives a shop change in
   * the top bar, which reuses this same holder with a new `load`, and would otherwise land
   * the old shop's rows on the new shop's rail. A counter is used instead because it also
   * orders refreshes *against each other* and against the mount read, which cancelling on a
   * change of subject says nothing about. One rule covers all of them: the read that started
   * last wins, whichever kind started it.
   */
  const started = useRef(0);

  const read = useCallback(
    async (signal?: AbortSignal) => {
      started.current += 1;
      const at = started.current;
      const current = () => started.current === at && signal?.aborted !== true;
      try {
        const next = await load(signal);
        if (!current()) {
          return;
        }
        setValue(next);
        setError(null);
      } catch (cause: unknown) {
        if (!current()) {
          return;
        }
        setError(describeApiError(cause, unavailable));
      } finally {
        if (current()) {
          setSettled(true);
        }
      }
    },
    [load, unavailable],
  );

  // `load` changes when the thing being read changes — a different shop, in practice — so the
  // held answer is dropped rather than shown against the new subject for a frame.
  useEffect(() => {
    const controller = new AbortController();
    setValue(null);
    setSettled(false);
    setError(null);
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);

  const refresh = useCallback(() => read(), [read]);

  return useMemo(
    () => ({ value, loading: !settled, error, refresh }),
    [value, settled, error, refresh],
  );
}

function useListing<Row>(
  load: (signal?: AbortSignal) => Promise<Row[]>,
  unavailable: string,
): Listing<Row> {
  const reading = useReading(load, unavailable);
  return useMemo(
    () => ({
      rows: reading.value ?? [],
      loading: reading.loading,
      error: reading.error,
      count: reading.error === null ? (reading.value?.length ?? null) : null,
      refresh: reading.refresh,
    }),
    [reading],
  );
}

/** The four shop listings and the one library the shop's rail points at (ADR 0056). */
export interface ShopListings {
  orders: Listing<OrderSummarySchema>;
  /** The profiles attached to this shop, which is what the Customers index lists. */
  customers: Listing<CustomerProfileSummarySchema>;
  tickets: Listing<TicketSummarySchema>;
  scenarios: Listing<ScenarioSummarySchema>;
  /**
   * The lab's one support-identity library. It is on the shop's rail because the prototype
   * draws it there and following that entry changes mode (ADR 0054); its count is the same
   * library's, read from the same route the lab reads.
   */
  supportIdentities: Listing<SupportIdentitySummarySchema>;
}

export function useShopListings(shopId: string): ShopListings {
  const orders = useListing(
    useCallback(
      async (signal?: AbortSignal) => (await listOrders(shopId, signal)).orders,
      [shopId],
    ),
    "The order service is unavailable.",
  );
  const customers = useListing(
    useCallback(
      async (signal?: AbortSignal) => (await listCustomerProfiles(shopId, signal)).profiles,
      [shopId],
    ),
    "The customer service is unavailable.",
  );
  const tickets = useListing(
    useCallback(
      async (signal?: AbortSignal) => (await listTickets(shopId, signal)).tickets,
      [shopId],
    ),
    "The ticket service is unavailable.",
  );
  const scenarios = useListing(
    useCallback(
      async (signal?: AbortSignal) => (await listScenarios(shopId, signal)).scenarios,
      [shopId],
    ),
    "The scenario workspace is unavailable.",
  );
  const supportIdentities = useListing(
    LIST_SUPPORT_IDENTITIES,
    "The support-identity service is unavailable.",
  );
  return useMemo(
    () => ({ orders, customers, tickets, scenarios, supportIdentities }),
    [orders, customers, tickets, scenarios, supportIdentities],
  );
}

/**
 * Module constants rather than `useCallback(…, [])`: none of these reads takes an argument,
 * so there is nothing per-mount about them, and a stable identity is what stops the shell
 * re-reading the lab on every render.
 */
const LIST_SUPPORT_IDENTITIES = async (signal?: AbortSignal) =>
  (await listSupportIdentities(signal)).identities;

const LIST_AGENT_CONFIGURATIONS = async (signal?: AbortSignal) =>
  (await listAgentConfigurations(signal)).configurations;

const LIST_JUDGES = async (signal?: AbortSignal) => (await listJudgeConfigurations(signal)).judges;

const LIST_OBJECTIVE_BLOCKS = async (signal?: AbortSignal) =>
  (await objectiveBlocks.list(signal)).blocks;

const LIST_MUTATION_BLOCKS = async (signal?: AbortSignal) =>
  (await mutationBlocks.list(signal)).blocks;

/**
 * History's total, which is not a listing this shell can hold.
 *
 * The history index reads one narrowed, URL-backed page at a time (ADR 0033) and the rail
 * says how many experiments the lab has run in total — the chip row's rule, "the count is of
 * the whole list". So the shell asks for the smallest page there is and keeps the `total`
 * beside it, which is the one figure it needs and none of the rows it does not.
 */
export const HISTORY_TOTAL_PAGE_SIZE = 1;

const READ_HISTORY_TOTAL = async (signal?: AbortSignal) =>
  (await listExperimentHistory({ page: 1, page_size: HISTORY_TOTAL_PAGE_SIZE }, signal)).total;

/** Every listing the lab's rail counts, and the one total (ADR 0056). */
export interface LabListings {
  history: Total;
  agentConfigurations: Listing<AgentConfigurationSummarySchema>;
  judges: Listing<JudgeConfigurationSummarySchema>;
  supportIdentities: Listing<SupportIdentitySummarySchema>;
  objectiveBlocks: Listing<BlockSummarySchema>;
  mutationBlocks: Listing<BlockSummarySchema>;
}

export function useLabListings(): LabListings {
  const total = useReading(READ_HISTORY_TOTAL, "Experiment history is unavailable.");
  const history = useMemo<Total>(
    () => ({
      count: total.error === null ? total.value : null,
      loading: total.loading,
      error: total.error,
      refresh: total.refresh,
    }),
    [total],
  );
  const agentConfigurations = useListing(
    LIST_AGENT_CONFIGURATIONS,
    "The agent-configuration service is unavailable.",
  );
  const judges = useListing(LIST_JUDGES, "The judge service is unavailable.");
  const supportIdentities = useListing(
    LIST_SUPPORT_IDENTITIES,
    "The support-identity service is unavailable.",
  );
  const objectiveBlocks = useListing(
    LIST_OBJECTIVE_BLOCKS,
    "The objective-block library is unavailable.",
  );
  const mutationBlocks = useListing(
    LIST_MUTATION_BLOCKS,
    "The mutation-block library is unavailable.",
  );
  return useMemo(
    () => ({
      history,
      agentConfigurations,
      judges,
      supportIdentities,
      objectiveBlocks,
      mutationBlocks,
    }),
    [history, agentConfigurations, judges, supportIdentities, objectiveBlocks, mutationBlocks],
  );
}
