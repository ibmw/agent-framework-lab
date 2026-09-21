/**
 * Format rules that a create-form hint and its matching `title=` both carry.
 *
 * `title=` may feed the browser's native validity message; the hint is the readable
 * carrier. One constant per rule so the two cannot drift.
 */

/** Lowercase kebab-case, as shop slugs and product handles are stored. */
export const KEBAB_PATTERN = "[a-z0-9]+(-[a-z0-9]+)*";

export const SHOP_SLUG_RULE =
  "Lowercase with hyphens. Follows the name until you edit it; empty it to follow the name again.";

export const PRODUCT_HANDLE_RULE =
  "Lowercase with hyphens. Tools address the product by this handle. Follows the title until you edit it; empty it to follow the title again.";

/** Shop-detail and product-editor entry IDs that follow a name, title or question. */
export const DERIVED_KEBAB_RULE =
  "Lowercase with hyphens. Follows the field above until you edit it; empty it to follow again.";

/** Uppercase alphanumeric kebab-case, as order and ticket references are stored. */
export const REFERENCE_PATTERN = "[A-Z0-9]+(-[A-Z0-9]+)*";

export const ORDER_REFERENCE_RULE =
  "Uppercase letters, digits, and hyphens. How the order is named in tickets. Prefills the next free reference; empty it to take that suggestion again.";

export const TICKET_REFERENCE_RULE =
  "Uppercase letters, digits, and hyphens. How the ticket is named in scenarios. Prefills the next free reference; empty it to take that suggestion again.";

export const VARIANT_SKU_RULE =
  "Uppercase letters, digits, and hyphens. Follows the handle and chosen options until you edit it; empty it to follow again.";

/**
 * What moving a *saved* entry's key means, for the two entries whose key is one of their own
 * fields rather than a derived ID beside them.
 *
 * `diff_keyed_collection` in `domain/definitions.py` keys a variant on its SKU and a media
 * entry on its reference, so an edit that moves either is reported as a removal and an
 * addition rather than as an update — which is the one place an edit in place cannot promise
 * "one updated field", and so is the one place it says so. Every other entry on these pages
 * has an ID of its own, and edit mode hands it back untouched.
 */
export const VARIANT_SKU_RENAME_RULE =
  "Uppercase letters, digits, and hyphens. Orders and tools name this variant by its SKU: changing it reads as a removal and an addition against the published version, and orders already placed keep their frozen copy.";

/** Whether a typed SKU is one the contract's `^[A-Z0-9]+(-[A-Z0-9]+)*$` would carry. */
export function isVariantSku(value: string): boolean {
  return new RegExp(`^${REFERENCE_PATTERN}$`).test(value);
}

export const MEDIA_REFERENCE_RULE =
  "A URL or path, like media/alpine-shell.jpg. It is what keys this entry: changing it reads as a removal and an addition against the published version.";

export function alreadyTakenMessage(id: string, place: string): string {
  return `${id} is already ${place}.`;
}

/**
 * What ticking a currency decides. Both clauses are the lab's own: `ShopPayload.validate` in
 * `domain/shop.py` refuses a variant priced outside `identity.currencies`, and
 * `ShopIdentity.default_currency` is the first of them.
 */
export const CURRENCIES_RULE = "Variants may only be priced in these; the first is the default.";

export const LOCALE_RULE = "Pick a locale from the list, or type another shaped like en or en-GB.";

/** What publishing does with the identity a configuration names. */
export const SUPPORT_IDENTITY_PIN_RULE =
  "Publishing pins the support-identity version a configuration names.";

/**
 * Where a country code is asked for. The shape is the lab's — `require_country_code` in
 * `domain/content.py` takes two letters and deliberately does not check the register — so the
 * rule says what is accepted and the field suggests the register beside it.
 */
export const COUNTRY_RULE =
  "Pick a country from the list, or type another two-letter code like FR.";

/**
 * What the contract's `MoneySchema.amount` accepts: up to ten digits, and at most two after
 * the point. Both the pattern and this sentence are that rule, so a price and a shipping fee
 * are refused in the same words wherever they are typed.
 */
export const MONEY_PATTERN = "\\d{1,10}(\\.\\d{1,2})?";

export const MONEY_RULE = "An exact amount with at most two decimals, like 249.00.";

