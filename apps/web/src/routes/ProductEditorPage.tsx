import type {
  AttributeSchema,
  MediaReferenceSchema,
  OptionSchema,
  ProductViewSchema,
  ReviewSchema,
  VariantSchema,
} from "@agent-lab/contracts";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipList, ChipListField } from "../components/ChipListField";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldGroupHint, FieldHint, FieldRows } from "../components/FieldHint";
import { PrimaryAction, RefusalLine } from "../components/PrimaryAction";
import { ProductDeleteConfirm } from "../components/ProductDeleteConfirm";
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
import {
  isSlug,
  SLUG_MAX_LENGTH,
  slugify,
  uniqueId,
  uniqueSuggestion,
  uniqueVariantSku,
} from "../lib/entryIds";
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
  PRODUCT_DESCRIPTION_RULE,
  PRODUCT_HANDLE_RULE,
  PRODUCT_STATUS_RULE,
  PRODUCT_TITLE_RULE,
  productWithoutVariantRule,
  REFERENCE_PATTERN,
  REVIEW_RATING_RULE,
  VARIANT_SKU_RENAME_RULE,
  VARIANT_SKU_RULE,
  variantInStockWithoutInventoryRule,
  variantWithoutPriceRule,
} from "../lib/fieldRules";
import { type DraftProduct, productEntryState, productKeyIn } from "../lib/productKeys";
import {
  consequenceOf,
  findingClauses,
  REMOVAL_FINDINGS,
  removedState,
  useRemoval,
} from "../lib/removal";
import {
  findProduct,
  findProductByHandle,
  isPlaceholderHandle,
  issuesForProduct,
  productTitle,
  ratingLabel,
  removeOption,
  removeProduct,
  replaceProduct,
  type VariantCollision,
  variantCollisions,
  variantOptionLabel,
  variantPriceLabel,
  variantsChoosing,
} from "../lib/shop";
import {
  accentButtonClasses,
  destructiveOutlineButtonClasses,
  destructiveSubtleButtonClasses,
  fieldControlClasses,
  fieldLabelClasses,
  outlineButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
  textAreaClasses,
  validationMessageClasses,
} from "../lib/ui";
import { useRegisterUnsavedWork } from "../lib/unsavedWork";
import { useShopWorkspace } from "../shell/useShopWorkspace";
import { useDuplicateProduct } from "./useDuplicateProduct";

const AVAILABILITIES = optionsOf(VARIANT_AVAILABILITY);

const ATTRIBUTE_TYPES = optionsOf(ATTRIBUTE_TYPE);

const PRODUCT_STATUSES = optionsOf(PRODUCT_STATUS);

/** Why a value typed into the Handle field is not written: the lab would not store it. */
function handleRefusal(typed: string, kept: string): string {
  return `${typed} cannot be a handle: lowercase letters and digits joined by single hyphens, at most ${SLUG_MAX_LENGTH} characters. The product is still ${kept}.`;
}

/**
 * The product editor, mounted afresh for every product (ADR 0061).
 *
 * The address is the product's handle, which a rename or a discard moves; what the page is
 * *about* is the key the workspace gave the product, which neither does. A history entry the
 * workspace made carries that key in its state — the catalog's links, *New product*, and the
 * page's own `replace` — and names that product whatever handle the address spells. An entry
 * with no key this load minted — typed, bookmarked, or from before a reload — is resolved by
 * handle once and stamped before the page mounts, so nothing the operator does on the page can
 * race the stamp. Keyed by the product, the page never remounts while the operator stays on one
 * product, and a move to another one starts clean, as `CustomerEditorRoute` does for a profile.
 */
export function ProductEditorRoute() {
  const { handle = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { content, productKeyMinted } = useShopWorkspace();
  const stamped = productKeyIn(location.state);
  const key = stamped !== null && productKeyMinted(stamped) ? stamped : null;
  const resolved = key === null ? (findProductByHandle(content, handle)?.key ?? null) : null;

  useEffect(() => {
    if (resolved !== null) {
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: productEntryState(resolved, location.state),
      });
    }
  }, [resolved, navigate, location.pathname, location.search, location.hash, location.state]);

  if (key !== null) {
    return <ProductEditorPage key={key} productKey={key} />;
  }
  if (resolved !== null) {
    return null;
  }
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

