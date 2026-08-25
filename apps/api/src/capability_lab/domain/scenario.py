"""The scenario recipe: one ticket, the context around it, and the blocks it is judged by.

A scenario is the last authorable definition before an experiment can run, and it is almost
entirely *composition* rather than new content. ADR 0016 deferred it for exactly that reason
and ADR 0017 delivered the templates first: a scenario's payload is mostly bound block
instances, and a binding has no shape until the templates say what a parameter is.

What a scenario adds on top of its ticket is four things:

- **Context documents.** The shop documents that matter for resolving the incident. They are
  curation, not sandbox content: the agent reaches every document through a tool, and whether
  it read the right one is an objective's evidence rather than a property of this list.
- **Hidden facts.** Operator-only prose the support agent must never see. It steers the human
  participant driver today and the customer simulator later.
- **Bound blocks.** Objective and mutation instances, each naming a template, binding its
  parameters to *this shop's* objects, and — for an objective — declaring a severity.
- **Completion.** What "done" means, plus the turn cap that guarantees a run terminates.

Two rules run through all of it:

- **Every binding resolves inside the scenario's own shop.** A template is shop-independent
  and names no object anywhere; `SHOP_BOUND_PARAMETER_KINDS` (ADR 0017) is how it declares
  which parameters a scenario must resolve, and this module is where that declaration is
  finally cashed in against a real shop.
- **Objective order is priority; mutation order is the run timeline.** Neither is a script.
  An objective therefore never says *when* it applies — only a mutation does, through the
  single timing parameter its template is required to declare.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from enum import StrEnum
from functools import partial
from uuid import UUID

from capability_lab.domain.blocks import (
    BlockParameter,
    BlockParameterKind,
    ObjectiveSeverity,
    check_bindings,
)
from capability_lab.domain.content import (
    FieldSensitivity,
    require_identifier,
    require_instance,
    require_integer_in_range,
    require_label,
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
from capability_lab.domain.shop import ShopDocumentKind

MAX_CONTEXT_DOCUMENTS = 12
MAX_SCENARIO_OBJECTIVES = 24
MAX_SCENARIO_MUTATIONS = 8
MAX_SCENARIO_BINDINGS = 8
"""One binding per template parameter, so this is `MAX_BLOCK_PARAMETERS` seen from here."""

MIN_COMPLETION_TURNS = 1
MAX_COMPLETION_TURNS = 100
DEFAULT_COMPLETION_TURNS = 12


class ScenarioConfigurationError(DomainError):
    """Raised when scenario content violates a structural invariant."""


_error_type = ScenarioConfigurationError
_require_slug = partial(require_slug, error=_error_type)
_require_identifier = partial(require_identifier, error=_error_type)
_require_label = partial(require_label, error=_error_type)
_require_text = partial(require_text, error=_error_type)
_require_unique = partial(require_unique, error=_error_type)
_require_instance = partial(require_instance, error=_error_type)
_require_integer_in_range = partial(require_integer_in_range, error=_error_type)


class ScenarioEntityKind(StrEnum):
    """The kinds of shop object an entity or data binding can name.

    Closed on purpose: a binding is resolved by the runtime, so a kind it cannot look up
    would be a value nothing could ever answer for.
    """

    ORDER = "order"
    CUSTOMER = "customer"
    PRODUCT = "product"


# The fields a `data_reference` may name on each entity, so a binding cannot point at a
# field the sandbox has no answer for. Small and driven by what the wrong-address incident
# actually needs: the address an arm must not reveal, and its immediate neighbours.
DATA_FIELDS: dict[ScenarioEntityKind, frozenset[str]] = {
    ScenarioEntityKind.ORDER: frozenset(
        {"shipping_address", "line_items", "payment", "total", "events"}
    ),
    ScenarioEntityKind.CUSTOMER: frozenset({"email", "phone", "address_book", "account"}),
    ScenarioEntityKind.PRODUCT: frozenset({"price", "availability", "variants"}),
}

_DATA_FIELD_SEPARATOR = "#"


@dataclass(frozen=True, slots=True)
class DocumentReference:
    """A shop document named by the collection it lives in and its ID."""

    kind: ShopDocumentKind
    document_id: str

    def __post_init__(self) -> None:
        _require_instance(
            self.kind, ShopDocumentKind, "a document reference must name a collection"
        )
        _require_slug(self.document_id, "document reference ID")

    @property
    def value(self) -> str:
        return f"{self.kind.value}:{self.document_id}"


@dataclass(frozen=True, slots=True)
class EntityReference:
    """A shop object named by its kind and the shop's own key for it.

    An order or a customer is named by its stable identifier and a product by its catalog
    handle, exactly as a ticket's origin names them: a renamed order is still the same
    order, while a handle *is* the shop's key.
    """

    kind: ScenarioEntityKind
    identifier: str

    def __post_init__(self) -> None:
        _require_instance(self.kind, ScenarioEntityKind, "an entity reference must name a kind")
        if self.kind is ScenarioEntityKind.PRODUCT:
            _require_slug(self.identifier, "product reference handle")
        else:
            _require_uuid_text(self.identifier, f"{self.kind.value} reference ID")

    @property
    def value(self) -> str:
        return f"{self.kind.value}:{self.identifier}"

    @property
    def entity_id(self) -> UUID | None:
        """The stable identifier, for the kinds a shop holds by UUID."""
        if self.kind is ScenarioEntityKind.PRODUCT:
            return None
        return UUID(self.identifier)


def _require_uuid_text(value: object, field_name: str) -> None:
    if not isinstance(value, str):
        raise ScenarioConfigurationError(f"{field_name} must be text")
    try:
        UUID(value)
    except ValueError as cause:
        raise ScenarioConfigurationError(f"{field_name} must be a UUID") from cause


def parse_document_reference(value: str) -> DocumentReference | None:
    """Read `policy:address-change`, or None when the value is not one."""
    kind_text, separator, document_id = value.partition(":")
    if not separator:
        return None
    try:
        kind = ShopDocumentKind(kind_text)
    except ValueError:
        return None
    try:
        return DocumentReference(kind=kind, document_id=document_id)
    except ScenarioConfigurationError:
        return None


def parse_entity_reference(value: str) -> EntityReference | None:
    """Read `order:<uuid>`, `customer:<uuid>`, or `product:<handle>`; None otherwise."""
    kind_text, separator, identifier = value.partition(":")
    if not separator:
        return None
    try:
        kind = ScenarioEntityKind(kind_text)
    except ValueError:
        return None
    try:
        return EntityReference(kind=kind, identifier=identifier)
    except ScenarioConfigurationError:
        return None


@dataclass(frozen=True, slots=True)
class DataReference:
    """One named field of one shop object, such as the address an arm must not reveal."""

    entity: EntityReference
    field: str

    def __post_init__(self) -> None:
        _require_instance(self.entity, EntityReference, "a data reference must name an entity")
        _require_identifier(self.field, "data reference field")

    @property
    def value(self) -> str:
        return f"{self.entity.value}{_DATA_FIELD_SEPARATOR}{self.field}"


def parse_data_reference(value: str) -> DataReference | None:
    """Read `order:<uuid>#shipping_address`, or None when the value is not one."""
    entity_text, separator, field = value.partition(_DATA_FIELD_SEPARATOR)
    if not separator:
        return None
    entity = parse_entity_reference(entity_text)
    if entity is None:
        return None
    try:
        return DataReference(entity=entity, field=field)
    except ScenarioConfigurationError:
        return None


@dataclass(frozen=True, slots=True)
class ContextDocument:
    """A shop document that matters for resolving this incident.

    Pre-filled from the ticket's suggested documents and editable afterwards. It records
    which documents the scenario is *about*; whether an arm read one is an objective's
    evidence, never a property of this entry.
    """

    kind: ShopDocumentKind
    document_id: str

    def __post_init__(self) -> None:
        _require_instance(
            self.kind, ShopDocumentKind, "a context document must name a shop collection"
        )
        _require_slug(self.document_id, "context document ID")

    @property
    def key(self) -> str:
        return f"{self.kind.value}:{self.document_id}"

    @property
    def reference(self) -> DocumentReference:
        return DocumentReference(kind=self.kind, document_id=self.document_id)


@dataclass(frozen=True, slots=True)
class ScenarioBinding:
    """One template parameter and the value this scenario supplies for it."""

    parameter: str
    value: str

    def __post_init__(self) -> None:
        _require_identifier(self.parameter, "binding parameter name")
        _require_text(self.value, "binding value")


def _normalized_bindings(bindings: tuple[ScenarioBinding, ...]) -> tuple[ScenarioBinding, ...]:
    """Bindings are a map, so their order is not content and must not reach a fingerprint.

    Normalized here rather than in the codec so a payload round-trips to itself: two
    scenarios that bind the same parameters to the same values are the same scenario, and
    two different authoring orders must not publish as two different versions.
    """
    for binding in bindings:
        _require_instance(binding, ScenarioBinding, "bindings must be scenario binding entries")
    _require_unique(tuple(binding.parameter for binding in bindings), "binding parameter names")
    if len(bindings) > MAX_SCENARIO_BINDINGS:
        raise ScenarioConfigurationError(
            f"a bound block carries at most {MAX_SCENARIO_BINDINGS} bindings"
        )
    return tuple(sorted(bindings, key=lambda binding: binding.parameter))


@dataclass(frozen=True, slots=True)
class BoundObjective:
    """One objective template, bound to this shop's objects with a severity.

    `severity` is a field rather than a binding because every objective answers it —
    including templates that declare no parameter at all. A template that declares a
    `severity` parameter is resolved from this field, so the two can never disagree; what
    the parameter's default supplies is the value an editor starts a new binding at.
    """

    id: str
    block_id: UUID
    severity: ObjectiveSeverity = ObjectiveSeverity.REQUIRED
    bindings: tuple[ScenarioBinding, ...] = ()

    def __post_init__(self) -> None:
        _require_slug(self.id, "bound objective ID")
        _require_instance(self.block_id, UUID, "a bound objective must name its template")
        _require_instance(
            self.severity, ObjectiveSeverity, "a bound objective must declare its severity"
        )
        object.__setattr__(self, "bindings", _normalized_bindings(self.bindings))

    @property
    def binding_values(self) -> dict[str, str]:
        return {binding.parameter: binding.value for binding in self.bindings}


@dataclass(frozen=True, slots=True)
class BoundMutation:
    """One mutation template, bound to this shop's objects.

    No severity: a mutation is not judged, it is injected. Its moment is an ordinary
    binding of the single timing parameter ADR 0017 requires every published mutation
    template to declare.
    """

    id: str
    block_id: UUID
    bindings: tuple[ScenarioBinding, ...] = ()

    def __post_init__(self) -> None:
        _require_slug(self.id, "bound mutation ID")
        _require_instance(self.block_id, UUID, "a bound mutation must name its template")
        object.__setattr__(self, "bindings", _normalized_bindings(self.bindings))

    @property
    def binding_values(self) -> dict[str, str]:
        return {binding.parameter: binding.value for binding in self.bindings}


@dataclass(frozen=True, slots=True)
class CompletionConditions:
    """When a run of this scenario is over.

    Two halves that answer different questions. The statement says what success looks like
    and is read by the operator and, later, the judge. `max_turns` is the hard cap that
    guarantees termination whatever the arms do, so both arms are bounded identically.
    """

    statement: str = ""
    max_turns: int = DEFAULT_COMPLETION_TURNS

    def __post_init__(self) -> None:
        _require_text(self.statement, "completion statement", allow_empty=True)
        _require_integer_in_range(
            self.max_turns, MIN_COMPLETION_TURNS, MAX_COMPLETION_TURNS, "completion turn cap"
        )


@dataclass(frozen=True, slots=True)
class ScenarioPayload:
    """The complete authored content of one scenario draft or published version.

    `ticket_id` is an ADR 0012 reference and so is every distinct `block_id`: publishing
    pins the exact ticket version and the exact template version of each block composed,
    which is what makes a historical run explainable after the library moves on.
    """

    name: str
    ticket_id: UUID
    context_documents: tuple[ContextDocument, ...] = ()
    objectives: tuple[BoundObjective, ...] = ()
    mutations: tuple[BoundMutation, ...] = ()
    hidden_facts: str = ""
    completion: CompletionConditions = CompletionConditions()

    def __post_init__(self) -> None:
        _require_label(self.name, "scenario name")
        _require_instance(self.ticket_id, UUID, "a scenario must be built on a ticket")
        _require_text(self.hidden_facts, "scenario hidden facts", allow_empty=True)
        _require_instance(
            self.completion, CompletionConditions, "a scenario must declare its completion"
        )
        if len(self.context_documents) > MAX_CONTEXT_DOCUMENTS:
            raise ScenarioConfigurationError(
                f"a scenario carries at most {MAX_CONTEXT_DOCUMENTS} context documents"
            )
        if len(self.objectives) > MAX_SCENARIO_OBJECTIVES:
            raise ScenarioConfigurationError(
                f"a scenario composes at most {MAX_SCENARIO_OBJECTIVES} objectives"
            )
        if len(self.mutations) > MAX_SCENARIO_MUTATIONS:
            raise ScenarioConfigurationError(
                f"a scenario composes at most {MAX_SCENARIO_MUTATIONS} mutations"
            )
        _require_unique(
            tuple(document.key for document in self.context_documents), "context documents"
        )
        _require_unique(tuple(objective.id for objective in self.objectives), "bound objective IDs")
        _require_unique(tuple(mutation.id for mutation in self.mutations), "bound mutation IDs")

    @property
    def objective_block_ids(self) -> tuple[UUID, ...]:
        """Each distinct objective template, in the order the scenario first binds it.

        Distinct because a reference is per definition: two read-checks on two documents
        bind one template, and a published scenario pins it once.
        """
        return _distinct(objective.block_id for objective in self.objectives)

    @property
    def mutation_block_ids(self) -> tuple[UUID, ...]:
        return _distinct(mutation.block_id for mutation in self.mutations)

    @property
    def context_document_keys(self) -> frozenset[str]:
        return frozenset(document.key for document in self.context_documents)


def _distinct(values: Iterable[UUID]) -> tuple[UUID, ...]:
    """Preserve first-seen order while dropping repeats; a reference is per definition."""
    return tuple(dict.fromkeys(values))


# Every leaf of the `scenario-payload-v1` document, so a newly authored field cannot arrive
# without a decision about whether it may reach a log line or a span. Identifiers and
# selections are operational — they name shop configuration and library templates — while
# the hidden facts are the one thing here written to be kept from the support agent.
FIELD_SENSITIVITY: dict[str, FieldSensitivity] = {
    "canonical_schema_version": FieldSensitivity.OPERATIONAL,
    "name": FieldSensitivity.OPERATIONAL,
    "ticket_id": FieldSensitivity.OPERATIONAL,
    "context_documents[].kind": FieldSensitivity.OPERATIONAL,
    "context_documents[].document_id": FieldSensitivity.OPERATIONAL,
    "objectives[].id": FieldSensitivity.OPERATIONAL,
    "objectives[].block_id": FieldSensitivity.OPERATIONAL,
    "objectives[].severity": FieldSensitivity.OPERATIONAL,
    "objectives[].bindings[].parameter": FieldSensitivity.OPERATIONAL,
    # A binding names a shop object; the closest it comes to content is a document ID.
    "objectives[].bindings[].value": FieldSensitivity.OPERATIONAL,
    "mutations[].id": FieldSensitivity.OPERATIONAL,
    "mutations[].block_id": FieldSensitivity.OPERATIONAL,
    "mutations[].bindings[].parameter": FieldSensitivity.OPERATIONAL,
    "mutations[].bindings[].value": FieldSensitivity.OPERATIONAL,
    # Written so the support agent never sees it. That is the definition of customer-only.
    "hidden_facts": FieldSensitivity.CUSTOMER_ONLY,
    "completion.statement": FieldSensitivity.OPERATIONAL,
    "completion.max_turns": FieldSensitivity.OPERATIONAL,
}


def unclassified_paths(document: object) -> frozenset[str]:
    """Document leaves with no sensitivity decision; empty for a complete payload."""
    return unclassified_document_paths(document, FIELD_SENSITIVITY)


def restricted_values(payload: ScenarioPayload) -> tuple[str, ...]:
    """Every authored value that must never reach a log line, span, or error message."""
    # An empty needle would match every haystack in the tests that assert absence.
    return tuple(value for value in (payload.hidden_facts,) if value)


def telemetry_attributes(payload: ScenarioPayload) -> dict[str, str | int | bool]:
    """The only scenario attributes the lab may attach to a span or a log line.

    Everything here is an `OPERATIONAL` field or a count, so a trace can describe which
    recipe a run started from without disclosing a fact the agent is not meant to have.
    """
    return {
        "lab.scenario.name": payload.name,
        "lab.scenario.ticket_id": str(payload.ticket_id),
        "lab.scenario.context_document_count": len(payload.context_documents),
        "lab.scenario.objective_count": len(payload.objectives),
        "lab.scenario.mutation_count": len(payload.mutations),
        "lab.scenario.objective_block_count": len(payload.objective_block_ids),
        "lab.scenario.mutation_block_count": len(payload.mutation_block_ids),
        "lab.scenario.has_hidden_facts": bool(payload.hidden_facts),
        "lab.scenario.max_turns": payload.completion.max_turns,
    }


@dataclass(frozen=True, slots=True)
class BlockTemplate:
    """One library template as the scenario's publish gate needs to see it.

    Only what a binding is judged against: the parameters, the name the findings quote, and
    whether the template has a version a publication could pin. The payload itself stays in
    the block library — a scenario never re-states what a template asserts.
    """

    name: str
    parameters: tuple[BlockParameter, ...] = ()
    published: bool = True

    def __post_init__(self) -> None:
        _require_slug(self.name, "block template name")

    def parameter(self, name: str) -> BlockParameter | None:
        for parameter in self.parameters:
            if parameter.name == name:
                return parameter
        return None

    @property
    def severity_parameters(self) -> tuple[str, ...]:
        return tuple(
            parameter.name
            for parameter in self.parameters
            if parameter.kind is BlockParameterKind.SEVERITY
        )


@dataclass(frozen=True, slots=True)
class ScenarioAuthoringContext:
    """What the scenario's shop, ticket, and libraries currently offer.

    Passed in rather than looked up so the rules stay pure: the same scenario is complete or
    incomplete purely as a function of the content around it, and the preview an author reads
    is the same rule set that refuses the freeze.
    """

    ticket_in_shop: bool = True
    ticket_published: bool = True
    shop_published: bool = True
    # The customer the ticket is about. Every entity a scenario binds has to be theirs: the
    # incident is one customer's, and an arm that could reach another one's order would be
    # comparing something the ticket never described.
    ticket_customer_profile_id: UUID | None = None
    document_ids: dict[ShopDocumentKind, frozenset[str]] | None = None
    product_handles: frozenset[str] = frozenset()
    # Two order sets rather than one, as with a ticket, so "that order is gone" and "that
    # order is somebody else's" stay distinguishable findings.
    shop_order_ids: frozenset[UUID] = frozenset()
    customer_order_ids: frozenset[UUID] = frozenset()
    shop_customer_profile_ids: frozenset[UUID] = frozenset()
    objective_blocks: dict[UUID, BlockTemplate] | None = None
    mutation_blocks: dict[UUID, BlockTemplate] | None = None

    def documents(self, kind: ShopDocumentKind) -> frozenset[str]:
        return (
            frozenset() if self.document_ids is None else self.document_ids.get(kind, frozenset())
        )

    def objective_template(self, block_id: UUID) -> BlockTemplate | None:
        return None if self.objective_blocks is None else self.objective_blocks.get(block_id)

    def mutation_template(self, block_id: UUID) -> BlockTemplate | None:
        return None if self.mutation_blocks is None else self.mutation_blocks.get(block_id)


def _prefixed(issues: tuple[DefinitionIssue, ...], prefix: str) -> list[DefinitionIssue]:
    """Re-root a template's own findings under the instance that produced them."""
    return [replace(issue, path=f"{prefix}.{issue.path}") for issue in issues]