/** Whether a typed amount is one `MoneySchema` would carry. */
export function isMoneyAmount(value: string): boolean {
  return new RegExp(`^${MONEY_PATTERN}$`).test(value);
}

/**
 * What the contract's temperature accepts (`^\d(?:\.\d{1,2})?$`) inside the range
 * `agent_configuration.py` and `judge.py` both enforce (`0 <= t <= MAX_TEMPERATURE`, which is
 * 2). The pattern cannot say the upper bound on its own — it would take `9` — so the hint
 * carries the range and the domain stays the authority.
 */
export const TEMPERATURE_PATTERN = "\\d(\\.\\d{1,2})?";

export const TEMPERATURE_RULE =
  "Between 0 and 2, with at most two decimals. An exact decimal, never a binary float: it is part of what a published version is fingerprinted on.";

/** The bound the contract puts on a seed: a whole number inside one unsigned 32-bit word. */
export const MAX_SEED = 2 ** 32 - 1;

export const SEED_RULE = `A whole number between 0 and ${MAX_SEED}. The same seed over the same starting state replays the same run.`;

/** The five lists that enter their values one at a time; each is `_require_unique` in the domain. */
export const OPTION_VALUES_RULE =
  "One value per chip. Every variant chooses one of these, and each must be different.";

export const ATTRIBUTE_CHOICES_RULE =
  "One choice per chip, each different. The attribute's value must be one of them.";

export const PERSONA_TRAITS_RULE =
  "One short trait per chip, each different, written as a reader should see it.";

/**
 * What the lab stores a tag as: `_require_slug` in `domain/ticket.py`.
 *
 * The sentence names the *shape* and leaves the respelling to the live "Saved as" line beside
 * it, which is the paired-line convention doing its job. Describing the transformation in
 * words would take three clauses to be true — `slugify` folds an accent to its base letter
 * rather than to a hyphen, collapses an inner run to one hyphen rather than one each, and
 * drops edge runs entirely — and a hint that gets any of them slightly wrong is the defect
 * this slice exists to remove.
 */
export const TICKET_TAGS_RULE =
  "One tag per chip, each different. Saved as lowercase letters, digits and hyphens, like refund-urgent.";

export const ESCALATION_CONDITIONS_RULE =
  "One condition per chip, each different. Naming any needs an escalation target above.";

/** What `ReviewSchema.rating` carries: a whole number of stars between one and five. */
export const REVIEW_RATING_RULE = "A whole number of stars, from one to five.";

/**
 * What the contract caps one entry of a chip list at, so the field stops where the save would.
 *
 * A ticket tag is a slug (`openapi.yaml` `TicketPayloadSchema.tags`, 64); an option value, an
 * attribute choice, a persona trait and an escalation condition are labels (200). The two
 * numbers are the contract's, not a house style, and they are here beside the patterns for the
 * reason those are: one spelling, so a field and the gate behind it cannot disagree.
 */
export const CHIP_LABEL_MAX_LENGTH = 200;

export const TICKET_TAG_MAX_LENGTH = 64;

/**
 * What a framework's or a judge provider's proven set means for the two model fields.
 *
 * Both gates are in the lab's code and they are not the same severity, so neither sentence
 * may claim the other's: `capability_issues` in `agent_capabilities.py` and
 * `judge_capability_issues` in `judge_capabilities.py` raise `provider_not_proven` as an
 * **error** — nothing in the lab could execute it — and an unlisted model only as a
 * **warning**, because the lab does not publish a framework for every model of a provider it
 * supports. So the provider is a select that refuses and the model is a datalist that
 * suggests, on `CountryField`'s reasoning: a dropdown there would refuse in the browser what
 * the API would take.
 */
export const PROVEN_PROVIDER_RULE =
  "Only the providers this has been proven against; publishing refuses any other.";

export const PROVEN_MODEL_RULE =
  "Pick a proven model, or type another: publishing warns rather than refuses.";

