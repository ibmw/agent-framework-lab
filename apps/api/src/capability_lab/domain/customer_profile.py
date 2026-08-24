"""Typed synthetic customer profile: identity, address book, persona, and hidden facts.

A customer profile is the authored content of a `customer_profile` definition. Every fact
in it is fictional and belongs to the sandbox; the profile travels across shops while
orders, tickets, and support history stay with the shop that owns them.

The payload deliberately keeps four kinds of fact apart, because later slices treat them
very differently:

- **personal facts** (identity, address book, account) are what a support agent may
  legitimately discover through tools;
- **behavioral persona** guides the operator and the future customer simulator and is
  never injected into the support agent's prompt;
- **background** is authored fictional history that predates the sandbox and explains the
  profile, as opposed to the shop-scoped order and ticket records of Milestone 2; and
- **hidden facts** are known only to the customer side of a simulation.

`FIELD_SENSITIVITY` classifies every leaf of the canonical document so nothing new can be
authored without deciding whether it may reach a log or a span.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from functools import partial

from capability_lab.domain.content import (
    FieldSensitivity,
    require_bool,
    require_country_code,
    require_email,
    require_instance,
    require_iso_date,
    require_label,
    require_locale,
    require_phone,
    require_slug,
    require_text,
    require_unique,
)
from capability_lab.domain.content import (
    unclassified_paths as unclassified_document_paths,
)
from capability_lab.domain.definitions import (
    DefinitionChange,
    DefinitionChangeKind,
    DefinitionIssue,
    DefinitionValidation,
    diff_keyed_collection,
    field_changes,
    issue_error,
    issue_warning,
    validation_of,
)
from capability_lab.domain.entities import DomainError

MAX_PERSONA_TRAITS = 12


class CustomerProfileConfigurationError(DomainError):
    """Raised when customer-profile content violates a structural invariant."""


_error_type = CustomerProfileConfigurationError
_require_slug = partial(require_slug, error=_error_type)
_require_label = partial(require_label, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)
_require_bool = partial(require_bool, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)
_require_locale = partial(require_locale, error=_error_type)
_require_email = partial(require_email, error=_error_type)
_require_phone = partial(require_phone, error=_error_type)
_require_country_code = partial(require_country_code, error=_error_type)
_require_iso_date = partial(require_iso_date, error=_error_type)


class AccountStatus(StrEnum):
    ACTIVE = "active"
    DORMANT = "dormant"
    CLOSED = "closed"


class LoyaltyTier(StrEnum):
    NONE = "none"
    SILVER = "silver"
    GOLD = "gold"


class BackgroundKind(StrEnum):
    """What a piece of authored pre-sandbox history is about."""

    PURCHASE = "purchase"
    SUPPORT_CONTACT = "support_contact"
    ACCOUNT_EVENT = "account_event"
    LIFE_EVENT = "life_event"


@dataclass(frozen=True, slots=True)
class CustomerIdentity:
    """Fictional personal facts. Always synthetic; never a real person's data."""

    given_name: str
    family_name: str
    email: str
    locale: str
    phone: str | None = None

    def __post_init__(self) -> None:
        _require_label(self.given_name, "customer given name")
        _require_label(self.family_name, "customer family name")
        _require_email(self.email, "customer email")
        _require_locale(self.locale, "customer locale")
        if self.phone is not None:
            _require_phone(self.phone, "customer phone")

    @property
    def display_name(self) -> str:
        return f"{self.given_name} {self.family_name}"


@dataclass(frozen=True, slots=True)
class AccountFacts:
    """Account-level facts a support agent can legitimately discover through tools."""

    customer_since: str
    status: AccountStatus
    loyalty_tier: LoyaltyTier
    marketing_opt_in: bool
    notes: str = ""

    def __post_init__(self) -> None:
        _require_iso_date(self.customer_since, "customer since")
        _require_instance(self.status, AccountStatus, "account status must be a supported status")
        _require_instance(self.loyalty_tier, LoyaltyTier, "loyalty tier must be a supported tier")
        _require_bool(self.marketing_opt_in, "marketing opt-in")
        _require_text(self.notes, "account notes", allow_empty=True)


