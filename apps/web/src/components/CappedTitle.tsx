import { capCount } from "../lib/fieldRules";

/**
 * A card title that reads how far into the lab's cap its collection is — "3 of 24".
 *
 * The count is the collection as the page holds it, so it moves with every add and removal
 * rather than with a save. It sits in the title, where it is read before the list it counts;
 * the card keeps its bare title as its accessible name (`Card`'s `label`), and whatever is
 * refused at the cap names its own line.
 */
export function CappedTitle({ title, count, max }: { title: string; count: number; max: number }) {
  return (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span>{title}</span>{" "}
      <span className="text-[13px] font-semibold tracking-normal text-admin-muted">
        {capCount(count, max)}
      </span>
    </span>
  );
}
