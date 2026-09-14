import type {
  AttributeSchema,
  OptionSchema,
  ProductViewSchema,
  VariantSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChipList, ChipListField } from "../components/ChipListField";
import { DerivedIdField } from "../components/DerivedIdField";
import { FieldGroupHint, FieldHint } from "../components/FieldHint";
import {
  Card,
  EntryId,
  EntryKind,
  IssueList,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import type { Currency } from "../lib/currencies";
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
  CHIP_LABEL_MAX_LENGTH,
  DERIVED_KEBAB_RULE,
  KEBAB_PATTERN,
  MONEY_PATTERN,
  MONEY_RULE,
  OPTION_VALUES_RULE,
  REFERENCE_PATTERN,
  REVIEW_RATING_RULE,
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
  fieldControlClasses,
  fieldLabelClasses,
  subtleButtonClasses,
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
  const { content, preview, edit, save, saving, dirty, error } = useShopWorkspace();
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
          <button
            className={accentButtonClasses}
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : dirty ? "Save draft" : "Saved"}
          </button>
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

interface EditorProps {
  product: ProductViewSchema;
  onChange: (next: ProductViewSchema) => void;
}

interface PricedEditorProps extends EditorProps {
  /** The shop's sellable currencies; the first is the domain default. */
  currencies: Currency[];
}

function OptionsCard({ product, onChange }: EditorProps) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const taken = product.options.map((option) => option.key);
  const { value: suggestedKey, takenBase } = uniqueSuggestion(slugify(name, ""), taken);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key || taken.includes(key) || values.length === 0) {
      return;
    }
    const option: OptionSchema = {
      key,
      name,
      values,
    };
    onChange({ ...product, options: [...product.options, option] });
    setKey("");
    setName("");
    setValues([]);
  }

  return (
    <Card title="Options">
      <ul className="grid gap-1.5 text-[13px]">
        {product.options.map((option) => (
          <li key={option.key} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{option.name}</span>
            <EntryId value={option.key} />
            {/* Frame 2c draws an option's values as pills on the saved row, the same pills
                the add form below enters them as. */}
            <ChipList label={`Values of ${option.name}`} values={option.values} />
            <button
              className={`${subtleButtonClasses} ml-auto`}
              type="button"
              onClick={() =>
                onChange({
                  ...product,
                  options: product.options.filter((entry) => entry.key !== option.key),
                })
              }
            >
              Remove {option.name}
            </button>
          </li>
        ))}
        {product.options.length === 0 ? (
          <li className="text-admin-muted">No options yet.</li>
        ) : null}
      </ul>
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
          onChange={setValues}
        />
        <button className={`${accentButtonClasses} justify-self-start`} type="submit">
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
      option_values: product.options.map((option) => ({
        key: option.key,
        value: optionValues[option.key] ?? option.values[0],
      })),
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
            {product.variants.map((variant, index) => (
              <tr key={variant.sku}>
                <td className={tableCellClasses}>{variant.sku}</td>
                <td className={tableCellClasses}>{variantOptionLabel(variant)}</td>
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
                  <button
                    className={subtleButtonClasses}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...product,
                        variants: product.variants.filter((entry) => entry.sku !== variant.sku),
                      })
                    }
                  >
                    Remove {variant.sku}
                  </button>
                </td>
              </tr>
            ))}
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
          Add variant
        </button>
      </form>
    </Card>
  );
}

