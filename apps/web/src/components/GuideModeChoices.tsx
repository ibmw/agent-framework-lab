import type { ReactNode } from "react";
import { type GuideModeChoice, useGuideModeChoice } from "../lib/guide";

/**
 * Guide mode, offered as three choices: the derived default and the two ways of disagreeing
 * with it.
 *
 * The default is read from the record — on while the lab holds no completed comparison, off
 * once it holds one — so "follow the lab" stores nothing at all, and only a disagreement is
 * remembered (ADR 0044). What the mode decides is whether each surface with a tour offers its
 * *Show me around* control; an operator who turns the guide off turns them off everywhere at
 * once, which is what keeps the guide one thing rather than one per screen (ADR 0045).
 *
 * There is one of these, on `/settings`, so the preference has a single home and cannot be
 * shown with two different vocabularies.
 */

const CHOICES: { value: GuideModeChoice; label: string; description: string }[] = [
  {
    value: "follow",
    label: "Follow the lab",
    description:
      "On until this lab holds a completed comparison, off afterwards. Nothing is stored.",
  },
  {
    value: "on",
    label: "Always on",
    description: "Keep the tours after the first comparison.",
  },
  {
    value: "off",
    label: "Always off",
    description: "Offer no tour on any surface, including in an empty lab.",
  },
];

export function GuideModeChoices({
  idPrefix,
  /** What the preference is, inside the group it describes rather than beside it. */
  description,
}: {
  idPrefix: string;
  description?: ReactNode;
}) {
  const [choice, chooseMode] = useGuideModeChoice();
  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-semibold text-admin-muted">Guide mode</legend>
      {description ? (
        <p className="text-[13px] leading-relaxed text-admin-ink-soft">{description}</p>
      ) : null}
      {CHOICES.map((option) => (
        <label
          key={option.value}
          htmlFor={`${idPrefix}-${option.value}`}
          className="flex items-start gap-2 text-[13px] text-admin-ink-soft"
        >
          <input
            id={`${idPrefix}-${option.value}`}
            type="radio"
            className="mt-0.5"
            name={`${idPrefix}-guide-mode`}
            value={option.value}
            checked={choice === option.value}
            onChange={() => chooseMode(option.value)}
          />
          <span>
            <span className="font-semibold text-admin-ink">{option.label}</span>
            <span className="block text-xs text-admin-muted">{option.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
