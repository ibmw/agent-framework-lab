import type { BlockSummarySchema } from "@agent-lab/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { mutationBlocks, objectiveBlocks } from "../api/blocks";
import { describeApiError } from "../api/client";
import { savedAsPreview } from "../components/DerivedIdField";
import { FieldHint } from "../components/FieldHint";
import { TourLaunch } from "../components/TourLaunch";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import { toSlug } from "../lib/blocks";
import type { TourId } from "../lib/tours";
import {
  accentButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";

interface LibraryCopy {
  title: string;
  /** The tour this library offers. */
  tour: TourId;
  description: string;
  /** What the library is, shown above the index the way frames 4a and 4b state it. */
  premise: string;
  emptyState: string;
  createLabel: string;
  typeHeading: string;
  unavailable: string;
  namePlaceholder: string;
}

const OBJECTIVE_COPY: LibraryCopy = {
  title: "Objective blocks",
  tour: "objective-blocks",
  description:
    "What an experiment asserts, authored once and composed by any scenario. A scenario binds a template's parameters to its own shop's objects.",
  premise:
    "Blocks are shop-independent templates with typed parameters. A scenario binds those parameters to its own shop's objects — a binding can never point outside the scenario's shop.",
  emptyState: "No objective block yet. Create one to define what a scenario can assert.",
  createLabel: "New objective block",
  typeHeading: "Assessment · evidence",
  unavailable: "The objective-block library is unavailable.",
  namePlaceholder: "read-required-document",
};

const MUTATION_COPY: LibraryCopy = {
  title: "Mutation blocks",
  tour: "mutation-blocks",
  description:
    "What the scenario runtime injects into a run's sandbox. A scenario binds a template's parameters and its trigger time.",
  premise:
    "Mutations are injected into a run's sandbox at a bound trigger time. They are never exposed as agent tools — an arm only ever observes their consequences, and both arms receive the identical schedule.",
  emptyState: "No mutation block yet. Create one to define a fault a scenario can inject.",
  createLabel: "New mutation block",
  typeHeading: "Effect",
  unavailable: "The mutation-block library is unavailable.",
  namePlaceholder: "tool-timeout",
};

function BlockLibrary({
  copy,
  list,
  create,
}: {
  copy: LibraryCopy;
  list: (signal?: AbortSignal) => Promise<{ blocks: BlockSummarySchema[] }>;
  create: (command: { name: string }) => Promise<unknown>;
}) {
  const [blocks, setBlocks] = useState<BlockSummarySchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      setBlocks((await list(signal)).blocks);
      setLoadError(null);
    },
    [list],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(describeApiError(cause, copy.unavailable));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [reload, copy.unavailable]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      await create({ name: toSlug(name) });
      setName("");
    } catch (cause: unknown) {
      setFormError(describeApiError(cause, "The block could not be created."));
      setCreating(false);
      return;
    }
    try {
      await reload();
    } catch (cause: unknown) {
      setLoadError(describeApiError(cause, copy.unavailable));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageHeader
        title={copy.title}
        chips={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft">
            <span aria-hidden>⇄</span> Shared across shops
          </span>
        }
        actions={<TourLaunch id={copy.tour} />}
        description={copy.description}
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <p className="mb-4 max-w-3xl text-[13px] text-admin-ink-soft">{copy.premise}</p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* The index has no name of its own, so it carries the tour's anchor (ADR 0045). */}
        <section data-tour="block-index" className={`${surfaceClasses} overflow-hidden`}>
          {loading ? (
            <p className="p-4 text-[13px] text-admin-muted">Loading blocks…</p>
          ) : blocks.length === 0 ? (
            <p className="p-4 text-[13px] text-admin-muted">{copy.emptyState}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={tableHeadClasses}>Name</th>
                    <th className={tableHeadClasses}>{copy.typeHeading}</th>
                    <th className={tableHeadClasses}>Parameters</th>
                    <th className={tableHeadClasses}>Version</th>
                    <th className={tableHeadClasses}>Draft updated</th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((block) => (
                    <tr key={block.block_id}>
                      <td className={tableCellClasses}>
                        <Link
                          className="font-mono font-semibold text-lab-ink underline-offset-2 hover:underline"
                          to={block.block_id}
                        >
                          {block.name}
                        </Link>
                        <div className="text-admin-muted">
                          {block.statement || "No statement yet"}
                        </div>
                      </td>
                      <td className={`${tableCellClasses} whitespace-nowrap`}>
                        {block.type_label}
                      </td>
                      <td className={tableCellClasses}>
                        {block.parameter_count === 0 ? (
                          <span className="text-admin-muted">—</span>
                        ) : (
                          <>
                            {block.parameter_count}
                            {block.shop_bound_parameter_count > 0 ? (
                              <div className="text-admin-muted">
                                {block.shop_bound_parameter_count} bound same-shop
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className={tableCellClasses}>
                        {block.latest_published_version === null
                          ? "Draft"
                          : `v${block.latest_published_version} · ${block.published_version_count} version(s)`}
                      </td>
                      <td className={tableCellClasses}>{formatTimestamp(block.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Card title={copy.createLabel}>
          <form className="grid gap-3" onSubmit={submit}>
            <FieldHint
              label="Name"
              hint="Saved as a lowercase slug. A scenario binds this template to its own shop's objects."
              extra={name && toSlug(name) !== name ? savedAsPreview(toSlug(name)) : undefined}
            >
              <input
                className={fieldControlClasses}
                value={name}
                required
                placeholder={copy.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldHint>
            {formError ? (
              <p role="alert" className="text-[13px] text-lab-error">
                {formError}
              </p>
            ) : null}
            <button className={accentButtonClasses} type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create block"}
            </button>
            <p className="text-xs text-admin-muted">
              A new block declares nothing. Its parameters and what it asserts are authored in the
              editor, then published together — and a published scenario pins the exact template
              version it composed.
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}

export function ObjectiveBlocksPage() {
  return (
    <BlockLibrary
      copy={OBJECTIVE_COPY}
      list={objectiveBlocks.list}
      create={objectiveBlocks.create}
    />
  );
}

export function MutationBlocksPage() {
  return (
    <BlockLibrary copy={MUTATION_COPY} list={mutationBlocks.list} create={mutationBlocks.create} />
  );
}
