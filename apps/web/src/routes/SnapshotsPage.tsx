import type {
  DefinitionIssueSchema,
  DefinitionVersionSummarySchema,
  SandboxSnapshotResponse,
  SandboxSnapshotSummarySchema,
  SandboxSummarySchema,
} from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { describeApiError, LabApiError } from "../api/client";
import { cloneSandbox, listSandboxes } from "../api/sandboxes";
import { getScenarioDraft, listScenarioVersions } from "../api/scenarios";
import {
  getSandboxSnapshot,
  listSandboxSnapshots,
  materializeSandboxSnapshot,
} from "../api/snapshots";
import { Explainer } from "../components/Explainer";
import { SandboxToolConsole } from "../components/SandboxToolConsole";
import {
  Card,
  Fingerprint,
  IssueList,
  PageHeader,
  StatusPill,
} from "../components/WorkspaceChrome";
import { originLabel } from "../lib/tickets";
import {
  accentButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  formatTimestamp,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const UNAVAILABLE = "The starting states of this scenario are unavailable.";
const ARMS_UNAVAILABLE = "The arms cloned from this snapshot are unavailable.";
const DEFAULT_SEED = 20260825;
/** The contract's own bound, declared here so the field refuses before the server has to. */
const MAX_SEED = 2 ** 32 - 1;

function newestVersion(versions: DefinitionVersionSummarySchema[]): number | null {
  return versions.reduce<number | null>(
    (newest, published) =>
      newest === null || published.version > newest ? published.version : newest,
    null,
  );
}

/**
 * The starting states one scenario has been frozen into.
 *
 * A published scenario version is a recipe, not starting state: it pins its shop, ticket, and
 * templates, but the orders it names keep moving. Materializing is what settles that, so this
 * page pairs each published version with the snapshots taken from it and says which pins and
 * which copies each one holds.
 */
export function SnapshotsPage() {
  const { shopId } = useShopWorkspace();
  const { scenarioId = "" } = useParams();
  const [name, setName] = useState("");
  const [versions, setVersions] = useState<DefinitionVersionSummarySchema[]>([]);
  const [snapshots, setSnapshots] = useState<SandboxSnapshotSummarySchema[]>([]);
  const [selected, setSelected] = useState<SandboxSnapshotResponse | null>(null);
  const [version, setVersion] = useState("");
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<DefinitionIssueSchema[]>([]);
  const [working, setWorking] = useState(false);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const [draft, versionList, snapshotList] = await Promise.all([
        getScenarioDraft(shopId, scenarioId, signal),
        listScenarioVersions(shopId, scenarioId, signal),
        listSandboxSnapshots(shopId, scenarioId, signal),
      ]);
      setName(draft.content.name);
      setVersions(versionList.versions);
      setSnapshots(snapshotList.snapshots);
      // The newest published version is the one an operator means by default. Computed
      // rather than read off an end of the list: the contract does not promise an order,
      // and the server happens to send newest-first, which `at(-1)` would read as oldest.
      setVersion((current) =>
        current === "" ? String(newestVersion(versionList.versions) ?? "") : current,
      );
    },
    [shopId, scenarioId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(describeApiError(cause, UNAVAILABLE));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload]);

  const materialize = async (event: FormEvent) => {
    event.preventDefault();
    // `Number("")` is 0, so a cleared field would quietly freeze against a seed the author
    // never chose. The seed is a behavioral input; it has to be said out loud.
    if (seed.trim() === "") {
      setError("Enter the seed this starting state should be fingerprinted with.");
      return;
    }
    setWorking(true);
    setError(null);
    setIssues([]);
    try {
      const record = await materializeSandboxSnapshot(shopId, scenarioId, Number(version), {
        seed: Number(seed),
      });
      setSelected(record);
      await reload();
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This version could not be frozen."));
      setIssues(cause instanceof LabApiError ? cause.issues : []);
    } finally {
      setWorking(false);
    }
  };

  const inspect = async (snapshotId: string) => {
    setError(null);
    setIssues([]);
    try {
      setSelected(await getSandboxSnapshot(shopId, snapshotId));
    } catch (cause: unknown) {
      setError(describeApiError(cause, UNAVAILABLE));
    }
  };

  return (
    <>
      <PageHeader
        title={loading ? "Starting states" : `${name} · starting states`}
        description={
          <>
            <Link className="font-semibold text-lab-ink" to=".." relative="path">
              Back to the recipe
            </Link>{" "}
            · a snapshot pins every published version it reaches and copies the orders nothing
            pinned, then fingerprints the two together. Each arm of an experiment runs in its own
            clone of one snapshot.
          </>
        }
      />

      <Explainer id="snapshots" />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div className="mb-4">
          <IssueList issues={issues} />
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-4">
          <Card
            title="Freeze a published version"
            footer={
              <p className="text-xs text-admin-muted">
                Freezing the same version, seed, and orders returns the snapshot that already holds
                them. An order edited in between is different starting state, so it produces a new
                one.
              </p>
            }
          >
            {versions.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                {loading
                  ? "Loading published versions…"
                  : "This scenario has no published version yet. Publish the recipe first."}
              </p>
            ) : (
              <form className="flex flex-wrap items-end gap-3" onSubmit={materialize}>
                <label className={fieldLabelClasses}>
                  Scenario version
                  <select
                    className={fieldControlClasses}
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                  >
                    {[...versions]
                      .sort((left, right) => right.version - left.version)
                      .map((published) => (
                        <option key={published.version} value={String(published.version)}>
                          v{published.version}
                        </option>
                      ))}
                  </select>
                </label>
                <label className={fieldLabelClasses}>
                  Seed
                  <input
                    className={fieldControlClasses}
                    type="number"
                    min={0}
                    max={MAX_SEED}
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                  />
                </label>
                <button className={accentButtonClasses} type="submit" disabled={working}>
                  {working ? "Freezing…" : "Materialize snapshot"}
                </button>
              </form>
            )}
          </Card>

          <Card title="Snapshots">
            {snapshots.length === 0 ? (
              <p className="text-[13px] text-admin-muted">
                {loading ? "Loading snapshots…" : "No starting state has been frozen yet."}
              </p>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={tableHeadClasses}>Fingerprint</th>
                    <th className={tableHeadClasses}>Version</th>
                    <th className={tableHeadClasses}>Seed</th>
                    <th className={tableHeadClasses}>Orders</th>
                    <th className={tableHeadClasses}>Frozen</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => (
                    <tr key={snapshot.snapshot_id}>
                      <td className={tableCellClasses}>
                        <button
                          className="text-left font-semibold text-lab-ink underline-offset-2 hover:underline"
                          type="button"
                          onClick={() => void inspect(snapshot.snapshot_id)}
                        >
                          <Fingerprint value={snapshot.sandbox_fingerprint} />
                        </button>
                      </td>
                      <td className={tableCellClasses}>v{snapshot.scenario_version}</td>
                      <td className={tableCellClasses}>{snapshot.seed}</td>
                      <td className={tableCellClasses}>{snapshot.order_count}</td>
                      <td className={tableCellClasses}>{formatTimestamp(snapshot.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          {selected === null ? (
            <Card title="Frozen starting state">
              <p className="text-[13px] text-admin-muted">
                Select a snapshot to read what it pinned and what it copied.
              </p>
            </Card>
          ) : (
            <>
              <SnapshotDetail snapshot={selected} />
              {/* Keyed on the snapshot so switching selection starts a clean panel rather
                  than carrying one snapshot's draft label or error onto another's arms. */}
              <SandboxArms
                key={selected.snapshot_id}
                shopId={shopId}
                snapshotId={selected.snapshot_id}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SnapshotDetail({ snapshot }: { snapshot: SandboxSnapshotResponse }) {
  const { interaction } = snapshot.state;
  return (
    <>
      <Card title={`Snapshot · ${snapshot.canonical_schema_version}`}>
        <p className="text-[13px] text-admin-ink-soft">
          Fingerprint <Fingerprint value={snapshot.sandbox_fingerprint} /> · seed {snapshot.seed} ·
          frozen {formatTimestamp(snapshot.created_at)}
        </p>
        <p className="text-[13px] text-admin-ink-soft">
          Opened from the {originLabel(interaction.origin_kind)} on ticket{" "}
          <span className="font-mono font-semibold">{interaction.ticket_reference}</span> via{" "}
          {interaction.channel}
          {interaction.product_handle === null ? null : (
            <>
              {" "}
              · <span className="font-mono">{interaction.product_handle}</span>
            </>
          )}
          {interaction.order_id === null ? null : (
            <>
              {" "}
              · <span className="font-mono">{interaction.order_id}</span>
            </>
          )}
        </p>
        <p className="text-xs text-admin-muted">
          The origin is an identifier, never a copy of the resource: an arm resolves it through its
          tools against this same state.
        </p>
      </Card>

      <Card
        title="Pinned versions"
        footer={
          <p className="text-xs text-admin-muted">
            Immutable already, so the snapshot records the pin instead of a second copy that could
            disagree with it.
          </p>
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {snapshot.pins.map((pin) => (
              <tr key={`${pin.definition_type}:${pin.definition_id}`}>
                <td className={tableCellClasses}>{pin.definition_type.replace(/_/g, " ")}</td>
                <td className={tableCellClasses}>v{pin.version}</td>
                <td className={tableCellClasses}>
                  <Fingerprint value={pin.content_fingerprint} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card
        title="Copied orders"
        footer={
          <p className="text-xs text-admin-muted">
            No published version pins an order fixture, so the snapshot froze these documents as
            they read. Editing the order afterwards leaves this snapshot exactly as it is.
          </p>
        }
      >
        {snapshot.state.orders.length === 0 ? (
          <p className="text-[13px] text-admin-muted">This customer holds no orders.</p>
        ) : (
          <ul className="grid gap-3">
            {snapshot.state.orders.map((order) => (
              <li key={order.order_id} className="grid gap-1">
                <p className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-mono font-semibold text-lab-ink">{order.reference}</span>
                  <StatusPill tone="payment" label={order.payment_status.replace(/_/g, " ")} />
                  <StatusPill
                    tone="fulfilment"
                    label={order.fulfilment_status.replace(/_/g, " ")}
                  />
                  <span className="text-admin-muted">
                    {order.total_amount} {order.currency} · {order.item_count} item(s)
                  </span>
                </p>
                {order.shipping_label === null ? null : (
                  <p className="text-xs text-admin-muted">Ships to {order.shipping_label}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * The arms cloned from one snapshot.
 *
 * A snapshot is starting state shared by every arm and never moves; a sandbox is the copy one
 * arm works in. So the two fingerprints beside each other are the whole point: the snapshot
 * fingerprint says where an arm started, and the state fingerprint says where it is now.
 * Clones of one snapshot answer with the same pair until one of them writes.
 */
function SandboxArms({ shopId, snapshotId }: { shopId: string; snapshotId: string }) {
  const [arms, setArms] = useState<SandboxSummarySchema[]>([]);
  const [label, setLabel] = useState("");
  const [inspected, setInspected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const listed = await listSandboxes(shopId, snapshotId, signal);
      setArms(listed.sandboxes);
    },
    [shopId, snapshotId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(describeApiError(cause, ARMS_UNAVAILABLE));
      }
    });
    return () => controller.abort();
  }, [load]);

  const clone = async (event: FormEvent) => {
    event.preventDefault();
    if (label.trim() === "") {
      setError("Name the arm so it can be told from the one beside it.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      // The response is the arm, so it is appended rather than refetched. A failed reload
      // would otherwise be reported as a failed clone, after the arm already exists.
      const created = await cloneSandbox(shopId, snapshotId, { label: label.trim() });
      setArms((current) => [...current, created]);
      setLabel("");
    } catch (cause: unknown) {
      setError(describeApiError(cause, "This snapshot could not be cloned."));
    } finally {
      setWorking(false);
    }
  };

  const selected = arms.find((arm) => arm.sandbox_id === inspected) ?? null;

  return (
    <>
      <Card
        title="Sandbox arms"
        footer={
          <p className="text-xs text-admin-muted">
            Every arm starts at the same state fingerprint because it starts from the same bytes. A
            write inside one arm moves only that arm — never the snapshot, never the other.
          </p>
        }
      >
        {error ? (
          <p role="alert" className="text-[13px] text-lab-error">
            {error}
          </p>
        ) : null}
        <form className="flex flex-wrap items-end gap-3" onSubmit={clone}>
          <label className={fieldLabelClasses}>
            Arm label
            <input
              className={fieldControlClasses}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button className={accentButtonClasses} type="submit" disabled={working}>
            {working ? "Cloning…" : "Clone sandbox"}
          </button>
        </form>

        {arms.length === 0 ? (
          <p className="text-[13px] text-admin-muted">
            No arm has been cloned from this starting state yet.
          </p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={tableHeadClasses}>Arm</th>
                <th className={tableHeadClasses}>Revision</th>
                <th className={tableHeadClasses}>Current state</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm) => (
                <tr key={arm.sandbox_id}>
                  <td className={tableCellClasses}>
                    <button
                      className="text-left font-semibold text-lab-ink underline-offset-2 hover:underline"
                      type="button"
                      aria-pressed={arm.sandbox_id === inspected}
                      onClick={() => setInspected(arm.sandbox_id)}
                    >
                      {arm.label}
                    </button>
                  </td>
                  <td className={tableCellClasses}>r{arm.revision}</td>
                  <td className={tableCellClasses}>
                    <Fingerprint value={arm.state_fingerprint} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {/* Keyed on the arm so switching selection starts a clean console rather than
        carrying one arm's arguments or result onto another's. */}
      {selected === null ? null : (
        <SandboxToolConsole
          key={selected.sandbox_id}
          shopId={shopId}
          arm={selected}
          // A write moved the arm, so the revision and fingerprint above are stale. Reloaded
          // on being told rather than polled: the console does not own this list.
          onArmMoved={() => {
            load().catch((cause: unknown) => setError(describeApiError(cause, ARMS_UNAVAILABLE)));
          }}
        />
      )}
    </>
  );
}
