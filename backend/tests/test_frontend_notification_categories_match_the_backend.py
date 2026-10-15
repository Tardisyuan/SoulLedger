"""`packages/core/src/api/auth.ts` restates the notification categories and which cells are locked.

The web table greys out the locked cells from its own copy (`NOTIFICATION_LOCKED`); the server enforces them from
`apps/notifications/categories.py`. A copy that drifts would show a switch the server refuses (a 400 on click) or a
"必收" label on a cell that can in fact be turned off. The authority is `categories.py`.
"""
import re
from pathlib import Path

from apps.notifications import categories

AUTH_TS = Path(__file__).resolve().parents[2] / "packages" / "core" / "src" / "api" / "auth.ts"


def _source():
    return AUTH_TS.read_text(encoding="utf-8")


def test_the_category_list_is_the_backend_list_in_order():
    block = re.search(r"NOTIFICATION_CATEGORIES = \[(.*?)\] as const", _source(), re.S).group(1)
    assert tuple(re.findall(r'"([a-z_]+)"', block)) == categories.CATEGORIES


def test_the_locked_cells_are_the_backend_locked_cells():
    block = re.search(r"NOTIFICATION_LOCKED[^=]*= \{(.*?)\n\};", _source(), re.S).group(1)
    found = {name: tuple(re.findall(r'"(\w+)"', cells)) for name, cells in re.findall(r"(\w+): \[(.*?)\]", block)}
    assert found == categories.LOCKED