/**
 * The publish gate's own sentences, reproduced here character for character.
 *
 * Each is one `issue_*` message in the lab's own code, and the path to that code is named
 * beside it so a reviewer changing either side can find the other. There is no trailing full
 * stop, because the gate's messages carry none and `IssueList` prints them as they arrive —
 * a field that added one would be a second wording of the same rule, which is exactly what
 * `docs/design-direction.md`'s one-copy rule is written against.
 *
 * Written here rather than read off `preview.issues` because the preview endpoint previews the
 * **saved** draft: `GET /draft/preview` takes no payload, so a refetch after a keystroke would
 * answer for the model that was last saved and report the wrong value in the field that is
 * being typed. Reading the gate live would need a preview that accepts a draft payload, which
 * is a contract change this slice is not authorised to make.
 *
 * Both sides are pinned: `test_agent_capabilities.py` and `test_judge_configurations.py` assert
 * the exact Python messages, and `fieldRules.test.ts` asserts the exact sentences here.
 */

/** `model_not_exercised` / `judge_model_not_exercised`, which are worded identically. */
export function unexercisedModelRule(modelId: string, proven: string, models: string[]): string {
  return `${modelId} is not a model the lab exercises; ${proven} is proven on ${models.join(", ")}`;
}

/** `provider_not_proven` in `agent_capabilities.py` — an error, not a warning. */
export function unprovenAgentProviderRule(provider: string, frameworkLabel: string): string {
  return `${frameworkLabel} has not been proven against the ${provider} provider`;
}

/**
 * `judge_provider_not_proven` in `judge_capabilities.py`.
 *
 * Deliberately not the agent's sentence: the judge gate names no framework, because a judge
 * has none, and a shared wording would put a subject in the sentence that does not exist.
 */
export function unprovenJudgeProviderRule(provider: string): string {
  return `${provider} is not a provider the lab has proven it can judge with`;
}

/** What a tone-of-voice override names, and where the names come from. */
export const TONE_OVERRIDE_RULE =
  "The ID of a guideline the target shop publishes. The list is the preview shop's own.";

/** What the category field groups, with the draft's existing categories offered beside it. */
export const PRODUCT_CATEGORY_RULE =
  "Groups the product in the catalog, for example Jackets. Pick one the draft already uses, or type a new one.";

/*
 * ---------------------------------------------------------------------------------------
 * The editor rows' own rules (UI-8).
 *
 * Everything below is read against the surface it is shown on rather than taken from the
 * handoff: `tmp/design-frames/Workspace.dc.html` writes a hint for each of its 107 rows, and
 * several of them describe a lab that is not this one — its product Status row promises that
 * a draft product is "never returned to an agent", and its Shop details Slug row says the
 * slug is "set once, at creation". Neither is true here, so neither sentence is repeated.
 *
 * Each rule names the code that makes it true, because that is the only way a sentence with
 * no pixel to measure it against can be reviewed at all.
 * ---------------------------------------------------------------------------------------
 */

/**
 * The five sentences the create forms used to spell inline.
 *
 * Six literals, five rules: the given-name and family-name hints were already the same
 * sentence written twice, which is the drift this module exists to prevent, one step before
 * it happens. Each is now read by its create form and by the editor row for the same field.
 */

/** Product title. It is the catalog's own column and what `search_products` matches on. */
export const PRODUCT_TITLE_RULE = "The name customers and the catalog see.";

/** Shop name. A published version freezes the whole identity, this included. */
export const SHOP_NAME_RULE =
  "The shop's public name. Publishing freezes it with the rest of the shop.";

/**
 * Given and family name, on the create form and in the editor.
 *
 * `CustomerIdentity.display_name` joins the two, and it is the `customer_display_name` a
 * ticket (`application/tickets.py`) and an order (`application/order_fixtures.py`) are listed
 * under — so the sentence is about both fields and says so.
 */
export const CUSTOMER_NAME_RULE = "Part of the display name on tickets and orders.";

/** Customer email. `attached_shop_count` is the reuse the second sentence names. */
export const CUSTOMER_EMAIL_RULE =
  "A fictional address used to identify the profile. The profile is reusable across shops.";

/** `AccountFacts.customer_since`, an ISO day. */
export const CUSTOMER_SINCE_RULE = "The day this fictional customer first bought.";

/**
 * Product status, which is neither a catalog filter nor a publish-gate exemption.
 *
 * `_search_products` in `application/sandbox_tools.py` filters on the query alone, and
 * `product_summary` carries `status` into the result, so a draft or archived product reaches
 * an agent exactly as an active one does — with its status attached to be reasoned about.
 * `validate_shop` in `domain/shop.py` calls `_validate_product` for every product whatever
 * its status, so the same missing price refuses the shop either way. The handoff says the
 * opposite ("Present in the catalog but never returned to an agent"); it is describing its
 * own prototype.
 */
