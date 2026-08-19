"""Shared bounds for the list read models.

Both the persona library and the conversation history use offset pagination with a total
count, so a page can be addressed by number; these constants bound the page size.
"""

from __future__ import annotations

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100
