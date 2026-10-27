import { type ReactNode, useId } from "react";
import { ItemFormRow } from "../components/ItemList";
import { type RefusedBy, refusalOn } from "../lib/itemForm";
import { useRefusalTouch } from "../lib/refusalTouch";

/**
 * A form below a list whose *Add* is refused by a rule on one field — `field`, or another —
 * drawn as the adopters draw one: `ItemFormRow` watching the form's touch (ADR 0078), and the
 * field component under test handed `refusedBy` for the refusal as it names that field.
 */
export function RefusingForm({
  reason,
  field = "value",
  children,
}: {
  /** What *Add* is refused with, said in the form's line. */
  reason: string;
  /** The field the refusal names; another than the one under test leaves it unnamed. */
  field?: string;
  children: (refusedBy: RefusedBy | undefined) => ReactNode;
}) {
  const touch = useRefusalTouch();
  const reasonId = useId();
  const refusal = { field, reason };
  return (
    <ItemFormRow
      title="Add an entry"
      editing={false}
      addLabel="Add entry"
      refusal={refusal}
      reasonId={reasonId}
      touch={touch}
      onSubmit={() => {}}
      onCancel={() => {}}
    >
      {children(refusalOn(refusal, "value", reasonId, touch.touched))}
    </ItemFormRow>
  );
}