def _entity_issues(
    entity: EntityReference, path: str, code_prefix: str, context: ScenarioAuthoringContext
) -> list[DefinitionIssue]:
    """Resolve one entity reference inside this scenario's shop and this ticket's customer."""
    if entity.kind is ScenarioEntityKind.PRODUCT:
        if entity.identifier not in context.product_handles:
            return [
                issue_error(
                    f"{code_prefix}_product_missing_from_catalog",
                    f"product {entity.identifier} is no longer in this shop's catalog",
                    path,
                )
            ]
        return []

    entity_id = entity.entity_id
    if entity_id is None:  # pragma: no cover - a non-product reference always has an ID
        return []

    if entity.kind is ScenarioEntityKind.ORDER:
        if entity_id not in context.shop_order_ids:
            return [
                issue_error(
                    f"{code_prefix}_order_missing_from_shop",
                    f"order {entity_id} is no longer an order of this shop",
                    path,
                )
            ]
        if entity_id not in context.customer_order_ids:
            return [
                issue_error(
                    f"{code_prefix}_order_of_another_customer",
                    f"order {entity_id} belongs to another customer, and this scenario's "
                    "incident is about the ticket's customer",
                    path,
                )
            ]
        return []

    if entity_id not in context.shop_customer_profile_ids:
        return [
            issue_error(
                f"{code_prefix}_customer_missing_from_shop",
                f"customer profile {entity_id} is not attached to this shop",
                path,
            )
        ]
    if (
        context.ticket_customer_profile_id is not None
        and entity_id != context.ticket_customer_profile_id
    ):
        return [
            issue_error(
                f"{code_prefix}_customer_not_the_ticket_customer",
                f"customer profile {entity_id} is not the customer the ticket is about",
                path,
            )
        ]
    return []


