"""What the demo says: one shop, one customer, one order, one incident, two arms.

Every payload here is the same type an author would build in the Studio, so the publish
gates read this content exactly as they read a hand-authored draft. Nothing is minimal on
purpose: a screen that has only enough content to satisfy a validator looks like a fixture,
and this is the first thing anyone sees.

Three values are quoted rather than derived and must stay quoted together, because the
incident declaration in `infrastructure/agents/scripted/incident` quotes them too: the
order reference `NS-10482`, the shipping policy's ID `shipping`, and the customer's default
address-book entry, which is the Lyon one the arms redirect to. Changing any of them here
without changing it there leaves both arms asking for something the world does not hold.
"""

from decimal import Decimal
from uuid import UUID

from capability_lab.application.agent_capabilities import (
    default_agent_configuration_model,
)
from capability_lab.application.judge_capabilities import CONTROL_JUDGE_PROVIDER
from capability_lab.application.order_fixtures import (
    OrderEventDraft,
    OrderLineSelection,
)
from capability_lab.domain.agent_configuration import ModelSettings
from capability_lab.domain.blocks import (
    BlockParameter,
    BlockParameterKind,
    MutationBlockPayload,
    MutationEffect,
    ObjectiveAssessment,
    ObjectiveBlockPayload,
    ObjectiveEvidence,
)
from capability_lab.domain.customer_profile import (
    AccountFacts,
    AccountStatus,
    AddressEntry,
    BackgroundEntry,
    BackgroundKind,
    BehavioralPersona,
    CustomerIdentity,
    CustomerProfilePayload,
    HiddenFact,
    LoyaltyTier,
)
from capability_lab.domain.judge import (
    JudgeConfigurationPayload,
    JudgeEvidenceScope,
    JudgeModel,
)
from capability_lab.domain.shop import (
    AttributeType,
    Currency,
    FaqEntry,
    FulfilmentMethod,
    MediaReference,
    Money,
    OptionDefinition,
    PaymentMethod,
    PaymentMethodKind,
    PolicyDocument,
    PolicyKind,
    Product,
    ProductReview,
    ProductStatus,
    ProductVariant,
    ShopIdentity,
    ShopPayload,
    SupportChannel,
    SupportGuideline,
    ToneOfVoiceGuideline,
    TypedAttribute,
    VariantAvailability,
)
from capability_lab.domain.support_identity import (
    EscalationPolicy,
    GuidanceNote,
    SupportIdentityPayload,
    SupportPermission,
    SupportRole,
)
from capability_lab.domain.ticket import (
    SuggestedDocument,
    SuggestedDocumentKind,
    TicketAuthor,
    TicketMessage,
    TicketOrigin,
    TicketOriginKind,
    TicketStatus,
)

# -- the values the incident declaration also quotes ---------------------------

ORDER_REFERENCE = "NS-10482"
"""The order the customer names in the trigger and both arms ask for by name."""

SHIPPING_POLICY_ID = "shipping"
"""The policy the recipe puts in context and the read objective is bound to."""

STALE_ADDRESS_ID = "bordeaux-previous-flat"
"""Where the order still ships: the flat the customer left in June."""

CURRENT_ADDRESS_ID = "home"
"""The customer's default address, and therefore the one an arm redirects to."""

# -- the clock the story happened on -------------------------------------------

PLACED_AT = "2026-08-20T14:55:00.000000Z"
CAPTURED_AT = "2026-08-20T15:02:00.000000Z"
SUPPORT_CONTACT_AT = "2026-08-21T09:14:00.000000Z"
HISTORY_QUESTION_AT = "2026-08-21T09:14:00.000000Z"
HISTORY_ANSWER_AT = "2026-08-21T09:16:00.000000Z"
TRIGGER_AT = "2026-08-21T13:40:00.000000Z"

# -- names the operator sees ---------------------------------------------------

