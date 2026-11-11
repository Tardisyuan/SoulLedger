"""VIEWER 看不到功过分 —— 每个出口都一样(审计 2026-11-11 P-02)。

灵魂详情与列表对 VIEWER 拿掉 `merit_score` / `demerit_score` / `karmic_balance`(`SoulSerializer` 上写明的底线),
而 `souls/{id}/karma/`、`souls/export/`、`ledger/balance/`、`ledger/stats/export/` 曾原样给出。
口径:整个响应就是分数的(karma、balance、effective、inheritance)→ 403 `scores_hidden`;
带别的数据的行(两份 CSV)→ 列留着、分数格子空着。判断只有一处:`apps/souls/serializers.py::scores_hidden_from`。
"""
import csv
import io

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def _client(user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def hall():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    soul = Soul.objects.create(name="Scored Soul", current_state=SoulState.REINCARNATING,
                               merit_score=77, demerit_score=13, tenant=tenant)
    viewer = User.objects.create_user(username="score_viewer", password="x", role="VIEWER", tenant=tenant)
    judge = User.objects.create_user(username="score_judge", password="x", role="JUDGE", tenant=tenant)
    return soul, _client(viewer), _client(judge)


def _row(response, name):
    assert response.status_code == 200, response.content
    rows = list(csv.DictReader(io.StringIO(response.content.decode())))
    return next(r for r in rows if r["Name"] == name)


@pytest.mark.parametrize("path", [
    "/api/v1/souls/{soul}/karma/",
    "/api/v1/ledger/balance/{soul}/",
    "/api/v1/ledger/effective/{soul}/",
    "/api/v1/ledger/inheritance/{soul}/",
])
def test_score_documents_are_refused_to_a_viewer(hall, path):
    soul, viewer, judge = hall
    res = viewer.get(path.format(soul=soul.pk))
    assert res.status_code == 403, res.content
    assert res.json()["code"] == "scores_hidden"
    assert "77" not in res.content.decode()
    # 不是这几个接口坏了:判官照样拿到
    assert judge.get(path.format(soul=soul.pk)).status_code == 200


@pytest.mark.parametrize("path", ["/api/v1/souls/export/", "/api/v1/ledger/stats/export/"])
def test_exports_keep_the_row_and_blank_the_scores_for_a_viewer(hall, path):
    soul, viewer, judge = hall
    row = _row(viewer.get(path), soul.name)
    assert (row["Merit Score"], row["Demerit Score"], row["Karmic Balance"]) == ("", "", "")
    assert row["Soul ID"] == str(soul.pk)
    row = _row(judge.get(path), soul.name)
    assert (row["Merit Score"], row["Demerit Score"], row["Karmic Balance"]) == ("77", "13", "64")
