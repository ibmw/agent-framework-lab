"""The shop's documents as the pickers that point at them offer them.

A ticket suggests a shop document and a scenario includes one as context; both name it by its
`(kind, id)` pair (ADR 0057) and both show it by its title. What a document's title *is* differs
by collection — an FAQ entry's is its question — and is read here once, so the two pickers
cannot come to disagree about what a document is called.
"""

from __future__ import annotations

from dataclasses import dataclass

from capability_lab.domain.shop import ShopDocumentKind, ShopPayload


@dataclass(frozen=True, slots=True)
class ShopDocumentOption:
    """One shop document a reference may name, with the title an author reads it by."""

    kind: ShopDocumentKind
    document_id: str
    title: str


def shop_document_options(shop: ShopPayload) -> tuple[ShopDocumentOption, ...]:
    """Every document the shop holds, policies first, in each collection's own order."""
    return (
        *(
            ShopDocumentOption(
                kind=ShopDocumentKind.POLICY, document_id=policy.id, title=policy.title
            )
            for policy in shop.policies
        ),
        *(
            ShopDocumentOption(
                kind=ShopDocumentKind.SUPPORT_GUIDELINE,
                document_id=guideline.id,
                title=guideline.title,
            )
            for guideline in shop.support_guidelines
        ),
        *(
            ShopDocumentOption(
                kind=ShopDocumentKind.FAQ_ENTRY, document_id=entry.id, title=entry.question
            )
            for entry in shop.faq
        ),
    )
