import { cloneElement, type ReactElement, type ReactNode, useId } from "react";
import {
  fieldLabelClasses,
  fieldRowClasses,
  fieldRowControlClasses,
  fieldRowHintClasses,
  fieldRowLabelClasses,
  fieldRowLabelTextClasses,
  fieldRowWideControlClasses,
} from "../lib/ui";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/**
 * The second line's three treatments.
 *
 * `admin-draft-ink` is the colour `IssueList` gives the *word* "Warning" beside a gate
 * finding (it paints the message itself `admin-ink-soft`, and `PublishReasons` summarises
 * warnings in `admin-muted`). It is borrowed here as the workspace's warning ink, not as a
 * copy of any one of those three renderings.
 *
 * `finding` is a publish-gate **error** on a draft that still saves — `GateFindingLine`'s line,
 * drawn as a row's second line: the refusal's ink and weight, announced politely rather than as
 * an alert, and marking nothing invalid on the control's behalf, because nothing was refused.
 * The control says `aria-invalid` itself, as the judge's rubric does.
 */
const EXTRA_TONES = {
  muted: "text-admin-muted",
  warning: "text-admin-draft-ink",
  error: "text-lab-error",
  finding: "text-lab-error",
} as const;

type ExtraTone = keyof typeof EXTRA_TONES;

/** A refusal and a gate error read at the validation weight (ADR 0063); the rest stay normal. */
function atValidationWeight(tone: ExtraTone): boolean {
  return tone === "error" || tone === "finding";
}

/**
 * Label, hint and second line are one contract with two arrangements.
 *
 * `FieldHint` stacks them; `Field` below puts the label and the hint in a left column and the
 * control in a right one, which is the row the workspace refresh draws 107 times. What must
 * not fork between the two is *which* ids exist, what ends up in `aria-describedby`, and the
 * fact that the second line stays mounted while it is empty so a later preview can announce —
 * so that lives here and each arrangement only decides where the parts are drawn.
 *
 * `hasHint` is not cosmetic: a row with no rule to state must not point `aria-describedby` at
 * a paragraph that was never rendered. `FieldHint` always has one; a `Field` need not. It is
 * read for truth rather than for `undefined`, because a caller computing a rule conditionally
 * hands back `null` or `false` as readily as nothing at all, and each of those renders the
 * same empty paragraph.
 *
 * `hintDescribes` is false while the control is described by a line that says the hint's own
 * sentence — a refusal whose reason is the field's rule — so the rule is heard once rather than
 * twice in a row; the hint stays drawn.
 */
function useBoundControl(
  children: ReactElement<ControlProps>,
  {
    htmlFor,
    hasHint,
    hintDescribes = true,
    invalid,
    extraId: givenExtraId,
  }: {
    htmlFor?: string;
    hasHint: boolean;
    hintDescribes?: boolean;
    invalid: boolean;
    extraId?: string;
  },
) {
  const generatedId = useId();
  const controlId = htmlFor ?? children.props.id ?? generatedId;
  const hintId = `${generatedId}-hint`;
  const extraId = givenExtraId ?? `${generatedId}-extra`;
  const describedBy = [
    children.props["aria-describedby"],
    hasHint && hintDescribes ? hintId : null,
    extraId,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    controlId,
    hintId,
    extraId,
    // A second line in the error tone is a refusal of what the control holds, so the control
    // says it is invalid too (ADR 0063); a control that already says so keeps its own answer.
    control: cloneElement(children, {
      id: controlId,
      "aria-describedby": describedBy,
      ...(invalid ? { "aria-invalid": true } : {}),
    }),
  };
}

/**
 * The second line, wherever it is drawn: a live preview, a warning at the gate's own severity,
 * or a refusal. It keeps its element while it holds nothing — `sr-only` rather than unmounted
 * — because a polite region that appears at the moment it has something to say is a region no
 * reader is listening to yet.
 *
 * `className` is the arrangement's own typography and nothing more; the tone's ink is this
 * component's, so no caller can give a refusal the colour of a preview.
 */
function ExtraLine({
  id,
  tone,
  className,
  children,
}: {
  id: string;
  tone: ExtraTone;
  className: string;
  children?: ReactNode;
}) {
  return (
    <p
      id={id}
      className={children ? `${className} ${EXTRA_TONES[tone]}` : "sr-only"}
      role={children && tone === "error" ? "alert" : undefined}
      aria-live={tone === "error" ? undefined : "polite"}
    >
      {children ?? null}
    </p>
  );
}

