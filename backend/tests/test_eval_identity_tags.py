"""评测身份在灵魂列表与用户管理里显示,并带 `is_eval_identity`(用户 2026-09-29 定:显示,打「评测专用 · 不能登录」)。

真的只有配置行上那两个是 true;普通灵魂 / 官员是 false(断言缺席)。id 一次请求只查一次,不是每行一次。
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.authentication.models import User
from apps.soul_accounts.models import SoulAccount
from apps.souls.models import Soul, SoulState
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(cn_tenant):
    return officer_client(User.objects.create_user(username="yama", password="x", role="ADMIN", tenant=cn_tenant))


@pytest.fixture
def ids(api):
    body = api.post("/api/v1/assist-admin/eval/identities/").data
    return SoulAccount.objects.get(pk=body["eval_soul_account"]).soul_id, body["eval_officer"]


def _rows(response):
    assert response.status_code == 200, response.data
    return response.data.get("results", response.data)


def test_the_soul_list_and_detail_tag_the_eval_soul_and_only_it(api, cn_tenant, ids):
    """变异:`_is_eval_soul` 恒真 → 普通灵魂也是 true,红;恒假 → 评测灵魂 false,红。"""
    soul_id, _ = ids
    normal = Soul.objects.create(name="普通亡魂", tenant=cn_tenant, current_state=SoulState.JUDGING)
    flags = {row["id"]: row["is_eval_identity"] for row in _rows(api.get("/api/v1/souls/", {"page_size": 100}))}
    assert flags[str(soul_id)] is True
    assert flags[str(normal.pk)] is False
    assert [k for k, v in flags.items() if v] == [str(soul_id)]
    assert api.get(f"/api/v1/souls/{soul_id}/").data["is_eval_identity"] is True
    assert api.get(f"/api/v1/souls/{normal.pk}/").data["is_eval_identity"] is False


def test_the_user_list_tags_the_eval_officer_and_only_it(api, cn_tenant, ids, judge_user):
    _, officer_id = ids
    flags = {row["id"]: row["is_eval_identity"] for row in _rows(api.get("/api/v1/users/", {"page_size": 100}))}
    assert flags[officer_id] is True
    assert flags[judge_user.pk] is False
    assert [k for k, v in flags.items() if v] == [officer_id]
    assert api.get(f"/api/v1/users/{officer_id}/").data["is_eval_identity"] is True


def test_without_eval_identities_nothing_is_tagged(api, cn_tenant, judge_user):
    Soul.objects.create(name="普通亡魂", tenant=cn_tenant, current_state=SoulState.JUDGING)
    assert not any(r["is_eval_identity"] for r in _rows(api.get("/api/v1/souls/")))
    assert not any(r["is_eval_identity"] for r in _rows(api.get("/api/v1/users/")))


def test_the_eval_soul_lookup_runs_once_per_request_not_per_row(api, cn_tenant, ids):
    """变异:`tagged_ids` 不用 context 缓存 → 每行查一次配置行,红。"""
    for i in range(5):
        Soul.objects.create(name=f"亡魂{i}", tenant=cn_tenant, current_state=SoulState.JUDGING)
    from apps.soul_assist.models import AssistConfig

    table = AssistConfig._meta.db_table
    with CaptureQueriesContext(connection) as queries:
        rows = _rows(api.get("/api/v1/souls/", {"page_size": 100}))
    assert len(rows) >= 6
    lookups = [q["sql"] for q in queries.captured_queries if f'FROM "{table}"' in q["sql"]]
    assert len(lookups) == 1, lookups
