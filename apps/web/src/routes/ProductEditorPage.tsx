import type {
  AttributeSchema,
  MediaReferenceSchema,
  OptionSchema,
  ProductViewSchema,
  ReviewSchema,
  VariantSchema,
} from "@agent-lab/contracts";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipList, ChipListField } from "../components/ChipListField";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldGroupHint, FieldHint } from "../components/FieldHint";
import {
  Card,
  EditorSaveActions,
  EntryCard,
  EntryEditButtons,
  EntryEditNotice,
  EntryId,
  EntryKind,
  IssueList,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import type { Currency } from "../lib/currencies";
import { entryEdit, useEntryEdit } from "../lib/entryEdit";
import { slugify, uniqueId, uniqueSuggestion, uniqueVariantSku } from "../lib/entryIds";
import {
  ATTRIBUTE_TYPE,
  labelOf,
  optionsOf,
  PRODUCT_STATUS,
  VARIANT_AVAILABILITY,
} from "../lib/enumLabels";
import {
  ATTRIBUTE_CHOICES_RULE,
  alreadyTakenMessage,
  CHIP_LABEL_MAX_LENGTH,
  DERIVED_KEBAB_RULE,
  isVariantSku,
  KEBAB_PATTERN,
  MEDIA_REFERENCE_RULE,
  MONEY_PATTERN,
  MONEY_RULE,
  OPTION_VALUES_RULE,
  REFERENCE_PATTERN,
  REVIEW_RATING_RULE,
  VARIANT_SKU_RENAME_RULE,
  VARIANT_SKU_RULE,
} from "../lib/fieldRules";
import {
  findProduct,
  issuesForProduct,
  ratingLabel,
  replaceProduct,
  variantOptionLabel,
  variantPriceLabel,
} from "../lib/shop";
import {
  accentButtonClasses,
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
  textAreaClasses,
} from "../lib/ui";
import { useShopWorkspace } from "../shell/ShopWorkspace";

const AVAILABILITIES = optionsOf(VARIANT_AVAILABILITY);

const ATTRIBUTE_TYPES = optionsOf(ATTRIBUTE_TYPE);

const PRODUCT_STATUSES = optionsOf(PRODUCT_STATUS);

export function ProductEditorPage() {
  const { handle = "" } = useParams();
  const { content, preview, edit, save, saving, discard, discarding, dirty, error } =
    useShopWorkspace();
  const product = findProduct(content, handle);

  if (!product) {
    return (
      <>
        <PageHeader title="Product not found" />
        <p className="text-[13px] text-admin-muted">
          This draft has no product <code>{handle}</code>.{" "}
          <Link className="font-semibold text-lab-ink" to=".." relative="path">
            Back to products
          </Link>
        </p>
      </>
    );
  }

  function update(next: ProductViewSchema) {
    edit(replaceProduct(content, handle, next));
  }

  return (
    <>
      <PageHeader
        title={product.title}
        chips={<VersionChips preview={preview} />}
        description={`Editing the shop draft · ${ratingLabel(product)}`}
        actions={
          <EditorSaveActions
            tone="accent"
            dirty={dirty}
            saving={saving}
            discarding={discarding}
            onSave={() => void save()}
            onDiscard={() => void discard()}
          />
        }
      />

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <Card title="Details">
            <label className={fieldLabelClasses}>
              Title
              <input
                className={fieldControlClasses}
                value={product.title}
                onChange={(event) => update({ ...product, title: event.target.value })}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldLabelClasses}>
                Status
                <select
                  className={fieldControlClasses}
                  value={product.status}
                  onChange={(event) =>
                    update({
                      ...product,
                      status: event.target.value as ProductViewSchema["status"],
                    })
                  }
                >
                  {PRODUCT_STATUSES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.option}
                    </option>
                  ))}
                </select>
              </label>
              <label className={fieldLabelClasses}>
                Category
                <input
                  className={fieldControlClasses}
                  value={product.category}
                  onChange={(event) => update({ ...product, category: event.target.value })}
                />
              </label>
            </div>
            <label className={fieldLabelClasses}>
              Description
              <textarea
                className={textAreaClasses}
                value={product.description}
                onChange={(event) => update({ ...product, description: event.target.value })}
              />
            </label>
          </Card>

          <OptionsCard product={product} onChange={update} />
          <VariantsCard
            product={product}
            onChange={update}
            currencies={content.identity.currencies}
          />
          <MediaCard product={product} onChange={update} />
          <AttributesCard product={product} onChange={update} />
          <ReviewsCard product={product} onChange={update} />
        </div>

        <div className="grid content-start gap-4">
          <Card title="Product validation">
            <IssueList issues={issuesForProduct(preview?.issues ?? [], product.handle)} />
          </Card>
          <Card title="Freezing">
            <p className="text-[13px] leading-relaxed text-admin-ink-soft">
              These edits belong to the shop draft. Published shop versions are immutable, so
              experiments that pinned an earlier version never see them.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * The authored fields of each of the product's five keyed lists, and the one function per
 * list that turns them into the entry the draft stores.
 *
 * The add form below a list and the open row inside it hold the same field object and hand it
 * to the same builder, so neither can grow a field the other does not write. Where an entry
 * has an identifier of its own — an option key, an attribute key, a review ID — it is the
 * builder's first argument and an edit hands back the one the entry already has. A variant
 * and a media reference have no such field: their key *is* one of their fields, which is why
 * those two are the only ones an open row may move, and why they say so where they are typed.
 */