SHOP_NAME = "Northstar Outfitters"
TICKET_REFERENCE = "T-2041"
TICKET_SUBJECT = "Order is going to my old address"
SCENARIO_NAME = "Wrong shipping address before dispatch"
EXPERIMENT_LABEL = "Wrong shipping address — Pydantic AI vs OpenAI Agents SDK"
IDENTITY_NAME = "Northstar tier 1"
JUDGE_NAME = "Resolution quality"

READ_POLICY_BLOCK = "read-required-document"
REDIRECT_BLOCK = "redirect-the-order"
EXPLAINED_BLOCK = "explain-the-change-to-the-customer"
MUTATION_BLOCK = "concurrent-entity-mutation"

READ_POLICY_OBJECTIVE = "read-the-shipping-policy"
REDIRECT_OBJECTIVE = "redirect-the-order"
EXPLAINED_OBJECTIVE = "explain-the-change-to-the-customer"
FAULT = "warehouse-picks-the-order"

DEMO_TAGS: tuple[str, ...] = ("framework-comparison", "wrong-address", "milestone-6")
DEMO_NOTE = (
    "Both arms read the policy, proposed the redirect and applied their own confirmation, "
    "so the write path is the same under either SDK. The warehouse pick fired while each "
    "arm was still reading the order and neither noticed it — worth a second look at "
    "whether the reply should mention that fulfilment had already started."
)


# -- the shop ------------------------------------------------------------------


def shop_identity() -> ShopIdentity:
    return ShopIdentity(
        name=SHOP_NAME,
        slug="northstar-outfitters",
        locale="en-GB",
        currencies=(Currency.EUR,),
        channels=(SupportChannel.CHAT, SupportChannel.EMAIL),
    )


def _eur(amount: str) -> Money:
    return Money(amount=Decimal(amount), currency=Currency.EUR)


def _alpine_shell_jacket() -> Product:
    return Product(
        handle="alpine-shell-jacket",
        title="Alpine Shell Jacket",
        description=(
            "A three-layer waterproof shell with fully taped seams, a helmet-compatible "
            "hood and pit zips. Cut long at the back for climbing and cycling. Packs into "
            "its own chest pocket."
        ),
        status=ProductStatus.ACTIVE,
        category="Jackets",
        options=(
            OptionDefinition(key="colour", name="Colour", values=("Ocean Blue", "Charcoal")),
            OptionDefinition(key="size", name="Size", values=("S", "M", "L")),
        ),
        variants=(
            ProductVariant(
                sku="NS-ASJ-OB-M",
                option_values=(("colour", "Ocean Blue"), ("size", "M")),
                availability=VariantAvailability.IN_STOCK,
                stock_quantity=12,
                price=_eur("249.00"),
            ),
            ProductVariant(
                sku="NS-ASJ-OB-L",
                option_values=(("colour", "Ocean Blue"), ("size", "L")),
                availability=VariantAvailability.IN_STOCK,
                stock_quantity=4,
                price=_eur("249.00"),
            ),
            ProductVariant(
                sku="NS-ASJ-CH-S",
                option_values=(("colour", "Charcoal"), ("size", "S")),
                availability=VariantAvailability.BACKORDER,
                stock_quantity=0,
                price=_eur("249.00"),
            ),
        ),
        media=(
            MediaReference(
                reference="media/alpine-shell-ocean-blue.jpg",
                alt_text="Alpine Shell Jacket in Ocean Blue, hood up",
            ),
            MediaReference(
                reference="media/alpine-shell-detail-seams.jpg",
                alt_text="Taped seam detail on the shoulder",
            ),
        ),
        attributes=(
            TypedAttribute(
                key="waterproof-rating",
                label="Waterproof rating",
                attribute_type=AttributeType.MEASUREMENT,
                value="20000",
                unit="mm",
            ),
            TypedAttribute(
                key="weight",
                label="Weight (size M)",
                attribute_type=AttributeType.MEASUREMENT,
                value="420",
                unit="g",
            ),
            TypedAttribute(
                key="fit",
                label="Fit",
                attribute_type=AttributeType.CHOICE,
                value="Regular",
                choices=("Slim", "Regular", "Relaxed"),
            ),
        ),
        reviews=(
            ProductReview(
                id="asj-review-1",
                author_display_name="Ines V.",
                rating=5,
                body="Four days on the west coast in horizontal rain and I stayed dry.",
            ),
            ProductReview(
                id="asj-review-2",
                author_display_name="Tomas R.",
                rating=4,
                body="Excellent shell. Sizing runs a little large — I went down one.",
            ),
        ),
    )