/**
 * One muted line under a control, tied to it by `aria-describedby`.
 *
 * A format rule or a consequence is written here so it is read rather than hovered.
 * `title=` may still feed the browser's native validity message; it is never the only
 * carrier of the rule.
 *
 * Required-field convention (PLAN-UX Slice 1): the minority is marked. Create forms
 * have no optional fields, so they do not pass `optional`. The product editor already
 * writes "(optional)" on price and is not a create form — this flag is the primitive's
 * encoding of that convention for later consumers, not a conversion of that editor.
 *
 * **Stacked by default, a row where a caller asks.** The stacked arrangement is the one for a
 * field that is not a row of a form: the inline add-a-chip control inside `ChipListField`, and
 * every surface the field pattern has not reached. `arrangement="row"` hands the same props to
 * `Field`, and exists for one case — a self-labelling field such as `LocaleField` sitting in a
 * card whose other rows are on the pattern. Wrapping one of those in a `Field` would give one
 * control two names; leaving it stacked puts two label typographies in one card. Asking it to
 * draw itself as a row is the third answer, and the default keeps every other caller as it was.
 */
export function FieldHint({
  arrangement = "stacked",
  labelHidden,
  labelId,
  ...props
}: FieldHintProps) {
  return arrangement === "row" ? (
    <Field {...props} />
  ) : (
    <StackedFieldHint labelHidden={labelHidden} labelId={labelId} {...props} />
  );
}

type FieldHintProps = {
  label: string;
  /**
   * The field's rule. Every field that has one states it; a field whose only line is a
   * refusal it can be in — the fulfilment window's maximum, which no rule of its own
   * constrains until the minimum passes it — draws no hint, exactly as a hint-less `Field`
   * row does, and its description holds the second line alone.
   */
  hint?: ReactNode;
  /** A second description line (for example a live "Saved as" preview), also tied by aria-describedby. */
  extra?: ReactNode;
  /**
   * Collision copy uses the create-error treatment; a preview stays muted.
   *
   * `warning` is the publish gate's third severity, in `admin-draft-ink` — the ink
   * `IssueList` uses for the word "Warning" on a gate finding. A field that echoes a gate
   * finding must not claim a severity the gate did not give it: an unexercised model is
   * a warning there, so it is a warning here, and it is announced politely rather than
   * as an alert because nothing has been refused.
   *
   * `finding` is the gate's **error** on a draft that still saves — the judge's rubric — at
   * the refusal's ink and weight, announced politely and marking nothing invalid on the
   * control's behalf (see `EXTRA_TONES`).
   */
  extraTone?: ExtraTone;
  /**
   * The second line's `id`, where something else must name it too — a row's Save refused for
   * the very reason the line gives, which is one sentence rather than two (ADR 0063).
   */
  extraId?: string;
  optional?: boolean;
  /**
   * False while a line the control is described by says the hint's own sentence, so the hint
   * is drawn and not read a second time (`useBoundControl`).
   */
  hintDescribes?: boolean;
  /** `"row"` draws this field as a `Field`. See `FieldHint` for the one case it is for. */
  arrangement?: Arrangement;
  /**
   * Stacked only: the label names the control for a reader and is not drawn, because a legend
   * right above already labels it on screen — `ChipListField`'s, where "Values" over "New
   * value" was two labels for one control. A row always draws its label.
   */
  labelHidden?: boolean;
  /**
   * Stacked only: the label's `id`, for a control named by more than its label — the chip
   * list's input, named "Values New value" by its legend and this label together, so the name
   * starts with the words drawn over it (WCAG 2.5.3).
   */
  labelId?: string;
  children: ReactElement<ControlProps>;
};

/** Which of the two arrangements a self-labelling field draws itself in. */
export type Arrangement = "stacked" | "row";

function StackedFieldHint({
  label,
  hint,
  extra,
  extraTone = "muted",
  extraId: givenExtraId,
  optional = false,
  hintDescribes,
  labelHidden = false,
  labelId,
  children,
}: Omit<FieldHintProps, "arrangement">) {
  const { controlId, hintId, extraId, control } = useBoundControl(children, {
    hasHint: Boolean(hint),
    hintDescribes,
    invalid: extraTone === "error" && Boolean(extra),
    extraId: givenExtraId,
  });

  return (
    <div className={fieldLabelClasses}>
      <label id={labelId} htmlFor={controlId} className={labelHidden ? "sr-only" : undefined}>
        {label}
        {optional ? " (optional)" : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="font-normal text-admin-muted">
          {hint}
        </p>
      ) : null}
      {/* A refusal reads at the validation weight in either arrangement (ADR 0063); a preview
          keeps the stacked label's small type. */}
      <ExtraLine
        id={extraId}
        tone={extraTone}
        className={atValidationWeight(extraTone) ? "text-[13px] font-semibold" : "font-normal"}
      >
        {extra}
      </ExtraLine>
    </div>
  );
}