function MediaCard({ product, onChange }: EditorProps) {
  const [reference, setReference] = useState("");
  const [altText, setAltText] = useState("");

  return (
    <Card title="Media references">
      <ul className="grid gap-1.5 text-[13px]">
        {product.media.map((entry) => (
          <li key={entry.reference} className="flex items-center gap-2">
            <code className="font-mono text-[12px]">{entry.reference}</code>
            <span className="text-admin-muted">{entry.alt_text}</span>
            <button
              className={`${subtleButtonClasses} ml-auto`}
              type="button"
              onClick={() =>
                onChange({
                  ...product,
                  media: product.media.filter((item) => item.reference !== entry.reference),
                })
              }
            >
              Remove {entry.reference}
            </button>
          </li>
        ))}
        {product.media.length === 0 ? (
          <li className="text-admin-muted">No media reference yet.</li>
        ) : null}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[2fr_2fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onChange({ ...product, media: [...product.media, { reference, alt_text: altText }] });
          setReference("");
          setAltText("");
        }}
      >
        <label className={fieldLabelClasses}>
          Reference
          <input
            className={fieldControlClasses}
            value={reference}
            required
            onChange={(event) => setReference(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Alt text
          <input
            className={fieldControlClasses}
            value={altText}
            required
            onChange={(event) => setAltText(event.target.value)}
          />
        </label>
        <button className={`${accentButtonClasses} self-end`} type="submit">
          Add media
        </button>
      </form>
      <p className="text-xs text-admin-muted">
        URL or path metadata only — managed binary upload is deferred.
      </p>
    </Card>
  );
}

function AttributesCard({ product, onChange }: EditorProps) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [attributeType, setAttributeType] = useState<AttributeSchema["attribute_type"]>("text");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const taken = product.attributes.map((attribute) => attribute.key);
  const { value: suggestedKey, takenBase } = uniqueSuggestion(slugify(label, ""), taken);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key || taken.includes(key)) {
      return;
    }
    const attribute: AttributeSchema = {
      key,
      label,
      attribute_type: attributeType,
      value,
      unit: attributeType === "measurement" ? unit : null,
      choices: attributeType === "choice" ? choices : [],
    };
    onChange({ ...product, attributes: [...product.attributes, attribute] });
    setKey("");
    setLabel("");
    setValue("");
    setUnit("");
    setChoices([]);
  }

  return (
    <Card title="Custom attributes (typed)">
      <ul className="grid gap-1.5 text-[13px]">
        {product.attributes.map((attribute) => (
          <li key={attribute.key} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{attribute.label}</span>
            <EntryId value={attribute.key} />
            <EntryKind value={labelOf(ATTRIBUTE_TYPE, attribute.attribute_type)} />
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
            <button
              className={`${subtleButtonClasses} ml-auto`}
              type="button"
              onClick={() =>
                onChange({
                  ...product,
                  attributes: product.attributes.filter((entry) => entry.key !== attribute.key),
                })
              }
            >
              Remove {attribute.label}
            </button>
          </li>
        ))}
        {product.attributes.length === 0 ? (
          <li className="text-admin-muted">No custom attribute yet.</li>
        ) : null}
      </ul>
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={add}>
        <label className={fieldLabelClasses}>
          Label
          <input
            className={fieldControlClasses}
            value={label}
            required
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
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
        <label className={fieldLabelClasses}>
          Type
          <select
            className={fieldControlClasses}
            value={attributeType}
            onChange={(event) =>
              setAttributeType(event.target.value as AttributeSchema["attribute_type"])
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
            value={value}
            required
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {attributeType === "measurement" ? (
          <label className={fieldLabelClasses}>
            Unit
            <input
              className={fieldControlClasses}
              value={unit}
              required
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>
        ) : null}
        {attributeType === "choice" ? (
          <div className="sm:col-span-3">
            <ChipListField
              legend="Choices"
              label="New choice"
              hint={ATTRIBUTE_CHOICES_RULE}
              maxLength={CHIP_LABEL_MAX_LENGTH}
              addLabel="Add choice"
              placeholder="Regular"
              empty="No choice yet; a choice attribute needs at least one."
              values={choices}
              takenPlace="a choice of this attribute"
              onChange={setChoices}
            />
          </div>
        ) : null}
        <button className={`${accentButtonClasses} self-end`} type="submit">
          Add attribute
        </button>
      </form>
      <p className="text-xs text-admin-muted">
        Discoverable by agents through catalog tools — never free-form JSON.
      </p>
    </Card>
  );
}

function ReviewsCard({ product, onChange }: EditorProps) {
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");

  return (
    <Card title={`Ratings & reviews · ${ratingLabel(product)}`} label="Ratings and reviews">
      <ul className="grid gap-1.5 text-[13px]">
        {product.reviews.map((review) => (
          <li key={review.id} className="flex items-start gap-2">
            <span className="font-semibold">{review.rating}★</span>
            <EntryId value={review.id} />
            <span className="text-admin-ink-soft">
              “{review.body}” — {review.author_display_name}
            </span>
            <button
              className={`${subtleButtonClasses} ml-auto`}
              type="button"
              onClick={() =>
                onChange({
                  ...product,
                  reviews: product.reviews.filter((entry) => entry.id !== review.id),
                })
              }
            >
              Remove review {review.id}
            </button>
          </li>
        ))}
        {product.reviews.length === 0 ? (
          <li className="text-admin-muted">No synthetic review yet.</li>
        ) : null}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const id = uniqueId(
            slugify(author, "review"),
            product.reviews.map((review) => review.id),
          );
          onChange({
            ...product,
            reviews: [...product.reviews, { id, author_display_name: author, rating, body }],
          });
          setAuthor("");
          setBody("");
        }}
      >
        <label className={fieldLabelClasses}>
          Author
          <input
            className={fieldControlClasses}
            value={author}
            required
            onChange={(event) => setAuthor(event.target.value)}
          />
        </label>
        <StarRatingField value={rating} onChange={setRating} />
        <label className={`${fieldLabelClasses} sm:col-span-3`}>
          Body
          <input
            className={fieldControlClasses}
            value={body}
            required
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <button className={`${accentButtonClasses} self-end`} type="submit">
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
              className={`rounded px-0.5 text-lg peer-focus-visible:ring-2 peer-focus-visible:ring-lab-accent/40 ${
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