@dataclass(frozen=True, slots=True)
class AddressEntry:
    """One named address-book entry.

    Orders select an entry and keep a frozen, source-labeled copy, so editing or removing
    an entry here never rewrites an existing order, published scenario, or snapshot.
    """

    id: str
    label: str
    recipient: str
    line1: str
    postal_code: str
    city: str
    country: str
    line2: str | None = None
    region: str | None = None
    is_default: bool = False

    def __post_init__(self) -> None:
        _require_slug(self.id, "address ID")
        _require_label(self.label, "address label")
        _require_label(self.recipient, "address recipient")
        _require_label(self.line1, "address line 1")
        _require_label(self.postal_code, "address postal code")
        _require_label(self.city, "address city")
        _require_country_code(self.country, "address country")
        if self.line2 is not None:
            _require_label(self.line2, "address line 2")
        if self.region is not None:
            _require_label(self.region, "address region")
        _require_bool(self.is_default, "address default flag")

    @property
    def single_line(self) -> str:
        parts = (self.recipient, self.line1, self.line2, f"{self.postal_code} {self.city}")
        return " · ".join(part for part in parts if part)


@dataclass(frozen=True, slots=True)
class BehavioralPersona:
    """How the customer behaves. Guides the operator and the future customer simulator.

    It is never injected into the support agent's prompt: an agent that could read the
    persona would be evaluated against a script rather than against a customer.
    """

    summary: str
    traits: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _require_text(self.summary, "persona summary", allow_empty=True)
        for trait in self.traits:
            _require_label(trait, "persona trait")
        _require_unique(self.traits, "persona traits")
        if len(self.traits) > MAX_PERSONA_TRAITS:
            raise CustomerProfileConfigurationError(
                f"a persona can carry at most {MAX_PERSONA_TRAITS} traits"
            )


@dataclass(frozen=True, slots=True)
class BackgroundEntry:
    """Authored fictional history that predates the sandbox.

    Shop-scoped order and ticket records arrive with Milestone 2 and stay with their shop;
    these entries travel with the profile and explain who the customer already is.
    """

    id: str
    kind: BackgroundKind
    occurred_on: str
    note: str

    def __post_init__(self) -> None:
        _require_slug(self.id, "background entry ID")
        _require_instance(self.kind, BackgroundKind, "background kind must be a supported kind")
        _require_iso_date(self.occurred_on, "background entry date")
        _require_text(self.note, "background entry note")


@dataclass(frozen=True, slots=True)
class HiddenFact:
    """A fact the customer side knows and the support agent must never be told."""

    id: str
    note: str
    revealed_when: str = ""

    def __post_init__(self) -> None:
        _require_slug(self.id, "hidden fact ID")
        _require_text(self.note, "hidden fact note")
        _require_text(self.revealed_when, "hidden fact reveal condition", allow_empty=True)


@dataclass(frozen=True, slots=True)
class CustomerProfilePayload:
    """The complete authored content of one customer-profile draft or version."""

    identity: CustomerIdentity
    account: AccountFacts
    persona: BehavioralPersona
    addresses: tuple[AddressEntry, ...] = ()
    background: tuple[BackgroundEntry, ...] = ()
    hidden_facts: tuple[HiddenFact, ...] = ()

    def __post_init__(self) -> None:
        _require_instance(
            self.identity, CustomerIdentity, "a customer profile must declare its identity"
        )
        _require_instance(
            self.account, AccountFacts, "a customer profile must declare its account facts"
        )
        _require_instance(
            self.persona, BehavioralPersona, "a customer profile must declare its persona"
        )
        _require_unique(tuple(entry.id for entry in self.addresses), "address IDs")
        _require_unique(tuple(entry.id for entry in self.background), "background entry IDs")
        _require_unique(tuple(fact.id for fact in self.hidden_facts), "hidden fact IDs")
        defaults = [entry for entry in self.addresses if entry.is_default]
        if len(defaults) > 1:
            raise CustomerProfileConfigurationError(
                "a customer profile can declare at most one default address"
            )

    @property
    def default_address(self) -> AddressEntry | None:
        for entry in self.addresses:
            if entry.is_default:
                return entry
        return None


