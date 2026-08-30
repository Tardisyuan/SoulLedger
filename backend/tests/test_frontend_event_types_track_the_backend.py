"""The frontend's picture of `EventType` is checked against the real one.

`lib/events/event_registry.ts` holds `BACKEND_EVENT_TYPES`, a hand-copied list
of the backend enum, and `detectEventDrift()` compares `EVENT_REGISTRY` to it.
Both tables are in that one file and **neither end reads the backend**, so the
detector could only ever find a disagreement between two copies that drift
together. Measured 2026-08-29: it reported no drift while missing
`SETTLEMENT_CORRECTED`, which `Soul.correct_settlement` emits.

The consequence was not a missing label. `handleUnknownEvent` shows a bare
English toast and **invalidates nothing**, so a corrected settlement left the
open page showing the state it had just superseded -- exactly what the event
was added to prevent, per that method's own docstring.

This is the same answer this repo already reached seventeen times
(`test_frontend_page_size.py` and friends): compare against the authority, and
say which side the authority is. It is `apps.events.models.EventType`.
"""
import re
from pathlib import Path

import pytest

from apps.events.models import EventType

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
REGISTRY = FRONTEND / "lib" / "events" / "event_registry.ts"
HANDLERS = FRONTEND / "lib" / "events" / "eventHandlers.ts"

# Emitted by `event_bus.publish` rather than declared on EventType. Listed here
# so the extra-member check stays meaningful instead of being switched off.
KNOWN_EXTRA = {"NOTIFICATION_CREATED"}


def _backend_members():
    return {member.value for member in EventType}


def _listed_in(path, array_name):
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"{array_name}[^=]*=\s*\[(.*?)\]", text, re.S)
    assert match, f"{array_name} not found in {path.name}"
    return set(re.findall(r'"([A-Z_]+)"', match.group(1)))


def test_the_parser_found_the_list():
    """An empty parse makes the real assertions pass for the wrong reason."""
    assert REGISTRY.is_file(), REGISTRY
    assert len(_listed_in(REGISTRY, "BACKEND_EVENT_TYPES")) > 15


def test_the_frontends_copy_of_the_enum_is_complete():
    missing = _backend_members() - _listed_in(REGISTRY, "BACKEND_EVENT_TYPES")
    assert not missing, (
        f"BACKEND_EVENT_TYPES is missing {sorted(missing)}. `detectEventDrift()` "
        f"treats that list as the backend, so a member absent from it is a "
        f"drift the drift detector cannot report."
    )


def test_the_frontends_copy_invents_nothing():
    extra = (
        _listed_in(REGISTRY, "BACKEND_EVENT_TYPES") - _backend_members() - KNOWN_EXTRA
    )
    assert not extra, f"BACKEND_EVENT_TYPES lists {sorted(extra)}, which EventType has not"


def test_every_event_type_has_a_label():
    """`EVENT_LABELS` is a third copy, and an unlabelled event shows raw."""
    text = HANDLERS.read_text(encoding="utf-8")
    match = re.search(r"EVENT_LABELS[^=]*=\s*\{(.*?)\n\}", text, re.S)
    assert match, "EVENT_LABELS not found"
    labelled = set(re.findall(r"^\s*([A-Z_]+)\s*:", match.group(1), re.M))
    missing = _backend_members() - labelled
    assert not missing, f"EVENT_LABELS has no entry for {sorted(missing)}"


def _soul_domain_members():
    """The members under `# Soul audit events` in EventType.

    `souls.events.*` is the *soul timeline's* namespace, not a copy of the
    whole enum. My first version of the bundle test below compared it against
    every EventType member and reported nine social events as missing copy --
    they are missing on purpose; a post being liked does not belong on a
    soul's lifecycle. That was the wrong subject list, which is the failure
    this repository keeps finding in other people's guards.

    The section comments in `apps/events/models.py` are the only statement of
    which events belong to which domain, so they are what this reads. If
    someone regroups that enum, the assertion below says so rather than
    quietly measuring a different set.
    """
    import inspect

    from apps.events import models as events_models

    source = inspect.getsource(events_models.EventType)
    # Stop at the next *group* header, not at the next comment. Group headers
    # all read "# <Something> events"; the explanatory comment above
    # SETTLEMENT_CORRECTED does not, and an earlier version of this pattern
    # stopped there and parsed two members out of nine. The
    # `len(members) >= 5` assertion below is what caught that -- it is here
    # precisely because a regex that silently matches less is indistinguishable
    # from a codebase that has less.
    section = re.search(
        r"#\s*Soul audit events\s*\n(.*?)(?=\n\s*#[^\n]*\bevents\b)",
        source,
        re.S,
    )
    assert section, (
        "the `# Soul audit events` section of EventType was not found -- the "
        "enum has been regrouped and this test is measuring nothing"
    )
    members = set(re.findall(r"^\s*([A-Z_]+)\s*=", section.group(1), re.M))
    assert len(members) >= 5, f"parsed only {members} from the soul section"
    return members


@pytest.mark.parametrize("bundle", ["zh-Hans", "en", "egy"])
def test_every_soul_event_has_copy_in_every_bundle(bundle):
    """Key parity between the bundles cannot catch a key all three lack.

    All three were missing `souls.events.SETTLEMENT_CORRECTED` together, so
    parity held throughout. Only a comparison against the backend finds it.
    """
    import json

    data = json.loads(
        (FRONTEND / "messages" / f"{bundle}.json").read_text(encoding="utf-8")
    )
    events = data.get("souls", {}).get("events", {})
    assert events, f"souls.events is empty in {bundle}.json"
    missing = _soul_domain_members() - set(events)
    assert not missing, (
        f"{bundle}.json has no copy for {sorted(missing)} -- the soul timeline "
        f"renders an unrecognised-value placeholder for those"
    )


def test_the_soul_timeline_can_handle_every_soul_event():
    """A soul-domain event with no handler shows a toast and refreshes nothing.

    `handleUnknownEvent` does not invalidate any query, so a page open on that
    soul keeps showing the state the event just superseded.
    """
    text = REGISTRY.read_text(encoding="utf-8")
    block = re.search(r"soul:\s*\{(.*?)\n  \}", text, re.S)
    assert block, "EVENT_REGISTRY.soul not found"
    handled = set(re.findall(r"^\s*([A-Z_]+)\s*:", block.group(1), re.M))
    missing = _soul_domain_members() - handled
    assert not missing, f"EVENT_REGISTRY.soul has no handler for {sorted(missing)}"
