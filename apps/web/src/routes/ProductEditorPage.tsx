import type {
  AttributeSchema,
  MediaReferenceSchema,
  OptionSchema,
  ProductViewSchema,
  ReviewSchema,
  VariantSchema,
} from "@agent-lab/contracts";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ButtonIcon } from "../components/ButtonIcon";
import { ChipList, ChipListField } from "../components/ChipListField";
import { ConfirmRemove, RemovalNotice } from "../components/ConfirmRemove";
import { DerivedIdField } from "../components/DerivedIdField";
import { Field, FieldGroup, FieldGroupHint, FieldHint, FieldRows } from "../components/FieldHint";
import { GateFindingLine } from "../components/GateFindingLine";
import {
  EditButton,
  FixedKeyField,
  ItemFormRow,
  ListItem,
  RemoveButton,
} from "../components/ItemList";
import { PrimaryAction } from "../components/PrimaryAction";
import { ProductDeleteConfirm } from "../components/ProductDeleteConfirm";
import {
  Card,
  EditorSaveActions,
  EntryEditButtons,
  EntryEditNotice,
  EntryKind,
  GateCard,
  IssueList,
  PageHeader,
  VersionChips,
} from "../components/WorkspaceChrome";
import type { Currency } from "../lib/currencies";
import { useEntryEdit } from "../lib/entryEdit";
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
  isVariantSku,
  KEBAB_PATTERN,
  LABEL_MAX_LENGTH,
  MEDIA_REFERENCE_RULE,
  MONEY_PATTERN,
  MONEY_RULE,
  OPTION_VALUES_RULE,
  PRODUCT_CATEGORY_RULE,
  PRODUCT_DESCRIPTION_RULE,
  PRODUCT_HANDLE_RULE,
  PRODUCT_STATUS_RULE,
  PRODUCT_TITLE_RULE,
  productWithoutVariantRule,
  REFERENCE_PATTERN,
  REVIEW_RATING_RULE,
  TEXT_MAX_LENGTH,
  VARIANT_SKU_RENAME_RULE,
  VARIANT_SKU_RULE,
  variantInStockWithoutInventoryRule,
  variantWithoutPriceRule,
} from "../lib/fieldRules";
import {
  formTitle,
  type ItemFormWords,
  refusedProps,
  useEditButtons,
  useFocusAfterCommit,
  useItemForm,
} from "../lib/itemForm";
import {
  type AttributeFields,
  attributeEntry,
  attributeFields,
  attributeRefusal,
  BLANK_ATTRIBUTE,
  BLANK_MEDIA,
  BLANK_OPTION,
  BLANK_REVIEW,
  KEY_TAKEN_PLACE,
  type MediaFields,
  mediaEntry,
  mediaFields,
  mediaRefusal,
  type OptionFields,
  optionEntry,
  optionFields,
  optionRefusal,
  type ReviewFields,
  reviewEntry,
  reviewFields,
  reviewRefusal,
} from "../lib/productEntries";
import { type DraftProduct, productEntryState, productKeyIn } from "../lib/productKeys";
import { pythonStrip } from "../lib/pythonText";
import {
  consequenceOf,
  findingClauses,
  REMOVAL_FINDINGS,
  removedState,
  useRemoval,
} from "../lib/removal";
import {
  draftCategories,
  findProduct,
  findProductByHandle,
  isPlaceholderHandle,
  issuesForProduct,
  productTitle,
  ratingLabel,
  removeOption,
  removeProduct,
  replaceProduct,
  SHOP_DRAFT_FREEZE_NOTE,
  type VariantCollision,
  variantCollisions,
  variantOptionLabel,
  variantPriceLabel,
  variantsChoosing,
} from "../lib/shop";
import {
  addFormClasses,
  destructiveOutlineButtonClasses,
  editorColumnsClasses,
  editorMainClasses,
  editorPanelClasses,
  fieldControlClasses,
  fieldLabelClasses,
  outlineButtonClasses,
  surfaceClasses,
  tableCellClasses,
  tableHeadClasses,
  textAreaClasses,
  validationMessageClasses,
} from "../lib/ui";
import { HELD_VALUE_REASON, useRegisterUnsavedWork } from "../lib/unsavedWork";
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
    checking,
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
  const categoryListId = useId();
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
          unsavable: HELD_VALUE_REASON,
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
   * one unsaved-work guard has nothing to ask on the way (ADR 0051); an open variant row or an
   * edit in one of its forms goes with the product, which is what the Delete was asked to do.
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
        back={{ to: "..", label: "Products", kind: "editing the draft" }}
        description={ratingLabel(product)}
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
        reasons={
          error ? (
            <p role="alert" className="text-[13px] text-lab-error">
              {error}
            </p>
          ) : null
        }
        sticky
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

      <div className={editorColumnsClasses}>
        <div className={editorMainClasses}>
          <Card title="Details">
            {/* Status and Category shared a `sm:grid-cols-2` here. The prototype gives each of
                the four its own full-width row, and the field pattern's own wrap already
                stacks a row where there is no room, so the half-width pair went with it. */}
            <FieldRows>
              <Field label="Title" hint={PRODUCT_TITLE_RULE}>
                <input
                  maxLength={LABEL_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
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
                maxLength={SLUG_MAX_LENGTH}
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
                  className={`${fieldControlClasses} w-full`}
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
              {/*
               * A datalist rather than a select: a catalog's first product has no category to
               * pick from and the second is often a new one, so the list suggests and never
               * refuses. What it offers is the spellings the draft's other products already use
               * (`draftCategories`), because correcting "jackets" into a second spelling of
               * "Jackets" is how one catalog ends up with two of everything.
               */}
              <Field label="Category" hint={PRODUCT_CATEGORY_RULE}>
                <input
                  maxLength={LABEL_MAX_LENGTH}
                  className={`${fieldControlClasses} w-full`}
                  list={categoryListId}
                  autoComplete="off"
                  value={product.category}
                  onChange={(event) => update({ ...product, category: event.target.value })}
                />
              </Field>
              <datalist id={categoryListId}>
                {draftCategories(content, productKey).map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
              <Field label="Description" hint={PRODUCT_DESCRIPTION_RULE}>
                <textarea
                  maxLength={TEXT_MAX_LENGTH}
                  className={`${textAreaClasses} w-full`}
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

        <div className={editorPanelClasses}>
          {/* The shop draft publishes, and this product's findings are what its gate raises
              about it (`issuesForProduct`). */}
          <GateCard title="Publish gate" busy={checking} dirty={dirty || heldHandle !== null}>
            <IssueList issues={issuesForProduct(preview?.issues ?? [], product.handle)} />
          </GateCard>
          <Card title="What publishing freezes">
            <p className="text-[13px] leading-relaxed text-admin-ink-soft">
              {SHOP_DRAFT_FREEZE_NOTE}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * A variant's two fields the open row corrects, and the builder that writes them. The product's
 * other four lists are edited in the form below them, and their fields and builders are
 * `lib/productEntries.ts` (ADR 0074).
 */
interface VariantFields {
  sku: string;
  optionValues: Record<string, string>;
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
    value: choiceStillOffered(options, entry.key, chosen) ?? entry.value,
  }));
  const declared = new Set(stored.map((entry) => entry.key));
  const gained = options
    .filter((option) => !declared.has(option.key))
    .map((option) => ({
      key: option.key,
      value: choiceStillOffered(options, option.key, chosen) ?? option.values[0],
    }));
  return [...carried, ...gained];
}