# Every leaf of the `customer-profile-payload-v1` document, so a newly authored field
# cannot arrive without a decision. `[]` stands for a list index.
FIELD_SENSITIVITY: dict[str, FieldSensitivity] = {
    "canonical_schema_version": FieldSensitivity.OPERATIONAL,
    "identity.given_name": FieldSensitivity.SENSITIVE,
    "identity.family_name": FieldSensitivity.SENSITIVE,
    "identity.email": FieldSensitivity.SENSITIVE,
    "identity.phone": FieldSensitivity.SENSITIVE,
    "identity.locale": FieldSensitivity.OPERATIONAL,
    "account.customer_since": FieldSensitivity.OPERATIONAL,
    "account.status": FieldSensitivity.OPERATIONAL,
    "account.loyalty_tier": FieldSensitivity.OPERATIONAL,
    "account.marketing_opt_in": FieldSensitivity.OPERATIONAL,
    "account.notes": FieldSensitivity.SENSITIVE,
    "addresses[].id": FieldSensitivity.OPERATIONAL,
    "addresses[].label": FieldSensitivity.SENSITIVE,
    "addresses[].recipient": FieldSensitivity.SENSITIVE,
    "addresses[].line1": FieldSensitivity.SENSITIVE,
    "addresses[].line2": FieldSensitivity.SENSITIVE,
    "addresses[].postal_code": FieldSensitivity.SENSITIVE,
    "addresses[].city": FieldSensitivity.SENSITIVE,
    "addresses[].region": FieldSensitivity.SENSITIVE,
    "addresses[].country": FieldSensitivity.OPERATIONAL,
    "addresses[].is_default": FieldSensitivity.OPERATIONAL,
    "persona.summary": FieldSensitivity.CUSTOMER_ONLY,
    "persona.traits[]": FieldSensitivity.CUSTOMER_ONLY,
    "background[].id": FieldSensitivity.OPERATIONAL,
    "background[].kind": FieldSensitivity.OPERATIONAL,
    "background[].occurred_on": FieldSensitivity.OPERATIONAL,
    "background[].note": FieldSensitivity.SENSITIVE,
    "hidden_facts[].id": FieldSensitivity.OPERATIONAL,
    "hidden_facts[].note": FieldSensitivity.CUSTOMER_ONLY,
    "hidden_facts[].revealed_when": FieldSensitivity.CUSTOMER_ONLY,
}


def unclassified_paths(document: object) -> frozenset[str]:
    """Document leaves with no sensitivity decision; empty for a complete payload."""
    return unclassified_document_paths(document, FIELD_SENSITIVITY)


def restricted_values(payload: CustomerProfilePayload) -> tuple[str, ...]:
    """Every authored value that must never reach a log line, span, or error message."""
    values: list[str] = [
        payload.identity.given_name,
        payload.identity.family_name,
        payload.identity.email,
        payload.account.notes,
        payload.persona.summary,
        *payload.persona.traits,
    ]
    if payload.identity.phone is not None:
        values.append(payload.identity.phone)
    for address in payload.addresses:
        values.extend(
            [address.label, address.recipient, address.line1, address.postal_code, address.city]
        )
        values.extend(part for part in (address.line2, address.region) if part is not None)
    values.extend(entry.note for entry in payload.background)
    for fact in payload.hidden_facts:
        values.extend([fact.note, fact.revealed_when])
    # Empty strings are dropped: an unset optional field has nothing to disclose, and an
    # empty needle would match every haystack in the tests that assert absence.
    return tuple(value for value in values if value)


def telemetry_attributes(payload: CustomerProfilePayload) -> dict[str, str | int | bool]:
    """The only customer-profile attributes the lab may attach to a span or a log line.

    Everything here is derived from `OPERATIONAL` fields or is a count; no authored text
    from the profile appears, so a trace can describe a profile without disclosing it.
    """
    return {
        "lab.customer_profile.locale": payload.identity.locale,
        "lab.customer_profile.account_status": payload.account.status.value,
        "lab.customer_profile.loyalty_tier": payload.account.loyalty_tier.value,
        "lab.customer_profile.marketing_opt_in": payload.account.marketing_opt_in,
        "lab.customer_profile.address_count": len(payload.addresses),
        "lab.customer_profile.has_default_address": payload.default_address is not None,
        "lab.customer_profile.address_countries": ",".join(
            sorted({address.country for address in payload.addresses})
        ),
        "lab.customer_profile.persona_trait_count": len(payload.persona.traits),
        "lab.customer_profile.background_count": len(payload.background),
        "lab.customer_profile.hidden_fact_count": len(payload.hidden_facts),
    }