def _fjord_base_layer() -> Product:
    return Product(
        handle="fjord-merino-base-layer",
        title="Fjord Merino Base Layer",
        description=(
            "A 200gsm merino crew with flatlock seams and offset shoulders that sit clear "
            "of a pack strap. Warm when damp and slow to hold odour."
        ),
        status=ProductStatus.ACTIVE,
        category="Base layers",
        options=(
            OptionDefinition(key="colour", name="Colour", values=("Slate", "Rust")),
            OptionDefinition(key="size", name="Size", values=("S", "M", "L")),
        ),
        variants=(
            ProductVariant(
                sku="NS-FMB-SL-M",
                option_values=(("colour", "Slate"), ("size", "M")),
                availability=VariantAvailability.IN_STOCK,
                stock_quantity=31,
                price=_eur("89.00"),
            ),
            ProductVariant(
                sku="NS-FMB-RU-L",
                option_values=(("colour", "Rust"), ("size", "L")),
                availability=VariantAvailability.IN_STOCK,
                stock_quantity=9,
                price=_eur("89.00"),
            ),
        ),
        media=(
            MediaReference(
                reference="media/fjord-base-layer-slate.jpg",
                alt_text="Fjord Merino Base Layer in Slate",
            ),
        ),
        attributes=(
            TypedAttribute(
                key="fabric-weight",
                label="Fabric weight",
                attribute_type=AttributeType.MEASUREMENT,
                value="200",
                unit="gsm",
            ),
            TypedAttribute(
                key="machine-washable",
                label="Machine washable",
                attribute_type=AttributeType.BOOLEAN,
                value="true",
            ),
        ),
        reviews=(
            ProductReview(
                id="fmb-review-1",
                author_display_name="Kasia D.",
                rating=5,
                body="Third one I have bought. The shoulder seams really do help.",
            ),
        ),
    )


def _harbour_dry_bag() -> Product:
    return Product(
        handle="harbour-dry-bag-20l",
        title="Harbour Dry Bag 20L",
        description=(
            "A roll-top dry bag in recycled tarpaulin with a welded base and a removable "
            "shoulder strap. Floats when closed and sealed."
        ),
        status=ProductStatus.ACTIVE,
        category="Packs",
        options=(OptionDefinition(key="colour", name="Colour", values=("Sand", "Black")),),
        variants=(
            ProductVariant(
                sku="NS-HDB-SA-20",
                option_values=(("colour", "Sand"),),
                availability=VariantAvailability.IN_STOCK,
                stock_quantity=48,
                price=_eur("45.00"),
            ),
            ProductVariant(
                sku="NS-HDB-BK-20",
                option_values=(("colour", "Black"),),
                availability=VariantAvailability.OUT_OF_STOCK,
                stock_quantity=0,
                price=_eur("45.00"),
            ),
        ),
        media=(
            MediaReference(
                reference="media/harbour-dry-bag-sand.jpg",
                alt_text="Harbour Dry Bag 20L in Sand, rolled closed",
            ),
        ),
        attributes=(
            TypedAttribute(
                key="capacity",
                label="Capacity",
                attribute_type=AttributeType.MEASUREMENT,
                value="20",
                unit="L",
            ),
        ),
        reviews=(),
    )