/**
 * The value typed for an option, while the option still offers it. A choice is typed against
 * the values on screen, and a *Discard changes* can take one away while the choice is held —
 * the open row and the add form both outlive a discard. A typed choice the option no longer
 * offers is dropped rather than written: the builder falls back to the value the variant
 * already holds, or to the option's first for a variant being added.
 *
 * This answers for the typed choice only. A variant whose *stored* value the option does not
 * offer — authored through the API, or left by an option value's one-press removal (ADR
 * 0060) — still writes that stored value, which the gate raises as
 * `variant_unknown_option_value`, while its select shows the option's first value.
 */
function choiceStillOffered(
  options: readonly OptionSchema[],
  key: string,
  chosen: Record<string, string>,
): string | undefined {
  const value = chosen[key];
  const option = options.find((entry) => entry.key === key);
  return value !== undefined && option?.values.includes(value) ? value : undefined;
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

/** Why a variant row is refused with no SKU: the SKU is what an order line names. */
const VARIANT_NEEDS_SKU = "A variant needs a SKU.";

/** An option's values, as the form enters them: one chip at a time, duplicates refused. */
function OptionValuesField({
  values,
  refusedBy,
  onChange,
}: {
  values: string[];
  refusedBy?: string;
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
      refusedBy={refusedBy}
      onChange={onChange}
    />
  );
}

/** Hands focus back to the Edit a finished edit was opened from, and empties the form. */
function cancelEdit(
  form: { editing: string | null; reset: () => void },
  focusAfterCommit: (target: () => HTMLElement | null | undefined) => void,
  editButtons: { get: (id: string) => HTMLButtonElement | undefined },
) {
  const editing = form.editing;
  form.reset();
  if (editing !== null) {
    focusAfterCommit(() => editButtons.get(editing));
  }
}

const OPTION_WORDS: ItemFormWords = { form: "Options", entry: "an option", record: "draft" };

/** The prototype's line for the options (`Workspace.dc.html` :956), which the gate enforces. */
const OPTIONS_HINT = "Every variant chooses one value of each option.";

const OPTION_KEY_HINT =
  "Lowercase with hyphens. Follows the option name until you edit it; empty it to follow again.";

const OPTION_KEY_FIXED_HINT = "Set when the option was added. A variant chooses by it.";

/**
 * The product's options, as items, and the one form that adds an option or edits the one
 * chosen (ADR 0074). The key is fixed while editing, because a variant chooses by it; an
 * option's removal still takes its variants' values with it (ADR 0060), the confirm in the
 * item's place as `Workspace.dc.html` :955–975 draws it in the option's.
 */
function OptionsCard({ product, onChange }: EditorProps) {
  const options = product.options;
  const ids = options.map((option) => option.key);
  const nameOf = (key: string) => options.find((option) => option.key === key)?.name ?? key;
  const form = useItemForm<OptionFields>({
    blank: BLANK_OPTION,
    ids,
    words: OPTION_WORDS,
    nameOf,
    formOf: (key) => optionFields(options.find((option) => option.key === key) as OptionSchema),
    typedOf: (fields) => fields.name,
  });
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const nameInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = optionRefusal(form.fields, ids, form.editing);
  // A blank form is refused and says why, but marks nothing until something is in it.
  const marked = form.dirty ? refusal : null;
  const suggested = uniqueSuggestion(slugify(form.fields.name, ""), ids);

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      // An edit that changed nothing writes nothing, so the draft stays as clean as it was.
      if (form.dirty) {
        onChange({
          ...product,
          options: options.map((option) =>
            option.key === editing ? optionEntry(editing, form.fields) : option,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      onChange({ ...product, options: [...options, optionEntry(form.fields.key, form.fields)] });
    }
    form.reset();
  }

  return (
    <Card title="Options">
      <FieldRows>
        <FieldGroup label="Declared" hint={OPTIONS_HINT}>
          <div className="grid gap-2">
            {options.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {options.map((option) => {
                  const choosing = variantsChoosing(product, option.key);
                  const drop = () => onChange(removeOption(product, option.key));
                  const notice = `Removed the option “${option.name}” from the draft.`;
                  if (removal.isArmed(option.key)) {
                    return (
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
                    );
                  }
                  return (
                    <ListItem
                      key={option.key}
                      name={option.name}
                      id={option.key}
                      // Frame 2c draws an option's values as pills, the same pills the form
                      // below enters them as.
                      detail={
                        <ChipList label={`Values of ${option.name}`} values={option.values} />
                      }
                      editing={form.editing === option.key}
                    >
                      <EditButton
                        name={option.name}
                        buttonRef={editButtons.ref(option.key)}
                        onEdit={() => {
                          form.begin(option.key, optionFields(option));
                          focusAfterCommit(() => nameInput.current);
                        }}
                      />
                      <RemoveButton
                        name={option.name}
                        entryKey={option.key}
                        removal={removal}
                        notice={notice}
                        onRemove={drop}
                      />
                    </ListItem>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-admin-muted">No options yet.</p>
            )}
            <RemovalNotice removal={removal} />
          </div>
        </FieldGroup>
        <ItemFormRow
          title={formTitle(form.editing, nameOf, OPTION_WORDS.entry)}
          hint="The name and values can change later; the key is fixed once the option is added."
          editing={form.editing !== null}
          addLabel="Add option"
          refusal={refusal}
          reasonId={reasonId}
          onSubmit={submit}
          onCancel={() => cancelEdit(form, focusAfterCommit, editButtons)}
        >
          <FieldHint label="Option name">
            <input
              maxLength={LABEL_MAX_LENGTH}
              ref={nameInput}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.name}
              {...refusedProps(marked, "name", reasonId)}
              onChange={(event) => form.update({ name: event.target.value })}
            />
          </FieldHint>
          {form.editing !== null ? (
            <FixedKeyField
              label="Option key"
              hint={OPTION_KEY_FIXED_HINT}
              value={form.fields.key}
            />
          ) : (
            <DerivedIdField
              label="Option key"
              hint={OPTION_KEY_HINT}
              value={form.fields.key}
              suggested={suggested.value}
              takenBase={suggested.takenBase}
              takenPlace={KEY_TAKEN_PLACE}
              monospace
              maxLength={SLUG_MAX_LENGTH}
              refusedBy={marked?.field === "key" ? reasonId : undefined}
              onChange={(key) => form.update({ key })}
            />
          )}
          <div className="col-span-full">
            <OptionValuesField
              key={form.session}
              values={form.fields.values}
              refusedBy={marked?.field === "values" ? reasonId : undefined}
              onChange={(values) => form.update({ values })}
            />
          </div>
        </ItemFormRow>
      </FieldRows>
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
  const editor = useEntryEdit(product.variants, {
    keyOf: (variant) => variant.sku,
    labelOf: (variant) => variant.sku,
    fieldsOf: variantFields,
  });
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const chosenValues = product.options.map(
    (option) => choiceStillOffered(product.options, option.key, optionValues) ?? option.values[0],
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
                          className={`${fieldControlClasses} w-full max-w-44`}
                          value={rowEdit.fields.sku}
                          pattern={REFERENCE_PATTERN}
                          maxLength={SLUG_MAX_LENGTH}
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
                                className={`${fieldControlClasses} w-full max-w-36`}
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
                        className={`${fieldControlClasses} w-full max-w-28`}
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
                    <GateFindingLine id={unpricedId} className="mt-1 max-w-56">
                      {unpriced ? variantWithoutPriceRule(variant.sku) : null}
                    </GateFindingLine>
                  </td>
                  <td className={tableCellClasses}>
                    <label className="sr-only" htmlFor={`availability-${variant.sku}`}>
                      Availability for {variant.sku}
                    </label>
                    <select
                      id={`availability-${variant.sku}`}
                      className={`${fieldControlClasses} w-full max-w-36`}
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
                      className={`${fieldControlClasses} w-full max-w-24`}
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
                    <GateFindingLine id={emptyInStockId} className="mt-1 max-w-56">
                      {emptyInStock ? variantInStockWithoutInventoryRule(variant.sku) : null}
                    </GateFindingLine>
                  </td>
                  <td className={tableCellClasses}>
                    <span className="flex items-center gap-[11px]">
                      <EntryEditButtons
                        label={variant.sku}
                        open={rowEdit !== null}
                        blockedBy={editor.blocked(variant.sku) ? editNoticeId : undefined}
                        saveRefusal={
                          skuRefusal === null ? undefined : { id: skuRefusalId, reason: skuRefusal }
                        }
                        onOpen={() => editor.begin(variant.sku)}
                        onSave={() => {
                          if (rowEdit) {
                            saveVariant(index, rowEdit.fields);
                          }
                          editor.close();
                        }}
                        onCancel={() => editor.close()}
                      />
                      {rowEdit ? null : (
                        <RemoveButton
                          name={variant.sku}
                          entryKey={variant.sku}
                          removal={removal}
                          notice={`Removed the variant ${variant.sku} from the draft.`}
                          onRemove={drop}
                        />
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

      <form className={`${addFormClasses} sm:grid-cols-2`} onSubmit={add}>
        {product.options.map((option) => (
          <div key={option.key} className={fieldLabelClasses}>
            {/* An explicit association keeps the accessible name free of the option text. */}
            <label htmlFor={`new-variant-${option.key}`}>{option.name}</label>
            <select
              id={`new-variant-${option.key}`}
              className={`${fieldControlClasses} w-full`}
              value={
                choiceStillOffered(product.options, option.key, optionValues) ?? option.values[0]
              }
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
            className={`${fieldControlClasses} w-full`}
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
              className={`${fieldControlClasses} w-full`}
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
          maxLength={SLUG_MAX_LENGTH}
          title={VARIANT_SKU_RULE}
          required
          normalize={(value) => value.toUpperCase()}
          onChange={setSku}
        />
        <PrimaryAction variant="accent" className="self-end justify-self-start" type="submit">
          <ButtonIcon verb="create" />
          Add variant
        </PrimaryAction>
      </form>
    </Card>
  );
}

const MEDIA_WORDS: ItemFormWords = {
  form: "Media references",
  entry: "a media reference",
  record: "draft",
};

/**
 * The product's media references, as items, and the one form that adds one or edits the one
 * chosen (ADR 0074). A reference is its own key, which nothing else names, so it stays asked
 * while editing; one another entry holds is refused after the buttons, with the field marked,
 * because two entries sharing it are one key in the draft's change summary.
 */
function MediaCard({ product, onChange }: EditorProps) {
  const media = product.media;
  const ids = media.map((entry) => entry.reference);
  const nameOf = (reference: string) => reference;
  const form = useItemForm<MediaFields>({
    blank: BLANK_MEDIA,
    ids,
    words: MEDIA_WORDS,
    nameOf,
    formOf: (reference) =>
      mediaFields(media.find((entry) => entry.reference === reference) as MediaReferenceSchema),
    typedOf: (fields) => fields.reference,
  });
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const referenceInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = mediaRefusal(form.fields, ids, form.editing);
  const marked = form.dirty ? refusal : null;

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    const entry = mediaEntry(form.fields);
    if (editing !== null) {
      if (form.dirty) {
        onChange({
          ...product,
          media: media.map((item) => (item.reference === editing ? entry : item)),
        });
      }
      // The reference is the entry's key, so the Edit to hand focus back to is the one the
      // entry is under now.
      focusAfterCommit(() => editButtons.get(form.dirty ? entry.reference : editing));
    } else {
      onChange({ ...product, media: [...media, entry] });
    }
    form.reset();
  }

  return (
    <Card
      title="Media references"
      description="URL or path metadata only — managed binary upload is deferred."
    >
      <FieldRows>
        <FieldGroup label="References">
          <div className="grid gap-2">
            {media.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {media.map((entry) => {
                  const drop = () =>
                    onChange({
                      ...product,
                      media: media.filter((item) => item.reference !== entry.reference),
                    });
                  const notice = `Removed the media reference ${entry.reference} from the draft.`;
                  if (removal.isArmed(entry.reference)) {
                    return (
                      <ConfirmRemove
                        key={entry.reference}
                        as="li"
                        title={`Remove the media reference ${entry.reference}?`}
                        consequence={consequenceOf(
                          "The reference and its alt text leave the product; the file it points at is not this lab's and is not touched.",
                          findingClauses([media.length === 1 && "product_without_media"]),
                          "Nothing is written until you save the draft, and a published shop version keeps it.",
                        )}
                        onConfirm={removal.confirm(drop, notice)}
                        onKeep={removal.keep}
                      />
                    );
                  }
                  return (
                    <ListItem
                      key={entry.reference}
                      name={entry.reference}
                      monospace
                      detail={entry.alt_text}
                      editing={form.editing === entry.reference}
                    >
                      <EditButton
                        name={entry.reference}
                        buttonRef={editButtons.ref(entry.reference)}
                        onEdit={() => {
                          form.begin(entry.reference, mediaFields(entry));
                          focusAfterCommit(() => referenceInput.current);
                        }}
                      />
                      <RemoveButton
                        name={entry.reference}
                        entryKey={entry.reference}
                        removal={removal}
                        notice={notice}
                        onRemove={drop}
                      />
                    </ListItem>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-admin-muted">No media reference yet.</p>
            )}
            <RemovalNotice removal={removal} />
          </div>
        </FieldGroup>
        <ItemFormRow
          title={formTitle(form.editing, nameOf, MEDIA_WORDS.entry)}
          editing={form.editing !== null}
          addLabel="Add media"
          refusal={refusal}
          reasonId={reasonId}
          onSubmit={submit}
          onCancel={() => cancelEdit(form, focusAfterCommit, editButtons)}
        >
          <FieldHint label="Reference" hint={MEDIA_REFERENCE_RULE}>
            <input
              maxLength={TEXT_MAX_LENGTH}
              ref={referenceInput}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.reference}
              placeholder="media/alpine-shell.jpg"
              {...refusedProps(marked, "reference", reasonId)}
              onChange={(event) => form.update({ reference: event.target.value })}
            />
          </FieldHint>
          <FieldHint label="Alt text">
            <input
              maxLength={LABEL_MAX_LENGTH}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.altText}
              {...refusedProps(marked, "altText", reasonId)}
              onChange={(event) => form.update({ altText: event.target.value })}
            />
          </FieldHint>
        </ItemFormRow>
      </FieldRows>
    </Card>
  );
}

const ATTRIBUTE_WORDS: ItemFormWords = {
  form: "Custom attributes",
  entry: "an attribute",
  record: "draft",
};

const ATTRIBUTE_KEY_HINT =
  "Lowercase with hyphens. Follows the label until you edit it; empty it to follow again.";

const ATTRIBUTE_KEY_FIXED_HINT =
  "Set when the attribute was added. Agents read it through the catalog tools.";

/** The stored value, its unit, and "one of" the choices it is constrained to. */
function AttributeDetail({ attribute }: { attribute: AttributeSchema }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        {attribute.value}
        {attribute.unit ? ` ${attribute.unit}` : ""}
      </span>
      {attribute.choices.length > 0 ? (
        <>
          {/* "one of" is the rule the lab applies — `shop.py` refuses a choice attribute whose
              value is not among them — so it stays a word, and the choices beside it are the
              chips frame 2c draws. */}
          <span>one of</span>
          <ChipList label={`Choices for ${attribute.label}`} values={attribute.choices} />
        </>
      ) : null}
    </span>
  );
}

/**
 * The product's typed attributes, as items, and the one form that adds one or edits the one
 * chosen (ADR 0074). The key is derived while adding and fixed while editing; the type decides
 * what the value, the unit and the choices ask, and the form is one unit through a discard: a
 * clean one follows the entry whole, a dirty one keeps all of what it holds.
 */
function AttributesCard({ product, onChange }: EditorProps) {
  const attributes = product.attributes;
  const ids = attributes.map((attribute) => attribute.key);
  const nameOf = (key: string) =>
    attributes.find((attribute) => attribute.key === key)?.label ?? key;
  const form = useItemForm<AttributeFields>({
    blank: BLANK_ATTRIBUTE,
    ids,
    words: ATTRIBUTE_WORDS,
    nameOf,
    formOf: (key) =>
      attributeFields(attributes.find((attribute) => attribute.key === key) as AttributeSchema),
    typedOf: (fields) => fields.label,
  });
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const labelInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = attributeRefusal(form.fields, ids, form.editing);
  const marked = form.dirty ? refusal : null;
  const suggested = uniqueSuggestion(slugify(form.fields.label, ""), ids);
  const type = form.fields.attributeType;

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      if (form.dirty) {
        onChange({
          ...product,
          attributes: attributes.map((attribute) =>
            attribute.key === editing ? attributeEntry(editing, form.fields) : attribute,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      onChange({
        ...product,
        attributes: [...attributes, attributeEntry(form.fields.key, form.fields)],
      });
    }
    form.reset();
  }

  return (
    <Card
      title="Custom attributes (typed)"
      description="Discoverable by agents through catalog tools — never free-form JSON."
    >
      <FieldRows>
        <FieldGroup label="Attributes">
          <div className="grid gap-2">
            {attributes.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {attributes.map((attribute) => {
                  const drop = () =>
                    onChange({
                      ...product,
                      attributes: attributes.filter((entry) => entry.key !== attribute.key),
                    });
                  const notice = `Removed the attribute “${attribute.label}” from the draft.`;
                  if (removal.isArmed(attribute.key)) {
                    return (
                      <ConfirmRemove
                        key={attribute.key}
                        as="li"
                        title={`Remove the attribute “${attribute.label}”?`}
                        consequence="Agents can no longer discover it through the catalog tools once the draft is published. Nothing is written until you save the draft, and a published shop version keeps it."
                        onConfirm={removal.confirm(drop, notice)}
                        onKeep={removal.keep}
                      />
                    );
                  }
                  return (
                    <ListItem
                      key={attribute.key}
                      name={attribute.label}
                      id={attribute.key}
                      tag={<EntryKind value={labelOf(ATTRIBUTE_TYPE, attribute.attribute_type)} />}
                      detail={<AttributeDetail attribute={attribute} />}
                      editing={form.editing === attribute.key}
                    >
                      <EditButton
                        name={attribute.label}
                        buttonRef={editButtons.ref(attribute.key)}
                        onEdit={() => {
                          form.begin(attribute.key, attributeFields(attribute));
                          focusAfterCommit(() => labelInput.current);
                        }}
                      />
                      <RemoveButton
                        name={attribute.label}
                        entryKey={attribute.key}
                        removal={removal}
                        notice={notice}
                        onRemove={drop}
                      />
                    </ListItem>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-admin-muted">No custom attribute yet.</p>
            )}
            <RemovalNotice removal={removal} />
          </div>
        </FieldGroup>
        <ItemFormRow
          title={formTitle(form.editing, nameOf, ATTRIBUTE_WORDS.entry)}
          hint="The type decides what the value may be, and whether a unit or choices come with it. The key is fixed once the attribute is added."
          editing={form.editing !== null}
          addLabel="Add attribute"
          refusal={refusal}
          reasonId={reasonId}
          onSubmit={submit}
          onCancel={() => cancelEdit(form, focusAfterCommit, editButtons)}
        >
          <FieldHint label="Label">
            <input
              maxLength={LABEL_MAX_LENGTH}
              ref={labelInput}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.label}
              {...refusedProps(marked, "label", reasonId)}
              onChange={(event) => form.update({ label: event.target.value })}
            />
          </FieldHint>
          {form.editing !== null ? (
            <FixedKeyField label="Key" hint={ATTRIBUTE_KEY_FIXED_HINT} value={form.fields.key} />
          ) : (
            <DerivedIdField
              label="Key"
              hint={ATTRIBUTE_KEY_HINT}
              value={form.fields.key}
              suggested={suggested.value}
              takenBase={suggested.takenBase}
              takenPlace={KEY_TAKEN_PLACE}
              monospace
              maxLength={SLUG_MAX_LENGTH}
              refusedBy={marked?.field === "key" ? reasonId : undefined}
              onChange={(key) => form.update({ key })}
            />
          )}
          <FieldHint label="Type">
            <select
              className={`${fieldControlClasses} w-full`}
              value={type}
              onChange={(event) =>
                form.update({
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
          </FieldHint>
          <FieldHint label="Value">
            <input
              maxLength={LABEL_MAX_LENGTH}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.value}
              {...refusedProps(marked, "value", reasonId)}
              onChange={(event) => form.update({ value: event.target.value })}
            />
          </FieldHint>
          {type === "measurement" ? (
            <FieldHint label="Unit">
              <input
                maxLength={LABEL_MAX_LENGTH}
                className={`${fieldControlClasses} w-full`}
                value={form.fields.unit}
                {...refusedProps(marked, "unit", reasonId)}
                onChange={(event) => form.update({ unit: event.target.value })}
              />
            </FieldHint>
          ) : null}
          {type === "choice" ? (
            <div className="col-span-full">
              <ChipListField
                key={form.session}
                legend="Choices"
                label="New choice"
                hint={ATTRIBUTE_CHOICES_RULE}
                maxLength={CHIP_LABEL_MAX_LENGTH}
                addLabel="Add choice"
                placeholder="Regular"
                empty="No choice yet; a choice attribute needs at least one."
                values={form.fields.choices}
                takenPlace="a choice of this attribute"
                refusedBy={marked?.field === "choices" ? reasonId : undefined}
                onChange={(choices) => form.update({ choices })}
              />
            </div>
          ) : null}
        </ItemFormRow>
      </FieldRows>
    </Card>
  );
}

const REVIEW_WORDS: ItemFormWords = {
  form: "Ratings and reviews",
  entry: "a review",
  record: "draft",
};

/**
 * The product's synthetic reviews, as items, and the one form that adds a review or edits the
 * one chosen (ADR 0074). A review is named by its ID on its controls — "Edit review one" — as
 * it was on its row, and reads as "{rating}★" with "“{body}” — {author}" under it.
 */
function ReviewsCard({ product, onChange }: EditorProps) {
  const reviews = product.reviews;
  const ids = reviews.map((review) => review.id);
  const nameOf = (id: string) => `review ${id}`;
  const form = useItemForm<ReviewFields>({
    blank: BLANK_REVIEW,
    ids,
    words: REVIEW_WORDS,
    nameOf,
    formOf: (id) => reviewFields(reviews.find((review) => review.id === id) as ReviewSchema),
    typedOf: (fields) => fields.body,
  });
  // Scoped by the product's key (ADR 0061), which a rename does not move: it is the same
  // product. A discard that lands still drops what was armed, because what the confirm states
  // was read off the draft the discard threw away.
  const { discarding } = useShopWorkspace();
  const removal = useRemoval(product.key, discarding);
  const editButtons = useEditButtons();
  const focusAfterCommit = useFocusAfterCommit();
  const authorInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const refusal = reviewRefusal(form.fields);
  const marked = form.dirty ? refusal : null;

  function submit() {
    if (refusal !== null) {
      return;
    }
    const editing = form.editing;
    if (editing !== null) {
      if (form.dirty) {
        onChange({
          ...product,
          reviews: reviews.map((review) =>
            review.id === editing ? reviewEntry(editing, form.fields) : review,
          ),
        });
      }
      focusAfterCommit(() => editButtons.get(editing));
    } else {
      const id = uniqueId(slugify(pythonStrip(form.fields.author), "review"), ids);
      onChange({ ...product, reviews: [...reviews, reviewEntry(id, form.fields)] });
    }
    form.reset();
  }

  return (
    <Card
      title={`Ratings & reviews · ${ratingLabel(product)}`}
      label="Ratings and reviews"
      description="The rating summary is derived from these reviews; it is never authored directly."
    >
      <FieldRows>
        <FieldGroup label="Reviews">
          <div className="grid gap-2">
            {reviews.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {reviews.map((review) => {
                  const drop = () =>
                    onChange({
                      ...product,
                      reviews: reviews.filter((entry) => entry.id !== review.id),
                    });
                  const notice = `Removed the review by ${review.author_display_name} from the draft.`;
                  if (removal.isArmed(review.id)) {
                    return (
                      <ConfirmRemove
                        key={review.id}
                        as="li"
                        title={`Remove the review by ${review.author_display_name}?`}
                        consequence="The rating summary is derived again without it. Nothing is written until you save the draft, and a published shop version keeps it."
                        onConfirm={removal.confirm(drop, notice)}
                        onKeep={removal.keep}
                      />
                    );
                  }
                  return (
                    <ListItem
                      key={review.id}
                      name={`${review.rating}★`}
                      id={review.id}
                      detail={`“${review.body}” — ${review.author_display_name}`}
                      editing={form.editing === review.id}
                    >
                      <EditButton
                        name={nameOf(review.id)}
                        buttonRef={editButtons.ref(review.id)}
                        onEdit={() => {
                          form.begin(review.id, reviewFields(review));
                          focusAfterCommit(() => authorInput.current);
                        }}
                      />
                      <RemoveButton
                        name={nameOf(review.id)}
                        entryKey={review.id}
                        removal={removal}
                        notice={notice}
                        onRemove={drop}
                      />
                    </ListItem>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-admin-muted">No synthetic review yet.</p>
            )}
            <RemovalNotice removal={removal} />
          </div>
        </FieldGroup>
        <ItemFormRow
          title={formTitle(form.editing, nameOf, REVIEW_WORDS.entry)}
          editing={form.editing !== null}
          addLabel="Add review"
          refusal={refusal}
          reasonId={reasonId}
          onSubmit={submit}
          onCancel={() => cancelEdit(form, focusAfterCommit, editButtons)}
        >
          <FieldHint label="Author">
            <input
              maxLength={LABEL_MAX_LENGTH}
              ref={authorInput}
              className={`${fieldControlClasses} w-full`}
              value={form.fields.author}
              {...refusedProps(marked, "author", reasonId)}
              onChange={(event) => form.update({ author: event.target.value })}
            />
          </FieldHint>
          <StarRatingField
            value={form.fields.rating}
            onChange={(rating) => form.update({ rating })}
          />
          <div className="col-span-full">
            <FieldHint label="Body">
              <input
                maxLength={TEXT_MAX_LENGTH}
                className={`${fieldControlClasses} w-full`}
                value={form.fields.body}
                {...refusedProps(marked, "body", reasonId)}
                onChange={(event) => form.update({ body: event.target.value })}
              />
            </FieldHint>
          </div>
        </ItemFormRow>
      </FieldRows>
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