interface OptionFields {
  name: string;
  values: string[];
}

interface MediaFields {
  reference: string;
  altText: string;
}

interface AttributeFields {
  label: string;
  attributeType: AttributeSchema["attribute_type"];
  value: string;
  unit: string;
  choices: string[];
}

interface ReviewFields {
  author: string;
  rating: number;
  body: string;
}

interface VariantFields {
  sku: string;
  optionValues: Record<string, string>;
}

function optionEntry(key: string, fields: OptionFields): OptionSchema {
  return { key, name: fields.name, values: fields.values };
}

function mediaEntry(fields: MediaFields): MediaReferenceSchema {
  return { reference: fields.reference, alt_text: fields.altText };
}

function attributeEntry(key: string, fields: AttributeFields): AttributeSchema {
  return {
    key,
    label: fields.label,
    attribute_type: fields.attributeType,
    value: fields.value,
    // A unit belongs to a measurement and choices to a choice; anything else the form was
    // holding when the type moved is not part of the entry either path writes.
    unit: fields.attributeType === "measurement" ? fields.unit : null,
    choices: fields.attributeType === "choice" ? fields.choices : [],
  };
}

function attributeFields(entry: AttributeSchema): AttributeFields {
  return {
    label: entry.label,
    attributeType: entry.attribute_type,
    value: entry.value,
    unit: entry.unit ?? "",
    choices: entry.choices,
  };
}

function reviewEntry(id: string, fields: ReviewFields): ReviewSchema {
  return { id, author_display_name: fields.author, rating: fields.rating, body: fields.body };
}

/**
 * The option values a variant carries, built the one way for both paths — and the order the
 * open row renders its selects in, so the form cannot offer a control the builder ignores.
 *
 * `stored` is what the variant holds today and is empty for one being added. It decides the
 * order and comes first, so an edit replaces the value of a key the variant already carries
 * and leaves that order alone: a SKU-only correction cannot silently re-sort a variant
 * authored through the API into this form's order and report "Updated variant" for something
 * nobody touched.
 *
 * An option the variant *predates* is then appended rather than skipped. `validate_shop`
 * raises `variant_missing_option` as an **error**, so a variant that chooses no value for a
 * declared option cannot be published; the only place to answer that is this row, and a row
 * that showed the select but dropped the answer — or hid the select and left the gate
 * unanswerable — would be the defect this plan exists to remove. With `stored` empty this is
 * exactly the add form's old expression, so the two paths are one path.
 */
function variantOptionValues(
  stored: readonly VariantSchema["option_values"][number][],
  options: readonly OptionSchema[],
  chosen: Record<string, string>,
): VariantSchema["option_values"] {
  const carried = stored.map((entry) => ({
    key: entry.key,
    value: chosen[entry.key] ?? entry.value,
  }));
  const declared = new Set(stored.map((entry) => entry.key));
  const gained = options
    .filter((option) => !declared.has(option.key))
    .map((option) => ({ key: option.key, value: chosen[option.key] ?? option.values[0] }));
  return [...carried, ...gained];
}

/**
 * A variant keeps everything the table's own cells edit — price, availability, stock — and
 * takes only the two fields the row could not correct at all until now.
 */
function variantEntry(
  variant: VariantSchema,
  fields: VariantFields,
  options: readonly OptionSchema[],
): VariantSchema {
  return {
    ...variant,
    sku: fields.sku,
    option_values: variantOptionValues(variant.option_values, options, fields.optionValues),
  };
}

function variantFields(variant: VariantSchema): VariantFields {
  return {
    sku: variant.sku,
    optionValues: Object.fromEntries(
      variant.option_values.map((chosen) => [chosen.key, chosen.value]),
    ),
  };
}

interface EditorProps {
  product: ProductViewSchema;
  onChange: (next: ProductViewSchema) => void;
}

interface PricedEditorProps extends EditorProps {
  /** The shop's sellable currencies; the first is the domain default. */
  currencies: Currency[];
}

/** An option's values, as both paths enter them: one chip at a time, duplicates refused. */
function OptionValuesField({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <ChipListField
      legend="Values"
      label="New value"
      hint={OPTION_VALUES_RULE}
      maxLength={CHIP_LABEL_MAX_LENGTH}
      addLabel="Add value"
      placeholder="Ocean Blue"
      empty="No value yet; an option needs at least one."
      values={values}
      takenPlace="a value of this option"
      onChange={onChange}
    />
  );
}