def _policies() -> tuple[PolicyDocument, ...]:
    return (
        PolicyDocument(
            id=SHIPPING_POLICY_ID,
            title="Shipping and delivery",
            kind=PolicyKind.SHIPPING,
            body=(
                "Standard delivery is 2 to 5 working days across the EU; express is next "
                "working day when ordered before 14:00 CET.\n\n"
                "A shipping address may be changed at any point before the order leaves "
                "the warehouse. Support may make that change on the customer's behalf "
                "once the new address has been read back and confirmed, and must record "
                "what was changed in the order's history.\n\n"
                "Once an order has been picked, the address can no longer be changed in "
                "the system. The parcel is intercepted with the carrier instead, which "
                "adds one working day and is arranged by tier 2."
            ),
        ),
        PolicyDocument(
            id="returns",
            title="Returns and exchanges",
            kind=PolicyKind.RETURNS,
            body=(
                "Unworn items may be returned within 30 days of delivery for a full "
                "refund, and exchanged for another size at no cost. Return shipping is "
                "free within the EU. Refunds are issued to the original payment method "
                "within five working days of the return arriving."
            ),
        ),
        PolicyDocument(
            id="cancellation",
            title="Cancelling an order",
            kind=PolicyKind.CANCELLATION,
            body=(
                "An order can be cancelled in full while it is unfulfilled. Once any part "
                "of it has been picked, only the unpicked lines can be cancelled and the "
                "rest is handled as a return."
            ),
        ),
    )


def _faq() -> tuple[FaqEntry, ...]:
    return (
        FaqEntry(
            id="delivery-times",
            question="When will my order arrive?",
            answer=(
                "Standard delivery arrives in 2 to 5 working days. You will get a tracking "
                "link by email as soon as the parcel leaves the warehouse."
            ),
        ),
        FaqEntry(
            id="address-changes",
            question="Can I change the delivery address after ordering?",
            answer=(
                "Yes, as long as the order has not been picked yet. Ask support and they "
                "will read the new address back to you before changing anything."
            ),
        ),
        FaqEntry(
            id="returns-window",
            question="How long do I have to return something?",
            answer="Thirty days from delivery, unworn, with free return shipping in the EU.",
        ),
        FaqEntry(
            id="size-guide",
            question="Do the jackets run true to size?",
            answer=(
                "Shells are cut to layer over a mid-layer, so they run roomy. If you are "
                "between sizes and do not layer heavily, size down."
            ),
        ),
    )


def _support_guidelines() -> tuple[SupportGuideline, ...]:
    return (
        SupportGuideline(
            id="escalation",
            title="When to escalate",
            body=(
                "Escalate to tier 2 for any refund above 200 EUR, any parcel that has "
                "already been picked or shipped, and anything a customer has contacted us "
                "about more than twice. Say plainly that you are handing it on and what "
                "the customer should expect next."
            ),
        ),
        SupportGuideline(
            id="order-changes",
            title="Changing an order for a customer",
            body=(
                "Read the order back before you change it: the reference, what is in it, "
                "and where it is currently going. Propose the change in words the customer "
                "can check, wait for their confirmation, and then tell them exactly what "
                "moved. Never guess at an address from context — use the one saved on the "
                "account or the one the customer spells out."
            ),
        ),
        SupportGuideline(
            id="delivery-delays",
            title="Talking about delays",
            body=(
                "Give the real date rather than a reassurance. If the delay is ours, say "
                "so and offer the express upgrade at no cost."
            ),
        ),
    )


def _tone_of_voice() -> tuple[ToneOfVoiceGuideline, ...]:
    return (
        ToneOfVoiceGuideline(
            id="warm-and-precise",
            name="Warm and precise",
            guidance=(
                "Write like a person who has actually looked. Lead with the fact, then "
                "the action, then what happens next. Short sentences, no exclamation "
                "marks, no apologising twice for the same thing. Name amounts, dates and "
                "addresses in full rather than referring to 'your order' in the abstract."
            ),
            is_default=True,
        ),
        ToneOfVoiceGuideline(
            id="brisk",
            name="Brisk",
            guidance=(
                "For repeat contacts who want the answer and nothing else: one line of "
                "fact, one line of action. No pleasantries."
            ),
        ),
    )


