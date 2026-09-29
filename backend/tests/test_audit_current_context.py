"""`_current_context()` reads user / tenant / request for every audit write.

Each read has its own guard: one contextvar lookup that raises must yield None
for that value only, and never cost the row the other two.
"""
import pytest

from apps.audit.signals import _current_context

GETTERS = {
    "user": "apps.core.request_local.get_current_user",
    "tenant": "apps.tenants.managers.get_current_tenant",
    "request": "apps.core.request_local.get_current_request",
}


def _boom():
    raise LookupError("contextvar not set")


def _install(monkeypatch, broken=None):
    for name, target in GETTERS.items():
        value = f"the-{name}"
        monkeypatch.setattr(target, _boom if name == broken else (lambda v=value: v))


def test_returns_all_three_in_order(monkeypatch):
    _install(monkeypatch)
    assert _current_context() == ("the-user", "the-tenant", "the-request")


@pytest.mark.parametrize("broken", list(GETTERS))
def test_one_failing_read_blanks_only_itself(monkeypatch, broken):
    _install(monkeypatch, broken)
    got = dict(zip(GETTERS, _current_context(), strict=True))
    assert got.pop(broken) is None
    assert got == {name: f"the-{name}" for name in got}