export const PRODUCT_STATUS_RULE =
  "A fact an agent reads, not a filter. The catalog tools return a draft or archived product too, and the publish gate holds all three to the same rules.";

/**
 * Product description. `product_detail` in `application/sandbox_tool_views.py` returns it and
 * `product_summary` does not, which is what "when it opens the product" is being careful
 * about; `_validate_product` raises `product_without_description` as a **warning**, so the
 * severity in the sentence is the gate's own.
 */
export const PRODUCT_DESCRIPTION_RULE =
  "What a support agent reads when it opens the product. Leaving it empty publishes with a warning, not a refusal.";

/**
 * The shop slug where it is edited rather than derived.
 *
 * `SHOP_SLUG_RULE` above cannot serve this row: its second clause is `DerivedIdField`'s
 * follow-until-edited behaviour, and Shop details renders a plain input. What is left that is
 * true here is the shape `require_slug` enforces at save (the control enforces none) and the
 * one place the value is read — `ShopsPage` searches `[shop.name, shop.slug]`.
 */
export const SHOP_SLUG_DETAIL_RULE =
  "Lowercase with hyphens. The shops index searches it beside the name.";

/**
 * The six rules a shop document's create page and its editor carry (PLAN-UX Slice 16).
 *
 * Each names the code that makes it true. A document is a tool result and never prompt text —
 * `sandbox_tool_views.py` builds `get_policies`, `get_support_guidelines` and `get_faq` out of
 * the three collections and nothing else reads them — and it is named by its kind *and* its
 * id: `ContextDocumentSchema` is `{kind, document_id}`, which is why the two rows that carry
 * the address say they are fixed rather than pretending to be questions (ADR 0057).
 */
export const DOCUMENT_TITLE_RULE = "What the tool result is labelled with when an agent reads it.";

export const DOCUMENT_KIND_RULE =
  "Policies state rules, guidelines state judgement, FAQ answers state one thing plainly. It decides which tool returns the document, and it is answered here because a scenario names a document by its kind and its slug together.";

export const DOCUMENT_SLUG_RULE =
  "Lowercase with hyphens. How a scenario names this document when it requires the read. Follows the title until you edit it; empty it to follow again.";

export const DOCUMENT_SLUG_FIXED_RULE =
  "How a scenario names this document when it requires the read. Set when the document was created.";

export const DOCUMENT_KIND_FIXED_RULE =
  "Which collection this is in, and so which tool returns it. Set with the slug when the document was created.";

export const DOCUMENT_BODY_RULE = "The text an agent gets back from the tool call, verbatim.";

/**
 * The one identity fact a customer profile may be missing, and the shape it takes when it is
 * not: `require_phone`'s `\+?[0-9][0-9 ()./-]{4,30}` in `domain/content.py`. The control is
 * `type="tel"`, which refuses nothing, so the save is the first thing that would.
 */
export const CUSTOMER_PHONE_RULE =
  "The only identity fact that may be left out. A leading + is allowed, then a digit and at least four more of digits, spaces, or ( ) . / -.";

/**
 * Account status and loyalty tier, which the lab reports and does not act on.
 *
 * Both are read out to the agent by `customer_profile` in `sandbox_tool_views.py` and
 * attached to a span by `telemetry_attributes`. Neither appears in a condition anywhere in
 * `apps/api/src`: `validate_order_fixture` checks that the customer is attached to the shop
 * and nothing about the account, so an order against a closed account is authored without a
 * finding. The handoff gives the tier a rule the lab does not enforce ("what the goodwill
 * guideline reads when deciding whether an exception is allowed"); that would be a field
 * claiming a gate it has not got.
 */
export const ACCOUNT_STATUS_RULE =
  "The customer lookup reports it to the agent. Nothing here gates on it: an order or a ticket can be authored against a closed account.";

export const LOYALTY_TIER_RULE =
  "Read by the agent, enforced by nobody. What a tier is worth is whatever the shop's policies and guidelines say.";

/**
 * Account notes, which are the sensitive facts the agent *is* allowed to find.
 *
 * `customer_profile` in `sandbox_tool_views.py` returns `account.notes` in full;
 * `FIELD_SENSITIVITY` classifies it `SENSITIVE` (a log may not carry it, a tool result may)
 * against `hidden_facts[].note`, which is `CUSTOMER_ONLY` and absent from that view by
 * construction. So the two are one decision and the hint names the other half of it.
 */
