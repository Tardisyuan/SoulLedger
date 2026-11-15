"""Object level and write side of §7.5: a civilization ADMIN cannot read, change or act on another civilization's row.

The list differential (`test_admin_is_civilization_scoped.py`) compares what each caller *lists*. This file takes the
same random world and walks every router detail route of the same viewsets — retrieve, PATCH, and every custom
detail action, GET or POST — on rows it knows the hall of (a row is "of hall h" when h's own ADMIN lists it):

  * a civilization ADMIN of C, on a row of another civilization or of the unknown-civilization hall: 403 or 404,
    for every method;
  * the same caller on a row of one of C's halls, GET: exactly the status that hall's ADMIN gets;
  * SYSTEM_ADMIN on the other civilization's row: never 404 / never 5xx — it reaches the row; what it then gets is
    that action's own answer (200, 400 for an empty body, 409 for a state…).

Then the second gate on its own. Every route answers 404 through ``get_queryset`` before any object permission runs,
so the walk above stays green if ``TenantPermission``'s civilization check is deleted — the reviewer's mutation 7
left 489 tests green. ``test_the_object_gate_refuses_…`` calls ``check_object_permissions`` of each viewset that
carries ``TenantPermission``, for each detail action, with another civilization's row: the gate that stands alone
the day a ``get_queryset`` is wider than it (a ``_base_manager`` lookup, a residence OR).
"""
import pytest
from django.urls import get_resolver, reverse
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.core.permissions import TenantPermission
from apps.core.tenant import civilization_halls
from tests import test_admin_is_civilization_scoped as lists
from tests.test_tenant_scoping_contract import _model_for, _tenant_path

EMPTY_BY_DESIGN, _list_routes = lists.EMPTY_BY_DESIGN, lists._list_routes
world = lists.world  # the same random world, as this module's fixture

pytestmark = pytest.mark.django_db


def _detail_routes(cls):
    """(route name, URL kwarg, {method: action}) for each route of ``cls`` whose one kwarg is its lookup."""
    lookup = cls.lookup_url_kwarg or cls.lookup_field
    found = []

    def walk(resolver, ns):
        for pattern in resolver.url_patterns:
            if hasattr(pattern, "url_patterns"):
                walk(pattern, f"{ns}{pattern.namespace}:" if pattern.namespace else ns)
                continue
            if getattr(pattern.callback, "cls", None) is not cls or pattern.pattern.regex.groups != 1:
                continue
            kwarg = next(iter(pattern.pattern.regex.groupindex))
            actions = {m: a for m, a in (pattern.callback.actions or {}).items() if m in ("get", "post", "patch")}
            if pattern.name and actions and kwarg == lookup:
                found.append((f"{ns}{pattern.name}", kwarg, actions))

    walk(get_resolver(), "")
    return found


def _absent(cls):
    """A lookup value no row has: what "this row does not exist" answers on the route."""
    import uuid

    meta = _model_for(cls)._meta
    field = meta.pk if cls.lookup_field == "pk" else meta.get_field(cls.lookup_field)
    if field.get_internal_type() == "UUIDField":
        return str(uuid.uuid4())
    return "987654321" if field.get_internal_type().endswith("AutoField") else "NO_SUCH_ROW"


def _lookups(client, url, cls):
    """The lookup values (``pk``, or ``code`` for halls) of the rows ``client`` lists at ``url``, all pages."""
    keys = ("id", "pk") if cls.lookup_field == "pk" else (cls.lookup_field,)
    out = set()
    while url:
        body = client.get(url).json()
        rows = body.get("results", []) if isinstance(body, dict) else body
        out |= {str(row[k]) for row in rows for k in keys if k in row}
        url = body.get("next") if isinstance(body, dict) else None
    return out


def _rows_by_hall(world, list_url, cls):
    return {pk: _lookups(c, list_url, cls) for pk, c in world["hall_admin"].items()}


