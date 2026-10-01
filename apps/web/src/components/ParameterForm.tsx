import type { BlockParameterKind } from "@agent-lab/contracts";
import { type FormEvent, useId, useState } from "react";
import { PARAMETER_KINDS, PARAMETERS_FULL, toIdentifier, uniqueParameterName } from "../lib/blocks";
import { savedAsPreview } from "../lib/fieldPreviews";
import { addFormClasses, fieldControlClasses, fieldLabelClasses } from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { FieldHint } from "./FieldHint";
import { PrimaryAction, RefusalLine } from "./PrimaryAction";

/**
 * The control that adds a typed parameter to a block template on the block libraries' create
 * pages (PLAN-UX Slice 13): a template's parameters are what a scenario binds, so they are part
 * of what constrains the work that follows and they are asked for on the way in. The editor
 * adds and edits its parameters in the one form below its list instead (ADR 0074).
 *
 * The label is typed and the identifier is derived — *identifiers are derived, never asked
 * first* — with the saved spelling previewed under the field, and a name another parameter
 * already answers to is suffixed rather than refused.
 *
 * At the contract's cap it refuses with the cap, rather than going quiet (ADR 0063).
 */
export function ParameterForm({
  taken,
  onAdd,
  full,
}: {
  taken: readonly string[];
  onAdd: (name: string, kind: BlockParameterKind) => void;
  /** The template already carries the contract's cap. */
  full: boolean;
}) {
  const reasonId = useId();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<BlockParameterKind>("document_reference");
  const identifier = uniqueParameterName(toIdentifier(label), taken);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (full) {
      return;
    }
    onAdd(label, kind);
    setLabel("");
  }

  return (
    <form className={addFormClasses} aria-label="Add a parameter" onSubmit={submit}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <FieldHint
            label="Label"
            hint="The name a scenario binds. Saved as a snake_case identifier."
            extra={label ? savedAsPreview(identifier) : undefined}
          >
            <input
              className={`${fieldControlClasses} w-full`}
              value={label}
              required
              placeholder="Document"
              onChange={(event) => setLabel(event.target.value)}
            />
          </FieldHint>
        </div>
        <label className={`${fieldLabelClasses} min-w-56 flex-1`}>
          Kind
          {/* Named explicitly: a wrapping label around a select carries every option's text in
            its own text content, so the control needs its own name to be addressable. */}
          <select
            aria-label="Kind"
            className={`${fieldControlClasses} w-full`}
            value={kind}
            onChange={(event) => setKind(event.target.value as BlockParameterKind)}
          >
            {PARAMETER_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <PrimaryAction
          variant="ink"
          type="submit"
          refusal={full ? { id: reasonId, reason: PARAMETERS_FULL } : null}
        >
          <ButtonIcon verb="create" />
          Add parameter
        </PrimaryAction>
      </div>
      {full ? <RefusalLine id={reasonId}>{PARAMETERS_FULL}</RefusalLine> : null}
    </form>
  );
}
