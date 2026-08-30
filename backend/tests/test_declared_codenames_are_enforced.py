"""A view that declares a codename must attach the class that enforces it.

`apps/perm/test_codename_coverage.py` checks that every declared codename is
defined in the catalogue and held by some role. It cannot catch a codename
that nothing reads, and four viewsets were in that state: they set
`permission_codename` and listed `TenantPermission` alone.

One of them was leaking. Measured 2026-08-29, a VIEWER -- which does not hold
`audit.read` -- got 200 from `GET /api/v1/audit-logs/` and from `/timeline/`,
the permission-change timeline. `stats` was the only protected action, and only
because someone hand-wrote a role check inside it. The other three were latent:
`actors.read` and `realms.read` happen to be held by every role today, and
`user.manage` sits behind a stricter `IsAdminPermission`. "The codename happens
to be universal" is not a permission check.

This walks the live URLconf rather than a list of viewsets, for the reason
this codebase keeps rediscovering: a hand-written subject list is where guards
go blind. `apps/actors/` alone had a count guard with four independent
hand-copied duplicates, and a grep by filename found three.
"""
import pytest
from django.urls import get_resolver

from apps.core.permissions import CodenamePermission


def _routed_views():
    """Every view class reachable through the project's URLconf."""
    seen = {}

    def walk(patterns, prefix=""):
        for entry in patterns:
            if hasattr(entry, "url_patterns"):
                walk(entry.url_patterns, prefix + str(entry.pattern))
                continue
            callback = entry.callback
            cls = getattr(callback, "cls", None) or getattr(
                callback, "view_class", None
            )
            if cls is not None:
                seen.setdefault(cls, prefix + str(entry.pattern))

    walk(get_resolver().url_patterns)
    return seen


def test_the_walk_finds_something():
    """Without this, an empty result would make the real assertion vacuous.

    `assert not <empty>` is the failure shape this repository has on record;
    a resolver walk that silently returns nothing is exactly how it happens.
    """
    views = _routed_views()
    assert len(views) > 20, f"only {len(views)} routed views found"


def test_every_view_declaring_a_codename_also_enforces_it():
    unenforced = []
    declared = 0
    for cls, route in _routed_views().items():
        codename = getattr(cls, "permission_codename", None)
        extra = getattr(cls, "extra_permissions", None)
        if not codename and not extra:
            continue
        declared += 1
        classes = getattr(cls, "permission_classes", []) or []
        if any(issubclass(c, CodenamePermission) for c in classes):
            continue
        # A stricter gate is an acceptable substitute -- `IsAdminPermission`
        # admits fewer callers than any codename could. Named explicitly
        # rather than waved past: if it is ever loosened, this line has to be
        # revisited, and a comment is easier to find than an absence.
        names = {c.__name__ for c in classes}
        if "IsAdminPermission" in names:
            continue
        unenforced.append(f"{cls.__name__} ({route}) declares {codename!r}")

    assert declared > 10, (
        f"only {declared} views declare a codename -- the filter is wrong, "
        f"not the codebase"
    )
    assert unenforced == [], (
        f"{len(unenforced)} view(s) declare a permission codename and attach "
        f"nothing that reads it, which makes the declaration decorative: "
        f"{unenforced}"
    )


@pytest.mark.django_db
def test_a_viewer_cannot_read_the_audit_log(cn_tenant):
    """The leak itself, end to end, since the meta-test above is structural."""
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    User = get_user_model()
    viewer = User.objects.create_user(
        username="dc_viewer", password="x", role="VIEWER", tenant=cn_tenant
    )
    token = RefreshToken.for_user(viewer)
    token["tenant_code"] = cn_tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

    for path in ("/api/v1/audit-logs/", "/api/v1/audit-logs/timeline/"):
        resp = client.get(path)
        assert resp.status_code == 403, (
            f"VIEWER got {resp.status_code} from {path}. `audit.read` is held "
            f"by ADMIN and MODERATOR; /timeline/ is the permission-change log."
        )