def shop_payload() -> ShopPayload:
    """The whole shop as a publishable draft: catalog, policies, FAQ, and voice."""
    return ShopPayload(
        identity=shop_identity(),
        products=(_alpine_shell_jacket(), _fjord_base_layer(), _harbour_dry_bag()),
        faq=_faq(),
        policies=_policies(),
        payment_methods=(
            PaymentMethod(id="visa", name="Visa", kind=PaymentMethodKind.CARD, enabled=True),
            PaymentMethod(id="paypal", name="PayPal", kind=PaymentMethodKind.WALLET, enabled=True),
            PaymentMethod(
                id="gift-card",
                name="Northstar gift card",
                kind=PaymentMethodKind.GIFT_CARD,
                enabled=False,
            ),
        ),
        fulfilment_methods=(
            FulfilmentMethod(
                id="standard",
                name="Standard delivery",
                carrier="Nordic Post",
                min_transit_days=2,
                max_transit_days=5,
            ),
            FulfilmentMethod(
                id="express",
                name="Express delivery",
                carrier="Nordic Post",
                min_transit_days=1,
                max_transit_days=2,
            ),
        ),
        support_guidelines=_support_guidelines(),
        tone_of_voice_guidelines=_tone_of_voice(),
    )


# -- the customer --------------------------------------------------------------


def customer_identity() -> CustomerIdentity:
    return CustomerIdentity(
        given_name="Maya",
        family_name="Laurent",
        email="maya.laurent@example.org",
        locale="fr-FR",
        phone="+33 6 12 00 00 00",
    )


CUSTOMER_SINCE = "2024-03-14"


def customer_payload() -> CustomerProfilePayload:
    """The customer the incident happens to, with the address book that causes it."""
    return CustomerProfilePayload(
        identity=customer_identity(),
        account=AccountFacts(
            customer_since=CUSTOMER_SINCE,
            status=AccountStatus.ACTIVE,
            loyalty_tier=LoyaltyTier.SILVER,
            marketing_opt_in=True,
            notes="Prefers written confirmation of every change to an order.",
        ),
        persona=BehavioralPersona(
            summary=(
                "A frequent customer who buys one considered thing a season. Direct, and "
                "mildly anxious once something is uncertain: she wants a concrete answer "
                "and a date rather than reassurance. She will confirm an address that is "
                "read back to her rather than dictate one unprompted."
            ),
            traits=("frequent", "direct", "mildly anxious", "confirms rather than dictates"),
        ),
        addresses=(
            AddressEntry(
                id=CURRENT_ADDRESS_ID,
                label="Home",
                recipient="Maya Laurent",
                line1="18 rue des Écoles",
                line2="Appartement 4",
                postal_code="69005",
                city="Lyon",
                region=None,
                country="FR",
                is_default=True,
            ),
            AddressEntry(
                id=STALE_ADDRESS_ID,
                label="Bordeaux — previous flat",
                recipient="Maya Laurent",
                line1="7 cours de l'Intendance",
                line2=None,
                postal_code="33000",
                city="Bordeaux",
                region=None,
                country="FR",
                is_default=False,
            ),
            AddressEntry(
                id="office",
                label="Office",
                recipient="Maya Laurent — Atelier Vidal",
                line1="22 quai Saint-Antoine",
                line2="3e étage",
                postal_code="69002",
                city="Lyon",
                region=None,
                country="FR",
                is_default=False,
            ),
        ),
        background=(
            BackgroundEntry(
                id="moved-in-june",
                kind=BackgroundKind.LIFE_EVENT,
                occurred_on="2026-06-02",
                note=(
                    "Moved from Bordeaux to Lyon. Updated the default address on the "
                    "account but never removed the Bordeaux entry, which several older "
                    "orders still point at."
                ),
            ),
            BackgroundEntry(
                id="exchange-2025",
                kind=BackgroundKind.SUPPORT_CONTACT,
                occurred_on="2025-11-18",
                note="Exchanged a base layer for a larger size. Resolved on first contact.",
            ),
        ),
        hidden_facts=(
            HiddenFact(
                id="believes-it-ships-to-lyon",
                note=(
                    "She believes she already fixed this and has not looked at the order "
                    "page in detail."
                ),
                revealed_when="The agent reads the current shipping address back to her.",
            ),
            HiddenFact(
                id="will-accept-the-account-address",
                note=(
                    "She will confirm the Lyon address on her account if the agent offers "
                    "it, and will not spell one out unless asked twice."
                ),
                revealed_when="The agent proposes an address rather than asking for one.",
            ),
        ),
    )


