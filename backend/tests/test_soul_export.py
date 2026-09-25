"""`GET /api/v1/souls/export/?ids=…` — the /souls batch bar's 「导出」.

Same scope as the list (`SoulViewSet.get_queryset`), same codename (`soul.read`).
The cross-tenant caller is a custom role, not ADMIN: ADMIN is tenant-exempt, so
an ADMIN test could not tell a working tenant check from a missing one.
"""
import csv
import io
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Permission, Role, RolePermission
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

URL = "/api/v1/souls/export/"


def _client_for(user, tenant):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def _role(name, *codenames):
    role = Role.objects.create(name=name, display_name=name)
    for codename in codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    return role


@pytest.fixture
def world(db):
    invalidate_all_permissions()
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "Duat"})
    _role("EXPORTER", "soul.read")
    _role("BLIND", "ledger.read")
    reader = User.objects.create_user(username="ex_reader", password="x", role="EXPORTER", tenant=cn)
    blind = User.objects.create_user(username="ex_blind", password="x", role="BLIND", tenant=cn)
    souls = [
        Soul.objects.create(name="乙魂", tenant=cn, current_state=SoulState.ALIVE, merit_score=5),
        Soul.objects.create(name="甲魂", tenant=cn, current_state=SoulState.ALIVE, demerit_score=2),
        Soul.objects.create(name="=HYPERLINK(\"http://evil\",\"x\")", tenant=cn, current_state=SoulState.ALIVE),
    ]
    foreign = Soul.objects.create(name="Sennedjem", tenant=eg, current_state=SoulState.ALIVE)
    yield {"souls": souls, "foreign": foreign, "reader": _client_for(reader, cn), "blind": _client_for(blind, cn)}
    invalidate_all_permissions()


def _rows(response):
    assert response.status_code == 200, response.content
    assert response["Content-Type"].startswith("text/csv")
    header, *rows = list(csv.reader(io.StringIO(response.content.decode())))
    assert header[:2] == ["Soul ID", "Name"]
    return rows


def _ids(*souls):
    return ",".join(str(s.pk) for s in souls)


@pytest.mark.django_db
def test_the_file_holds_exactly_the_selected_souls(world):
    a, b, _ = world["souls"]
    rows = _rows(world["reader"].get(URL, {"ids": _ids(a, b)}))
    # Ordered by name, but CJK order is the database's collation (PG and SQLite may differ): not pinned.
    assert sorted(r[1] for r in rows) == sorted(["甲魂", "乙魂"])
    assert [r[0] for r in rows if r[1] == "乙魂"] == [str(a.pk)]
    assert len(rows) == 2


@pytest.mark.django_db
def test_another_tenants_soul_is_simply_not_in_the_file(world):
    a = world["souls"][0]
    rows = _rows(world["reader"].get(URL, {"ids": _ids(a, world["foreign"])}))
    assert [r[0] for r in rows] == [str(a.pk)]
    assert "Sennedjem" not in {r[1] for r in rows}


@pytest.mark.django_db
def test_a_deleted_soul_is_not_exported(world):
    a, b, _ = world["souls"]
    Soul.all_objects.filter(pk=b.pk).update(is_deleted=True)
    rows = _rows(world["reader"].get(URL, {"ids": _ids(a, b), "show_deleted": "true"}))
    assert [r[0] for r in rows] == [str(a.pk)]


@pytest.mark.django_db
def test_a_formula_name_is_neutralised(world):
    evil = world["souls"][2]
    rows = _rows(world["reader"].get(URL, {"ids": _ids(evil)}))
    assert rows[0][1].startswith("'=")


@pytest.mark.django_db
def test_without_soul_read_it_is_refused(world):
    assert world["blind"].get(URL, {"ids": _ids(world["souls"][0])}).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("ids", ["", "not-a-uuid", ",".join(str(uuid.uuid4()) for _ in range(101))])
def test_bad_ids_are_a_400_not_a_file(world, ids):
    response = world["reader"].get(URL, {"ids": ids})
    assert response.status_code == 400
    assert "ids" in response.json()