def _shop_binding_issues(
    parameter: BlockParameter, value: str, path: str, context: ScenarioAuthoringContext
) -> list[DefinitionIssue]:
    """Resolve one shop-bound binding, which is the rule the whole model exists for.

    A template declares the *kind* of object a scenario must supply and can say no more; here
    is where that kind meets a real shop. Reported as errors rather than warnings: a binding
    that resolves to nothing would materialize a snapshot with a hole in it.
    """
    if parameter.kind is BlockParameterKind.DOCUMENT_REFERENCE:
        document = parse_document_reference(value)
        if document is None:
            return [
                issue_error(
                    "binding_document_malformed",
                    f"{value} does not name a shop document; expected a value such as "
                    "policy:address-change",
                    path,
                )
            ]
        if document.document_id not in context.documents(document.kind):
            return [
                issue_error(
                    "binding_document_missing_from_shop",
                    f"{document.kind.value} {document.document_id} is not configured by this shop",
                    path,
                )
            ]
        return []

    if parameter.kind is BlockParameterKind.ENTITY_REFERENCE:
        entity = parse_entity_reference(value)
        if entity is None:
            return [
                issue_error(
                    "binding_entity_malformed",
                    f"{value} does not name a shop object; expected a value such as "
                    "order:<id>, customer:<id>, or product:<handle>",
                    path,
                )
            ]
        return _entity_issues(entity, path, "binding", context)

    data = parse_data_reference(value)
    if data is None:
        return [
            issue_error(
                "binding_data_malformed",
                f"{value} does not name a field of a shop object; expected a value such as "
                "order:<id>#shipping_address",
                path,
            )
        ]
    issues = _entity_issues(data.entity, path, "binding", context)
    if data.field not in DATA_FIELDS[data.entity.kind]:
        issues.append(
            issue_error(
                "binding_data_field_unknown",
                f"a {data.entity.kind.value} has no {data.field} the sandbox could resolve",
                path,
            )
        )
    return issues


