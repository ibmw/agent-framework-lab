import type { BlockParameterKind } from "@agent-lab/contracts";
import { type FormEvent, useState } from "react";
import { PARAMETER_KINDS, toIdentifier, uniqueParameterName } from "../lib/blocks";
import { savedAsPreview } from "../lib/fieldPreviews";
import { fieldControlClasses, fieldLabelClasses, inkButtonClasses } from "../lib/ui";
import { ButtonIcon } from "./ButtonIcon";
import { FieldHint } from "./FieldHint";

/**
 * The control that adds a typed parameter to a block template.
 *
 * It lived inside `BlockEditorPage` until the block libraries' create pages wanted it too
 * (PLAN-UX Slice 13): a template's parameters are what a scenario binds, so they are part of
 * what constrains the work that follows and they are asked for on the way in. Two consumers
 * is what moved it here; nothing about it changed.
 *
 * The label is typed and the identifier is derived — *identifiers are derived, never asked
 * first* — with the saved spelling previewed under the field, and a name another parameter
 * already answers to is suffixed rather than refused.
 */
export function ParameterForm({
  taken,
  onAdd,
  disabled,
}: {
  taken: readonly string[];
  onAdd: (name: string, kind: BlockParameterKind) => void;
  disabled: boolean;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<BlockParameterKind>("document_reference");
  const identifier = uniqueParameterName(toIdentifier(label), taken);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAdd(label, kind);
    setLabel("");
  }

  return (
    <form className="flex flex-wrap items-end gap-2" aria-label="Add a parameter" onSubmit={submit}>
      <div className="min-w-40 flex-1">
        <FieldHint
          label="Label"
          hint="The name a scenario binds. Saved as a snake_case identifier."
          extra={label ? savedAsPreview(identifier) : undefined}
        >
          <input
            className={fieldControlClasses}
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
          className={fieldControlClasses}
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
      <button className={inkButtonClasses} type="submit" disabled={disabled}>
        <ButtonIcon verb="create" />
        Add parameter
      </button>
    </form>
  );
}
