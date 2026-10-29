"""数据范围 B8:真 PostgreSQL 上,范围过滤后的三张列表走索引、不全表扫、不退化成逐行子查询。

1 万灵魂 / 1 万审判 / 1 万审批流 / 50 机构(殿根下 10 司、每司 4 科)。判官在第 0 司。
两种范围 ——「本机构及以下」(+ 本人创建 / 认领 / 城隍指派,任何范围都带)与「自定义机构」(两个别司的科)——
各打一次真接口(灵魂列表、审判队列、审批列表),把接口实际发出的、带范围条件的那几条 SQL 拿出来
`EXPLAIN (ANALYZE, FORMAT JSON)`,断言:

  * 灵魂、审判两张主表不全表扫(审批流见 `ENDPOINTS` 上的 ponytail);
  * 「本人或指派」的子查询不逐行执行。城隍 officers 是多对多:写成 `pk__in=(子查询)` 时它是 OR 里的
    hashed SubPlan,审判整表扫(B8 首跑实测 count 5–8 ms、page 22–26 ms,全表);现在先取出城隍 id 写成
    `city_god__in=[…]`(`data_scope._user_q`),走 BitmapOr(count 2–3 ms、page 10–16 ms);
  * 每条执行时间在 `BUDGET_MS` 以内(实测数字见 `-s` 的输出与 B8 报告)。

可重复跑:`pytest tests/test_datascope_b8_pg_performance.py -s --create-db`(只在 PostgreSQL 上跑;SQLite 跳过,
已登记在 `test_concurrency.py` 的 PG-only 名单)。
"""
import json

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.authentication.models import User
from apps.judgment.models import CityGod, Judgment
from apps.souls.models import Soul
from apps.workflow.models import ApprovalNode, ApprovalWorkflow
from tests.data_scope_support import org, scope
from tests.soul_account_support import officer_client

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.skipif(connection.vendor != "postgresql", reason="EXPLAIN ANALYZE 的计划与耗时只在 PostgreSQL 上有意义"),
]

N = 10_000
BIG = {"souls_soul", "judgment_judgment", "workflow_approvalworkflow"}
#: 单条 SQL 的执行时间上限。实测远低于它(见报告);它防的是「退化成全表 / 逐行子查询」那种数量级的变化,
#: 不是给慢机器卡秒表。
BUDGET_MS = 250

#: (名字, 接口, 主表, 主表必须走索引)。
#: ponytail: 审批流的范围顺 `soul__owner_org` 取(设计「其余模型顺外键取」),OR 的几支分在灵魂、审批流、当前节点
#: 三张表上,规划器只能 hash join 后整表过滤审批流 —— 1 万条实测 6–38 ms(B8 报告)。所以这一张只卡耗时不卡索引;
#: 审批流上十万条再给 ApprovalWorkflow 加 owner_org 冗余列。
ENDPOINTS = [
    ("灵魂列表", "/api/v1/souls/", "souls_soul", True),
    ("审判队列", "/api/v1/judgment/?has_verdict=false", "judgment_judgment", True),
    ("审批列表", "/api/v1/workflows/?status=IN_PROGRESS", "workflow_approvalworkflow", False),
]


def _grant(role_name, *codenames):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})
    for codename in codenames:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]})
        RolePermission.objects.get_or_create(role=role, permission=permission)


@pytest.fixture
def world(cn_tenant):
    depts = [org(cn_tenant, f"司{d}") for d in range(10)]
    leaves = [org(cn_tenant, f"司{d}科{k}", parent=depts[d]) for d in range(10) for k in range(4)]
    orgs = depts + leaves
    assert len(orgs) == 50
    judge = User.objects.create_user(username="b8_judge", password="x", role="JUDGE", tenant=cn_tenant, organization=depts[0])
    _grant("JUDGE", "soul.read", "judgment.read", "workflow.read")
    god = CityGod.objects.create(tenant=cn_tenant, name="B8 城隍")
    god.officers.add(judge)

    souls = Soul.all_objects.bulk_create(
        (Soul(name=f"B8魂{i}", tenant=cn_tenant, home_tenant=cn_tenant, owner_org=orgs[i % 50],
              create_user=judge if i % 1000 == 7 else None) for i in range(N)),
        batch_size=2000)
    judgments = Judgment.all_objects.bulk_create(
        (Judgment(soul=s, tenant=cn_tenant, civilization="CHINESE", case_number=f"B8-{i:05d}", owner_org=s.owner_org,
                  claimed_by=judge if i % 500 == 3 else None, city_god=god if i % 1000 == 11 else None)
         for i, s in enumerate(souls)),
        batch_size=2000)
    flows = ApprovalWorkflow._base_manager.bulk_create(
        (ApprovalWorkflow(number=f"B8WF-{i:05d}", judgment=j, soul=j.soul, tenant=cn_tenant, workflow_name="十殿审判流程",
                          status="IN_PROGRESS") for i, j in enumerate(judgments)),
        batch_size=2000)
    # 1% 的流程停在一个指给 JUDGE 角色的待决节点上 ——「待我审批」那条 extra_q 有东西可命中。
    nodes = ApprovalNode.objects.bulk_create(
        ApprovalNode(workflow=f, node_name="判官复核", node_order=1, approver_type="ROLE", approver_role="JUDGE", status="PENDING")
        for f in flows[::100])
    for f, n in zip(flows[::100], nodes, strict=True):
        f.current_node = n
    ApprovalWorkflow._base_manager.bulk_update(flows[::100], ["current_node"])
    with connection.cursor() as cur:
        cur.execute("ANALYZE")
    return {"judge": judge, "depts": depts, "leaves": leaves}