def _bound_block_issues(
    *,
    instance_id: str,
    block_id: UUID,
    bindings: dict[str, str],
    template: BlockTemplate | None,
    path: str,
    noun: str,
    context: ScenarioAuthoringContext,
) -> list[DefinitionIssue]:
    """Judge one bound instance against the template it names."""
    if template is None:
        return [
            issue_error(
                f"{noun}_block_missing",
                f"{instance_id} binds {noun} block {block_id}, which the library no longer holds",
                path,
            )
        ]

    issues: list[DefinitionIssue] = []
    if not template.published:
        # Publishing a scenario pins the exact template version it composed, so a template
        # with no version is a pin that could not be written.
        issues.append(
            issue_error(
                f"{noun}_block_unpublished",
                f"{template.name} has never been published, and publishing a scenario pins "
                "the exact template version it composed",
                path,
            )
        )

    # Everything the template alone can judge: unknown parameters, missing required ones,
    # and literals that do not fit their kind (ADR 0017).
    issues.extend(
        _prefixed(check_bindings(template.parameters, bindings).issues, f"{path}.template")
    )

    for name, value in sorted(bindings.items()):
        parameter = template.parameter(name)
        if parameter is None or not parameter.binds_shop_object:
            continue
        issues.extend(_shop_binding_issues(parameter, value, f"{path}.bindings.{name}", context))
    return issues