function OptionsCard({ product, onChange }: EditorProps) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const editor = useEntryEdit<OptionFields>(product.options.map((option) => option.key));
  const notice = useId();
  const taken = product.options.map((option) => option.key);
  const { value: suggestedKey, takenBase } = uniqueSuggestion(slugify(name, ""), taken);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key || taken.includes(key) || values.length === 0) {
      return;
    }
    onChange({ ...product, options: [...product.options, optionEntry(key, { name, values })] });
    setKey("");
    setName("");
    setValues([]);
  }

  return (
    <Card title="Options">
      <ul className="grid gap-2 text-[13px]">
        {product.options.map((option) => (
          <EntryCard
            key={option.key}
            title={option.name}
            chips={
              <>
                <EntryId value={option.key} />
                {/* Frame 2c draws an option's values as pills on the saved row, the same pills
                    the add form below — and the open row — enter them as. */}
                <ChipList label={`Values of ${option.name}`} values={option.values} />
              </>
            }
            edit={entryEdit(
              editor,
              notice,
              option.key,
              option.name,
              () => ({ name: option.name, values: option.values }),
              (fields) =>
                onChange({
                  ...product,
                  options: product.options.map((entry) =>
                    entry.key === option.key ? optionEntry(option.key, fields) : entry,
                  ),
                }),
              (value, change) => (
                <>
                  <label className={fieldLabelClasses}>
                    Option name
                    <input
                      className={fieldControlClasses}
                      value={value.name}
                      required
                      onChange={(event) => change({ ...value, name: event.target.value })}
                    />
                  </label>
                  <OptionValuesField
                    values={value.values}
                    onChange={(values) => change({ ...value, values })}
                  />
                </>
              ),
              // An option with no value is one no variant can choose, which is what the add
              // form already refuses.
              (value) => value.values.length > 0,
            )}
            actions={
              <button
                className={destructiveSubtleButtonClasses}
                type="button"
                onClick={() =>
                  onChange({
                    ...product,
                    options: product.options.filter((entry) => entry.key !== option.key),
                  })
                }
              >
                <ButtonIcon verb="delete" />
                Remove {option.name}
              </button>
            }
          />
        ))}
        {product.options.length === 0 ? (
          <li className="text-admin-muted">No options yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <form className="grid gap-2" onSubmit={add}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={fieldLabelClasses}>
            Option name
            <input
              className={fieldControlClasses}
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <DerivedIdField
            label="Option key"
            hint={DERIVED_KEBAB_RULE}
            value={key}
            suggested={suggestedKey}
            taken={taken}
            takenBase={takenBase}
            takenPlace="in the draft"
            pattern={KEBAB_PATTERN}
            title={DERIVED_KEBAB_RULE}
            required
            onChange={setKey}
          />
        </div>
        <OptionValuesField values={values} onChange={setValues} />
        <button className={`${accentButtonClasses} justify-self-start`} type="submit">
          <ButtonIcon verb="create" />
          Add option
        </button>
      </form>
    </Card>
  );
}

function VariantsCard({ product, onChange, currencies }: PricedEditorProps) {
  const defaultCurrency = currencies[0];
  // One description for every row's price box: the rule is the same on all of them, and a
  // reader hears it wherever they land in the table.
  const priceRuleId = useId();
  // The SKU rule is the same on every row for the same reason the price rule is, and it is
  // the one field on this table whose edit is a rename, so it is visible while a row is open
  // rather than only in the description.
  const skuRuleId = useId();
  const editNoticeId = useId();
  const editor = useEntryEdit<VariantFields>(product.variants.map((variant) => variant.sku));
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const chosenValues = product.options.map(
    (option) => optionValues[option.key] ?? option.values[0],
  );
  const takenSkus = product.variants.map((variant) => variant.sku);
  const { value: suggestedSku, takenBase: takenSkuBase } = uniqueVariantSku(
    product.handle,
    chosenValues,
    takenSkus,
  );
  const [sku, setSku] = useState(suggestedSku);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [skuResume, setSkuResume] = useState(0);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sku || takenSkus.includes(sku)) {
      return;
    }
    const variant: VariantSchema = {
      sku,
      option_values: variantOptionValues([], product.options, optionValues),
      availability: "in_stock",
      stock_quantity: 1,
      price: amount ? { amount, currency } : null,
    };
    onChange({ ...product, variants: [...product.variants, variant] });
    setSku("");
    setAmount("");
    setSkuResume((generation) => generation + 1);
  }

  function updateVariant(index: number, next: VariantSchema) {
    onChange({
      ...product,
      variants: product.variants.map((variant, position) => (position === index ? next : variant)),
    });
  }

  /**
   * Written from the row as it stands *now*, not from the one the editor was opened on: the
   * price, availability and stock cells edit the draft while the row is open, and reading a
   * captured copy would put them back where they were.
   */
  function saveVariant(index: number, fields: VariantFields) {
    onChange({
      ...product,
      variants: product.variants.map((variant, position) =>
        position === index ? variantEntry(variant, fields, product.options) : variant,
      ),
    });
  }

  const openSku = editor.open?.fields.sku ?? "";
  const skuCollides =
    editor.open !== null && openSku !== editor.open.id && takenSkus.includes(openSku);
  // The open row's SKU sits in a `<td>` with no form around it and a Save that is a plain
  // button, so `pattern` marks the box and refuses nothing — the *chips* revision's rule that
  // a pattern is not a refusal, read the other way. The shape is therefore checked here, off
  // the same constant the pattern is built from, so the edit path refuses exactly what the
  // add form's submit refuses rather than letting "NS ASJ_1" wait for the publish gate.
  const skuMisshapen = openSku !== "" && !isVariantSku(openSku);
  const skuSaveable = openSku !== "" && !skuCollides && !skuMisshapen;

  return (
    <Card title="Variants">
      <div className={`${surfaceClasses} overflow-x-auto`}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={tableHeadClasses}>SKU</th>
              <th className={tableHeadClasses}>Options</th>
              <th className={tableHeadClasses}>Price</th>
              <th className={tableHeadClasses}>Availability</th>
              <th className={tableHeadClasses}>Stock</th>
              <th className={tableHeadClasses}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {product.variants.map((variant, index) => {
              // The row's own open edit, or null. Held once so the two cells it changes and
              // the buttons that close it read the same object.
              const rowEdit = editor.isOpen(variant.sku) ? editor.open : null;
              return (
                <tr key={variant.sku}>
                  <td className={tableCellClasses}>
                    {rowEdit ? (
                      <>
                        <label className="sr-only" htmlFor={`sku-${variant.sku}`}>
                          SKU for {variant.sku}
                        </label>
                        <input
                          id={`sku-${variant.sku}`}
                          className={`${fieldControlClasses} max-w-44`}
                          value={rowEdit.fields.sku}
                          pattern={REFERENCE_PATTERN}
                          title={VARIANT_SKU_RENAME_RULE}
                          aria-describedby={skuRuleId}
                          aria-invalid={skuCollides || skuMisshapen || undefined}
                          onChange={(event) =>
                            editor.change({
                              ...rowEdit.fields,
                              sku: event.target.value.toUpperCase(),
                            })
                          }
                        />
                      </>
                    ) : (
                      variant.sku
                    )}
                  </td>
                  <td className={tableCellClasses}>
                    {rowEdit ? (
                      <div className="grid gap-1.5">
                        {/* One select per value the builder will write, in the order it will
                            write them, derived from the builder itself so the form cannot
                            offer a control with no write behind it. A key whose option the
                            product no longer declares is skipped: that is
                            `variant_unknown_option`, which this row cannot fix by picking
                            from a list that does not exist. */}
                        {variantOptionValues(
                          variant.option_values,
                          product.options,
                          rowEdit.fields.optionValues,
                        ).map((chosen) => {
                          const option = product.options.find((entry) => entry.key === chosen.key);
                          if (!option) {
                            return null;
                          }
                          return (
                            <span key={chosen.key}>
                              <label
                                className="sr-only"
                                htmlFor={`option-${variant.sku}-${chosen.key}`}
                              >
                                {option.name} for {variant.sku}
                              </label>
                              <select
                                id={`option-${variant.sku}-${chosen.key}`}
                                className={`${fieldControlClasses} max-w-36`}
                                value={chosen.value}
                                onChange={(event) =>
                                  editor.change({
                                    ...rowEdit.fields,
                                    optionValues: {
                                      ...rowEdit.fields.optionValues,
                                      [chosen.key]: event.target.value,
                                    },
                                  })
                                }
                              >
                                {option.values.map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </select>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      variantOptionLabel(variant)
                    )}
                  </td>
                  <td className={tableCellClasses}>
                    <label className="sr-only" htmlFor={`price-${variant.sku}`}>
                      Price for {variant.sku}
                    </label>
                    {/* The currency is beside the box rather than inside its label, so a row
                      that is priced says which money it is priced in without the operator
                      opening the header. A hint line per row would be twenty copies of one
                      sentence down the table, so every row's field is described by the one
                      below it instead: `aria-describedby` may name an element anywhere, and
                      the rule reaching a reader without a pointer is the point of the
                      convention. `title=` stays for the browser's own validity bubble. */}
                    <span className="flex items-center gap-1.5">
                      <input
                        id={`price-${variant.sku}`}
                        className={`${fieldControlClasses} max-w-28`}
                        value={variant.price?.amount ?? ""}
                        inputMode="decimal"
                        pattern={MONEY_PATTERN}
                        title={MONEY_RULE}
                        aria-describedby={priceRuleId}
                        placeholder={variantPriceLabel(variant)}
                        onChange={(event) =>
                          updateVariant(index, {
                            ...variant,
                            price: event.target.value
                              ? {
                                  amount: event.target.value,
                                  currency: variant.price?.currency ?? defaultCurrency,
                                }
                              : null,
                          })
                        }
                      />
                      <span className="text-admin-muted">
                        {variant.price?.currency ?? defaultCurrency}
                      </span>
                    </span>
                  </td>
                  <td className={tableCellClasses}>
                    <label className="sr-only" htmlFor={`availability-${variant.sku}`}>
                      Availability for {variant.sku}
                    </label>
                    <select
                      id={`availability-${variant.sku}`}
                      className={`${fieldControlClasses} max-w-36`}
                      value={variant.availability}
                      onChange={(event) =>
                        updateVariant(index, {
                          ...variant,
                          availability: event.target.value as VariantSchema["availability"],
                        })
                      }
                    >
                      {AVAILABILITIES.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={tableCellClasses}>
                    <label className="sr-only" htmlFor={`stock-${variant.sku}`}>
                      Stock for {variant.sku}
                    </label>
                    <input
                      id={`stock-${variant.sku}`}
                      type="number"
                      min={0}
                      className={`${fieldControlClasses} max-w-24`}
                      value={variant.stock_quantity}
                      onChange={(event) =>
                        updateVariant(index, {
                          ...variant,
                          stock_quantity: Number(event.target.value),
                        })
                      }
                    />
                  </td>
                  <td className={tableCellClasses}>
                    <span className="flex items-center gap-1.5">
                      <EntryEditButtons
                        label={variant.sku}
                        open={rowEdit !== null}
                        blockedBy={editor.blocked(variant.sku) ? editNoticeId : undefined}
                        saveable={skuSaveable}
                        onOpen={() =>
                          editor.begin(variant.sku, variant.sku, variantFields(variant))
                        }
                        onSave={() => {
                          if (rowEdit) {
                            saveVariant(index, rowEdit.fields);
                          }
                          editor.close();
                        }}
                        onCancel={() => editor.close()}
                      />
                      {rowEdit ? null : (
                        <button
                          className={destructiveSubtleButtonClasses}
                          type="button"
                          onClick={() =>
                            onChange({
                              ...product,
                              variants: product.variants.filter(
                                (entry) => entry.sku !== variant.sku,
                              ),
                            })
                          }
                        >
                          <ButtonIcon verb="delete" />
                          Remove {variant.sku}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {product.variants.length === 0 ? (
              <tr>
                <td className={`${tableCellClasses} text-admin-muted`} colSpan={6}>
                  No sellable variant yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p id={priceRuleId} className="sr-only">
        {MONEY_RULE}
      </p>
      {/* The SKU's rule, on the price rule's terms — one copy for the column, reached by
          `aria-describedby` — except that it becomes visible while a row is open, because a
          rename is the one edit on this page whose consequence an operator must read before
          pressing Save rather than only on request. */}
      <p id={skuRuleId} className={editor.open ? "text-xs text-admin-muted" : "sr-only"}>
        {VARIANT_SKU_RENAME_RULE}
      </p>
      {skuCollides || skuMisshapen ? (
        <p role="alert" className="text-xs text-lab-error">
          {skuCollides ? alreadyTakenMessage(openSku, "in the draft") : VARIANT_SKU_RENAME_RULE}
        </p>
      ) : null}
      <EntryEditNotice id={editNoticeId} label={editor.open?.label ?? null} />

      <form className="grid gap-2 sm:grid-cols-2" onSubmit={add}>
        {product.options.map((option) => (
          <div key={option.key} className={fieldLabelClasses}>
            {/* An explicit association keeps the accessible name free of the option text. */}
            <label htmlFor={`new-variant-${option.key}`}>{option.name}</label>
            <select
              id={`new-variant-${option.key}`}
              className={fieldControlClasses}
              value={optionValues[option.key] ?? option.values[0]}
              onChange={(event) =>
                setOptionValues({ ...optionValues, [option.key]: event.target.value })
              }
            >
              {option.values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        ))}
        {/* The currency is a control of its own where the shop sells in more than one, so
            the suffix only says what the form is not already asking: the money a single-
            currency shop prices in, which nothing else on this form names. */}
        <FieldHint
          label="Price"
          hint={MONEY_RULE}
          extra={currencies.length > 1 ? undefined : `Priced in ${defaultCurrency}.`}
          optional
        >
          <input
            className={fieldControlClasses}
            value={amount}
            inputMode="decimal"
            pattern={MONEY_PATTERN}
            title={MONEY_RULE}
            placeholder="249.00"
            onChange={(event) => setAmount(event.target.value)}
          />
        </FieldHint>
        {currencies.length > 1 ? (
          <label className={fieldLabelClasses}>
            Currency
            <select
              className={fieldControlClasses}
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {currencies.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <DerivedIdField
          key={skuResume}
          label="New variant SKU"
          hint={VARIANT_SKU_RULE}
          value={sku}
          suggested={suggestedSku}
          taken={takenSkus}
          takenBase={takenSkuBase}
          takenPlace="in the draft"
          pattern={REFERENCE_PATTERN}
          title={VARIANT_SKU_RULE}
          required
          normalize={(value) => value.toUpperCase()}
          onChange={setSku}
        />
        <button className={`${accentButtonClasses} self-end`} type="submit">
          <ButtonIcon verb="create" />
          Add variant
        </button>
      </form>
    </Card>
  );
}

/**
 * A media entry's two fields, on the add form and in an open row alike — including the
 * refusal, which both paths therefore make in the same words.
 *
 * A reference is what keys this list, in the draft's change summary and in React's own
 * reconciliation, so two entries may not share one. The add form did not refuse a duplicate
 * at all and the open row refused it by greying Save and saying nothing; both now read on
 * `DerivedIdField`'s collision model — the second line turns to the error treatment and is
 * announced, the field is marked invalid, and the press does nothing.
 */
function MediaFieldset({
  value,
  onChange,
  collision,
}: {
  value: MediaFields;
  onChange: (next: MediaFields) => void;
  /** Why this reference cannot be saved, when another entry already holds it. */
  collision?: string;
}) {
  return (
    <>
      <FieldHint
        label="Reference"
        hint={MEDIA_REFERENCE_RULE}
        extra={collision}
        extraTone={collision ? "error" : "muted"}
      >
        <input
          className={fieldControlClasses}
          value={value.reference}
          required
          placeholder="media/alpine-shell.jpg"
          aria-invalid={collision ? true : undefined}
          onChange={(event) => onChange({ ...value, reference: event.target.value })}
        />
      </FieldHint>
      <label className={fieldLabelClasses}>
        Alt text
        <input
          className={fieldControlClasses}
          value={value.altText}
          required
          onChange={(event) => onChange({ ...value, altText: event.target.value })}
        />
      </label>
    </>
  );
}

function MediaCard({ product, onChange }: EditorProps) {
  const [media, setMedia] = useState<MediaFields>({ reference: "", altText: "" });
  const taken = product.media.map((entry) => entry.reference);
  const editor = useEntryEdit<MediaFields>(taken);
  const notice = useId();

  /** Computed once for both paths: a reference is free unless the row holding it is this one. */
  function collisionOf(reference: string, own?: string): string | undefined {
    if (reference === "" || reference === own || !taken.includes(reference)) {
      return undefined;
    }
    return alreadyTakenMessage(reference, "a media reference of this product");
  }

  const addCollision = collisionOf(media.reference);
  const openCollision = editor.open
    ? collisionOf(editor.open.fields.reference, editor.open.id)
    : undefined;

  return (
    <Card title="Media references">
      <ul className="grid gap-2 text-[13px]">
        {product.media.map((entry) => (
          <EntryCard
            key={entry.reference}
            title={<code className="font-mono text-[12px]">{entry.reference}</code>}
            edit={entryEdit(
              editor,
              notice,
              entry.reference,
              entry.reference,
              () => ({ reference: entry.reference, altText: entry.alt_text }),
              (fields) =>
                onChange({
                  ...product,
                  media: product.media.map((item) =>
                    item.reference === entry.reference ? mediaEntry(fields) : item,
                  ),
                }),
              (value, change) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  <MediaFieldset value={value} onChange={change} collision={openCollision} />
                </div>
              ),
              (value) => value.reference !== "" && openCollision === undefined,
            )}
            actions={
              <button
                className={destructiveSubtleButtonClasses}
                type="button"
                onClick={() =>
                  onChange({
                    ...product,
                    media: product.media.filter((item) => item.reference !== entry.reference),
                  })
                }
              >
                <ButtonIcon verb="delete" />
                Remove {entry.reference}
              </button>
            }
          >
            <p className="text-admin-muted">{entry.alt_text}</p>
          </EntryCard>
        ))}
        {product.media.length === 0 ? (
          <li className="text-admin-muted">No media reference yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <form
        className="grid gap-2 sm:grid-cols-[2fr_2fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (addCollision) {
            return;
          }
          onChange({ ...product, media: [...product.media, mediaEntry(media)] });
          setMedia({ reference: "", altText: "" });
        }}
      >
        <MediaFieldset value={media} onChange={setMedia} collision={addCollision} />
        <button className={`${accentButtonClasses} self-end`} type="submit">
          <ButtonIcon verb="create" />
          Add media
        </button>
      </form>
      <p className="text-xs text-admin-muted">
        URL or path metadata only — managed binary upload is deferred.
      </p>
    </Card>
  );
}

/**
 * The four controls an attribute is authored through, in the order both paths ask them: what
 * it is called, what kind of value it holds, the value, and the unit or the choices that kind
 * brings with it.
 */
function AttributeFieldset({
  value,
  onChange,
  beside,
}: {
  value: AttributeFields;
  onChange: (next: AttributeFields) => void;
  /** The derived key, which only the add form asks for. */
  beside?: ReactNode;
}) {
  return (
    <>
      <label className={fieldLabelClasses}>
        Label
        <input
          className={fieldControlClasses}
          value={value.label}
          required
          onChange={(event) => onChange({ ...value, label: event.target.value })}
        />
      </label>
      {beside}
      <label className={fieldLabelClasses}>
        Type
        <select
          className={fieldControlClasses}
          value={value.attributeType}
          onChange={(event) =>
            onChange({
              ...value,
              attributeType: event.target.value as AttributeSchema["attribute_type"],
            })
          }
        >
          {ATTRIBUTE_TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className={fieldLabelClasses}>
        Value
        <input
          className={fieldControlClasses}
          value={value.value}
          required
          onChange={(event) => onChange({ ...value, value: event.target.value })}
        />
      </label>
      {value.attributeType === "measurement" ? (
        <label className={fieldLabelClasses}>
          Unit
          <input
            className={fieldControlClasses}
            value={value.unit}
            required
            onChange={(event) => onChange({ ...value, unit: event.target.value })}
          />
        </label>
      ) : null}
      {value.attributeType === "choice" ? (
        <div className="sm:col-span-3">
          <ChipListField
            legend="Choices"
            label="New choice"
            hint={ATTRIBUTE_CHOICES_RULE}
            maxLength={CHIP_LABEL_MAX_LENGTH}
            addLabel="Add choice"
            placeholder="Regular"
            empty="No choice yet; a choice attribute needs at least one."
            values={value.choices}
            takenPlace="a choice of this attribute"
            onChange={(choices) => onChange({ ...value, choices })}
          />
        </div>
      ) : null}
    </>
  );
}

const EMPTY_ATTRIBUTE: AttributeFields = {
  label: "",
  attributeType: "text",
  value: "",
  unit: "",
  choices: [],
};

function AttributesCard({ product, onChange }: EditorProps) {
  const [key, setKey] = useState("");
  const [fields, setFields] = useState<AttributeFields>(EMPTY_ATTRIBUTE);
  const editor = useEntryEdit<AttributeFields>(product.attributes.map((entry) => entry.key));
  const notice = useId();
  const taken = product.attributes.map((attribute) => attribute.key);
  const { value: suggestedKey, takenBase } = uniqueSuggestion(slugify(fields.label, ""), taken);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key || taken.includes(key)) {
      return;
    }
    onChange({ ...product, attributes: [...product.attributes, attributeEntry(key, fields)] });
    setKey("");
    setFields(EMPTY_ATTRIBUTE);
  }

  return (
    <Card title="Custom attributes (typed)">
      <ul className="grid gap-2 text-[13px]">
        {product.attributes.map((attribute) => (
          <EntryCard
            key={attribute.key}
            title={attribute.label}
            chips={
              <>
                <EntryId value={attribute.key} />
                <EntryKind value={labelOf(ATTRIBUTE_TYPE, attribute.attribute_type)} />
              </>
            }
            edit={entryEdit(
              editor,
              notice,
              attribute.key,
              attribute.label,
              () => attributeFields(attribute),
              (next) =>
                onChange({
                  ...product,
                  attributes: product.attributes.map((entry) =>
                    entry.key === attribute.key ? attributeEntry(attribute.key, next) : entry,
                  ),
                }),
              (value, change) => (
                <div className="grid gap-2 sm:grid-cols-3">
                  <AttributeFieldset value={value} onChange={change} />
                </div>
              ),
            )}
            actions={
              <button
                className={destructiveSubtleButtonClasses}
                type="button"
                onClick={() =>
                  onChange({
                    ...product,
                    attributes: product.attributes.filter((entry) => entry.key !== attribute.key),
                  })
                }
              >
                <ButtonIcon verb="delete" />
                Remove {attribute.label}
              </button>
            }
          >
            {/* The stored value, the unit and the choices are the row's *body*, not its
                header: a header stays put while the row is open, and a stale "20k" printed
                beside the box editing it is the thing an operator reads instead of the box. */}
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {attribute.value}
                {attribute.unit ? ` ${attribute.unit}` : ""}
              </span>
              {attribute.choices.length > 0 ? (
                <>
                  {/* "one of" is the rule the lab applies — `shop.py` refuses a choice
                      attribute whose value is not among them — so it stays a word, and the
                      choices beside it become the chips frame 2c draws. */}
                  <span className="text-admin-muted">one of</span>
                  <ChipList label={`Choices for ${attribute.label}`} values={attribute.choices} />
                </>
              ) : null}
            </span>
          </EntryCard>
        ))}
        {product.attributes.length === 0 ? (
          <li className="text-admin-muted">No custom attribute yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={add}>
        <AttributeFieldset
          value={fields}
          onChange={setFields}
          beside={
            <DerivedIdField
              label="Key"
              hint={DERIVED_KEBAB_RULE}
              value={key}
              suggested={suggestedKey}
              taken={taken}
              takenBase={takenBase}
              takenPlace="in the draft"
              pattern={KEBAB_PATTERN}
              title={DERIVED_KEBAB_RULE}
              required
              onChange={setKey}
            />
          }
        />
        <button className={`${accentButtonClasses} self-end`} type="submit">
          <ButtonIcon verb="create" />
          Add attribute
        </button>
      </form>
      <p className="text-xs text-admin-muted">
        Discoverable by agents through catalog tools — never free-form JSON.
      </p>
    </Card>
  );
}

/** A synthetic review's three fields, on the add form and in an open row alike. */
function ReviewFieldset({
  value,
  onChange,
}: {
  value: ReviewFields;
  onChange: (next: ReviewFields) => void;
}) {
  return (
    <>
      <label className={fieldLabelClasses}>
        Author
        <input
          className={fieldControlClasses}
          value={value.author}
          required
          onChange={(event) => onChange({ ...value, author: event.target.value })}
        />
      </label>
      <StarRatingField value={value.rating} onChange={(rating) => onChange({ ...value, rating })} />
      <label className={`${fieldLabelClasses} sm:col-span-3`}>
        Body
        <input
          className={fieldControlClasses}
          value={value.body}
          required
          onChange={(event) => onChange({ ...value, body: event.target.value })}
        />
      </label>
    </>
  );
}

function ReviewsCard({ product, onChange }: EditorProps) {
  const [fields, setFields] = useState<ReviewFields>({ author: "", rating: 5, body: "" });
  const editor = useEntryEdit<ReviewFields>(product.reviews.map((review) => review.id));
  const notice = useId();

  return (
    <Card title={`Ratings & reviews · ${ratingLabel(product)}`} label="Ratings and reviews">
      <ul className="grid gap-2 text-[13px]">
        {product.reviews.map((review) => (
          <EntryCard
            key={review.id}
            title={`${review.rating}★`}
            chips={<EntryId value={review.id} />}
            edit={entryEdit(
              editor,
              notice,
              review.id,
              `review ${review.id}`,
              () => ({
                author: review.author_display_name,
                rating: review.rating,
                body: review.body,
              }),
              (next) =>
                onChange({
                  ...product,
                  reviews: product.reviews.map((entry) =>
                    entry.id === review.id ? reviewEntry(review.id, next) : entry,
                  ),
                }),
              (value, change) => (
                <div className="grid gap-2 sm:grid-cols-4">
                  <ReviewFieldset value={value} onChange={change} />
                </div>
              ),
            )}
            actions={
              <button
                className={destructiveSubtleButtonClasses}
                type="button"
                onClick={() =>
                  onChange({
                    ...product,
                    reviews: product.reviews.filter((entry) => entry.id !== review.id),
                  })
                }
              >
                <ButtonIcon verb="delete" />
                Remove review {review.id}
              </button>
            }
          >
            <p className="text-admin-ink-soft">
              “{review.body}” — {review.author_display_name}
            </p>
          </EntryCard>
        ))}
        {product.reviews.length === 0 ? (
          <li className="text-admin-muted">No synthetic review yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <form
        className="grid gap-2 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const id = uniqueId(
            slugify(fields.author, "review"),
            product.reviews.map((review) => review.id),
          );
          onChange({ ...product, reviews: [...product.reviews, reviewEntry(id, fields)] });
          setFields({ ...fields, author: "", body: "" });
        }}
      >
        <ReviewFieldset value={fields} onChange={setFields} />
        <button className={`${accentButtonClasses} self-end`} type="submit">
          <ButtonIcon verb="create" />
          Add review
        </button>
      </form>
      <p className="text-xs text-admin-muted">
        The rating summary is derived from these reviews; it is never authored directly.
      </p>
    </Card>
  );
}

const STARS = [1, 2, 3, 4, 5];

/**
 * The rating a synthetic review carries: five radios, one per star.
 *
 * A number box asked an operator to type a digit into a field whose meaning is a row of
 * stars, and accepted `0` and `7` on the way to being refused by the contract. Five radios
 * carry the same payload — `ReviewSchema.rating` is an integer between 1 and 5 — while being
 * the shape the value actually has: a closed set of five, arrow-key navigable, each with its
 * own name, and impossible to leave holding something the lab would refuse.
 *
 * **There is no "no rating".** The contract requires the field, the add form has always
 * submitted one, and a sixth state would exist only to be refused when Add was pressed. The
 * five stars this form opens on are the default this form already had.
 *
 * The stars themselves are `aria-hidden` and the accessible name of each radio is its own
 * sr-only wording ("4 stars"), so the row is never read as five identical glyphs. The group's
 * second line says the chosen count in words, because a filled star and an empty one differ
 * by colour and shape alone, which the design direction does not let carry a value.
 */
function StarRatingField({ value, onChange }: { value: number; onChange: (star: number) => void }) {
  const name = useId();
  return (
    <FieldGroupHint legend="Rating" hint={REVIEW_RATING_RULE} extra={`${value} of 5 stars.`}>
      <div className="flex items-center gap-0.5">
        {STARS.map((star) => (
          <label key={star} className="cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name={name}
              checked={value === star}
              onChange={() => onChange(star)}
            />
            <span
              aria-hidden
              className={`rounded px-0.5 text-lg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lab-primary ${
                star <= value ? "text-lab-accent" : "text-admin-border"
              }`}
            >
              ★
            </span>
            <span className="sr-only">{star === 1 ? "1 star" : `${star} stars`}</span>
          </label>
        ))}
      </div>
    </FieldGroupHint>
  );
}