# -- the support identity the agent adopts -------------------------------------


def support_role() -> SupportRole:
    return SupportRole(
        name=IDENTITY_NAME,
        title="Customer support representative",
        description=(
            "First contact for order, delivery and returns questions. Resolves what can be "
            "resolved before dispatch and hands the rest to tier 2."
        ),
    )


def support_identity_payload() -> SupportIdentityPayload:
    return SupportIdentityPayload(
        role=support_role(),
        permissions=(
            SupportPermission.READ_ORDERS,
            SupportPermission.READ_POLICIES,
            SupportPermission.CHANGE_SHIPPING_ADDRESS,
        ),
        guidance=(
            GuidanceNote(
                id="read-it-back",
                title="Read the order back before changing it",
                body=(
                    "Say the reference, what is in the order and where it is currently "
                    "going, before proposing any change to it."
                ),
            ),
            GuidanceNote(
                id="one-change-at-a-time",
                title="Confirm one change at a time",
                body=(
                    "Propose a single change, wait for the customer to confirm it, apply "
                    "it, then say what moved."
                ),
            ),
        ),
        escalation=EscalationPolicy(
            escalate_to="Tier 2 support",
            conditions=(
                "The customer asks for a refund above 200 EUR",
                "The parcel has already left the warehouse",
            ),
        ),
    )


# -- the order the incident is about -------------------------------------------


def order_lines() -> tuple[OrderLineSelection, ...]:
    return (
        OrderLineSelection(sku="NS-ASJ-OB-M", quantity=1),
        OrderLineSelection(sku="NS-FMB-SL-M", quantity=2),
    )


def order_events() -> tuple[OrderEventDraft, ...]:
    return (
        OrderEventDraft(
            id="order-placed",
            kind="placed",
            occurred_at=PLACED_AT,
            summary="Order placed from the web checkout.",
        ),
        OrderEventDraft(
            id="payment-captured",
            kind="payment_captured",
            occurred_at=CAPTURED_AT,
            summary="Payment captured on the Visa ending 4417. Order marked paid.",
        ),
        OrderEventDraft(
            id="support-contact",
            kind="support_contact",
            occurred_at=SUPPORT_CONTACT_AT,
            summary=f"Customer opened ticket {TICKET_REFERENCE} about the payment.",
        ),
    )


# -- the ticket that opens the incident ----------------------------------------


def ticket_origin(order_id: UUID) -> TicketOrigin:
    """Where the customer was: the order page of the order she is worried about."""
    return TicketOrigin(kind=TicketOriginKind.ORDER_PAGE, order_id=order_id)


def ticket_history() -> tuple[TicketMessage, ...]:
    """The payment exchange the wrong-address incident opens on top of."""
    return (
        TicketMessage(
            id="payment-question",
            author=TicketAuthor.CUSTOMER,
            body="Did my payment go through? The checkout page showed an error at the end.",
            sent_at=HISTORY_QUESTION_AT,
        ),
        TicketMessage(
            id="payment-answer",
            author=TicketAuthor.SUPPORT_AGENT,
            body=(
                f"Your order {ORDER_REFERENCE} is confirmed and paid — the error was only "
                "on the confirmation page. Nothing else is needed from you."
            ),
            sent_at=HISTORY_ANSWER_AT,
        ),
    )


