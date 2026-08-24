"""The page size, as both ends declare it.

Why this file exists
--------------------
`frontend/lib/api/client.ts` declares ``PAGE_SIZE = 20`` under a docstring
reading "Must match DRF's ``REST_FRAMEWORK["PAGE_SIZE"]`` in
backend/config/settings.py". Nothing made that true. Two integers in two
languages, joined by a sentence — the KEEP-IN-SYNC shape this repository has now
found in the colour tokens (`f62fdaa`), in `lib/chart-colors.ts`, and most
recently in a test helper whose comment claimed to be "the one prefix rule,
written once" from a directory production code cannot import.

That last one is why this file is being written now rather than in the pass that
found it. The general rule the drift keeps teaching is that a canonical
definition belongs where both the app and the check can reach it, and the check
asserts against it rather than restating it. Across a language boundary neither
side can import the other, so the mechanism has to be a test that *reads* one
side and compares it to the other — the device
`test_frontend_civilization_codes.py` beside this file already uses. Absent that,
the comment is doing the work of a mechanism, and a comment cannot fail.

What actually breaks
--------------------
The server decides how many rows a page holds; the client only derives a page
*count* from ``count``. So a mismatch does not raise anywhere. Six pages compute
``Math.ceil(data.count / PAGE_SIZE)`` — /judgment, /tenants, /social,
/social/profile/[id], /audit and their siblings — and every one of them would
draw a pager with the wrong number of pages, off by exactly the ratio of the two
constants, with the last page or two unreachable.

`app/audit/page.tsx` is worse than the rest: it *sends* ``page_size:
String(PAGE_SIZE)`` on the request. There the frontend constant stops being a
local derivation and becomes what the server is asked for, so a stale value
changes the response rather than mis-describing it.

Direction
---------
DRF is the authority and the frontend mirrors it, so this asserts the frontend's
literal against ``settings.REST_FRAMEWORK["PAGE_SIZE"]`` and never the reverse.
Nothing here keeps its own copy of 20: a forgotten literal being the failure
under test, this side must not own one.
"""
import re
from pathlib import Path

import pytest
from django.conf import settings

REPO_ROOT = Path(__file__).resolve().parents[2]
CLIENT_TS = REPO_ROOT / "frontend" / "lib" / "api" / "client.ts"


def _ts_page_size() -> int:
    """The integer `PAGE_SIZE` is exported as, read out of the TypeScript.

    Raises rather than returning a default when the declaration cannot be
    found. A cross-end test that silently compares the backend to a fallback is
    the failure mode this file exists to avoid, and it passes.
    """
    source = CLIENT_TS.read_text(encoding="utf-8")
    match = re.search(r"^export const PAGE_SIZE\s*=\s*(\d+)\s*;", source, re.MULTILINE)
    if match is None:
        raise AssertionError(
            f"Could not find `export const PAGE_SIZE = <int>;` in {CLIENT_TS}. "
            "Fix this parser; do not delete the comparison."
        )
    return int(match.group(1))


class TestPageSizeAgrees:
    def test_the_parser_is_looking_at_something(self):
        # If the file moves or the declaration changes shape, every assertion
        # below would compare the backend against nothing. This is the "mutate
        # the thing it guards" guard for the guard itself.
        assert CLIENT_TS.exists(), CLIENT_TS
        assert _ts_page_size() > 0

    def test_drf_declares_a_page_size_at_all(self):
        # The other half of the same worry. `REST_FRAMEWORK` without
        # PAGE_SIZE means DRF is not paginating, and comparing the frontend to
        # a KeyError is not a comparison.
        assert "PAGE_SIZE" in settings.REST_FRAMEWORK

    def test_frontend_mirrors_the_drf_setting(self):
        # The claim `client.ts` makes in prose, made checkable. The frontend is
        # the mirror and DRF is the authority: this compares in that direction
        # and the failure message says so, because "change the server to match
        # the client" is the wrong repair for a client-side page counter.
        assert _ts_page_size() == settings.REST_FRAMEWORK["PAGE_SIZE"], (
            f"{CLIENT_TS.name} declares PAGE_SIZE={_ts_page_size()} while DRF "
            f"serves {settings.REST_FRAMEWORK['PAGE_SIZE']} rows per page. The "
            "server decides; update the frontend constant."
        )

    def test_the_comment_still_points_at_the_setting_it_mirrors(self):
        # Kept deliberately, and it is not decoration. The comment is what a
        # reader of `client.ts` sees; if the constant were ever re-derived from
        # somewhere else — a config endpoint, an env var — the prose would go on
        # naming DRF and this test would go on comparing to DRF while the
        # runtime value came from a third place. Pinning the sentence to the
        # assertion keeps the explanation and the mechanism describing the same
        # join.
        source = CLIENT_TS.read_text(encoding="utf-8")
        assert "REST_FRAMEWORK" in source
        assert "backend/config/settings.py" in source


@pytest.mark.parametrize(
    "page",
    [
        "app/judgment/page.tsx",
        "app/tenants/page.tsx",
        "app/social/page.tsx",
        "app/audit/page.tsx",
    ],
)
def test_paginators_import_the_constant_rather_than_repeating_it(page):
    """No page may write 20 into its own `Math.ceil`.

    The constant existing does not stop a page from computing
    ``Math.ceil(count / 20)`` inline, and such a page is invisible to the
    assertion above — it would keep its own stale divisor while `client.ts` and
    DRF agreed perfectly. That is the same defect one level down, and it is the
    reason this parametrisation names files rather than trusting the export to
    be the only path.
    """
    source = (REPO_ROOT / "frontend" / page).read_text(encoding="utf-8")
    assert "PAGE_SIZE" in source, f"{page} no longer references PAGE_SIZE"
    inline = re.search(r"Math\.ceil\([^)]*/\s*\d+\s*\)", source)
    assert inline is None, (
        f"{page} divides by a literal ({inline.group(0)}) instead of PAGE_SIZE."
    )