/**
 * A form row: label and hint in one left column, the control in the right, both top-aligned,
 * stacking when the row is narrower than the two columns need.
 *
 * This is the workspace refresh's single form shape (`tmp/design-frames/README.md`, *The form
 * pattern*), and the geometry is in `lib/ui.ts` beside the other class sets rather than here.
 *
 * **It is not a second `FieldHint`.** It is the other arrangement of the same contract: the
 * ids, the `aria-describedby` wiring, the `(optional)` marker and the tones all come from the
 * helpers above, so there is exactly one place in the workspace that decides what a field's
 * accessible description contains. Where they differ is where the parts sit — the hint moves
 * from under the control to under the label, and the second line stays under the control,
 * which is where the handoff puts a validation message and where `form-decisions.md` 1.5 puts
 * "any refusal".
 *
 * `hint` is optional here, as it is on `FieldHint`. The refresh gives every one of its rows
 * a rule and this component does not encourage a row without one; but the four editors this
 * slice adopts it on hold rows whose rule has not been written yet, and a row is better in the
 * pattern with no hint than outside it with none either.
 *
 * `htmlFor` is for a caller whose control already owns its `id`. Left out, the row generates
 * one and binds it, exactly as `FieldHint` does. A control that is *not* one element — a chip
 * group, a set of checkboxes, a custom widget — is not this component: it is `FieldGroup`,
 * because there is nothing for `for` to point at.
 */