def _objective_issues(
    payload: ScenarioPayload, context: ScenarioAuthoringContext
) -> list[DefinitionIssue]:
    issues: list[DefinitionIssue] = []
    for objective in payload.objectives:
        path = f"objectives.{objective.id}"
        template = context.objective_template(objective.block_id)
        bindings = objective.binding_values
        if template is not None:
            for name in template.severity_parameters:
                if name in bindings:
                    # One authored source for severity, or the two could contradict.
                    issues.append(
                        issue_error(
                            "objective_binds_severity",
                            f"{name} is the template's severity, which this objective already "
                            "declares; remove the binding",
                            f"{path}.bindings.{name}",
                        )
                    )
                bindings[name] = objective.severity.value
        issues.extend(
            _bound_block_issues(
                instance_id=objective.id,
                block_id=objective.block_id,
                bindings=bindings,
                template=template,
                path=path,
                noun="objective",
                context=context,
            )
        )
        issues.extend(_read_check_issues(objective, template, payload, path))
    return issues


def _read_check_issues(
    objective: BoundObjective,
    template: BlockTemplate | None,
    payload: ScenarioPayload,
    path: str,
) -> list[DefinitionIssue]:
    """Warn when an objective reads a document the scenario does not list as context.

    A warning rather than an error: the binding is already resolved against the shop, so the
    read-check works either way. What is missing is the curation — the document will not
    appear beside the incident for the operator, and the ticket that suggested it did not.
    """
    if template is None:
        return []
    issues: list[DefinitionIssue] = []
    for binding in objective.bindings:
        parameter = template.parameter(binding.parameter)
        if parameter is None or parameter.kind is not BlockParameterKind.DOCUMENT_REFERENCE:
            continue
        document = parse_document_reference(binding.value)
        if document is not None and document.value not in payload.context_document_keys:
            issues.append(
                issue_warning(
                    "objective_document_outside_context",
                    f"{objective.id} reads {document.value}, which this scenario does not list "
                    "as a context document",
                    f"{path}.bindings.{binding.parameter}",
                )
            )
    return issues


