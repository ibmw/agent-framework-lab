import type {
  AttributeSchema,
  OptionSchema,
  ProductViewSchema,
  VariantSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Card,
  EntryId,
  EntryKind,
  IssueList,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import type { Currency } from "../lib/currencies";
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

const AVAILABILITIES: VariantSchema["availability"][] = [
  "in_stock",
  "backorder",
  "out_of_stock",
  "discontinued",
];

const ATTRIBUTE_TYPES: AttributeSchema["attribute_type"][] = [
  "text",
  "number",
  "boolean",
  "choice",
  "measurement",
];

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
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="archived">archived</option>
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
  const [values, setValues] = useState("");

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const option: OptionSchema = {
      key,
      name,
      values: values
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    };
    onChange({ ...product, options: [...product.options, option] });
    setKey("");
    setName("");
    setValues("");
  }

  return (
    <Card title="Options">
      <ul className="grid gap-1.5 text-[13px]">
        {product.options.map((option) => (
          <li key={option.key} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{option.name}</span>
            <EntryId value={option.key} />
            <span className="min-w-0 [overflow-wrap:anywhere] text-admin-muted">
              {option.values.join(" · ")}
            </span>
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
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={add}>
        <label className={fieldLabelClasses}>
          Option key
          <input
            className={fieldControlClasses}
            value={key}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Option name
          <input
            className={fieldControlClasses}
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Values (comma separated)
          <input
            className={fieldControlClasses}
            value={values}
            required
            onChange={(event) => setValues(event.target.value)}
          />
        </label>
        <button className={`${accentButtonClasses} self-end`} type="submit">
          Add option
        </button>
      </form>
    </Card>
  );
}

function VariantsCard({ product, onChange, currencies }: PricedEditorProps) {
  const defaultCurrency = currencies[0];
  const [sku, setSku] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
                  <input
                    id={`price-${variant.sku}`}
                    className={`${fieldControlClasses} max-w-28`}
                    value={variant.price?.amount ?? ""}
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
                    {AVAILABILITIES.map((availability) => (
                      <option key={availability} value={availability}>
                        {availability}
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

      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={add}>
        <label className={fieldLabelClasses}>
          New variant SKU
          <input
            className={fieldControlClasses}
            value={sku}
            required
            pattern="[A-Z0-9]+(-[A-Z0-9]+)*"
            title="Uppercase alphanumeric kebab-case, for example NS-ASJ-OB-M"
            onChange={(event) => setSku(event.target.value.toUpperCase())}
          />
        </label>
        <label className={fieldLabelClasses}>
          Price (optional)
          <input
            className={fieldControlClasses}
            value={amount}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
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
        <button className={`${accentButtonClasses} self-end`} type="submit">
          Add variant
        </button>
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
  const [choices, setChoices] = useState("");

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const attribute: AttributeSchema = {
      key,
      label,
      attribute_type: attributeType,
      value,
      unit: attributeType === "measurement" ? unit : null,
      choices:
        attributeType === "choice"
          ? choices
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [],
    };
    onChange({ ...product, attributes: [...product.attributes, attribute] });
    setKey("");
    setLabel("");
    setValue("");
    setUnit("");
    setChoices("");
  }

  return (
    <Card title="Custom attributes (typed)">
      <ul className="grid gap-1.5 text-[13px]">
        {product.attributes.map((attribute) => (
          <li key={attribute.key} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{attribute.label}</span>
            <EntryId value={attribute.key} />
            <EntryKind value={attribute.attribute_type} />
            <span>
              {attribute.value}
              {attribute.unit ? ` ${attribute.unit}` : ""}
            </span>
            {attribute.choices.length > 0 ? (
              <span className="text-admin-muted">one of {attribute.choices.join(", ")}</span>
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
          Key
          <input
            className={fieldControlClasses}
            value={key}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Label
          <input
            className={fieldControlClasses}
            value={label}
            required
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Type
          <select
            className={fieldControlClasses}
            value={attributeType}
            onChange={(event) =>
              setAttributeType(event.target.value as AttributeSchema["attribute_type"])
            }
          >
            {ATTRIBUTE_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
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
          <label className={fieldLabelClasses}>
            Choices (comma separated)
            <input
              className={fieldControlClasses}
              value={choices}
              required
              onChange={(event) => setChoices(event.target.value)}
            />
          </label>
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
  const [id, setId] = useState("");
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");

  return (
    <Card title={`Ratings & reviews · ${ratingLabel(product)}`} label="Ratings and reviews">
      <ul className="grid gap-1.5 text-[13px]">
        {product.reviews.map((review) => (
          <li key={review.id} className="flex items-start gap-2">
            <span className="font-semibold">{review.rating}★</span>
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
          onChange({
            ...product,
            reviews: [...product.reviews, { id, author_display_name: author, rating, body }],
          });
          setId("");
          setAuthor("");
          setBody("");
        }}
      >
        <label className={fieldLabelClasses}>
          Review ID
          <input
            className={fieldControlClasses}
            value={id}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(event) => setId(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Author
          <input
            className={fieldControlClasses}
            value={author}
            required
            onChange={(event) => setAuthor(event.target.value)}
          />
        </label>
        <label className={fieldLabelClasses}>
          Rating
          <input
            type="number"
            min={1}
            max={5}
            className={fieldControlClasses}
            value={rating}
            onChange={(event) => setRating(Number(event.target.value))}
          />
        </label>
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
