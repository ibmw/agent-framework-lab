"""Shared bounds for the listings that page by number.

Experiment history uses offset pagination with a total count, so a page can be addressed by
number and a listing can say what it is showing out of what; these constants bound the page
size. The POC's persona and conversation listings introduced them and were removed by
ADR 0034 — the bounds outlive them because history pages the same way and for the same
reason.
"""

from __future__ import annotations

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100