def _mutation_issues(
    payload: ScenarioPayload, context: ScenarioAuthoringContext
) -> list[DefinitionIssue]:
    return [
        issue
        for mutation in payload.mutations
        for issue in _bound_block_issues(
            instance_id=mutation.id,
            block_id=mutation.block_id,
            bindings=mutation.binding_values,
            template=context.mutation_template(mutation.block_id),
            path=f"mutations.{mutation.id}",
            noun="mutation",
            context=context,
        )
    ]


def _content_issues(payload: ScenarioPayload) -> list[DefinitionIssue]:
    """Findings that depend on the scenario alone, before its shop is consulted."""
    issues: list[DefinitionIssue] = []

    if not payload.objectives:
        issues.append(
            issue_error(
                "scenario_without_objective",
                "a published scenario must assert something; with no objective a run would "
                "produce no evidence to compare",
                "objectives",
            )
        )

    if not payload.completion.statement:
        issues.append(
            issue_error(
                "scenario_without_completion",
                "a published scenario must say what a resolved incident looks like, because "
                "the turn cap alone only says when to stop",
                "completion.statement",
            )
        )

    if not payload.context_documents:
        issues.append(
            issue_warning(
                "scenario_without_context_document",
                "no shop document is listed as context, so the incident names nothing the "
                "agent is expected to consult",
                "context_documents",
            )
        )

    if not payload.hidden_facts:
        issues.append(
            issue_warning(
                "scenario_without_hidden_facts",
                "no hidden facts are recorded, so whoever drives the customer has nothing to "
                "answer with beyond the ticket's first message",
                "hidden_facts",
            )
        )

    return issues


