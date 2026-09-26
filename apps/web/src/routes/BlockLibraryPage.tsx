import type {
  BlockParameterSchema,
  BlockSummarySchema,
  MutationEffect,
  ObjectiveAssessment,
  ObjectiveEvidence,
} from "@agent-lab/contracts";
import { type ReactNode, useId, useState } from "react";
import { Link } from "react-router-dom";
import { mutationBlocks, objectiveBlocks } from "../api/blocks";
import { ButtonIcon } from "../components/ButtonIcon";
import { CreatePage } from "../components/CreatePage";
import { Field, FieldRows } from "../components/FieldHint";
import { ParameterForm } from "../components/ParameterForm";
import { SearchField, SearchRow } from "../components/SearchField";
import { Card, PageHeader } from "../components/WorkspaceChrome";
import {
  ASSESSMENTS,
  addedParameter,
  type BlockPayload,
  bindsShopObject,
  DETERMINISTIC_EVIDENCE,
  EFFECTS,
  evidenceFor,
  MAX_PARAMETERS,
  toSlug,
  withoutParameter,
} from "../lib/blocks";
import { useCreateThenComplete } from "../lib/createDefinition";
import { savedAsPreview } from "../lib/fieldPreviews";
import { searchRows } from "../lib/filters";
import {
  accentButtonClasses,
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  formatTimestamp,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
} from "../lib/ui";
import type { Listing } from "../shell/listings";
import { useLabWorkspace } from "../shell/useLabWorkspace";

interface LibraryCopy {
  title: string;
  description: string;
  /** What the library is, shown above the index the way frames 4a and 4b state it. */
  premise: string;
  emptyState: string;
  /** What the card says when the library holds blocks but the search left none of them. */
  noMatch: string;
  createLabel: string;
  typeHeading: string;
  namePlaceholder: string;
  /** What the create page's breadcrumb says it is doing. */
  breadcrumb: string;
  /** What its heading reads before a name has been typed. */
  untitled: string;
  /** Where the editor of what was made lives. */
  editorBase: string;
  /** What the unsaved-work register calls a template created before its axis was saved. */
  owes: (name: string) => string;
}

const OBJECTIVE_COPY: LibraryCopy = {
  title: "Objective blocks",
  description:
    "What an experiment asserts, authored once and composed by any scenario. A scenario binds a template's parameters to its own shop's objects.",
  premise:
    "Blocks are shop-independent templates with typed parameters. A scenario binds those parameters to its own shop's objects — a binding can never point outside the scenario's shop.",
  emptyState: "No objective block yet. Create one to define what a scenario can assert.",
  noMatch: "No objective block matches this view.",
  createLabel: "New objective block",
  typeHeading: "Assessment · evidence",
  namePlaceholder: "read-required-document",
  breadcrumb: "creating an objective block",
  untitled: "New objective block",
  editorBase: "/lab/objective-blocks",
  owes: (name) => `Objective block ${name} was created without the template authored for it.`,
};

const MUTATION_COPY: LibraryCopy = {
  title: "Mutation blocks",
  description:
    "What the scenario runtime injects into a run's sandbox. A scenario binds a template's parameters and its trigger time.",
  premise:
    "Mutations are injected into a run's sandbox at a bound trigger time. They are never exposed as agent tools — an arm only ever observes their consequences, and both arms receive the identical schedule.",
  emptyState: "No mutation block yet. Create one to define a fault a scenario can inject.",
  noMatch: "No mutation block matches this view.",
  createLabel: "New mutation block",
  typeHeading: "Effect",
  namePlaceholder: "tool-timeout",
  breadcrumb: "creating a mutation block",
  untitled: "New mutation block",
  editorBase: "/lab/mutation-blocks",
  owes: (name) => `Mutation block ${name} was created without the template authored for it.`,
};

