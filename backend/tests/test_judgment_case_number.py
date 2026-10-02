"""案号(`Judgment.case_number`):开案发号、按前缀与年分组、单调、不留空号、全局唯一;
存量回填(judgment/0031–0033)往返;并发开案在 PostgreSQL 上排队拿号。

并发那一条只在 PostgreSQL 上跑(SQLite 整库写锁,没有行锁可等),登记在
`tests/test_concurrency.py::test_the_postgres_only_set_is_the_set_we_think_it_is`;
它的串行版本是 `test_numbers_run_per_prefix_and_year_without_gaps`。
"""
import threading
from datetime import UTC, datetime

import pytest
from django.db import IntegrityError, connection, connections, transaction
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.judgment.models import Judgment, JudgmentCaseCounter, case_number_prefix
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.migration_roundtrip import snapshot_rows

SQLITE = connection.vendor == "sqlite"
NEEDS_ROW_LOCKS = "Requires real row-level locking; SQLite serialises writers with a database lock."


def _soul(tenant, name="案号之魂"):
    return Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.JUDGING)


def _case(tenant):
    soul = _soul(tenant)
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=tenant)


def _admin(tenant, username):
    user = User.objects.create_user(username=username, password="x", role="ADMIN", tenant=tenant)
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.mark.django_db
def test_numbers_run_per_prefix_and_year_without_gaps(cn_tenant, eu_tenant):
    year = timezone.localdate().year
    cn = [_case(cn_tenant).case_number for _ in range(3)]
    eu = _case(eu_tenant).case_number
    # 灵魂必有租户,案子的 tenant 列可空(存量与测试里的行):没有租户的案子用品牌前缀。
    tenantless = Judgment.objects.create(soul=_soul(cn_tenant), civilization="CHINESE").case_number

    assert cn == [f"CN-{year}-0001", f"CN-{year}-0002", f"CN-{year}-0003"]
    # 另一个租户从 1 起,不接着中国的号。
    assert eu == f"EU-{year}-0001"
    assert tenantless == f"SL-{year}-0001"
    assert JudgmentCaseCounter.objects.get(key=f"CN-{year}").last == 3


@pytest.mark.django_db(transaction=True)
def test_a_create_that_fails_gives_its_number_back(cn_tenant):
    """自动提交下(调用方没有开事务):发号与写入必须在 `save()` 自己的事务里,
    否则计数先提交、写入再失败,留下一个永远不会出现的号。"""
    year = timezone.localdate().year
    _case(cn_tenant)
    soul = _soul(cn_tenant)
    with pytest.raises(IntegrityError):
        # 没有灵魂:插入在 NOT NULL 上失败,两个引擎都在语句处报。
        Judgment.objects.create(soul_id=None, civilization=soul.civilization, tenant=cn_tenant)
    assert _case(cn_tenant).case_number == f"CN-{year}-0002"


@pytest.mark.django_db
def test_two_tenants_sharing_a_prefix_share_one_counter(cn_tenant):
    """`CN_DIYU` 与 `CN_TEST` 前缀都是 CN:案号全局唯一,所以同一前缀只发一串号。"""
    other = Tenant.objects.create(code="CN_TEST", display_name="cn test")
    year = timezone.localdate().year
    assert [_case(cn_tenant).case_number, _case(other).case_number] == [f"CN-{year}-0001", f"CN-{year}-0002"]


def test_the_prefix_is_the_first_segment_of_the_tenant_code():
    assert case_number_prefix(None) == "SL"
    assert case_number_prefix(Tenant(code="EG_DUAT")) == "EG"
    assert case_number_prefix(Tenant(code="gr-elysion_x")) == "GRELYSIO"  # 只留字母数字,最多 8 位
    assert case_number_prefix(Tenant(code="_")) == "SL"


@pytest.mark.django_db
def test_the_api_shows_the_number_and_never_takes_one(cn_tenant):
    client = _admin(cn_tenant, "case_no_admin")
    soul = _soul(cn_tenant)
    created = client.post("/api/v1/judgment/", {"soul": str(soul.pk), "case_number": "CN-1999-9999"}, format="json")
    assert created.status_code == 201, created.data
    number = created.data["case_number"]
    assert number == f"CN-{timezone.localdate().year}-0001"
    assert number != "CN-1999-9999"

    case = Judgment.objects.get(pk=created.data["id"])
    patched = client.patch(f"/api/v1/judgment/{case.pk}/", {"case_number": "CN-1999-9999"}, format="json")
    assert patched.status_code == 200, patched.data
    case.refresh_from_db()
    assert case.case_number == number

    found = client.get("/api/v1/judgment/", {"search": number.lower()})
    assert [row["id"] for row in found.data["results"]] == [str(case.pk)]


@pytest.mark.django_db
def test_the_workflow_carries_its_judgments_number(cn_tenant):
    from apps.workflow.models import ApprovalWorkflow
    from apps.workflow.serializers import ApprovalWorkflowSerializer

    case = _case(cn_tenant)
    flow = ApprovalWorkflow.objects.create(soul=case.soul, judgment=case, tenant=cn_tenant, workflow_name="w")
    bare = ApprovalWorkflow.objects.create(soul=case.soul, tenant=cn_tenant, workflow_name="w2")
    assert ApprovalWorkflowSerializer(flow).data["judgment_case_number"] == case.case_number
    assert ApprovalWorkflowSerializer(bare).data["judgment_case_number"] is None


