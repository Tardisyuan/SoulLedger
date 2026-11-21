"""「未结」的两种写法答案相同:实例上的 `Judgment.is_open` / `is_concluded` 与查询里的 `OPEN_Q` / `NOT_CONCLUDED_Q`
(审计 2026-11-20 §4 #3)。逐格跑 裁决 × 已封 × 归档 × 软删 十六种组合,两种 manager 都比。

另守「归档」只收已有裁决的案子 —— 「未结」不看 `is_archived` 的前提:API 上 `JudgmentViewSet.archive` 拒无裁决的,
Django admin 里裁决、封印与归档列只读。两处任一放开,就做得出「已归档的未结案件」,这里红。

16 格里归档那一维不改变答案(已归档未结的两格算未结):那两格只能用 `.update` 造出来,正常路径到不了。
"""
import itertools

import pytest
from django.contrib import admin
from django.test import RequestFactory
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.judgment.models import NOT_CONCLUDED_Q, OPEN_Q, Judgment, Verdict
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.conftest import sign_in

GRID = list(itertools.product([None, Verdict.values[0]], [False, True], [False, True], [False, True]))


@pytest.fixture
def tenant(db):
    return Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN_DIYU"})[0]


def _case(tenant, n):
    soul = Soul.objects.create(name=f"案主{n}", tenant=tenant, current_state=SoulState.JUDGING)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant)


def _pks(qs):
    return set(qs.values_list("pk", flat=True))


@pytest.mark.django_db
def test_the_property_and_the_q_agree_on_every_combination(tenant):
    rows = {}
    for n, (verdict, is_final, is_archived, is_deleted) in enumerate(GRID):
        pk = _case(tenant, n).pk
        Judgment.all_objects.filter(pk=pk).update(
            verdict=verdict, is_final=is_final, is_archived=is_archived, is_deleted=is_deleted)
        rows[pk] = Judgment.all_objects.get(pk=pk)

    ids = list(rows)
    is_open = {pk for pk, j in rows.items() if j.is_open}
    assert _pks(Judgment.all_objects.filter(OPEN_Q, pk__in=ids)) == is_open
    assert _pks(Judgment.objects.filter(OPEN_Q, pk__in=ids)) == is_open
    not_concluded = {pk for pk, j in rows.items() if not j.is_concluded}
    assert _pks(Judgment.all_objects.filter(NOT_CONCLUDED_Q, pk__in=ids)) == not_concluded

    # 绝对答案也钉住,免得两边一起错:未结 = 无裁决、未封、未软删(归档两种都算);不看软删的再多出软删的两格。
    assert {(rows[pk].verdict, rows[pk].is_final, rows[pk].is_deleted) for pk in is_open} == {(None, False, False)}
    assert len(is_open) == 2
    assert {(rows[pk].verdict, rows[pk].is_final) for pk in not_concluded} == {(None, False)}
    assert len(not_concluded) == 4


@pytest.mark.django_db
@pytest.mark.parametrize("is_final", [False, True], ids=["open", "sealed-without-verdict"])
def test_a_case_without_a_verdict_cannot_be_archived(tenant, is_final):
    judgment = _case(tenant, 0)
    Judgment.all_objects.filter(pk=judgment.pk).update(is_final=is_final)
    admin = User.objects.create_user(username="archiver", password="x", role=UserRole.SYSTEM_ADMIN, tenant=None)
    client = sign_in(APIClient(), admin)

    response = client.post(f"/api/v1/judgment/{judgment.pk}/archive/", {"reason": "x"}, format="json")

    assert response.status_code == 400, response.content
    assert Judgment.all_objects.get(pk=judgment.pk).is_archived is False


ADMIN_LOCKED = ["verdict", "is_final", "is_archived", "archived_at", "archived_by", "archive_reason"]


@pytest.mark.django_db
def test_the_admin_cannot_write_a_verdict_or_an_archive():
    superuser = User.objects.create_superuser(username="root", password="x")
    request = RequestFactory().get("/admin/judgment/judgment/add/")
    request.user = superuser
    model_admin = admin.site._registry[Judgment]

    assert set(ADMIN_LOCKED) <= set(model_admin.get_readonly_fields(request))
    form_fields = set(model_admin.get_form(request).base_fields)
    assert not form_fields & set(ADMIN_LOCKED), form_fields & set(ADMIN_LOCKED)
    assert {f.name for f in Judgment._meta.get_fields()} >= set(ADMIN_LOCKED)