def _walk(node):
    yield node
    for child in node.get("Plans", ()):
        yield from _walk(child)


def _explain(sql):
    with connection.cursor() as cur:
        cur.execute("EXPLAIN (ANALYZE, FORMAT JSON) " + sql)
        raw = cur.fetchone()[0]
    return (json.loads(raw) if isinstance(raw, str) else raw)[0]


def _scoped_queries(client, url, table):
    """接口实际发出的、主表是 `table` 且带归属机构条件的 SELECT(分页的 count 与那一页)。"""
    with CaptureQueriesContext(connection) as ctx:
        response = client.get(url)
    assert response.status_code == 200, (url, response.status_code, getattr(response, "data", None))
    found = [q["sql"] for q in ctx.captured_queries
             if q["sql"].startswith("SELECT") and f'FROM "{table}"' in q["sql"] and "owner_org_id" in q["sql"]]
    assert found, f"{url} 没有一条带范围条件的 {table} 查询 —— 范围没套上,或这里的筛选找错了"
    return found


def _check(label, url, table, must_index, client):
    """(报告行, 违规) —— 违规先收齐再一起断言,一次跑完能看到全貌。"""
    rows, bad = [], []
    for sql in _scoped_queries(client, url, table):
        plan = _explain(sql)
        nodes = list(_walk(plan["Plan"]))
        kind = "count" if "COUNT(" in sql.upper().split("FROM")[0] else "page"
        where = f"{label} {kind}"
        seq = sorted({n.get("Relation Name") for n in nodes if n["Node Type"] == "Seq Scan"} & BIG)
        # 逐行子查询:一个非 hashed 的 SubPlan 被执行了不止一次。
        loops = [(n.get("Subplan Name"), n["Actual Loops"]) for n in nodes
                 if n.get("Parent Relationship") == "SubPlan" and n.get("Actual Loops", 0) > 1]
        ms = plan["Execution Time"]
        if must_index and table in seq:
            bad.append(f"{where}:{table} 全表扫描\n{json.dumps(plan, ensure_ascii=False)[:3000]}")
        if loops:
            bad.append(f"{where}:子查询逐行执行 {loops}")
        if ms >= BUDGET_MS:
            bad.append(f"{where}:{ms:.1f} ms 超过 {BUDGET_MS} ms")
        index = sorted({n["Index Name"] for n in nodes if n.get("Index Name")})
        rows.append(f"{where}: {ms:.2f} ms, rows={plan['Plan'].get('Actual Rows')}, seq={seq}, index={index}")
    return rows, bad


@pytest.mark.parametrize("value", ["ORG_CHILD", "DEFINE"])
def test_the_three_scoped_lists_use_indexes_and_stay_fast(world, value):
    if value == "DEFINE":
        scope("JUDGE", "DEFINE", orgs=[world["leaves"][9], world["leaves"][22]])  # 司2科1、司5科2:两个别司的科
    else:
        scope("JUDGE", "ORG_CHILD")
    client = officer_client(world["judge"])
    report, bad = [], []
    for label, url, table, must_index in ENDPOINTS:
        rows, problems = _check(label, url, table, must_index, client)
        report += rows
        bad += problems
    print("".join(f"\n[B8 PG {value}] {line}" for line in report))
    assert not bad, "\n".join(bad)


def test_the_scope_actually_narrows_what_the_lists_return(world):
    """上面量的是带范围的查询;这里确认它们真的只给范围内 + 本人的那些(防「快是因为条件丢了」)。"""
    scope("JUDGE", "ORG_CHILD")
    client = officer_client(world["judge"])
    mine_org = {world["depts"][0].pk, *(leaf.pk for leaf in world["leaves"][:4])}
    in_scope = Soul.all_objects.filter(name__startswith="B8魂", owner_org__in=mine_org).count()
    created = Soul.all_objects.filter(name__startswith="B8魂", create_user=world["judge"]).exclude(owner_org__in=mine_org).count()
    assert in_scope == N // 10 and created > 0
    assert client.get("/api/v1/souls/").data["count"] == in_scope + created
    assert client.get("/api/v1/souls/").data["count"] < N