def _call(client, method, url):
    """One request, rolled back: an approve / delete must not change the row the next route is asked about. The
    throttle cache is cleared first — a thousand calls in a row would otherwise end in 429s, not answers."""
    from django.core.cache import cache
    from django.db import transaction

    cache.clear()
    client.raise_request_exception = False  # a 5xx is a status to report, not an exception that ends the walk
    with transaction.atomic():
        res = getattr(client, method)(url, {}, format="json") if method != "get" else client.get(url)
        transaction.set_rollback(True)
    return res


def test_a_civilization_admin_cannot_reach_another_civilizations_row_and_system_admin_can(world):
    other = {"CHINESE": "EGYPTIAN", "EGYPTIAN": "CHINESE"}
    unknown = world["unknown"].pk
    calls, problems, routes = 0, [], set()
    for list_name, cls in _list_routes():
        if list_name in EMPTY_BY_DESIGN:
            continue
        by_hall = _rows_by_hall(world, reverse(list_name), cls)
        for name, kwarg, actions in _detail_routes(cls):
            for civ, halls in world["halls"].items():
                mine = halls[0]
                theirs = world["halls"][other[civ]][0]
                own_rows, their_rows = sorted(by_hall[mine.pk]), sorted(by_hall[theirs.pk] - by_hall[mine.pk])
                if not own_rows or not their_rows:
                    continue
                routes.add(name)
                targets = [their_rows[0]] + sorted(by_hall[unknown] - by_hall[mine.pk])[:1]
                for method in actions:
                    # A 400 for an empty body, a 405, may come before any row is read: then the row's answer must
                    # be the answer for no row at all — the row is not reached, it is indistinguishable from absent.
                    nothing = _call(world["civ_admin"][civ], method, reverse(name, kwargs={kwarg: _absent(cls)}))
                    for row in targets:
                        url = reverse(name, kwargs={kwarg: row})
                        got = _call(world["civ_admin"][civ], method, url).status_code
                        calls += 1
                        if got not in (403, 404, nothing.status_code):
                            problems.append(f"{method.upper()} {url} as {civ} ADMIN (row of another civilization): "
                                            f"{got}; no such row: {nothing.status_code}")
                    if method == "get":
                        url = reverse(name, kwargs={kwarg: own_rows[0]})
                        hall_got = _call(world["hall_admin"][mine.pk], "get", url).status_code
                        civ_got = _call(world["civ_admin"][civ], "get", url).status_code
                        calls += 1
                        if (civ_got < 300) != (hall_got < 300):
                            problems.append(f"GET {url} as {civ} ADMIN: {civ_got}, its hall's ADMIN {hall_got}")
                # SYSTEM_ADMIN reaches the row: no 404 the row's own hall ADMIN does not also get (an action's own
                # 404 — `node_not_found` for a preview asked with no node — is not reach), and no crash. 503 is a
                # service this test box does not run (chat without Matrix), the same for everyone.
                for method in actions:
                    url = reverse(name, kwargs={kwarg: their_rows[0]})
                    got = _call(world["system"], method, url).status_code
                    calls += 1
                    if got == 404 and _call(world["hall_admin"][theirs.pk], method, url).status_code != 404:
                        problems.append(f"{method.upper()} {url} as SYSTEM_ADMIN: 404, the row's hall ADMIN reaches it")
                    if got >= 500 and got != 503:
                        problems.append(f"{method.upper()} {url} as SYSTEM_ADMIN: {got}")
    print(f"{len(routes)} detail routes, {calls} calls")
    assert not problems, f"seed={world['seed']}\n" + "\n".join(problems)
    # Every endpoint family the list differential has rows for: judgments, dispositions, dispatch, plans, workflow…
    assert {"judgment-detail", "disposition-detail", "dispatch-detail", "sentence-plan-detail",
            "approval-workflow-detail", "cross-tenant-judgment-detail", "soul-inbox-detail"} <= routes, sorted(routes)
    assert len(routes) >= 60, sorted(routes)


