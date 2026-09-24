"""`POST /api/v1/souls/batch-recycle/` — several souls to the recycle bin, all or none.

The endpoint is the single delete (`SoulViewSet.destroy`) applied per id inside
one transaction. So most assertions here are comparisons against what the
single path does, not a second restatement of the rules:

  * who may call it       — the same codename (`soul.delete`);
  * which ids it reaches  — the same queryset; an id the single delete answers
                            with 404 is a 404 here, and nothing is written;
  * what a delete does    — the same `Soul.delete_with_cascade`: cascade id,
                            dependent records, one DELETE audit row per row.

The cross-tenant caller is a custom role holding `soul.delete`, not an ADMIN:
ADMIN is tenant-exempt (`apps/core/tenant.py:is_tenant_exempt`), so an ADMIN
test could not tell a working tenant check from a missing one.
"""
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.authentication.models import User, UserRole
from apps.judgment.models import Judgment
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import RecordType, SoulRecord
from apps.souls.serializers import SOUL_BATCH_RECYCLE_MAX
from apps.tenants.models import Tenant

URL = "/api/v1/souls/batch-recycle/"


def _client_for(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _grant(role, *codenames):
    for codename in codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    for name in UserRole.values:
        Role.objects.get_or_create(name=name, defaults={"display_name": name.title()})

    clerk_role = Role.objects.create(name="RECYCLER", display_name="回收员")
    _grant(clerk_role, "soul.read", "soul.delete")
    clerk = User.objects.create_user(username="br_clerk", password="x", role="RECYCLER", tenant=cn)

    reader_role = Role.objects.create(name="READER", display_name="只读")
    _grant(reader_role, "soul.read")
    reader = User.objects.create_user(username="br_reader", password="x", role="READER", tenant=cn)

    admin = User.objects.create_user(username="br_admin", password="x", role="ADMIN", tenant=cn)

    souls = [
        Soul.objects.create(name=f"批量{i}", tenant=cn, current_state=SoulState.ALIVE) for i in range(3)
    ]
    record = SoulRecord.objects.create(
        soul=souls[0], record_type=RecordType.MERIT, description="施粥", weight=3,
    )
    pending = Judgment.objects.create(soul=souls[0], civilization=Civilization.CHINESE)
    foreign = Soul.objects.create(name="Sennedjem", tenant=eg, current_state=SoulState.ALIVE)
    yield {
        "cn": cn, "eg": eg, "souls": souls, "record": record, "pending": pending,
        "foreign": foreign, "clerk": _client_for(clerk, cn), "clerk_user": clerk,
        "reader": _client_for(reader, cn), "admin": _client_for(admin, cn),
    }
    invalidate_all_permissions()


def _ids(*souls):
    return [str(s.pk) for s in souls]


def _deleted(*souls):
    return [Soul.all_objects.get(pk=s.pk).is_deleted for s in souls]


# ── happy path ────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_every_soul_is_recycled_with_its_own_cascade(world):
    souls = world["souls"]
    response = world["clerk"].post(URL, {"ids": _ids(*souls), "reason": "重复录入"}, format="json")
    assert response.status_code == 200, response.content

    body = response.json()
    assert body["recycled"] == 3
    assert [r["id"] for r in body["results"]] == _ids(*souls)
    assert _deleted(*souls) == [True, True, True]

    # Each soul gets its OWN cascade id — one bin entry per soul, restorable
    # one at a time — exactly as three single deletes would.
    cascade_ids = [r["cascade_id"] for r in body["results"]]
    assert len(set(cascade_ids)) == 3
    for soul, cascade_id in zip(souls, cascade_ids, strict=True):
        row = Soul.all_objects.get(pk=soul.pk)
        assert str(row.delete_cascade_id) == cascade_id
        assert row.delete_reason == "重复录入"

    # delete_with_cascade's dependents came along, under the parent's id.
    record = SoulRecord.all_objects.get(pk=world["record"].pk)
    pending = Judgment.all_objects.get(pk=world["pending"].pk)
    assert record.is_deleted and pending.is_deleted
    assert str(record.delete_cascade_id) == cascade_ids[0]
    assert str(pending.delete_cascade_id) == cascade_ids[0]

    # And they are gone from the list the bar sits on.
    listed = world["clerk"].get("/api/v1/souls/").json()["results"]
    assert not {s["id"] for s in listed} & set(_ids(*souls))


def _audit_deletes(capture, call):
    """DELETE audit rows `call` writes. They are `transaction.on_commit`
    callbacks (apps/audit/signals.py), which never run inside the test's
    rolled-back transaction — hence `execute=True`."""
    before = set(AuditLog.objects.filter(action="DELETE").values_list("pk", flat=True))
    with capture(execute=True):
        response = call()
    rows = AuditLog.objects.filter(action="DELETE").exclude(pk__in=before)
    return response, sorted((r.resource, r.resource_id, r.user_id) for r in rows)


@pytest.mark.django_db
def test_audit_rows_are_the_single_deletes_rows(world, django_capture_on_commit_callbacks):
    """One DELETE row per soul and per cascaded dependent, and the same author
    the single delete records — compared against the single path on a twin
    soul, not against a hand-kept expectation."""
    a, b, _ = world["souls"]
    b_record = SoulRecord.objects.create(soul=b, record_type=RecordType.DEMERIT, description="d", weight=1)

    single_resp, single = _audit_deletes(
        django_capture_on_commit_callbacks, lambda: world["clerk"].delete(f"/api/v1/souls/{b.pk}/")
    )
    assert single_resp.status_code == 204
    assert [(r, pk) for r, pk, _ in single] == [("soul", str(b.pk)), ("soulrecord", str(b_record.pk))]

    batch_resp, batch = _audit_deletes(
        django_capture_on_commit_callbacks,
        lambda: world["clerk"].post(URL, {"ids": _ids(a)}, format="json"),
    )
    assert batch_resp.status_code == 200, batch_resp.content
    assert [(r, pk) for r, pk, _ in batch] == sorted([
        ("judgment", str(world["pending"].pk)),
        ("soul", str(a.pk)),
        ("soulrecord", str(world["record"].pk)),
    ])
    # Both paths record the officer who pressed the button. This used to be
    # NULL for both: destroy() and batch_recycle bypass perform_destroy, which
    # was the only place the audit user was set. AuditUserViewSetMixin.initial
    # now sets it for every action (apps/core/viewsets.py).
    clerk_id = world["clerk_user"].pk
    assert {u for _, _, u in single} == {clerk_id}
    assert {u for _, _, u in batch} == {clerk_id}


@pytest.mark.django_db
def test_archive_records_its_author_too(world, django_capture_on_commit_callbacks):
    """`archive` is another @action write that never reached perform_*; the
    report that found the NULL author inferred it here and did not measure it."""
    a, _, _ = world["souls"]
    Judgment.objects.create(soul=a, civilization=Civilization.CHINESE, verdict="HEAVEN")
    before = set(AuditLog.objects.values_list("pk", flat=True))
    with django_capture_on_commit_callbacks(execute=True):
        response = world["admin"].post(f"/api/v1/souls/{a.pk}/archive/", {"reason": "结案归档"}, format="json")
    assert response.status_code == 200, response.content
    rows = AuditLog.objects.exclude(pk__in=before).filter(resource="soul", resource_id=str(a.pk))
    assert rows.exists()
    admin_id = User.objects.get(username="br_admin").pk
    assert set(rows.values_list("user_id", flat=True)) == {admin_id}


@pytest.mark.django_db
def test_a_refused_batch_writes_no_audit_rows(world, django_capture_on_commit_callbacks):
    a, b, c = world["souls"]
    Judgment.objects.create(soul=c, civilization=Civilization.CHINESE, verdict="HEAVEN")
    response, rows = _audit_deletes(
        django_capture_on_commit_callbacks,
        lambda: world["clerk"].post(URL, {"ids": _ids(a, b, c)}, format="json"),
    )
    assert response.status_code == 409
    assert rows == []


# ── the tenant check, and atomicity ───────────────────────────────────


@pytest.mark.django_db
def test_a_cross_tenant_id_is_404_like_the_single_delete_and_nothing_moves(world):
    souls, foreign = world["souls"], world["foreign"]
    single = world["clerk"].delete(f"/api/v1/souls/{foreign.pk}/")
    assert single.status_code == 404

    response = world["clerk"].post(URL, {"ids": _ids(souls[0], foreign, souls[1])}, format="json")
    assert response.status_code == 404, response.content
    assert response.json()["code"] == "not_found"
    assert response.json()["ids"] == [str(foreign.pk)]
    # Absence, not only presence: the reachable souls in the same request stay.
    assert _deleted(souls[0], souls[1], foreign) == [False, False, False]
    assert not SoulRecord.all_objects.get(pk=world["record"].pk).is_deleted


@pytest.mark.django_db
def test_a_refusal_after_writes_began_rolls_all_of_them_back(world):
    """The 409 path is decided INSIDE the transaction, after earlier souls in
    the list were already soft-deleted — this is the atomicity test."""
    a, b, c = world["souls"]
    Judgment.objects.create(soul=c, civilization=Civilization.CHINESE, verdict="HEAVEN")
    assert Soul.objects.get(pk=c.pk).has_concluded_judgment

    response = world["clerk"].post(URL, {"ids": _ids(a, b, c)}, format="json")
    assert response.status_code == 409, response.content
    body = response.json()
    assert body["code"] == "not_deletable"
    assert body["ids"] == [str(c.pk)]
    assert body["archivable"] is True
    assert _deleted(a, b, c) == [False, False, False]
    assert not SoulRecord.all_objects.get(pk=world["record"].pk).is_deleted
    assert not Judgment.all_objects.get(pk=world["pending"].pk).is_deleted


@pytest.mark.django_db
def test_an_already_deleted_id_is_404_like_the_single_delete(world):
    a, b, _ = world["souls"]
    world["clerk"].delete(f"/api/v1/souls/{a.pk}/")
    assert world["clerk"].delete(f"/api/v1/souls/{a.pk}/").status_code == 404

    response = world["clerk"].post(URL, {"ids": _ids(a, b)}, format="json")
    assert response.status_code == 404, response.content
    assert response.json()["ids"] == [str(a.pk)]
    assert _deleted(b) == [False]
    # show_deleted opts the LIST back in; it must not let a recycle re-delete.
    response = world["clerk"].post(f"{URL}?show_deleted=true", {"ids": _ids(a)}, format="json")
    assert response.status_code == 404


@pytest.mark.django_db
def test_an_unknown_id_is_404(world):
    response = world["clerk"].post(URL, {"ids": [str(uuid.uuid4())]}, format="json")
    assert response.status_code == 404


# ── permission ────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_without_soul_delete_it_is_403_and_nothing_moves(world):
    souls = world["souls"]
    assert world["reader"].delete(f"/api/v1/souls/{souls[0].pk}/").status_code == 403
    response = world["reader"].post(URL, {"ids": _ids(*souls)}, format="json")
    assert response.status_code == 403, response.content
    assert _deleted(*souls) == [False, False, False]


@pytest.mark.django_db
def test_anonymous_is_refused(world):
    response = APIClient().post(URL, {"ids": _ids(*world["souls"])}, format="json")
    assert response.status_code == 401
    assert _deleted(*world["souls"]) == [False, False, False]


@pytest.mark.django_db
def test_admin_reaches_other_tenants_as_the_single_delete_does(world):
    foreign = world["foreign"]
    response = world["admin"].post(URL, {"ids": _ids(foreign)}, format="json")
    assert response.status_code == 200, response.content
    assert _deleted(foreign) == [True]


# ── input validation ──────────────────────────────────────────────────


@pytest.mark.django_db
@pytest.mark.parametrize(
    "body",
    [
        {},
        {"ids": []},
        {"ids": "not-a-list"},
        {"ids": ["not-a-uuid"]},
        {"ids": [str(uuid.uuid4())], "reason": "x" * 501},
    ],
    ids=["missing", "empty", "not-a-list", "not-a-uuid", "reason-too-long"],
)
def test_malformed_input_is_400(world, body):
    response = world["clerk"].post(URL, body, format="json")
    assert response.status_code == 400, response.content


@pytest.mark.django_db
def test_over_the_cap_is_400_and_the_cap_itself_is_not(world):
    over = [str(uuid.uuid4()) for _ in range(SOUL_BATCH_RECYCLE_MAX + 1)]
    response = world["clerk"].post(URL, {"ids": over}, format="json")
    assert response.status_code == 400
    assert "ids" in response.json()
    # Exactly the cap passes validation and reaches the lookup (404: unknown ids).
    at_cap = over[:SOUL_BATCH_RECYCLE_MAX]
    assert world["clerk"].post(URL, {"ids": at_cap}, format="json").status_code == 404


@pytest.mark.django_db
def test_a_duplicate_id_is_400_and_nothing_moves(world):
    a, b, _ = world["souls"]
    response = world["clerk"].post(URL, {"ids": _ids(a, b, a)}, format="json")
    assert response.status_code == 400, response.content
    assert str(a.pk) in str(response.json()["ids"])
    assert _deleted(a, b) == [False, False]


@pytest.mark.django_db
def test_a_view_called_without_the_middleware_leaves_no_current_user(world):
    """initial() sets the audit user; finalize_response() must clear it.

    Without the clear, a view called straight through APIRequestFactory (no
    RequestContextMiddleware) kept its user in the contextvar, and the NEXT
    test's writes recorded it: test_a_leap_day_soul_can_have_its_ledger_read
    failed at teardown on tenants_tenant.update_user_id pointing at a user
    that test never created."""
    from rest_framework.test import APIRequestFactory, force_authenticate

    from apps.core.request_local import get_current_user
    from apps.souls.views import SoulViewSet

    admin = User.objects.get(username="br_admin")
    request = APIRequestFactory().get("/api/v1/souls/")
    force_authenticate(request, user=admin)
    response = SoulViewSet.as_view({"get": "list"})(request)
    # A request that got past authentication and permissions, so initial()
    # did set the user — otherwise this would prove nothing.
    assert response.status_code == 200, response.data
    assert get_current_user() is None