def _context_issues(
    payload: ScenarioPayload, context: ScenarioAuthoringContext
) -> list[DefinitionIssue]:
    """Findings that are the shop's and the libraries' answer to what the scenario points at."""
    issues: list[DefinitionIssue] = []

    if not context.ticket_in_shop:
        issues.append(
            issue_error(
                "ticket_not_in_shop",
                "the scenario's ticket belongs to another shop, and every object a scenario "
                "binds must live in one shop",
                "ticket_id",
            )
        )
    elif not context.ticket_published:
        issues.append(
            issue_error(
                "ticket_unpublished",
                "publishing a scenario pins an exact ticket version, and this ticket has "
                "never been published",
                "ticket_id",
            )
        )

    if not context.shop_published:
        issues.append(
            issue_error(
                "shop_unpublished",
                "publishing a scenario pins an exact shop version, and this shop has never "
                "been published",
                # The shop is the scenario's scope rather than its content, so this finding
                # names the scope; every other path here is a payload path.
                "shop",
            )
        )

    for document in payload.context_documents:
        if document.document_id not in context.documents(document.kind):
            issues.append(
                issue_error(
                    "context_document_missing_from_shop",
                    f"{document.kind.value} {document.document_id} is no longer configured by "
                    "this shop, so the incident points at a document nobody could read",
                    "context_documents",
                )
            )

    issues.extend(_objective_issues(payload, context))
    issues.extend(_mutation_issues(payload, context))
    return issues