def ticket_trigger() -> TicketMessage:
    """The first message every arm receives, carried by the pinned ticket."""
    return TicketMessage(
        id="trigger",
        author=TicketAuthor.CUSTOMER,
        body=(
            "Sorry, one more thing — I have just looked at the order page and it says "
            f"{ORDER_REFERENCE} is going to my old flat in Bordeaux. I moved in June. Can "
            "you change it before it ships?"
        ),
        sent_at=TRIGGER_AT,
    )


def ticket_tags() -> tuple[str, ...]:
    return ("address-change", "pre-fulfilment")


TICKET_STATUS = TicketStatus.OPEN

TICKET_SUGGESTED_DOCUMENTS: tuple[SuggestedDocument, ...] = (
    SuggestedDocument(kind=SuggestedDocumentKind.POLICY, document_id=SHIPPING_POLICY_ID),
    SuggestedDocument(kind=SuggestedDocumentKind.SUPPORT_GUIDELINE, document_id="order-changes"),
    SuggestedDocument(kind=SuggestedDocumentKind.FAQ_ENTRY, document_id="address-changes"),
)


# -- the library the recipe composes from --------------------------------------


def _reference_parameter(name: str, kind: BlockParameterKind, description: str) -> BlockParameter:
    return BlockParameter(name=name, kind=kind, description=description, required=True)


def _severity_parameter() -> BlockParameter:
    return BlockParameter(
        name="severity",
        kind=BlockParameterKind.SEVERITY,
        description="Whether missing this fails the objective or only warns.",
        required=True,
        default="required",
    )


def read_document_block() -> ObjectiveBlockPayload:
    return ObjectiveBlockPayload(
        name=READ_POLICY_BLOCK,
        statement="Read document",
        description=(
            "Passes when the arm reads the bound document through its tool before the run "
            "completes. The evidence is the recorded tool event whose result carries the "
            "document reference; nothing is inferred from the conversation text."
        ),
        assessment=ObjectiveAssessment.DETERMINISTIC,
        evidence=ObjectiveEvidence.EVENT,
        parameters=(
            _reference_parameter(
                "doc_ref",
                BlockParameterKind.DOCUMENT_REFERENCE,
                "The shop document the arm has to read.",
            ),
            _severity_parameter(),
        ),
    )


def redirect_block() -> ObjectiveBlockPayload:
    return ObjectiveBlockPayload(
        name=REDIRECT_BLOCK,
        statement="Change the bound field",
        description=(
            "Passes when the bound field of the bound entity differs at the end of the run "
            "from the value the snapshot froze. Read off the arm's own state rather than "
            "off what the agent said it did."
        ),
        assessment=ObjectiveAssessment.DETERMINISTIC,
        evidence=ObjectiveEvidence.STATE,
        parameters=(
            _reference_parameter(
                "doc_ref",
                BlockParameterKind.DATA_REFERENCE,
                "The entity field that has to have moved.",
            ),
            _severity_parameter(),
        ),
    )


def explained_block() -> ObjectiveBlockPayload:
    """The one row no rule can decide, so the demo has something for a judge to score."""
    return ObjectiveBlockPayload(
        name=EXPLAINED_BLOCK,
        statement="Tell the customer what changed",
        description=(
            "A judge reads the arm's replies and its calls and decides whether the "
            "customer was told, in plain words, what was changed and what happens next. "
            "No rule can settle this: the record shows that a write happened, not that "
            "anybody was told about it in terms they could check."
        ),
        assessment=ObjectiveAssessment.JUDGE,
        evidence=ObjectiveEvidence.DIMENSION,
        parameters=(),
    )


