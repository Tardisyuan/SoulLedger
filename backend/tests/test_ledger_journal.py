"""GET /api/v1/ledger/journal/ — 功过总账的四柱与流水(apps/ledger/journal.py)。

四柱必须自己平:旧管 + 新收 − 开除 = 实在,且每一柱都只数本租户、只数
MERIT / DEMERIT、只数原值。下面每一条都先造出会让它错的那一行。
"""
import datetime as dt

import pytest

from apps.souls.models import Soul, SoulState
from apps.souls.record_models import RecordType, SoulRecord
from tests import sentence_plan_support as plan

URL = "/api/v1/ledger/journal/"
UTC = dt.UTC


def _record(soul, kind, weight, when, *, category="OTHER", description="x"):
    rec = SoulRecord.objects.create(
        soul=soul, record_type=kind, weight=weight, category=category, description=description,
    )
    SoulRecord.all_objects.filter(pk=rec.pk).update(recorded_at=when)
    return rec


def _grant(role_name, *codenames):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})
    for codename in codenames:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]}
        )
        RolePermission.objects.get_or_create(role=role, permission=permission)


def _login(client, user, *codenames):
    """A real caller: role grants in the DB and a `tenant_code` claim — the
    shape tests/test_judgment_evidence_and_draft.py uses. `force_authenticate`
    sets no tenant, which would test the fail-closed branch instead."""
    from rest_framework_simplejwt.tokens import RefreshToken

    _grant(user.role, *codenames)
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def cn():
    return plan.tenant("CN_DIYU")


@pytest.fixture
def souls(db, cn):
    a = Soul.objects.create(name="甲", tenant=cn, current_state=SoulState.ALIVE)
    b = Soul.objects.create(name="乙", tenant=cn, current_state=SoulState.ALIVE)
    # May: opening material. June: the period. July: must not leak in.
    _record(a, RecordType.MERIT, 30, dt.datetime(2026, 5, 10, tzinfo=UTC))
    _record(a, RecordType.DEMERIT, 12, dt.datetime(2026, 5, 11, tzinfo=UTC))
    _record(a, RecordType.MERIT, 40, dt.datetime(2026, 6, 1, 0, 0, tzinfo=UTC), category="CHARITY")
    _record(b, RecordType.DEMERIT, 25, dt.datetime(2026, 6, 15, 8, 30, tzinfo=UTC), category="DECEPTION")
    _record(b, RecordType.MERIT, 5, dt.datetime(2026, 6, 30, 23, 59, tzinfo=UTC), category="CHARITY")
    # Evidence rows have no direction and are not in the ledger.
    _record(b, RecordType.JUDGMENT, 99, dt.datetime(2026, 6, 16, tzinfo=UTC))
    _record(a, RecordType.MERIT, 77, dt.datetime(2026, 7, 1, 0, 0, tzinfo=UTC))
    return a, b


@pytest.mark.django_db
class TestPillars:
    def test_the_four_pillars_balance_and_count_only_the_month(self, api_client, judge_user, souls):
        _login(api_client, judge_user, "ledger.read")
        body = api_client.get(URL, {"month": "2026-06"}).json()
        assert (body["opening"], body["received"], body["disbursed"], body["closing"]) == (18, 45, 25, 38)
        assert body["opening"] + body["received"] - body["disbursed"] == body["closing"]
        assert (body["record_count"], body["soul_count"], body["count"]) == (3, 2, 3)

    def test_rows_are_newest_first_with_a_utc_day_and_no_evidence_rows(self, api_client, judge_user, souls):
        _login(api_client, judge_user, "ledger.read")
        rows = api_client.get(URL, {"month": "2026-06"}).json()["results"]
        assert [(r["weight"], r["day"]) for r in rows] == [(5, "2026-06-30"), (25, "2026-06-15"), (40, "2026-06-01")]
        assert {r["record_type"] for r in rows} == {"MERIT", "DEMERIT"}
        assert rows[1]["soul_name"] == "乙" and rows[1]["soul_id"] == str(souls[1].pk)

    def test_categories_split_merit_from_demerit(self, api_client, judge_user, souls):
        _login(api_client, judge_user, "ledger.read")
        cats = api_client.get(URL, {"month": "2026-06"}).json()["categories"]
        assert cats == [
            {"category": "CHARITY", "merit": 45, "demerit": 0},
            {"category": "DECEPTION", "merit": 0, "demerit": 25},
        ]

    def test_a_filter_narrows_every_pillar_not_only_the_rows(self, api_client, judge_user, souls):
        _login(api_client, judge_user, "ledger.read")
        body = api_client.get(URL, {"month": "2026-06", "category": "CHARITY"}).json()
        assert (body["opening"], body["received"], body["disbursed"], body["closing"]) == (0, 45, 0, 45)
        assert body["count"] == 2

    def test_an_empty_month_is_zeros_with_the_opening_carried(self, api_client, judge_user, souls):
        _login(api_client, judge_user, "ledger.read")
        body = api_client.get(URL, {"month": "2026-08"}).json()
        assert (body["opening"], body["received"], body["disbursed"], body["closing"]) == (115, 0, 0, 115)
        assert body["results"] == [] and body["categories"] == []