def validate_customer_profile(payload: CustomerProfilePayload) -> DefinitionValidation:
    """Report every publish-gate finding for a customer-profile draft."""
    issues: list[DefinitionIssue] = []

    if not payload.addresses:
        issues.append(
            issue_error(
                "profile_without_address",
                "a published customer profile must hold at least one address, "
                "because orders select their shipping address from the address book",
                "addresses",
            )
        )
    elif payload.default_address is None:
        issues.append(
            issue_error(
                "address_book_without_default",
                "one address-book entry must be the default",
                "addresses",
            )
        )

    # Publish-gate messages are the authoring surface: they are read by the author who typed
    # the content, so naming the ambiguous label is helpful, not a disclosure. The restriction
    # in `restricted_values` is about logs, spans, and evidence that outlives the session.
    labels = [entry.label for entry in payload.addresses]
    for label in sorted({label for label in labels if labels.count(label) > 1}):
        issues.append(
            issue_warning(
                "duplicate_address_label",
                f"two address-book entries share the label {label}, "
                "which makes the order editor's picker ambiguous",
                "addresses",
            )
        )

    if not payload.persona.summary:
        issues.append(
            issue_error(
                "persona_without_summary",
                "a published customer profile must describe how the customer behaves",
                "persona.summary",
            )
        )
    elif not payload.persona.traits:
        issues.append(
            issue_warning(
                "persona_without_trait",
                "the persona has no traits to summarize it in a listing",
                "persona.traits",
            )
        )

    if not payload.background:
        issues.append(
            issue_warning(
                "profile_without_background",
                "the profile has no authored history explaining who this customer already is",
                "background",
            )
        )

    return validation_of(issues)


def summarize_customer_profile_changes(
    previous: CustomerProfilePayload | None, current: CustomerProfilePayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    if previous is None:
        return (
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path="",
                description=f"First published version of {current.identity.display_name}",
            ),
        )

    changes: list[DefinitionChange] = []
    changes.extend(
        field_changes(
            "identity",
            (
                ("given_name", previous.identity.given_name, current.identity.given_name),
                ("family_name", previous.identity.family_name, current.identity.family_name),
                ("email", previous.identity.email, current.identity.email),
                ("phone", previous.identity.phone, current.identity.phone),
                ("locale", previous.identity.locale, current.identity.locale),
            ),
            lambda name: f"Updated identity {name.replace('_', ' ')}",
        )
    )
    changes.extend(
        field_changes(
            "account",
            (
                ("customer_since", previous.account.customer_since, current.account.customer_since),
                ("status", previous.account.status, current.account.status),
                ("loyalty_tier", previous.account.loyalty_tier, current.account.loyalty_tier),
                (
                    "marketing_opt_in",
                    previous.account.marketing_opt_in,
                    current.account.marketing_opt_in,
                ),
                ("notes", previous.account.notes, current.account.notes),
            ),
            lambda name: f"Updated account {name.replace('_', ' ')}",
        )
    )
    changes.extend(
        field_changes(
            "persona",
            (
                ("summary", previous.persona.summary, current.persona.summary),
                ("traits", previous.persona.traits, current.persona.traits),
            ),
            lambda name: f"Updated persona {name}",
        )
    )

    changes.extend(
        diff_keyed_collection(
            previous.addresses,
            current.addresses,
            key=lambda entry: entry.id,
            label=lambda entry: entry.label,
            path="addresses",
            noun="address",
        )
    )
    changes.extend(
        diff_keyed_collection(
            previous.background,
            current.background,
            key=lambda entry: entry.id,
            label=lambda entry: entry.occurred_on,
            path="background",
            noun="background entry",
        )
    )
    changes.extend(
        diff_keyed_collection(
            previous.hidden_facts,
            current.hidden_facts,
            key=lambda fact: fact.id,
            label=lambda fact: fact.id,
            path="hidden_facts",
            noun="hidden fact",
        )
    )
    return tuple(changes)
