"""字段权限也管列表、导出和 karma(审计 2026-11-11 P-11,用户同日拍板)。

`FieldPermission` 此前只在四个详情序列化器上生效(`FieldPermissionMixin`):一条「JUDGE 看不到 Soul 的
`name` / `merit_score`」的规则,灵魂列表、各 CSV 导出与 `souls/{id}/karma/` 照给。现在判断只有一处
(`apps/core/field_permissions.py::hidden_fields`),口径:

- 灵魂列表:与详情一样,被藏的字段不出现;
- CSV:列留着、格子空着(与 VIEWER 分数 P-02 同一口径);别的导出里那一列灵魂姓名 / 编号跟着 Soul 的规则;
- karma:键留着、值为 null;被藏的分数连带 `reading` 里的分数(同一个数的另一种写法)。

每条都断言规则生效前看得到(同一个角色、同一个请求)、生效后看不到,以及没有这条规则的角色照样看得到。
"""
import csv
import io

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.perm.models import FieldPermission, Role
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db

HIDDEN = ("name", "merit_score")


def _client(user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def hall():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    soul = Soul.objects.create(name="Ruled Soul", current_state=SoulState.REINCARNATING,
                               merit_score=77, demerit_score=13, tenant=tenant)
    SoulRecord.objects.create(soul=soul, record_type="MERIT", description="a deed", weight=5)
    soul.refresh_from_db()
    Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant)
    judge = User.objects.create_user(username="fp_judge", password="x", role="JUDGE", tenant=tenant)
    viewer = User.objects.create_user(username="fp_viewer", password="x", role="VIEWER", tenant=tenant)
    return soul, _client(judge), _client(viewer)


def _hide_from_judges():
    role = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "判官"})[0]
    for field in HIDDEN:
        FieldPermission.objects.create(role=role, model_name="Soul", field_name=field, visible=False)


def _ok(response):
    assert response.status_code == 200, response.content
    return response


def _list_row(client, soul):
    body = _ok(client.get("/api/v1/souls/")).json()
    return next(r for r in body["results"] if r.get("id") == str(soul.pk))


def _csv_row(client, path, id_column, soul_id):
    rows = list(csv.DictReader(io.StringIO(_ok(client.get(path)).content.decode())))
    return next(r for r in rows if r[id_column] == soul_id)


def test_the_soul_list_drops_what_the_rule_hides(hall):
    soul, judge, viewer = hall
    before = _list_row(judge, soul)
    assert before["name"] == "Ruled Soul" and before["merit_score"] == 77
    _hide_from_judges()
    after = _list_row(judge, soul)
    assert "name" not in after and "merit_score" not in after
    assert after["demerit_score"] == 13 and after["current_state"] == SoulState.REINCARNATING  # 别的字段照给
    assert _list_row(viewer, soul)["name"] == "Ruled Soul"  # VIEWER 没有这条规则


@pytest.mark.parametrize("path", ["/api/v1/souls/export/", "/api/v1/ledger/stats/export/"])
def test_soul_exports_keep_the_column_and_blank_the_cell(hall, path):
    soul, judge, viewer = hall
    before = _csv_row(judge, path, "Soul ID", str(soul.pk))
    # ledger/stats/export/ 读的是账本汇总，不是 Soul 上存的分数,所以不写死 77,只要求规则生效前有值。
    assert before["Name"] == "Ruled Soul" and before["Merit Score"] != ""
    _hide_from_judges()
    row = _csv_row(judge, path, "Soul ID", str(soul.pk))
    assert "Name" in row and "Merit Score" in row  # 表头留着
    assert (row["Name"], row["Merit Score"]) == ("", "")
    assert row["Demerit Score"] == before["Demerit Score"] != "" and row["State"] == SoulState.REINCARNATING
    assert _csv_row(viewer, path, "Soul ID", str(soul.pk))["Name"] == "Ruled Soul"


def test_the_soul_column_of_another_export_follows_the_soul_rule(hall):
    soul, judge, _viewer = hall
    case_id = str(Judgment.objects.get(soul=soul).pk)
    assert _csv_row(judge, "/api/v1/judgment/export/", "Case ID", case_id)["Soul"] == "Ruled Soul"
    _hide_from_judges()
    row = _csv_row(judge, "/api/v1/judgment/export/", "Case ID", case_id)
    assert row["Soul"] == "" and row["Court"] == "第一殿"


def test_karma_nulls_the_hidden_keys_and_the_reading_scores(hall):
    soul, judge, viewer = hall
    path = f"/api/v1/souls/{soul.pk}/karma/"
    before = _ok(judge.get(path)).json()
    assert before["soul_name"] == "Ruled Soul" and before["merit_score"] is not None
    assert before["reading"]["merit"] is not None
    _hide_from_judges()
    after = _ok(judge.get(path)).json()
    assert (after["soul_name"], after["merit_score"]) == (None, None)
    assert after["reading"]["merit"] is None and after["reading"]["balance"] is None
    assert after["demerit_score"] is not None and after["soul_id"] == str(soul.pk)
    assert after["records"][0]["original_weight"] == 5  # 规则没藏 records
    assert _ok(viewer.get(path)).json()["soul_name"] == "Ruled Soul"
