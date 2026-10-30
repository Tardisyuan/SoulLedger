"""One request asks the permission cache (Redis) each (role, codename) once (perf-audit A5, 2026-10-30).

The sidebar (`/menus/list-public/`) runs `menu_is_visible_to` per menu, and each menu's codename used to be a
Redis GET — dozens per page. The memo lives on the request (`apps/perm/cache.py::_request_memo`) and any
invalidation clears it, so a matrix write and a check in the same request still agree.

Mutation: drop the memo lookup in `PermissionCache.get` → the same (role, codename) reaches the backend once per
menu → red.
"""
from types import SimpleNamespace
from unittest import mock

import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.request_local import clear_current_user, set_current_request
from apps.menus.models import Menu
from apps.perm.cache import PermissionCache, get_permission_cache

pytestmark = pytest.mark.django_db


@pytest.fixture
def backend_lookups():
    calls = []
    original = PermissionCache._get

    def spy(self, role, codename):
        calls.append((role, codename))
        return original(self, role, codename)

    with mock.patch.object(PermissionCache, "_get", spy):
        yield calls


def test_a_sidebar_request_asks_each_role_codename_pair_once(api_client, judge_user, cn_tenant, backend_lookups):
    for i in range(12):
        Menu.objects.create(name=f"M{i}", path=f"/m{i}", order=900 + i, is_active=True, roles=["ADMIN"],
                            permission="soul.read" if i % 2 else "judgment.read")
    token = RefreshToken.for_user(judge_user)
    token["tenant_code"] = cn_tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    response = api_client.get("/api/v1/menus/list-public/")
    assert response.status_code == 200
    asked = [c for c in backend_lookups if c[1] in ("soul.read", "judgment.read")]
    assert asked, "the probe saw no permission lookups; it proves nothing"
    assert len(backend_lookups) == len(set(backend_lookups)), f"asked twice in one request: {backend_lookups}"
    # The ceiling the sidebar may cost, whatever the menu count: every distinct pair once.
    assert len(asked) <= 2


def test_an_invalidation_in_the_same_request_is_seen(backend_lookups):
    cache = get_permission_cache()
    set_current_request(SimpleNamespace())
    try:
        cache.set("JUDGE", "x.memo", True)
        assert cache.get("JUDGE", "x.memo") is True
        assert backend_lookups == [], "a value set in this request is answered from the memo"
        cache.invalidate_role("JUDGE")
        assert cache.get("JUDGE", "x.memo") is None
        assert backend_lookups == [("JUDGE", "x.memo")]
    finally:
        clear_current_user()


def test_outside_a_request_nothing_is_memoized(backend_lookups):
    cache = get_permission_cache()
    cache.set("JUDGE", "x.nomemo", True)
    cache.get("JUDGE", "x.nomemo")
    cache.get("JUDGE", "x.nomemo")
    assert backend_lookups == [("JUDGE", "x.nomemo")] * 2
