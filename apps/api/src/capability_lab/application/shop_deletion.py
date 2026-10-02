"""Deleting a shop that never published, with everything it holds (ADR 0077).

A shop with no published version has no ticket or scenario version, no snapshot and no
experiment, because each of those needs a published shop version (ADR 0012, ADR 0016,
ADR 0019). Such a shop is authored state and nothing else, so it can go whole: its draft, the
drafts of its tickets and scenarios, its orders, its attachments and its images. The
shop-independent definitions it had attached — profiles, identities, blocks, configurations,
judges — stay, because other shops may use them and none of them is the shop's.

The first write is one conditional statement: delete the shop's draft where no published
version of it and no experiment naming it exists. Everything else follows only when that one
removed a row. SQLite's single writer orders it against a publish and an upload (ADR 0077).

The use case removes rows only. Its shop's media directory is removed by composition after the
transaction has committed, because a file cannot be rolled back.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from capability_lab.application.shop_media import MediaStore
from capability_lab.application.shops import ShopNotFoundError

_logger = logging.getLogger(__name__)


class ShopPublishedError(ValueError):
    """Raised when a shop that has published — or that an experiment names — is asked to go.

    `published_versions` is how many versions the shop has published.
    """

    def __init__(self, shop_id: UUID, published_versions: int) -> None:
        if published_versions == 0:
            # No version to speak of: what keeps it is the record of a run, not a version.
            message = (
                f"shop {shop_id} is kept because an experiment names it: "
                "a recorded run is explained by the shop it ran on"
            )
        else:
            versions = "1 version" if published_versions == 1 else f"{published_versions} versions"
            message = (
                f"shop {shop_id} is kept because it has published {versions}: "
                "its versions are what experiments are explained by"
            )
        super().__init__(message)
        self.published_versions = published_versions


class ShopDrafts(Protocol):
    """The definition drafts a shop is: its own, and the ones scoped to it."""

    def exists(self, shop_id: UUID) -> bool: ...

    def delete_unpublished(self, shop_id: UUID) -> bool:
        """Delete the shop's own draft in one statement, only while it has no published version
        and no experiment names it. Answers whether a row was deleted."""
        ...

    def delete_scoped_to(self, shop_id: UUID) -> int:
        """Delete every draft scoped to the shop — its tickets and scenarios. Answers how many."""
        ...

    def published_version_count(self, shop_id: UUID) -> int: ...


class ShopOrderRemoval(Protocol):
    def delete_for_shop(self, shop_id: UUID) -> int:
        """Delete every order fixture of the shop. Answers how many."""
        ...


class ShopAttachmentRemoval(Protocol):
    def detach_shop(self, shop_id: UUID) -> int:
        """Delete every attachment naming the shop; the definitions attached stay. How many."""
        ...


class ShopMediaRemoval(Protocol):
    def delete_for_shop(self, shop_id: UUID) -> int:
        """Delete every image row the shop holds. Answers how many; the files are not touched."""
        ...


@dataclass(frozen=True, slots=True)
class DeletedShop:
    """What one delete removed, row by row. The directory is composition's, after the commit."""

    shop_id: UUID
    scoped_drafts: int
    orders: int
    attachments: int
    images: int


class ShopDeletionService:
    """Delete a shop that never published (ADR 0077)."""

    def __init__(
        self,
        drafts: ShopDrafts,
        orders: ShopOrderRemoval,
        attachments: ShopAttachmentRemoval,
        media: ShopMediaRemoval,
    ) -> None:
        self._drafts = drafts
        self._orders = orders
        self._attachments = attachments
        self._media = media
        self._deleted: UUID | None = None

    @property
    def deleted(self) -> UUID | None:
        """The shop this service deleted, once its rows are gone; none before or after a refusal.

        Composition reads it after the transaction has committed, to remove the shop's files.
        """
        return self._deleted

    def delete_shop(self, shop_id: UUID) -> DeletedShop:
        # The condition and the delete are one statement, so nothing can publish the shop or
        # start an experiment on it between the check and the write.
        if not self._drafts.delete_unpublished(shop_id):
            if not self._drafts.exists(shop_id):
                raise ShopNotFoundError(f"shop {shop_id} has no draft")
            raise ShopPublishedError(shop_id, self._drafts.published_version_count(shop_id))
        removed = DeletedShop(
            shop_id=shop_id,
            scoped_drafts=self._drafts.delete_scoped_to(shop_id),
            orders=self._orders.delete_for_shop(shop_id),
            attachments=self._attachments.detach_shop(shop_id),
            images=self._media.delete_for_shop(shop_id),
        )
        self._deleted = shop_id
        return removed


def remove_deleted_shop_files(store: MediaStore, shop_id: UUID) -> None:
    """Remove a deleted shop's media directory; called only once its rows are committed gone.

    A removal that fails leaves the directory behind, holding files no row names: never served,
    because serving reads the row first, and logged by the shop's ID alone so it can be swept by
    hand. The delete has already happened, so the failure is not the request's (ADR 0077).
    """
    try:
        store.remove_shop(shop_id)
    except OSError:
        _logger.warning("left the media directory of deleted shop %s behind", shop_id)
