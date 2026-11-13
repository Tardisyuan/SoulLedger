"""VIEWER 看不到功过分 —— 每个出口都一样(审计 2026-11-11 P-02)。

灵魂详情与列表对 VIEWER 拿掉 `merit_score` / `demerit_score` / `karmic_balance`(`SoulSerializer` 上写明的底线),
而别的出口曾原样给出。口径与详情一致:**分数置 null、其余照给,不拒绝** —— 前端对 VIEWER 也读 `karma/` 的
`reading`(希腊行程块、冥界图)与 `inheritance/`。判断只有一处:`apps/souls/serializers.py::scores_hidden_from`。

- `souls/{id}/karma/`、`ledger/balance/`:三个总分、每条记录的 `original_weight` / `effective_weight`、
  `reading` 里的分数键(`READING_SCORE_KEYS`)为 null;计数、`reading.kind` 等照给。
- `ledger/effective/`、`ledger/inheritance/`:分数为 null,继承比例照给。
- 灵魂详情的 `records[].weight`、`souls/{id}/records/`:null(加起来就是总分)。
- `ledger/journal/`:每行 `weight` 为 null;四柱与类目合计是全殿聚合、照给,带搜索时(收窄到点名的灵魂)为 null。
  导出的「收 / 支」两格留空。
- `ledger/stats/overview/`:只有一个灵魂的平均余额就是那个灵魂的余额 → null。
- 两份灵魂 CSV:列留着、三个分数格留空。
"""
import csv
import io

import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant
from tests.conftest import sign_in

pytestmark = pytest.mark.django_db


@pytest.fixture
def hall():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    soul = Soul.objects.create(name="Scored Soul", current_state=SoulState.REINCARNATING,
                               merit_score=77, demerit_score=13, tenant=tenant)
    SoulRecord.objects.create(soul=soul, record_type="MERIT", description="a deed", weight=5)
    soul.refresh_from_db()
    viewer = User.objects.create_user(username="score_viewer", password="x", role="VIEWER", tenant=tenant)
    judge = User.objects.create_user(username="score_judge", password="x", role="JUDGE", tenant=tenant)
    return soul, sign_in(APIClient(), viewer), sign_in(APIClient(), judge)


def _ok(response):
    assert response.status_code == 200, response.content
    return response.json()


def test_the_ledger_summary_keeps_its_shape_and_loses_its_scores(hall):
    soul, viewer, judge = hall
    for path in (f"/api/v1/souls/{soul.pk}/karma/", f"/api/v1/ledger/balance/{soul.pk}/"):
        body = _ok(viewer.get(path))
        assert (body["merit_score"], body["demerit_score"], body["karmic_balance"]) == (None, None, None), path
        assert body["soul_id"] == str(soul.pk) and body["record_count"] == 1
        assert [(r["original_weight"], r["effective_weight"]) for r in body["records"]] == [(None, None)]
        assert body["records"][0]["description"] == "a deed"
        reading = body["reading"]
        assert reading["kind"] == "BALANCE" and reading["civilization"] == "CHINESE"
        assert (reading["balance"], reading["merit"], reading["demerit"]) == (None, None, None)

        full = _ok(judge.get(path))
        assert full["merit_score"] is not None and full["records"][0]["original_weight"] == 5
        assert full["reading"]["balance"] is not None


def test_effective_and_inheritance_keep_their_shape(hall):
    soul, viewer, judge = hall
    body = _ok(viewer.get(f"/api/v1/ledger/effective/{soul.pk}/"))
    assert body["soul_id"] == str(soul.pk)
    assert (body["effective_merit"], body["effective_demerit"], body["effective_balance"]) == (None, None, None)
    body = _ok(viewer.get(f"/api/v1/ledger/inheritance/{soul.pk}/"))
    assert (body["inherited_merit"], body["inherited_demerit"]) == (None, None)
    assert body["inheritance_merit_rate"] is not None and body["inheritance_demerit_rate"] is not None
    assert _ok(judge.get(f"/api/v1/ledger/inheritance/{soul.pk}/"))["inherited_merit"] is not None


def test_record_weights_are_hidden_on_the_detail_and_the_records_list(hall):
    soul, viewer, judge = hall
    detail = _ok(viewer.get(f"/api/v1/souls/{soul.pk}/"))
    assert [r["weight"] for r in detail["records"]] == [None]
    assert [r["weight"] for r in _ok(viewer.get(f"/api/v1/souls/{soul.pk}/records/"))] == [None]
    assert [r["weight"] for r in _ok(judge.get(f"/api/v1/souls/{soul.pk}/records/"))] == [5]


def test_the_journal_hides_row_weights_and_a_searched_soul_s_totals(hall):
    soul, viewer, judge = hall
    body = _ok(viewer.get("/api/v1/ledger/journal/"))
    assert [r["weight"] for r in body["results"]] == [None]
    assert body["received"] == 5  # 全殿聚合照给
    searched = _ok(viewer.get("/api/v1/ledger/journal/", {"search": soul.name}))
    assert (searched["opening"], searched["received"], searched["disbursed"], searched["closing"]) == (None,) * 4
    assert all(row["merit"] is None and row["demerit"] is None for row in searched["categories"])
    assert _ok(judge.get("/api/v1/ledger/journal/", {"search": soul.name}))["received"] == 5

    res = viewer.get("/api/v1/ledger/journal/export/")
    assert res.status_code == 200
    row = next(csv.reader(io.StringIO(res.content.decode().splitlines()[1])))
    assert row[-2:] == ["", ""]


def test_an_average_over_one_soul_is_hidden(hall):
    _soul, viewer, judge = hall
    body = _ok(viewer.get("/api/v1/ledger/stats/overview/"))
    assert body["total_souls"] == 1 and body["average_balance"] is None
    assert all(row["average_balance"] is None for row in body["state_distribution"] if row["count"] == 1)
    assert _ok(judge.get("/api/v1/ledger/stats/overview/"))["average_balance"] is not None


def _row(response, name):
    assert response.status_code == 200, response.content
    rows = list(csv.DictReader(io.StringIO(response.content.decode())))
    return next(r for r in rows if r["Name"] == name)


@pytest.mark.parametrize("path", ["/api/v1/souls/export/", "/api/v1/ledger/stats/export/"])
def test_exports_keep_the_row_and_blank_the_scores_for_a_viewer(hall, path):
    soul, viewer, judge = hall
    row = _row(viewer.get(path), soul.name)
    assert (row["Merit Score"], row["Demerit Score"], row["Karmic Balance"]) == ("", "", "")
    assert row["Soul ID"] == str(soul.pk)
    row = _row(judge.get(path), soul.name)
    assert (row["Merit Score"], row["Demerit Score"], row["Karmic Balance"]) == (
        str(soul.merit_score), str(soul.demerit_score), str(soul.karmic_balance))