@pytest.mark.skipif(SQLITE, reason=NEEDS_ROW_LOCKS)
@pytest.mark.django_db(transaction=True)
def test_eight_cases_opened_at_once_get_eight_consecutive_numbers(cn_tenant):
    """八个连接同时开案,每个在拿号后还在事务里停一会儿(握着计数行的锁)。

    读 max 再加一的写法在这里会让几个连接拿到同一个号,唯一约束随即报 IntegrityError;
    `UPDATE … last = last + 1` 让后来者在行锁上等,拿到的是前一个提交后的值。
    """
    import time

    souls = [_soul(cn_tenant, f"并发 {i}") for i in range(8)]
    barrier = threading.Barrier(len(souls))
    results = {}

    def open_case(i, soul):
        try:
            barrier.wait(timeout=10)
            with transaction.atomic():
                case = Judgment.objects.create(soul=soul, civilization=soul.civilization, tenant=cn_tenant)
                time.sleep(0.05)
            results[i] = case.case_number
        except Exception as exc:  # 在断言里显形
            results[i] = repr(exc)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=open_case, args=(i, s)) for i, s in enumerate(souls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    year = timezone.localdate().year
    assert sorted(results.values()) == [f"CN-{year}-{n:04d}" for n in range(1, 9)], results
    assert JudgmentCaseCounter.objects.get(key=f"CN-{year}").last == 8


# ── 回填:0030 → 0033 往返 ────────────────────────────────────────────────


# 两段:整段(0030 ↔ 0033,反向会删掉计数表)与只有数据那一步(0031 ↔ 0032,计数表留着,
# 反向必须自己清空它,否则再前进时号接着旧的往上数)。
@pytest.mark.parametrize("before, after", [
    ("0030_judgment_dispatch_draft", "0033_case_number_unique_statute_effective_required"),
    ("0031_case_number_and_statute_version", "0032_backfill_case_number_and_statute_version"),
])
def test_judgment_0031_to_0033_backfill_numbers_deterministically_and_reverse(migration_round_trip, before, after):
    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        cn = tenant_model._base_manager.create(code="CN_RT", display_name="cn")
        eg = tenant_model._base_manager.create(code="EG_RT", display_name="eg")
        soul = state.get_model("souls", "Soul")._base_manager.create(name="s")
        judgment = state.get_model("judgment", "Judgment")
        # (tenant, created_at, notes):注意插入顺序与时间顺序不同,同一秒的两条靠 id 定先后。
        rows = [
            (cn, datetime(2025, 3, 1, tzinfo=UTC), "cn-2025-b"),
            (cn, datetime(2024, 12, 31, 23, tzinfo=UTC), "cn-2024"),
            (cn, datetime(2025, 1, 2, tzinfo=UTC), "cn-2025-a"),
            (eg, datetime(2025, 6, 1, tzinfo=UTC), "eg-2025"),
            (None, datetime(2025, 6, 1, tzinfo=UTC), "none-2025"),
        ]
        for tenant, at, notes in rows:
            row = judgment._base_manager.create(soul=soul, civilization="CHINESE", tenant=tenant, notes=notes)
            judgment._base_manager.filter(pk=row.pk).update(created_at=at)
        # 软删的案子也编号:号永不复用。
        judgment._base_manager.filter(notes="cn-2025-b").update(is_deleted=True)
        statute = state.get_model("judgment", "Statute")
        art = statute._base_manager.create(code="RT-01", corpus="HELL_LAW", civilization="CHINESE", tenant=cn)
        statute._base_manager.filter(pk=art.pk).update(create_time=datetime(2026, 8, 27, 9, tzinfo=UTC))

    def snapshot(state):
        judgment = state.get_model("judgment", "Judgment")
        statute = state.get_model("judgment", "Statute")
        has = {f.name for f in judgment._meta.get_fields()}
        fields = {"tenant": lambda j: j.tenant_id, "deleted": "is_deleted"}
        if "case_number" in has:
            fields["case_number"] = "case_number"
        out = snapshot_rows(judgment._base_manager.all(), key="notes", fields=fields)
        art_fields = {"code": "code"}
        if any(f.name == "effective_from" for f in statute._meta.get_fields()):
            art_fields.update(revision="revision", effective_from="effective_from")
        out.update(snapshot_rows(statute._base_manager.all(), key="code", fields=art_fields, prefix="statute:"))
        return out

    def check_forward(state):
        rows = snapshot(state)
        assert {k: v["case_number"] for k, v in rows.items() if not k.startswith("statute:")} == {
            "cn-2024": "CN-2024-0001",
            "cn-2025-a": "CN-2025-0001",
            "cn-2025-b": "CN-2025-0002",
            "eg-2025": "EG-2025-0001",
            "none-2025": "SL-2025-0001",
        }
        counters = state.get_model("judgment", "JudgmentCaseCounter")
        assert dict(counters.objects.values_list("key", "last")) == {
            "CN-2024": 1, "CN-2025": 2, "EG-2025": 1, "SL-2025": 1,
        }
        assert rows["statute:RT-01"]["revision"] == 1
        assert str(rows["statute:RT-01"]["effective_from"]) == "2026-08-27"

    migration_round_trip(
        before=("judgment", before),
        after=("judgment", after),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
    )