@pytest.mark.django_db
class TestScope:
    def test_another_tenants_records_are_invisible(self, api_client, judge_user, souls):
        eg = plan.tenant("EG_DUAT")
        other = Soul.objects.create(name="外", tenant=eg, current_state=SoulState.ALIVE)
        _record(other, RecordType.MERIT, 50, dt.datetime(2026, 6, 2, tzinfo=UTC))
        _login(api_client, judge_user, "ledger.read")
        body = api_client.get(URL, {"month": "2026-06"}).json()
        assert body["received"] == 45
        assert "外" not in {r["soul_name"] for r in body["results"]}

    def test_a_deleted_souls_records_are_not_counted(self, api_client, judge_user, souls):
        Soul.all_objects.filter(pk=souls[1].pk).update(is_deleted=True)
        _login(api_client, judge_user, "ledger.read")
        body = api_client.get(URL, {"month": "2026-06"}).json()
        assert (body["received"], body["disbursed"]) == (40, 0)

    def test_anonymous_is_refused(self, api_client, souls):
        assert api_client.get(URL, {"month": "2026-06"}).status_code in (401, 403)


@pytest.mark.django_db
class TestParameters:
    @pytest.mark.parametrize("month", ["2026-13", "2026-6", "june", "2026-00"])
    def test_a_malformed_month_is_a_400_naming_the_field(self, api_client, judge_user, month):
        _login(api_client, judge_user, "ledger.read")
        response = api_client.get(URL, {"month": month})
        assert response.status_code == 400
        assert response.json()["field"] == "month"

    @pytest.mark.parametrize(("key", "value"), [("page", "0"), ("page", "x"), ("category", "NOPE")])
    def test_other_bad_parameters_are_400(self, api_client, judge_user, key, value):
        _login(api_client, judge_user, "ledger.read")
        response = api_client.get(URL, {"month": "2026-06", key: value})
        assert response.status_code == 400
        assert response.json()["field"] == key

    def test_december_rolls_into_the_next_year(self, api_client, judge_user, cn):
        soul = Soul.objects.create(name="岁末", tenant=cn, current_state=SoulState.ALIVE)
        _record(soul, RecordType.MERIT, 3, dt.datetime(2026, 12, 31, 23, 0, tzinfo=UTC))
        _record(soul, RecordType.MERIT, 4, dt.datetime(2027, 1, 1, 0, 0, tzinfo=UTC))
        _login(api_client, judge_user, "ledger.read")
        assert api_client.get(URL, {"month": "2026-12"}).json()["received"] == 3

    def test_the_second_page_continues_the_first(self, api_client, judge_user, cn):
        soul = Soul.objects.create(name="多", tenant=cn, current_state=SoulState.ALIVE)
        for i in range(23):
            _record(soul, RecordType.MERIT, 1, dt.datetime(2026, 6, 1, i % 24, tzinfo=UTC) + dt.timedelta(days=i))
        _login(api_client, judge_user, "ledger.read")
        first = api_client.get(URL, {"month": "2026-06"}).json()
        second = api_client.get(URL, {"month": "2026-06", "page": "2"}).json()
        assert (len(first["results"]), len(second["results"]), first["count"]) == (20, 3, 23)
        assert not {r["id"] for r in first["results"]} & {r["id"] for r in second["results"]}