export function Field({
  label,
  hint,
  htmlFor,
  extra,
  extraTone = "muted",
  extraId: givenExtraId,
  optional = false,
  hintDescribes,
  wide = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** The control's own `id`, where it has one. Omitted, the row makes one and binds it. */
  htmlFor?: string;
  extra?: ReactNode;
  extraTone?: ExtraTone;
  /** As on `FieldHint`: the second line's `id`, where something else names it too. */
  extraId?: string;
  optional?: boolean;
  /** As on `FieldHint`. */
  hintDescribes?: boolean;
  /**
   * The control takes the row's whole width, under its label (`fieldRowWideControlClasses`):
   * the same row, label and wiring, for a control a card is built around.
   */
  wide?: boolean;
  children: ReactElement<ControlProps>;
}) {
  const { controlId, hintId, extraId, control } = useBoundControl(children, {
    htmlFor,
    hasHint: Boolean(hint),
    hintDescribes,
    invalid: extraTone === "error" && Boolean(extra),
    extraId: givenExtraId,
  });

  return (
    <div className={fieldRowClasses}>
      <div className={fieldRowLabelClasses}>
        <label className={`${fieldRowLabelTextClasses} cursor-pointer`} htmlFor={controlId}>
          {label}
          {optional ? " (optional)" : null}
        </label>
        {hint ? (
          <p id={hintId} className={fieldRowHintClasses}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className={wide ? fieldRowWideControlClasses : fieldRowControlClasses}>
        {control}
        {/* 7px and 13px are the prototype's own second line under a control; the weight is the
            handoff's, which sets a validation message at 600 and leaves a preview at normal. */}
        <ExtraLine
          id={extraId}
          tone={extraTone}
          className={`mt-[7px] text-[13px] ${atValidationWeight(extraTone) ? "font-semibold" : "font-normal"}`}
        >
          {extra}
        </ExtraLine>
      </div>
    </div>
  );
}

/**
 * The same row, where the control is not a control: a set of checkboxes, a chip group, a
 * custom widget. 44 of the refresh's 107 rows are this.
 *
 * A `<fieldset>` named by `aria-labelledby`, where `FieldGroupHint` below uses a `<legend>`.
 * The difference is forced by the layout and is not a preference: a `<legend>` must be the
 * first child of its `<fieldset>`, so it cannot sit inside the left column beside the hint
 * while the controls sit in the right one. The element, the `group` role and the accessible
 * name come out the same either way, so nothing a reader hears depends on which a row uses.
 *
 * The one thing it must never be is a `<label htmlFor>` with nothing to point at — the
 * handoff says so in as many words, and the prototype itself does not obey it: its group rows
 * emit a bare `<label>` with no `for`, and the document contains no `role="group"` at all,
 * which names the group to a pointer and to nobody else.
 */
export function FieldGroup({
  label,
  hint,
  extra,
  extraTone = "muted",
  children,
}: {
  label: string;
  hint?: ReactNode;
  extra?: ReactNode;
  extraTone?: ExtraTone;
  children: ReactNode;
}) {
  const generatedId = useId();
  const labelId = `${generatedId}-label`;
  const hintId = `${generatedId}-hint`;
  const extraId = `${generatedId}-extra`;
  const describedBy = [hint ? hintId : null, extraId].filter(Boolean).join(" ");

  return (
    // `min-w-0` because a `<fieldset>` is `min-inline-size: min-content` by default, which
    // would keep the row from ever wrapping around a wide group.
    <fieldset
      className={`${fieldRowClasses} min-w-0`}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
    >
      <div className={fieldRowLabelClasses}>
        <span id={labelId} className={fieldRowLabelTextClasses}>
          {label}
        </span>
        {hint ? (
          <p id={hintId} className={fieldRowHintClasses}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className={fieldRowControlClasses}>
        {children}
        <ExtraLine
          id={extraId}
          tone={extraTone}
          className={`mt-[7px] text-[13px] ${atValidationWeight(extraTone) ? "font-semibold" : "font-normal"}`}
        >
          {extra}
        </ExtraLine>
      </div>
    </fieldset>
  );
}

/**
 * Consecutive rows, adjacent.
 *
 * A row carries its own `22px` padding and its own rule, so the gap of whatever holds it —
 * `Card` lays its children out on a `grid gap-3` — must not also apply between them or the
 * rows drift apart by a gap the handoff does not draw. Wrapping the run makes it one child of
 * that grid; inside it the rows sit against each other, which is the whole of the pattern's
 * vertical rhythm.
 *
 * The first row's own rule is dropped, because `Card` has already drawn one under its heading
 * and the two would read as a doubled line 16px apart. The handoff's `border-top` on every row
 * stays the row's geometry; what this suppresses is a repeat of a rule the card drew, which is
 * the one thing the prototype's run of rows never shows.
 *
 * It renders nothing but the box. It exists so that a page says what it means by the wrapper,
 * and so that whoever changes the rhythm changes it in one place.
 */
export function FieldRows({ children }: { children: ReactNode }) {
  return <div className="[&>:first-child]:border-t-0">{children}</div>;
}

/**
 * The same muted line, under a group of controls rather than under one.
 *
 * A checkbox group's rule belongs to the set and not to any one box — "the first is the
 * default" is nonsense written under `EUR` alone — so it is tied to the group. `FieldHint`
 * cannot carry it: its `<label htmlFor>` names a form control, and a `<fieldset>` is not one.
 * The group is named by its `<legend>`, the way the shop-detail groups already are, and
 * described by `aria-describedby` on the fieldset, so a reader arriving at the first checkbox
 * hears the rule once for the group instead of once per box or not at all.
 *
 * `extra` is `FieldHint`'s second line, for the same job it does there: where the hint names
 * something the group derives — "the first is the default" — this is where the group says
 * which one that currently is, the way `DerivedIdField` previews the id it will save.
 *
 * Stacked by default and paired with `FieldHint`, including its `arrangement`: a page building
 * its own group on the field pattern reaches for `FieldGroup`, and a *self-labelling* group
 * such as `CurrencyField` asks for the row here instead, for the reason `FieldHint` gives.
 */
export function FieldGroupHint({ arrangement = "stacked", ...props }: FieldGroupHintProps) {
  return arrangement === "row" ? (
    <FieldGroup label={props.legend} hint={props.hint} extra={props.extra}>
      {props.children}
    </FieldGroup>
  ) : (
    <StackedFieldGroupHint {...props} />
  );
}

type FieldGroupHintProps = {
  legend: string;
  /** The set's rule. A group with none to state — the bench's arms — draws no hint. */
  hint?: ReactNode;
  /** A live second description line: what the hint's rule currently resolves to. */
  extra?: ReactNode;
  /** `"row"` draws this group as a `FieldGroup`. See `FieldHint` for the one case it is for. */
  arrangement?: Arrangement;
  children: ReactNode;
};

function StackedFieldGroupHint({
  legend,
  hint,
  extra,
  children,
}: Omit<FieldGroupHintProps, "arrangement">) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  const extraId = `${generatedId}-extra`;
  const describedBy = [hint ? hintId : null, extraId].filter(Boolean).join(" ");
  return (
    <fieldset className={fieldLabelClasses} aria-describedby={describedBy}>
      <legend className="text-xs font-semibold text-admin-muted">{legend}</legend>
      {children}
      {hint ? (
        <p id={hintId} className="font-normal text-admin-muted">
          {hint}
        </p>
      ) : null}
      <ExtraLine id={extraId} tone="muted" className="font-normal">
        {extra}
      </ExtraLine>
    </fieldset>
  );
}
