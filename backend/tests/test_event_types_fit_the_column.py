"""Every event type the code can write must fit `SoulEvent.event_type`.

Why this is a test and not a comment: `varchar(n)` is ENFORCED on PostgreSQL and ignored by SQLite (CLAUDE.md,
"SQLITE HIDES A WHOLE CLASS OF DEFECT"). The column was `max_length=30` while `REBIRTH_APPLICATION_SUBMITTED` is
29 characters: one more letter in any new type would have passed the whole SQLite suite and failed in production
-- and, since a failed `SoulEvent` insert now rolls the business write back and raises, it would have taken the
business write with it. Widened to 50 in `events.0020`.

Nothing here is a hand-written list. The types come from two places:
  * the `EventType` enum (what the column's `choices` say is allowed), and
  * every string literal handed to `EventService.log(...)` / `event_bus.publish_soul_event(...)` anywhere under
    `apps/` (found by walking the source), so a literal that was never added to the enum cannot dodge the first
    check. Each must also BE an `EventType` member: `choices` is not enforced on write, so an undeclared
    literal (`REINCARNATION_COMPLETED` was one) writes happily, and then the OpenAPI enum and the generated
    TypeScript types do not know it exists.
"""
import ast
from pathlib import Path

import pytest

from apps.events.models import EventType, SoulEvent

APPS = Path(__file__).resolve().parents[1] / "apps"
LOG_CALLS = {"log": 1, "publish_soul_event": 2}  # attribute name -> index of the event-type argument


def _width():
    return SoulEvent._meta.get_field("event_type").max_length


def _literals_passed_to_the_log():
    found = {}
    for path in APPS.rglob("*.py"):
        if "migrations" in path.parts or "tests" in path.parts or path.name.startswith("test"):
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            index = LOG_CALLS.get(node.func.attr)
            owner = getattr(node.func.value, "id", getattr(node.func.value, "attr", ""))
            if index is None or owner not in {"EventService", "event_bus"} or len(node.args) <= index:
                continue
            arg = node.args[index]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                found.setdefault(arg.value, f"{path.relative_to(APPS.parent)}:{node.lineno}")
    return found


def test_every_declared_event_type_fits_the_column():
    too_long = {t.value: len(t.value) for t in EventType if len(t.value) > _width()}
    assert not too_long, f"longer than SoulEvent.event_type ({_width()}): {too_long}"


def test_every_literal_event_type_written_by_the_code_is_declared_and_fits():
    literals = _literals_passed_to_the_log()
    assert literals, "the scan found no EventService.log(...) literals; it is looking in the wrong place"
    assert {k: v for k, v in literals.items() if len(k) > _width()} == {}
    declared = {t.value for t in EventType}
    assert {k: v for k, v in literals.items() if k not in declared} == {}, "written but not in EventType"


def test_the_column_is_not_so_tight_that_the_next_type_overflows():
    """Headroom, so the next long name is a decision and not an accident."""
    assert _width() - max(len(t.value) for t in EventType) >= 10


@pytest.mark.migration
def test_events_0020_widens_the_column_and_reverses(transactional_db):
    """Schema-only migration (`AlterField`, no `RunPython`): migrate 0019 -> 0020 -> 0019 -> 0020 and read the
    column's width in each historical state. The data round-trip harness is not used because it demands that the
    migration change a row's visible content, and a widening changes none. Reversing with a value longer than 30
    characters present would fail on PostgreSQL; there is no such row until 0020 is applied and one is written."""
    from tests.migration_roundtrip import migrate_to, migrate_to_latest

    def width(state):
        return state.get_model("events", "SoulEvent")._meta.get_field("event_type").max_length

    before, after = ("events", "0019_cooldown_shortening"), ("events", "0020_soulevent_event_type_max_length_50")
    try:
        assert width(migrate_to([before])) == 30
        assert width(migrate_to([after])) == 50
        assert width(migrate_to([before])) == 30
        assert width(migrate_to([after])) == 50
    finally:
        migrate_to_latest()