export const ACCOUNT_NOTES_RULE =
  "The customer lookup returns these to the support agent. A fact it must not find belongs in Hidden simulator facts instead.";

/** `persona_without_summary`, an error in `validate_customer_profile`. */
export const PERSONA_SUMMARY_RULE =
  "A published profile must have one: the publish gate refuses an empty summary.";

/**
 * The two status selects, which offer a reachable future and never a past.
 *
 * `OrderFixtureDetailSchema.from_record` builds both option lists from `reachable_statuses`
 * over `PAYMENT_TRANSITIONS` and `FULFILMENT_TRANSITIONS`, and `require_reachable_status`
 * refuses anything else at save. An author may jump several steps at once, which is why the
 * sentence says "forward" rather than "one step".
 */
export const PAYMENT_STATUS_RULE =
  "Only the statuses reachable from the one saved. An authored order moves forward — several steps at once if you like — and never back.";

/**
 * The same rule, plus the consequence `ADDRESS_CHANGEABLE_STATUSES` attaches to this axis
 * alone: `FulfilmentState.allows_address_change` is false once the order is fulfilled, which
 * is what the line under this card already reports.
 *
 * Stated as a consequence of this axis and **not** as the only one there is. `refuse_reasons`
 * in `domain/address_change.py` turns a run's address change away on four grounds, two of
 * them about the order's state: `ORDER_ALREADY_SHIPPED` — this row — and `ORDER_REFUNDED`,
 * which belongs to the payment axis. "Fulfilled is what stops it" would be true of this
 * select and false of the order, which is the kind of sentence this slice exists to keep out.
 */
export const FULFILMENT_STATUS_RULE =
  "Only the statuses reachable from the one saved, and never back. Once fulfilled, a run can no longer change the address.";

/** `PaymentState.__post_init__`: a pending or authorized order may carry no capture time. */
export const PAID_AT_RULE =
  "Only once the money moved. A pending or authorized order cannot record a capture time, and saving one is refused.";

/** `FulfilmentState.__post_init__`: an unfulfilled order may carry no shipping time. */
export const SHIPPED_AT_RULE =
  "Only once something shipped. An unfulfilled order cannot record a shipping time, and saving one is refused.";

/**
 * Both method selects, which is one sentence because it is one rule.
 *
 * `_method_name` in `application/order_fixtures.py` resolves the display name from the shop
 * when the selection changes and keeps an already frozen one frozen otherwise, so the order
 * carries its own copy of the name and a rename in Shop details never reaches it. Naming
 * neither axis is deliberate: a second spelling of this is the drift the module refuses.
 */
export const ORDER_METHOD_RULE =
  "One of the shop's own methods. Its name is frozen into the order when you pick it, so renaming it under Shop details never rewrites this one.";

/**
 * The two refusals a tone-of-voice guideline makes on its own row (PLAN-UX Slice 17).
 *
 * Both are the lab's own rules, read one step before the publish gate reads them.
 *
 * A guideline with no name is refused by `ToneOfVoiceSchema.name`'s `minLength: 1` and again
 * by `_require_label(self.name, "tone-of-voice name")` in `domain/shop.py`, which also
 * refuses a name that is only padding — `not value.strip()`. `required` on the input does
 * not: it is satisfied by a space, which is the door this sentence closes. The second clause
 * is why the name is the field that matters at all: the ID a configuration names as an
 * override is `ToneOfVoiceSelectionSchema.guideline_id`, and `DerivedIdField` derived that ID
 * from the name when the guideline was created, so a guideline called nothing has nothing for
 * an override to reach for either.
 *
 * Deleting the shop default is refused because `tone_of_voice_without_default` — "one
 * tone-of-voice guideline must be the shop default", raised in `validate_shop` — is what the
 * draft would earn on the next preview. The sentence names the pointer rather than the row,
 * because moving the default is the way out and deleting the guideline is not.
 */
export const TONE_NAME_RULE =
  "A guideline must be named. The lab refuses a guideline whose name is empty, and the ID a configuration names it by was derived from that name.";

export const TONE_DEFAULT_REMOVAL_RULE =
  "The shop default cannot be deleted — point the default elsewhere first.";