function ProductEditorPage({ productKey }: { productKey: string }) {
  const { handle: addressed = "" } = useParams();
  const location = useLocation();
  const {
    shopId,
    content,
    preview,
    edit,
    save,
    saving,
    discard,
    discarding,
    dirty,
    error,
    productSaved,
  } = useShopWorkspace();
  const navigate = useNavigate();
  const product = findProduct(content, productKey);

  // The address follows the product, never the other way round (ADR 0061). A rename, or a
  // discard that undid one, leaves the address on a handle the product no longer has: it is
  // `replace`d, keeping one history entry per product rather than one per keystroke, and
  // stamped with the key so the route keeps naming this product. A product whose key has left
  // the draft — a discard took back one that was never saved — sends the page to the catalog;
  // the handle is never asked, because by then it may name another product.
  //
  // It runs on the handle and the address alone. The entry's state is read, not depended on —
  // each stamp makes a new one — and one handle is navigated to at most once until the address
  // has caught up with it, so the effect cannot re-fire on its own navigation.
  //
  // The header's Delete leaves by the same door: it takes the product out of the draft and
  // this effect, finding the key gone, goes to the catalog carrying what the Delete says there
  // (`deleted`). One way out, so a Delete and a discard can never send the page two places.
  const handle = product?.handle;
  const entryState = useRef(location.state);
  entryState.current = location.state;
  const requested = useRef<string | null>(null);
  const deleted = useRef<string | null>(null);
  useEffect(() => {
    if (handle === undefined) {
      navigate(`/shops/${shopId}/products`, {
        replace: true,
        state: deleted.current === null ? null : removedState(deleted.current, productKey),
      });
      return;
    }
    if (addressed === handle) {
      requested.current = null;
      return;
    }
    if (requested.current === handle) {
      return;
    }
    requested.current = handle;
    navigate(`/shops/${shopId}/products/${encodeURIComponent(handle)}`, {
      replace: true,
      state: productEntryState(productKey, entryState.current),
    });
  }, [addressed, handle, productKey, shopId, navigate]);

  /**
   * What is in the Handle field, while it differs from the handle the draft holds.
   *
   * Emptying the field is how the operator hands the handle back to the title, and it reports
   * the empty string on the way. A product cannot be addressed by nothing, so the draft is left
   * alone until there is a handle to write; the field shows what was typed and restores the
   * suggestion on blur, exactly as it does on every other surface.
   */
  const [typedHandle, setTypedHandle] = useState<string | null>(null);
  /**
   * The handle as it stood after the last title edit on this page, if it was then the title's;
   * `null` if it was not; `undefined` if no title has been edited here yet.
   *
   * The one thing about following that is not a fact of the product: a title that derives no
   * slug says nothing about the handle, so whether the handle follows *through* it is what it
   * was doing when the title was emptied — and only while the handle is still the one it was
   * then (ADR 0061).
   */
  const titled = useRef<string | null | undefined>(undefined);
  // A discard that lands puts back the handle the lab holds, so what was half-typed in the
  // Handle field, and what the last title edit made of the handle, are no longer about the
  // draft under it.
  const wasDiscarding = useRef(discarding);
  useEffect(() => {
    if (wasDiscarding.current && !discarding) {
      setTypedHandle(null);
      titled.current = undefined;
    }
    wasDiscarding.current = discarding;
  }, [discarding]);

  /**
   * A value the Handle field holds and the draft does not — refused as no handle, or taken —
   * is unsaved work like an open row's (ADR 0051): the header does not call the draft saved
   * over it and leaving asks (ADR 0061). An emptied field is not: it is how the handle is
   * handed back to the title, and leaving the field puts the suggestion back. Nor is anything
   * held for a product that has left the draft: there is no product for it to be the handle of,
   * and the page is on its way to the catalog.
   */
  const heldHandle =
    product !== undefined &&
    typedHandle !== null &&
    typedHandle !== "" &&
    typedHandle !== product.handle
      ? typedHandle
      : null;
  // The header's Delete is about this product and nothing else: scoped by its key, and dropped
  // when a discard lands, because what the confirm said was read off the draft the discard
  // threw away (ADR 0061, R4).
  const removal = useRemoval(productKey, discarding);
  const duplicate = useDuplicateProduct();

  useRegisterUnsavedWork(
    heldHandle === null
      ? null
      : {
          label: `The Handle field holds “${heldHandle}”, which the draft could not take; the product is still ${product?.handle ?? ""}.`,
          discard: () => setTypedHandle(null),
        },
  );

  if (!product) {
    return null;
  }

  /** The handles the *other* products hold, by key rather than by spelling. */
  const takenHandles = content.products
    .filter((entry) => entry.key !== productKey)
    .map((entry) => entry.handle);
  /**
   * What the handle would be if it followed `title`, never nothing.
   *
   * The field is bound to something that exists and is addressed by it, so a suggestion of ""
   * would rename the product to nothing the moment it was followed. An untitled product
   * therefore suggests the handle it already has, which is a no-op.
   */
  const suggestionFor = (title: string, current: DraftProduct) => {
    const derived = slugify(title, "");
    return uniqueSuggestion(derived === "" ? current.handle : derived, takenHandles);
  };
  const { value: suggestedHandle, takenBase: takenHandleBase } = suggestionFor(
    product.title,
    product,
  );

  function update(next: DraftProduct) {
    edit(replaceProduct(content, productKey, next));
  }

  /**
   * The header's Delete: this product out of the draft, by its key, and back to the catalog,
   * which says what was deleted (ADR 0062). The catalog is inside the shop draft's reach, so the
   * one unsaved-work guard has nothing to ask on the way (ADR 0051); an open row of this product
   * goes with the product, which is what the Delete was asked to do.
   */
  const deletedNotice = `Deleted “${productTitle(product)}” from the draft.`;
  function deleteProduct() {
    deleted.current = deletedNotice;
    edit(removeProduct(content, productKey));
  }

  /**
   * Whether the handle is the title's, before the keystroke that changes the title (ADR 0061).
   *
   * A title that derives a slug makes the handle the title's when the handle is what it
   * suggests. A title that derives none — empty, or punctuation alone — says nothing about the
   * handle, so the handle follows through it only if it was the title's when the title was
   * emptied on this page and has not been changed since (`titled`). A page opened on such a
   * title has no such memory, and falls back on the one fact there is: a product new to the
   * draft whose handle is still the placeholder *New product* gave it follows its first title;
   * any other handle — typed, or saved — stays.
   */
  function handleIsTitles(current: DraftProduct): boolean {
    if (slugify(current.title, "") !== "") {
      return current.handle === suggestedHandle;
    }
    if (titled.current !== undefined) {
      return current.handle === titled.current;
    }
    return !productSaved(current.key) && isPlaceholderHandle(current.handle);
  }

  /**
   * The one place the handle is derived (ADR 0061).
   *
   * The handle follows the title while it *is* the title's, or while the operator has emptied
   * the field to hand it back. That is a fact about the product rather than this page's
   * memory, so opening a product, a discard or a save's echo landing derives nothing: a
   * product whose handle is not its title's opens as it is, clean.
   */
  function retitle(title: string) {
    if (!product) {
      return;
    }
    const follows = typedHandle === "" || (typedHandle === null && handleIsTitles(product));
    if (!follows) {
      titled.current = null;
      update({ ...product, title });
      return;
    }
    const handle = suggestionFor(title, product).value;
    titled.current = handle;
    setTypedHandle(null);
    update({ ...product, title, handle });
  }

  return (
    <>
      <PageHeader
        // A product created from the catalog's *New product* arrives with no title — it is an
        // empty row of the draft, and naming it is the first thing this editor is for. An
        // empty `<h1>` would leave the page, and the tour's own first anchor, with nothing to
        // read, so the heading stands in until the Title row has an answer. The catalog's own
        // link uses the same stand-in, from the same place.
        title={productTitle(product)}
        chips={<VersionChips preview={preview} />}
        description={`Editing the shop draft · ${ratingLabel(product)}`}
        actions={
          <>
            {/* Frame 2c's pair, ahead of Save. The confirm stands under the header rather than
                in it, because a header has no row for it to take the place of (ADR 0060). No
                notice of its own: this page leaves, and the catalog says it. */}
            {removal.isArmed("product") ? null : (
              <button
                className={destructiveOutlineButtonClasses}
                type="button"
                ref={removal.trigger("product")}
                onClick={removal.ask("product", deleteProduct, null)}
              >
                <ButtonIcon verb="delete" />
                Delete
              </button>
            )}
            <button className={outlineButtonClasses} type="button" onClick={duplicate(productKey)}>
              Duplicate
            </button>
            <EditorSaveActions
              tone="accent"
              dirty={dirty || heldHandle !== null}
              saving={saving}
              discarding={discarding}
              onSave={() => void save()}
              onDiscard={() => void discard()}
            />
          </>
        }
      />

      {removal.isArmed("product") ? (
        <div className="mb-4">
          <ProductDeleteConfirm
            product={product}
            onConfirm={removal.confirm(deleteProduct, null)}
            onKeep={removal.keep}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-lab-error">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <Card title="Details">
            {/* Status and Category shared a `sm:grid-cols-2` here. The prototype gives each of
                the four its own full-width row, and the field pattern's own wrap already
                stacks a row where there is no room, so the half-width pair went with it. */}
            <FieldRows>
              <Field label="Title" hint={PRODUCT_TITLE_RULE}>
                <input
                  className={fieldControlClasses}
                  value={product.title}
                  onChange={(event) => retitle(event.target.value)}
                />
              </Field>
              {/*
               * The handle the tools address this product by, asked here because the catalog
               * no longer asks it: *New product* appends an empty row and opens this editor
               * (PLAN-UX Slice 12), so this is the one surface that can name it. It follows the
               * title only from the Title's own edit (`retitle`), so the field's own follow is
               * off, and the page's address follows the handle (ADR 0061).
               */}
              <DerivedIdField
                arrangement="row"
                label="Handle"
                hint={PRODUCT_HANDLE_RULE}
                value={typedHandle ?? product.handle}
                suggested={suggestedHandle}
                follows={false}
                refusal={
                  typedHandle !== null && typedHandle !== "" && !isSlug(typedHandle)
                    ? handleRefusal(typedHandle, product.handle)
                    : undefined
                }
                taken={takenHandles}
                takenBase={takenHandleBase}
                takenPlace="in the draft"
                pattern={KEBAB_PATTERN}
                title={PRODUCT_HANDLE_RULE}
                placeholder="alpine-shell-jacket"
                required
                onChange={(next) => {
                  // Only a *different*, free handle the lab would store is written: re-writing
                  // the same one would mark a clean draft dirty, a taken one would put two
                  // products under one address, and anything else — `#b`, `/b`, `..` — is an
                  // address the router reads as some other page (ADR 0061). The field keeps
                  // what was typed and refuses it on screen, and the page counts it as unsaved.
                  if (next === product.handle) {
                    setTypedHandle(null);
                    return;
                  }
                  if (isSlug(next) && !takenHandles.includes(next)) {
                    setTypedHandle(null);
                    update({ ...product, handle: next });
                    return;
                  }
                  setTypedHandle(next);
                }}
              />
              <Field label="Status" hint={PRODUCT_STATUS_RULE}>
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
              </Field>
              {/* Still no hint, and now the only row in this card without one.
                  `PRODUCT_CATEGORY_RULE`'s second sentence — "Pick one the draft already
                  uses" — promises a pick list, and this row renders none. It was true on the
                  create form, which rendered a `<datalist>` of the draft's categories; PLAN-UX
                  Slice 12 removed that form, so the promise is now unbacked everywhere rather
                  than on one surface of two. The anti-fragmentation rule *is* the useful thing
                  to say about a category, so any other sentence written here would satisfy the
                  sweep, silence this reminder, and still not tell the reader the one thing they
                  need. The datalist is behaviour and this row stays bare until it lands — see
                  `docs/decisions-and-next-step.md`, and PLAN-UX Slice 27. */}
              <Field label="Category">
                <input
                  className={fieldControlClasses}
                  value={product.category}
                  onChange={(event) => update({ ...product, category: event.target.value })}
                />
              </Field>
              <Field label="Description" hint={PRODUCT_DESCRIPTION_RULE}>
                <textarea
                  className={textAreaClasses}
                  value={product.description}
                  onChange={(event) => update({ ...product, description: event.target.value })}
                />
              </Field>
            </FieldRows>
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
  product: DraftProduct;
  onChange: (next: DraftProduct) => void;
}

interface PricedEditorProps extends EditorProps {
  /** The shop's sellable currencies; the first is the domain default. */
  currencies: Currency[];
}

/** Why an option is refused with no value: no variant could choose it. */
const OPTION_NEEDS_VALUE = "An option needs at least one value before a variant can choose it.";

/** Why a media entry is refused with no reference: the reference is what keys it. */
const MEDIA_NEEDS_REFERENCE = "A media entry needs a reference.";

/** Why a variant row is refused with no SKU: the SKU is what an order line names. */
const VARIANT_NEEDS_SKU = "A variant needs a SKU.";

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
  const openRefusalId = useId();
  const addRefusalId = useId();
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);
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
        {product.options.map((option) => {
          const choosing = variantsChoosing(product, option.key);
          const drop = () => onChange(removeOption(product, option.key));
          const notice = `Removed the option “${option.name}” from the draft.`;
          return removal.isArmed(option.key) ? (
            <ConfirmRemove
              key={option.key}
              as="li"
              title={`Remove the option “${option.name}”?`}
              consequence={consequenceOf(
                choosing === 0
                  ? "No variant chooses a value of it."
                  : choosing === 1
                    ? "One variant chooses a value of it and will lose it."
                    : `${choosing} variants choose a value of it and will lose it.`,
                collisionSentence(variantCollisions(product, option.key)),
                "Nothing is written until you save the draft, and an order keeps the frozen copy of its lines either way.",
              )}
              onConfirm={removal.confirm(drop, notice)}
              onKeep={removal.keep}
            />
          ) : (
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
                    {value.values.length === 0 ? (
                      <RefusalLine id={openRefusalId}>{OPTION_NEEDS_VALUE}</RefusalLine>
                    ) : null}
                  </>
                ),
                // An option with no value is one no variant can choose, which is what the add
                // form refuses too, in the same words.
                (value) =>
                  value.values.length > 0
                    ? true
                    : { id: openRefusalId, reason: OPTION_NEEDS_VALUE },
              )}
              actions={
                <button
                  className={destructiveSubtleButtonClasses}
                  type="button"
                  ref={removal.trigger(option.key)}
                  onClick={removal.ask(option.key, drop, notice)}
                >
                  <ButtonIcon verb="delete" />
                  Remove {option.name}
                </button>
              }
            />
          );
        })}
        {product.options.length === 0 ? (
          <li className="text-admin-muted">No options yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <RemovalNotice removal={removal} />
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
        <PrimaryAction
          variant="accent"
          className="justify-self-start"
          type="submit"
          refusal={values.length === 0 ? { id: addRefusalId, reason: OPTION_NEEDS_VALUE } : null}
        >
          <ButtonIcon verb="create" />
          Add option
        </PrimaryAction>
        {values.length === 0 ? (
          <RefusalLine id={addRefusalId}>{OPTION_NEEDS_VALUE}</RefusalLine>
        ) : null}
      </form>
    </Card>
  );
}