function BlockLibrary({
  copy,
  listing,
}: {
  copy: LibraryCopy;
  /**
   * The library this page renders, read once by the lab's shell so that the rail's figure
   * and this table are one answer (ADR 0056). The create page reads it again.
   */
  listing: Listing<BlockSummarySchema>;
}) {
  const blocks = listing.rows;
  const loading = listing.loading;
  const loadError = listing.error;
  const [query, setQuery] = useState("");

  // The name alone, which is what the prototype's two library searches read (`x.name` in its
  // `shownObBlocks` and `shownMutBlocks` filters). This library draws no filter chips — UI-4
  // records why — so there is no count for the search to move, and `searchRows` is the same
  // narrowing `filterList` applies under the chips on the eight indexes that have them.
  const visible = searchRows(blocks, { query, fields: (block) => [block.name] });

  return (
    <>
      <PageHeader
        title={copy.title}
        chips={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2.5 py-0.5 text-[11.5px] font-semibold text-admin-ink-soft">
            <span aria-hidden>⇄</span> Shared across shops
          </span>
        }
        description={copy.description}
        actions={
          // `aria-label` says what the text already says, because the library's tour lights
          // this control by its accessible name (`lib/tours.ts`) and a selector needs the
          // attribute. The name does not move: it is the word the side card carried.
          <Link className={accentButtonClasses} to="new" aria-label={copy.createLabel}>
            {copy.createLabel}
          </Link>
        }
      />

      {loadError ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {loadError}
        </p>
      ) : null}

      <p className="mb-4 max-w-3xl text-[13px] text-admin-ink-soft">{copy.premise}</p>

      {/* The index has no name of its own, so it carries the tour's anchor (ADR 0045). */}
      <section data-tour="block-index" className={`${surfaceClasses} overflow-hidden`}>
        {/* Only once there is a library to search: a box that can only narrow nothing is a
            control that does nothing, which is the rule the chip rows on the eight indexes
            with filters already follow. */}
        {loading || loadError ? null : (
          <SearchRow>
            <SearchField label="Search the library" onChange={setQuery} value={query} />
          </SearchRow>
        )}
        {loading ? (
          <p className="p-4 text-[13px] text-admin-muted">Loading blocks…</p>
        ) : blocks.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">{copy.emptyState}</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-[13px] text-admin-muted">{copy.noMatch}</p>
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
                {visible.map((block) => (
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
                    <td className={`${tableCellClasses} whitespace-nowrap`}>{block.type_label}</td>
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
    </>
  );
}

/**
 * `/lab/objective-blocks/new` and `/lab/mutation-blocks/new` — a template, authored on a page
 * (`Workspace.dc.html`:3614 and :3758).
 *
 * The name, the type axis and the parameters, which is what the prototype draws here and
 * what a scenario has to be able to bind. The statement and the description are the
 * editor's: they explain a template to whoever binds it, and the publish gate is where an
 * empty one is refused.
 *
 * **It is one write where the name is all the operator answered**, and two where it is not.
 * `CreateBlockRequest` says so itself — "A block is created with its name only; everything
 * else is decided in the editor" — so a template with a parameter on it is a `POST` followed
 * by a `PUT`, and a template that took the library's own defaults is a `POST` alone.
 * `useCreateThenComplete` decides which by comparing what the form asks for with what the
 * lab made, so a create that needs no second write registers no unsaved work either.
 */
function NewBlockPage<PayloadT extends BlockPayload>({
  copy,
  listing,
  create,
  replaceDraft,
  /** What the type-axis card has decided, spread into the composed payload. */
  axis,
  /** The card that draws it: Assessment for one library, Effect for the other. */
  axisCard,
}: {
  copy: LibraryCopy;
  listing: Listing<BlockSummarySchema>;
  create: (command: { name: string }) => Promise<{ block_id: string; content: PayloadT }>;
  replaceDraft: (blockId: string, payload: PayloadT) => Promise<unknown>;
  axis: Partial<PayloadT>;
  axisCard: ReactNode;
}) {
  const formId = useId();
  const [label, setLabel] = useState("");
  const [parameters, setParameters] = useState<BlockParameterSchema[]>([]);
  const name = toSlug(label, "");
  const taken = listing.rows.map((block) => block.name);

  const creating = useCreateThenComplete<PayloadT>(
    {
      create: async () => {
        const created = await create({ name });
        return { id: created.block_id, draft: created.content };
      },
      compose: (made) => ({ ...made, ...axis, parameters }),
      replace: replaceDraft,
      refresh: listing.refresh,
      editorAt: (id) => `${copy.editorBase}/${id}`,
      owes: () => copy.owes(name),
      standing: "created · its template is not saved yet",
      whenCreateFails: "The block could not be created.",
      whenCompleteFails: "The block was created, but its template could not be saved.",
    },
    // The listing is re-read the moment the template exists, so once it does it holds this
    // page's own block — and counting that against the operator would refuse the retry of
    // the create that made it.
    (made) =>
      listing.loading
        ? "Reading what this library already holds…"
        : label.trim() === ""
          ? "The template needs a name before it can be created."
          : name === ""
            ? "A name is saved as a lowercase slug, and this one leaves none — use letters or digits."
            : made === null && taken.includes(name)
              ? `${name} is the name of a template this library already holds.`
              : undefined,
  );

  return (
    <CreatePage
      backTo={copy.editorBase}
      backLabel={copy.title}
      breadcrumb={copy.breadcrumb}
      title={name}
      untitled={copy.untitled}
      standing={creating.standing}
      formId={formId}
      createLabel="Create block"
      creating={creating.busy}
      creatingLabel="Creating…"
      blockedBy={creating.blockedBy}
      error={creating.error ?? listing.error}
    >
      <form id={formId} className="grid gap-4" onSubmit={creating.submit}>
        <Card title="Template">
          <FieldRows>
            <Field
              label="Name"
              hint={
                creating.made !== null
                  ? "The template answers to this name now. A name is what the create request carried, so the write that follows cannot move one — renaming it means opening its editor."
                  : "Saved as a lowercase slug. A scenario binds this template to its own shop's objects, and the name is how the library and every binding refer to it."
              }
              extra={label && name !== label ? savedAsPreview(name) : undefined}
            >
              <input
                className={`${fieldControlClasses} font-mono`}
                value={label}
                required
                disabled={creating.made !== null}
                placeholder={copy.namePlaceholder}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
          </FieldRows>
          <p className="text-xs text-admin-muted">
            Shop-independent by construction: a block names typed parameters, never a specific
            object. What it asserts, in the words a scenario renders, is written in the editor.
          </p>
        </Card>

        {axisCard}
      </form>

      {/* Outside the create form on purpose: *Add a parameter* is a form of its own, and a
          form inside a form is not a thing the DOM has — the inner submit would reach the
          outer one and press Create. The header's Create still submits the card above by
          `form=`, and this card's answers are read out of the state it holds. */}
      <Card
        title="Parameters"
        footer={
          <p className="text-xs text-admin-muted">
            A parameter marked same-shop can only be bound to an object inside the scenario's own
            shop. Each one's description and default are authored in the editor.
          </p>
        }
      >
        {parameters.length === 0 ? (
          <p className="text-[13px] text-admin-muted">
            No parameters. This block does the same thing in every shop, which is a legitimate
            design for a rule that applies everywhere.
          </p>
        ) : (
          <ul className="grid gap-2">
            {parameters.map((parameter) => (
              <li
                key={parameter.name}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-admin-border bg-admin-canvas/40 p-3"
              >
                <code className="font-mono text-[13px] font-semibold text-lab-ink">
                  {parameter.name}
                </code>
                {bindsShopObject(parameter.kind) ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-border px-2 py-0.5 text-[11px] font-semibold text-admin-ink-soft">
                    <span aria-hidden>⌖</span> bound same-shop
                  </span>
                ) : null}
                <button
                  className={`ml-auto ${destructiveSubtleButtonClasses}`}
                  type="button"
                  aria-label={`Remove ${parameter.name}`}
                  onClick={() =>
                    setParameters((current) => withoutParameter(current, parameter.name))
                  }
                >
                  <ButtonIcon verb="delete" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <ParameterForm
          taken={parameters.map((parameter) => parameter.name)}
          onAdd={(added, kind) => setParameters((current) => addedParameter(current, added, kind))}
          full={parameters.length >= MAX_PARAMETERS}
        />
      </Card>
    </CreatePage>
  );
}

export function ObjectiveBlocksPage() {
  const { listings } = useLabWorkspace();
  return <BlockLibrary copy={OBJECTIVE_COPY} listing={listings.objectiveBlocks} />;
}

export function MutationBlocksPage() {
  const { listings } = useLabWorkspace();
  return <BlockLibrary copy={MUTATION_COPY} listing={listings.mutationBlocks} />;
}

export function NewObjectiveBlockPage() {
  const { listings } = useLabWorkspace();
  // The pairing the domain's own `new_objective_block` starts a draft on — the commonest
  // one and the only one that is always legal — so a create that leaves the axis alone asks
  // for exactly what the lab would have made and sends no second write.
  const [assessment, setAssessment] = useState<ObjectiveAssessment>("deterministic");
  const [evidence, setEvidence] = useState<ObjectiveEvidence>("event");

  return (
    <NewBlockPage
      copy={OBJECTIVE_COPY}
      listing={listings.objectiveBlocks}
      create={objectiveBlocks.create}
      replaceDraft={objectiveBlocks.replaceDraft}
      axis={{ assessment, evidence: evidenceFor(assessment, evidence) }}
      axisCard={
        <Card title="Assessment">
          <FieldRows>
            <Field
              label="Assessed by"
              hint="How the objective is decided. A rule reads the arm's own record; a judge reads an anonymised brief and scores a rubric dimension."
            >
              <select
                className={fieldControlClasses}
                value={assessment}
                onChange={(event) => setAssessment(event.target.value as ObjectiveAssessment)}
              >
                {ASSESSMENTS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            {assessment === "judge" ? null : (
              <Field
                label="Evidence"
                hint="What the objective is decided from. Objective order in a scenario is priority rather than a script, so an objective never says when it applies."
              >
                <select
                  className={fieldControlClasses}
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value as ObjectiveEvidence)}
                >
                  {DETERMINISTIC_EVIDENCE.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </FieldRows>
          {assessment === "judge" ? (
            <p className="text-xs text-admin-muted">
              A judged objective is scored on a rubric dimension, so the evidence follows the
              assessment rather than being chosen. Judge evidence is anonymised, versioned and
              rerunnable, and is recorded apart from deterministic evidence.
            </p>
          ) : null}
        </Card>
      }
    />
  );
}

export function NewMutationBlockPage() {
  const { listings } = useLabWorkspace();
  // What `new_mutation_block` starts a draft on, for the reason above.
  const [effect, setEffect] = useState<MutationEffect>("entity_mutation");

  return (
    <NewBlockPage
      copy={MUTATION_COPY}
      listing={listings.mutationBlocks}
      create={mutationBlocks.create}
      replaceDraft={mutationBlocks.replaceDraft}
      axis={{ effect }}
      axisCard={
        <Card title="Effect">
          <FieldRows>
            <Field
              label="Perturbs"
              hint="What the runtime does to the sandbox. The agent never sees the injection — only its consequences — and both arms receive the identical schedule."
            >
              <select
                className={fieldControlClasses}
                value={effect}
                onChange={(event) => setEffect(event.target.value as MutationEffect)}
              >
                {EFFECTS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
          </FieldRows>
          <p className="text-xs text-admin-muted">
            Mutation order in a scenario is the run timeline, so a published mutation declares
            exactly one timing parameter. Adding it here or in the editor is the same act.
          </p>
        </Card>
      }
    />
  );
}