def validate_scenario_content(payload: ScenarioPayload) -> DefinitionValidation:
    """The publish-gate findings a scenario carries on its own.

    Almost every rule a scenario has is about something outside it — its shop, its ticket,
    its templates — so this covers only what holds whatever those contain. It is what a pure
    caller, a test or a payload round-trip, can assert with no shop loaded.
    """
    return validation_of(_content_issues(payload))


def validate_scenario(
    payload: ScenarioPayload, context: ScenarioAuthoringContext
) -> DefinitionValidation:
    """Report every publish-gate finding for one scenario draft.

    Errors mark a recipe that could not materialize a coherent sandbox; warnings mark
    authoring an operator will miss, without blocking the freeze.
    """
    return validation_of(_content_issues(payload) + _context_issues(payload, context))


def _describe_bound(instance_id: str, bindings: tuple[ScenarioBinding, ...]) -> str:
    return f"{instance_id} ({len(bindings)} binding(s))"


def _order_change(
    previous_ids: tuple[str, ...], current_ids: tuple[str, ...], path: str, description: str
) -> list[DefinitionChange]:
    """Report a reordering of the entries both versions share.

    Order is content for both collections — objective order is priority and mutation order is
    the run timeline — so a reorder changes the fingerprint. Membership diffs alone would
    leave an author reading "no changes" beside a version that is genuinely different.
    """
    shared = set(previous_ids) & set(current_ids)
    before = tuple(entry for entry in previous_ids if entry in shared)
    after = tuple(entry for entry in current_ids if entry in shared)
    if before == after:
        return []
    return [DefinitionChange(kind=DefinitionChangeKind.UPDATED, path=path, description=description)]


def summarize_scenario_changes(
    previous: ScenarioPayload | None, current: ScenarioPayload
) -> tuple[DefinitionChange, ...]:
    """Describe what publishing this draft would freeze, against the latest version."""
    if previous is None:
        return (
            DefinitionChange(
                kind=DefinitionChangeKind.ADDED,
                path="",
                description=f"First published version of scenario {current.name}",
            ),
        )

    changes: list[DefinitionChange] = []
    changes.extend(
        field_changes(
            "scenario",
            (
                ("name", previous.name, current.name),
                ("ticket_id", previous.ticket_id, current.ticket_id),
                ("hidden_facts", previous.hidden_facts, current.hidden_facts),
            ),
            lambda name: f"Updated scenario {name.replace('_', ' ')}",
        )
    )
    changes.extend(
        field_changes(
            "completion",
            (
                ("statement", previous.completion.statement, current.completion.statement),
                ("max_turns", previous.completion.max_turns, current.completion.max_turns),
            ),
            lambda name: f"Updated completion {name.replace('_', ' ')}",
        )
    )
    changes.extend(
        diff_keyed_collection(
            previous.context_documents,
            current.context_documents,
            key=lambda document: document.key,
            label=lambda document: document.key,
            path="context_documents",
            noun="context document",
        )
    )
    changes.extend(
        diff_keyed_collection(
            previous.objectives,
            current.objectives,
            key=lambda objective: objective.id,
            label=lambda objective: _describe_bound(objective.id, objective.bindings),
            path="objectives",
            noun="objective",
        )
    )
    changes.extend(
        diff_keyed_collection(
            previous.mutations,
            current.mutations,
            key=lambda mutation: mutation.id,
            label=lambda mutation: _describe_bound(mutation.id, mutation.bindings),
            path="mutations",
            noun="mutation",
        )
    )
    changes.extend(
        _order_change(
            tuple(objective.id for objective in previous.objectives),
            tuple(objective.id for objective in current.objectives),
            "objectives",
            "Reordered the objectives, which is their priority",
        )
    )
    changes.extend(
        _order_change(
            tuple(mutation.id for mutation in previous.mutations),
            tuple(mutation.id for mutation in current.mutations),
            "mutations",
            "Reordered the mutations, which is the run timeline",
        )
    )
    return tuple(changes)