def mutation_block() -> MutationBlockPayload:
    return MutationBlockPayload(
        name=MUTATION_BLOCK,
        statement="Concurrent mutation of",
        description=(
            "Mutates the bound entity out of band at the bound moment, bumping its version "
            "so the arm's next write hits an optimistic-concurrency conflict."
        ),
        effect=MutationEffect.ENTITY_MUTATION,
        parameters=(
            _reference_parameter(
                "entity_ref",
                BlockParameterKind.ENTITY_REFERENCE,
                "The order or customer that moves under the arm.",
            ),
            BlockParameter(
                name="timing",
                kind=BlockParameterKind.TIMING,
                description="When the runtime injects the mutation.",
                required=True,
                default="after_first_read",
            ),
        ),
    )


# -- the recipe ----------------------------------------------------------------

HIDDEN_FACTS = (
    "Maya has not looked at the order page closely and believes she already fixed this. "
    "She will confirm the Lyon address on her account if it is offered to her, and will "
    "not spell out an address unless she is asked for one twice. She does not know that "
    "the warehouse begins picking the order while the conversation is happening."
)

COMPLETION_STATEMENT = (
    "The order ships to the address the customer confirmed, and she has been told what changed."
)

COMPLETION_TURNS = 1
"""The trigger, and one follow-up.

The cap is what ends an arm (ADR 0030), so a demo that wants both arms to read as finished
rather than as waiting has to choose one the incident actually fits. It fits in two turns:
the customer reports the wrong address, and asks once more whether anything else moved.
"""

FOLLOW_UP = (
    "Thank you. Can you confirm nothing else about the order changed while you were in there?"
)
"""The one composition an operator delivers, and the turn that completes both arms."""


# -- the agents, and what scores them ------------------------------------------

PROMPT = (
    "You are {{support_identity.role}} at {{shop.name}}.\n\n"
    "Write in the shop's tone of voice: {{shop.tone_of_voice}}. The shop trades in "
    "{{shop.currencies}} and answers in {{shop.locale}}.\n\n"
    "Use the tools for every commerce fact — the order, the customer's saved addresses, "
    "and the shop's own policies. Never state a fact about an order you have not read, and "
    "never invent an address.\n\n"
    "Before changing anything, read the current value back to the customer and propose the "
    "change. Apply it only with the confirmation the proposal answered with, then say "
    "plainly what moved.\n\n"
    "Your standing guidance: {{support_identity.guidance}}.\n"
    "You are permitted to: {{support_identity.permissions}}."
)

CONFIGURATION_DESCRIPTION = (
    "The lab's frontline single agent for the wrong-address incident. One of a matched "
    "pair that differ only in the framework running them."
)


def agent_model() -> ModelSettings:
    """The same model on both arms, so the framework is the only thing that moves."""
    default = default_agent_configuration_model()
    return ModelSettings(
        provider=default.provider,
        model_id=default.model_id,
        temperature=Decimal("0.20"),
        max_tool_rounds=24,
    )


JUDGE_RUBRIC = (
    "Decide whether the customer was actually told what happened to her order. A reply "
    "meets this when it names the order, says which address it now ships to, and says what "
    "the customer should expect next. It misses when the change is described only in the "
    "abstract, when the address is not stated, or when the reply claims something the "
    "calls do not support. Judge the words the customer received, not the effort behind "
    "them."
)

JUDGE_DESCRIPTION = "Reads a resolved incident the way the customer who opened it would."


def judge_payload() -> JudgeConfigurationPayload:
    return JudgeConfigurationPayload(
        name=JUDGE_NAME,
        model=JudgeModel(
            provider=CONTROL_JUDGE_PROVIDER,
            model_id="deterministic",
            temperature=Decimal("0.00"),
        ),
        description=JUDGE_DESCRIPTION,
        rubric=JUDGE_RUBRIC,
        evidence=(
            JudgeEvidenceScope.AGENT_REPLIES,
            JudgeEvidenceScope.CUSTOMER_TURNS,
            JudgeEvidenceScope.TOOL_CALLS,
        ),
    )