/**
 * A publish-gate error said under the cell that holds it, at the validation weight.
 *
 * Polite rather than an alert, because nothing has been refused: the lab stores the draft and
 * refuses it at publication, which is the reason `FieldHint` gives its warning tone for
 * announcing politely. The element stays mounted while it holds nothing — `sr-only` and empty
 * — for the reason `FieldHint`'s second line does: a live region that appears at the moment it
 * has something to say is one no reader is listening to yet. The sentence is the gate's
 * (`lib/fieldRules.ts`), so it matches the validation card word for word once the draft is
 * saved rather than saying the same finding twice in two voices.
 */
function GateFindingLine({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p
      id={id}
      aria-live="polite"
      className={children ? `${validationMessageClasses} mt-1 max-w-56` : "sr-only"}
    >
      {children}
    </p>
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
  const skuRefusalId = useId();
  const editNoticeId = useId();
  // The prefix of each row's two gate lines — the unpriced variant under its price, the empty
  // in-stock variant under its stock — which are per row, so the SKU completes the id.
  const rowFindingId = useId();
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);
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
  const skuRefusal =
    editor.open === null
      ? null
      : openSku === ""
        ? VARIANT_NEEDS_SKU
        : skuCollides
          ? alreadyTakenMessage(openSku, "in the draft")
          : skuMisshapen
            ? VARIANT_SKU_RENAME_RULE
            : null;

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
              const drop = () =>
                onChange({
                  ...product,
                  variants: product.variants.filter((entry) => entry.sku !== variant.sku),
                });
              if (removal.isArmed(variant.sku)) {
                return (
                  <ConfirmRemove
                    key={variant.sku}
                    as="tr"
                    columns={6}
                    title={`Remove the variant ${variant.sku}?`}
                    consequence={consequenceOf(
                      "It leaves the catalog with its price and its stock, and agents can no longer find it once the draft is published. An order line that names it keeps its frozen copy and reports a SKU the catalog no longer has.",
                      findingClauses([product.variants.length === 1 && "product_without_variant"]),
                      "Nothing is written until you save the draft.",
                    )}
                    onConfirm={removal.confirm(
                      drop,
                      `Removed the variant ${variant.sku} from the draft.`,
                    )}
                    onKeep={removal.keep}
                  />
                );
              }
              // The gate's two findings a row's own cells can raise, said on the row while it
              // holds them. Neither refuses a save — the lab stores both and
              // refuses them at publication — so they refuse no Save here either: they say it.
              const unpriced = variant.price === null;
              const emptyInStock =
                variant.availability === "in_stock" && variant.stock_quantity === 0;
              const unpricedId = `${rowFindingId}-price-${variant.sku}`;
              const emptyInStockId = `${rowFindingId}-stock-${variant.sku}`;
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
                        aria-describedby={unpriced ? `${priceRuleId} ${unpricedId}` : priceRuleId}
                        aria-invalid={unpriced || undefined}
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
                    <GateFindingLine id={unpricedId}>
                      {unpriced ? variantWithoutPriceRule(variant.sku) : null}
                    </GateFindingLine>
                  </td>
                  <td className={tableCellClasses}>
                    <label className="sr-only" htmlFor={`availability-${variant.sku}`}>
                      Availability for {variant.sku}
                    </label>
                    <select
                      id={`availability-${variant.sku}`}
                      className={`${fieldControlClasses} max-w-36`}
                      aria-describedby={emptyInStock ? emptyInStockId : undefined}
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
                      aria-describedby={emptyInStock ? emptyInStockId : undefined}
                      aria-invalid={emptyInStock || undefined}
                      value={variant.stock_quantity}
                      onChange={(event) =>
                        updateVariant(index, {
                          ...variant,
                          stock_quantity: Number(event.target.value),
                        })
                      }
                    />
                    <GateFindingLine id={emptyInStockId}>
                      {emptyInStock ? variantInStockWithoutInventoryRule(variant.sku) : null}
                    </GateFindingLine>
                  </td>
                  <td className={tableCellClasses}>
                    <span className="flex items-center gap-1.5">
                      <EntryEditButtons
                        label={variant.sku}
                        open={rowEdit !== null}
                        blockedBy={editor.blocked(variant.sku) ? editNoticeId : undefined}
                        saveRefusal={
                          skuRefusal === null ? undefined : { id: skuRefusalId, reason: skuRefusal }
                        }
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
                          ref={removal.trigger(variant.sku)}
                          onClick={removal.ask(
                            variant.sku,
                            drop,
                            `Removed the variant ${variant.sku} from the draft.`,
                          )}
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
                <td className={tableCellClasses} colSpan={6}>
                  {/* The gate's own sentence, whatever the product's status: the empty table
                      is the one place the finding has to stand, and the product's
                      validation card repeats it in the same words once the draft is saved. */}
                  <p className={validationMessageClasses}>
                    {productWithoutVariantRule(product.title)}
                  </p>
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
      {skuRefusal === null ? null : (
        <p id={skuRefusalId} role="alert" className={validationMessageClasses}>
          {skuRefusal}
        </p>
      )}
      <EntryEditNotice id={editNoticeId} label={editor.open?.label ?? null} />
      <RemovalNotice removal={removal} />

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
  collisionId,
}: {
  value: MediaFields;
  onChange: (next: MediaFields) => void;
  /** Why this reference cannot be saved, when another entry already holds it. */
  collision?: string;
  /** The collision line's `id`, where a refused Save is described by it. */
  collisionId?: string;
}) {
  return (
    <>
      <FieldHint
        label="Reference"
        hint={MEDIA_REFERENCE_RULE}
        extra={collision}
        extraTone={collision ? "error" : "muted"}
        extraId={collisionId}
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
  const openCollisionId = useId();
  const openEmptyId = useId();
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);

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
        {product.media.map((entry) => {
          const drop = () =>
            onChange({
              ...product,
              media: product.media.filter((item) => item.reference !== entry.reference),
            });
          return removal.isArmed(entry.reference) ? (
            <ConfirmRemove
              key={entry.reference}
              as="li"
              title={`Remove the media reference ${entry.reference}?`}
              consequence={consequenceOf(
                "The reference and its alt text leave the product; the file it points at is not this lab's and is not touched.",
                findingClauses([product.media.length === 1 && "product_without_media"]),
                "Nothing is written until you save the draft, and a published shop version keeps it.",
              )}
              onConfirm={removal.confirm(
                drop,
                `Removed the media reference ${entry.reference} from the draft.`,
              )}
              onKeep={removal.keep}
            />
          ) : (
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
                    <MediaFieldset
                      value={value}
                      onChange={change}
                      collision={openCollision}
                      collisionId={openCollisionId}
                    />
                    {value.reference === "" ? (
                      <RefusalLine id={openEmptyId} className="sm:col-span-2">
                        {MEDIA_NEEDS_REFERENCE}
                      </RefusalLine>
                    ) : null}
                  </div>
                ),
                // The collision is said once, on the field, and Save points at that line
                // rather than repeating it (*Two refusals with one cause are one sentence*).
                (value) =>
                  value.reference === ""
                    ? { id: openEmptyId, reason: MEDIA_NEEDS_REFERENCE }
                    : openCollision !== undefined
                      ? { id: openCollisionId, reason: openCollision }
                      : true,
              )}
              actions={
                <button
                  className={destructiveSubtleButtonClasses}
                  type="button"
                  ref={removal.trigger(entry.reference)}
                  onClick={removal.ask(
                    entry.reference,
                    drop,
                    `Removed the media reference ${entry.reference} from the draft.`,
                  )}
                >
                  <ButtonIcon verb="delete" />
                  Remove {entry.reference}
                </button>
              }
            >
              <p className="text-admin-muted">{entry.alt_text}</p>
            </EntryCard>
          );
        })}
        {product.media.length === 0 ? (
          <li className="text-admin-muted">No media reference yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <RemovalNotice removal={removal} />
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
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);
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
        {product.attributes.map((attribute) => {
          const drop = () =>
            onChange({
              ...product,
              attributes: product.attributes.filter((entry) => entry.key !== attribute.key),
            });
          return removal.isArmed(attribute.key) ? (
            <ConfirmRemove
              key={attribute.key}
              as="li"
              title={`Remove the attribute “${attribute.label}”?`}
              consequence="Agents can no longer discover it through the catalog tools once the draft is published. Nothing is written until you save the draft, and a published shop version keeps it."
              onConfirm={removal.confirm(
                drop,
                `Removed the attribute “${attribute.label}” from the draft.`,
              )}
              onKeep={removal.keep}
            />
          ) : (
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
                  ref={removal.trigger(attribute.key)}
                  onClick={removal.ask(
                    attribute.key,
                    drop,
                    `Removed the attribute “${attribute.label}” from the draft.`,
                  )}
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
          );
        })}
        {product.attributes.length === 0 ? (
          <li className="text-admin-muted">No custom attribute yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <RemovalNotice removal={removal} />
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
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);

  return (
    <Card title={`Ratings & reviews · ${ratingLabel(product)}`} label="Ratings and reviews">
      <ul className="grid gap-2 text-[13px]">
        {product.reviews.map((review) => {
          const drop = () =>
            onChange({
              ...product,
              reviews: product.reviews.filter((entry) => entry.id !== review.id),
            });
          return removal.isArmed(review.id) ? (
            <ConfirmRemove
              key={review.id}
              as="li"
              title={`Remove the review by ${review.author_display_name}?`}
              consequence="The rating summary is derived again without it. Nothing is written until you save the draft, and a published shop version keeps it."
              onConfirm={removal.confirm(
                drop,
                `Removed the review by ${review.author_display_name} from the draft.`,
              )}
              onKeep={removal.keep}
            />
          ) : (
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
                  ref={removal.trigger(review.id)}
                  onClick={removal.ask(
                    review.id,
                    drop,
                    `Removed the review by ${review.author_display_name} from the draft.`,
                  )}
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
          );
        })}
        {product.reviews.length === 0 ? (
          <li className="text-admin-muted">No synthetic review yet.</li>
        ) : null}
      </ul>
      <EntryEditNotice id={notice} label={editor.open?.label ?? null} />
      <RemovalNotice removal={removal} />
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

/**
 * What removing an option does to the variants it would leave identical, in the operator's
 * words — or nothing, where every variant still differs from every other. A group that is
 * identical already is said to be, with what it shares today, so the removal is blamed only for
 * what it adds: a new group, or a variant joining one the gate already refuses.
 */
function collisionSentence(groups: VariantCollision[]): string | null {
  const described = (list: { skus: string[]; values: string }[]) =>
    list.map((group) => `${namedList(group.skus)} (${group.values})`).join("; ");
  const sentences: string[] = [];
  const made = groups.filter((group) => group.before.length === 0);
  if (made.length > 0) {
    const count = made.reduce((total, group) => total + group.skus.length, 0);
    const across = made.length === 1 ? "" : ` in ${made.length} groups`;
    sentences.push(
      `${count} variants would become identical${across} — ${described(made)} — and ${REMOVAL_FINDINGS.duplicate_variant_options}.`,
    );
  }
  for (const group of groups) {
    const { before } = group;
    if (before.length === 0) {
      continue;
    }
    const covered = new Set(before.flatMap((part) => part.skus));
    const joining = group.skus.filter((sku) => !covered.has(sku));
    const already = `${described(before)} ${before.length === 1 ? "are" : "are each"} already identical, which the publish gate already refuses`;
    sentences.push(
      before.length === 1 && joining.length === 0
        ? `${already}; removing this option does not change that.`
        : before.length === 1
          ? `${already}, and removing this option makes ${namedList(joining)} identical to them too; ${sharing(group)}.`
          : `${already}, and removing this option makes ${joining.length === 0 ? "them" : `them and ${namedList(joining)}`} identical to one another; ${sharing(group)}.`,
    );
  }
  return sentences.length === 0 ? null : sentences.join(" ");
}

/** "A", "A and B", "A, B and C". */
function namedList(items: string[]): string {
  return items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What every variant of a merged group would share — or that none of them has a value. */
function sharing(group: VariantCollision): string {
  return group.values === "no option values"
    ? "none of them would have option values"
    : `${allOf(group.skus.length)} would share ${group.values}`;
}

/** "all three", "all 14": what every variant of a merged group would share. */
function allOf(count: number): string {
  const words = ["", "", "both", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return count === 2 ? "both" : count < words.length ? `all ${words[count]}` : `all ${count}`;
}
