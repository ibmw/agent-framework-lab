import { useId } from "react";
import { LABEL_MAX_LENGTH, PROVEN_MODEL_RULE, unexercisedModelRule } from "../lib/fieldRules";
import { fieldControlClasses } from "../lib/ui";
import { type Arrangement, FieldHint } from "./FieldHint";

/**
 * The Model field, wherever the lab has proven a set of them.
 *
 * `CountryField`'s shape rather than a select, and for the same reason: the publish gate
 * raises an unlisted model as a *warning* — the lab does not publish a framework for every
 * model of a provider it supports — so a dropdown would refuse in the browser what the API
 * would take. The proven set is offered as a `<datalist>`, and a model outside it stands.
 *
 * What it does not do is let the author find out one save later. The gate's own sentence is
 * written beneath the field as it is typed, at the gate's own severity — `FieldHint`'s
 * `warning` tone, which is the ink `IssueList` gives the word "Warning" — on the `extra` slot
 * and the paired-line convention: where a rule names a set the form knows, the form says where
 * the current value sits in it.
 *
 * `proven` is what the gate names as the thing the set belongs to: a framework's label in the
 * agent editor, a provider's in the judge editor. It is the subject of the gate's sentence,
 * so it is passed rather than guessed.
 *
 * `arrangement` is `FieldHint`'s: the field labels itself, so a card whose other fields are rows
 * asks it to draw itself as one rather than wrapping it in a row that would name it twice.
 */
export function ProvenModelField({
  value,
  models,
  proven,
  arrangement,
  onChange,
}: {
  value: string;
  /** The models the lab has proven, in the order the catalog publishes them. */
  models: string[];
  /** The framework or provider the proven set belongs to, as the gate names it. */
  proven: string;
  arrangement?: Arrangement;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  // An empty field is a draft mid-edit, not an unexercised model: the gate has nothing to
  // say about it and neither does this line.
  const offList = value !== "" && models.length > 0 && !models.includes(value);
  return (
    // A fragment, not a box: drawn as a row, the field is a child of `FieldRows`, whose first
    // row drops its rule only when the row itself is that first child. The list is not drawn.
    <>
      <FieldHint
        label="Model"
        hint={PROVEN_MODEL_RULE}
        extra={offList ? unexercisedModelRule(value, proven, models) : null}
        extraTone="warning"
        arrangement={arrangement}
      >
        <input
          maxLength={LABEL_MAX_LENGTH}
          className={`${fieldControlClasses} w-full`}
          list={listId}
          value={value}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </FieldHint>
      <datalist id={listId}>
        {models.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
    </>
  );
}
