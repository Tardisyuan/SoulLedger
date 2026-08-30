"""An e2e fixture must not carry a field its serializer does not send.

A fixture wider than the contract does not merely fail to catch a bug -- it
manufactures the behaviour the test then certifies. Three did, and each one
propped up an assertion that production cannot satisfy:

  * `WORKFLOW_INSTANCE.soul` held a Chinese personal name. On
    `ApprovalWorkflowListSerializer`, `soul` is the primary key -- a UUID.
    `workflow.spec.ts` asserted the row displays `WORKFLOW_INSTANCE.soul` and
    passed; the real page showed the UUID.
  * `PROPOSED_DISPATCH` carried `reason`, `dispatched_by`, `decided_at`,
    `create_time`, `update_time` -- none of which the *list* serializer emits.
    `critical-paths.spec.ts` asserted the pending card shows the proposal's
    reason and passed; the real card has no reason on it.
  * `OPENED_JUDGMENT` had `create_time` where `JudgmentSerializer` sends
    `created_at`, so `formatDate(judgment.created_at)` got undefined and threw
    `RangeError: Invalid time value`. **Every existing e2e that opened
    `/judgment/{id}` was looking at the error boundary, not at a judgment.**

Same shape as the mocked-away subject this repository already has on record:
the test exercises something the fixture invented.

Only *extra* keys are an error. A fixture may omit fields the page does not
read -- that is what makes it a fixture rather than a copy of the API.
"""
import json
import re
from pathlib import Path

import pytest

FIXTURES = (
    Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures.ts"
)

# fixture name -> serializer that produces it
PAIRS = [
    ("WORKFLOW_INSTANCE", "apps.workflow.serializers.ApprovalWorkflowListSerializer"),
    ("PROPOSED_DISPATCH", "apps.dispatch.serializers.DispatchRecordListSerializer"),
    ("OPENED_JUDGMENT", "apps.judgment.serializers.JudgmentSerializer"),
]


def _fixture_keys(name):
    """Top-level keys of `export const <name> = { ... };`.

    Deliberately shallow: only the object's own keys are compared, because
    that is the level at which the contract is a flat list of serializer
    fields.
    """
    text = FIXTURES.read_text(encoding="utf-8")
    match = re.search(
        rf"export const {re.escape(name)} = \{{(.*?)^\}};", text, re.S | re.M
    )
    assert match, f"{name} not found in {FIXTURES}"
    body = match.group(1)
    keys = set()
    depth = 0
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("//", "/*", "*")):
            continue
        if depth == 0:
            key = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*:", stripped)
            if key:
                keys.add(key.group(1))
        depth += stripped.count("{") + stripped.count("[")
        depth -= stripped.count("}") + stripped.count("]")
    return keys


def _serializer_fields(path):
    module_path, class_name = path.rsplit(".", 1)
    module = __import__(module_path, fromlist=[class_name])
    return set(getattr(module, class_name)().fields.keys())


def test_the_fixture_file_is_where_we_think_it_is():
    """Without this, a moved file makes every parametrized case vacuous."""
    assert FIXTURES.is_file(), FIXTURES
    assert "export const" in FIXTURES.read_text(encoding="utf-8")


@pytest.mark.parametrize("name,serializer_path", PAIRS)
def test_the_parser_actually_found_keys(name, serializer_path):
    """`set() - anything` is empty, and empty passes the real check silently."""
    assert len(_fixture_keys(name)) >= 4, (
        f"{name}: parsed fewer than 4 keys -- the regex has stopped matching, "
        f"which would make the assertion below pass for the wrong reason"
    )


@pytest.mark.parametrize("name,serializer_path", PAIRS)
def test_a_fixture_carries_no_field_its_serializer_does_not_send(
    name, serializer_path
):
    extra = _fixture_keys(name) - _serializer_fields(serializer_path)
    assert extra == set(), (
        f"{name} carries {sorted(extra)}, which {serializer_path.rsplit('.', 1)[1]} "
        f"does not send. A test asserting on those fields passes against a "
        f"response that will never contain them."
    )