def _gate_refuses(cls, action, method, user, obj):
    request = Request(getattr(APIRequestFactory(), method)("/"))
    request.user, request.tenant = user, getattr(user, "tenant", None)
    view = cls()
    view.request, view.action, view.args, view.kwargs, view.format_kwarg = request, action, (), {}, None
    try:
        view.check_object_permissions(request, obj)
    except (PermissionDenied, NotFound):
        return True
    return False


#: Viewsets with ``TenantPermission`` whose object gate does not judge the hall, so their queryset is the only gate —
#: the same for a hall's ADMIN as for a civilization ADMIN. Exact: a gate that starts (or stops) judging the hall
#: fails the test until this says so.
QUERYSET_ONLY = {
    "ApprovalNodeViewSet": "no tenant column (workflow__tenant): the generic gate reads a column-less model as global",
    "LoginLogViewSet": "no tenant column (user__tenant)",
    "NotificationViewSet": "no tenant column (user__tenant); a caller's own notifications only",
    "UserProfileViewSet": "no tenant column (user__tenant)",
    "SoulAccountViewSet": "no tenant column (user__tenant)",
    "OfficerCooldownShorteningViewSet": "no tenant column (soul__tenant)",
    "InitialCredentialViewSet": "no tenant column (soul__tenant)",
    "OfficerRebirthApplicationViewSet": "no tenant column (soul__tenant)",
    "TenantViewSet": "a hall has no tenant column, it is one; scope_to_tenant(field='pk') narrows the queryset",
    "SocialMuteViewSet": "_MuteHallPermission answers True: a mute is the soul's current hall's (F-SOC-11), "
                         "which the queryset scopes and the row's own tenant column is not",
}


def test_the_object_gate_refuses_another_civilizations_row_on_its_own(world):
    """Each viewset with ``TenantPermission``, each detail action: the gate alone says no to another civilization's
    row, and yes to the caller's own (the hall's ADMIN is asked the same, so a gate that refuses everyone — some
    actions are refused to every administrator by another class — is not read as reach)."""
    checked, problems, open_gates = 0, [], set()
    for _name, cls in _list_routes():
        if not any(issubclass(p, TenantPermission) for p in cls.permission_classes):
            continue
        model, path = _model_for(cls), _tenant_path(_model_for(cls))
        lookup = "pk__in" if path == "pk" else f"{path}__in"
        for civ, other in (("CHINESE", "EGYPTIAN"), ("EGYPTIAN", "CHINESE")):
            user = world["civ_admin"][civ].user
            theirs = model._base_manager.filter(**{lookup: civilization_halls(other)}).first()
            mine = model._base_manager.filter(**{lookup: civilization_halls(civ)}).first()
            assert theirs is not None and mine is not None, (model.__name__, civ)
            for _route, _kwarg, actions in _detail_routes(cls):
                for method, action in actions.items():
                    checked += 1
                    if not _gate_refuses(cls, action, method, user, theirs):
                        open_gates.add(cls.__name__)
                        if cls.__name__ not in QUERYSET_ONLY:
                            problems.append(f"{cls.__name__}.{action} ({method}) lets {civ} ADMIN at {other}'s row")
                    if _gate_refuses(cls, action, method, user, mine) and not _refused_to_everyone(
                            world, cls, action, method, mine):
                        problems.append(f"{cls.__name__}.{action} ({method}) refuses {civ} ADMIN its own row")
    print(f"{checked} object-gate checks")
    assert not problems, f"seed={world['seed']}\n" + "\n".join(problems)
    assert open_gates == set(QUERYSET_ONLY), (sorted(open_gates ^ set(QUERYSET_ONLY)))
    assert checked >= 100, checked


def _refused_to_everyone(world, cls, action, method, obj):
    hall_client = next(c for c in world["hall_admin"].values() if c.hall.pk == _hall_of(obj))
    return _gate_refuses(cls, action, method, hall_client.user, obj) and _gate_refuses(
        cls, action, method, world["system"].user, obj)


def _hall_of(obj):
    from apps.tenants.models import Tenant

    if isinstance(obj, Tenant):
        return obj.pk
    value = obj
    for part in _tenant_path(type(obj)).split("__"):
        value = getattr(value, part)
    return value.pk
