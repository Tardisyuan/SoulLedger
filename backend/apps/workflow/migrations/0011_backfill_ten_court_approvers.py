"""Give the pending approval nodes the approvers their own templates name.

背景
----
`4ceffe8 fix(workflow): actually check who is approving` 修好了 `can_approve`
的身份比对，也补上了它缺失的调用者，但把新门**限定在「已指定审批人」的节点**
上。理由写在那条提交信息里：`WorkflowService` 建的每个节点都是 `SYSTEM`，
一旦让 `can_approve` 成为唯一的门，在途流程会当场全部卡死。

于是那条身份校验在真实数据上一条也拦不下。2026-08-15 实测生产库
(`postgresql://…/soulledger`)：

    ApprovalNode 共 30 行 —— approver_type: SYSTEM 30 / ACTOR 0 / ROLE 0
    approver_actor 非空 0 行；approver_role 非空 0 行
    status: PENDING 30 行；verdict 全为空；decided_at / approver 全为 NULL
    分布在 3 个「十殿审判流程」(各 10 节点，IN_PROGRESS)
    另有 1 个 workflow「DebugTpl」没有任何节点 —— 共 4 个 workflow
    WorkflowTemplate 7 行，nodes_json 全部为空数组(不参与建节点)

也就是说：任何持有 `workflow.approve` codename 的 JUDGE/ADMIN 都能替**任意一
殿**下判，`complete_node` 会把他的名字写进 `node.approver`。这个迁移把节点该
归谁批的事实补回去，`views.approve_node` 随之去掉「仅对已指定节点生效」的作
用域，`can_approve` 成为唯一的门。

回填依据
--------
依据来自模板自身，不是推测。`services.WORKFLOW_TEMPLATES` 里的
「十殿审判流程」每个节点都**指名道姓**：节点名 `秦广王 · 分流`、`阎罗王 ·
四审` …… 而且 `court_code` 独立地说了同一件事——第一殿、第五殿。这两列与
`seed_mythology.CHINESE_ACTORS` 校订后的座次(第 N 殿之王坐 DY_COURT_NN，见
`79dee57`，`test_seed_mythology` 有断言)**逐条相符**。两条互不相干的列指向同
一个人，才使这份回填不需要任何判断。

`ROWS` 只收录这种节点：27 个模板节点里 13 个指名到人(十殿 10、申诉首节点 1、
埃及 2)，其余 14 个没有依据，**一律不回填**，理由逐
条记在 `services.TEMPLATE_NODES_WITHOUT_AN_APPROVER`：`原殿阎王 · 复核` 的
「原殿」是十殿之一而没有任何列记录是哪一殿；`酆都大帝`、`城隍` 在三套 cast 里
都没有 Actor 行；`十殿联审`、`四十二神官` 是合议，`approver_actor` 是单个外
键，挑其中一个就是把合议记成一个人的裁决；`主教座堂初审`/`罗马教廷终审` 是机
构；`审批节点` 是无模板时的兜底。这些节点回填后仍是 `SYSTEM`，也就是**任何人
都批不了**，只能走留痕的 `escalate` —— 见 `ApprovalNode.can_approve` 的说明。

埃及两行有一处译名不一致：节点名 `阿努比斯` 与 `Actor.name_zh` 逐字相同，而
节点名 `欧西里斯` 与 seeder 的 `奥西里斯` 不同字——同一位 Wsir 的两种译名，本
仓库两处各写一种。

本迁移最初写下时，这条对应**是推断而非数据**：按神格对应(模板自己就叫「欧西里
斯称重流程」，EGYPTIAN_ACTORS 里 Osiris 只有一行)，落地靠的是 `ROWS` 这一行的
actor 键恰好写作 `Osiris`、而查找同时匹配 `name` 与 `name_zh`。当时的 docstring
把这一点标明为遗留问题，交由所有者裁决。

**所有者已裁决：两种译名都保留，对应关系记入数据。** 「欧西里斯」现在是 Osiris
行上的一条 alias(`EGYPTIAN_ACTOR_ALIASES` → `powers_json["aliases"]`)，
`_find_actor` 读的就是它，见该函数的说明。这个迁移正向做的事一行没变——`ROWS`
仍写 `Osiris`，仍解析到同一行——变的是它凭什么解析得到。

不做什么
--------
* **不动已决节点。** 过滤条件要求 `status=PENDING` 且 `verdict=''` 且
  `decided_at`/`approver` 均为空。一个已经作出的裁决记录着当时**真的**是谁批
  的；给它追加一个「本应由谁批」会把事后的补记伪装成当时的事实。实测 30 行没
  有一行已决，所以这条过滤当下不排除任何行——它是为将来跑这个迁移的库写的。
* **不动已经配置过审批人的节点。** 只改 `approver_type='SYSTEM'` 且
  `approver_actor IS NULL` 的行。有人手工指定过的节点是一次决定，不是待补的
  空白。
* **不建 Actor。** 查不到就跳过并打印，节点保持 SYSTEM。缺席的 cast 成员应当
  由 `seed_mythology` 补，迁移凭一个流程模板去创建神祇就是在编造 pantheon。
* **不改模板行本身。** `WorkflowTemplate.nodes_json` 是租户自己的数据。

空库守卫
--------
一张空的 `workflow_approvalnode` 表是全新安装：没有在途流程要救，
`WorkflowService` 从此建节点时就会带上审批人(见 `_resolve_approver`)，这里再
写什么都是给种子数据添乱。realms/0014、judgment/0013 都带同一个守卫。

可逆性
------
`backwards` 只把**本迁移可能写过的那批行**改回 `SYSTEM`/`NULL`：匹配同一份
`ROWS` 签名，且当前的 `approver_actor` 正好是正向会指派的那位。别人后来改成
别的审批人的行不受影响。正反向都可重复执行，
`backend/tests/test_workflow_approver_backfill.py` 用 `migration_round_trip`
夹具做 forward → reverse → forward 的**数据**比对。

全部行访问走 `_base_manager`：`ApprovalWorkflow.objects` / `Actor.objects` 是
租户过滤 + 软删过滤的，迁移里没有租户上下文，它们会在没被碰过的表上报告静默
成功。`ApprovalNode` 没有自己的 manager 覆写，但一并用 `_base_manager` 以免
将来加上一个。
"""
from django.db import migrations
from django.db.models import Q

#: (node_name, court_code, node_order, civilization, actor_name)
#:
#: 冻结在这里而不是从 `services.WORKFLOW_TEMPLATES` 导入：迁移记录的是**当时**
#: 的事实，模板是活代码，明天改一个节点名不应该改变这个迁移已经做过/将要做的
#: 事。realms/0014 与 judgment/0013 用的是同一条分工。
#: `services.py` 那边的 `actor` 键与这份表由
#: `apps/workflow/tests.py::TestTemplateApproverBasis` 交叉断言，两份不会各走
#: 各的。
ROWS = [
    ("秦广王 · 分流", "第一殿", 1, "CHINESE", "秦广王"),
    ("楚江王 · 初审", "第二殿", 2, "CHINESE", "楚江王"),
    ("宋帝王 · 二审", "第三殿", 3, "CHINESE", "宋帝王"),
    ("五官王 · 三审", "第四殿", 4, "CHINESE", "五官王"),
    ("阎罗王 · 四审", "第五殿", 5, "CHINESE", "阎罗王"),
    ("卞城王 · 五审", "第六殿", 6, "CHINESE", "卞城王"),
    ("泰山王 · 六审", "第七殿", 7, "CHINESE", "泰山王"),
    ("都市王 · 七审", "第八殿", 8, "CHINESE", "都市王"),
    ("平等王 · 八审", "第九殿", 9, "CHINESE", "平等王"),
    ("转轮王 · 终审", "第十殿", 10, "CHINESE", "转轮王"),
    # 申诉审判流程的第一个节点。同一形状：节点名指名，court_code 独立复述
    # (察查司)，而 `魏征` 的 title 正是「察查司正堂」。该模板其余三个节点没有
    # 依据，见模块 docstring。
    ("魏征 · 察查司", "察查司", 1, "CHINESE", "魏征"),
    # 欧西里斯称重流程 1 与 3。第 2 节点(四十二神官)是合议，不回填。
    ("阿努比斯 · 引渡审判", "Hall of Two Truths", 1, "EGYPTIAN", "Anubis"),
    ("欧西里斯 · 终审", "Duat", 3, "EGYPTIAN", "Osiris"),
]


def _find_actor(actor_model, actor_name, civilization, tenant_id):
    """The named actor on this workflow's own bench, or None.

    四个名字列任一相符即可：中国侧 cast 的 `name` 是中文(秦广王)，埃及侧的
    `name` 是英文(Osiris)、中文在 `name_zh`。按 tenant 与 civilization 收口，
    因为 `Actor.name` 不是全局唯一的——两个租户各种一套同名 pantheon 时，不收
    口的查找会取到别人的行。

    列都不中时再查 `powers_json["aliases"]` —— **同一位神的另一种译名**，记在
    数据里而不是靠查找碰运气。本迁移的 docstring 原先写明 `欧西里斯`(模板)与
    `奥西里斯`(seeder)的对应「是推断而非数据」；那份对应现在是 Osiris 行上的
    一条 alias(`EGYPTIAN_ACTOR_ALIASES`)，这里读的就是它。取值规则见
    `apps/actors/models.py::resolve_actor_by_any_name`——本函数是它的冻结副本，
    与 `ROWS` 同样的分工：迁移记录当时的事实，活代码可以继续演进。

    别名比对在 Python 里做而不是用 `powers_json` 的 JSON 查询：JSON 包含查询
    是后端相关的(SQLite 不支持，而测试跑在 SQLite 上)，候选集又只是一个租户、
    一个文明的 cast。`apps/actors/mythology/seeding.py` 对 `assessor_index`
    作的是同一个选择。

    `powers_json` 自 `actors/0001` 就在模型上，所以这里读它**不需要**给本迁移
    加新依赖——给一个可能已经 apply 过的迁移加依赖会触发
    InconsistentMigrationHistory。
    """
    # 空串不是名字：可选名字列是 `blank=True`，`Q(name_zh="")` 会命中所有没有
    # 中文名的行(四十二判官全在内)。`ROWS` 里没有空串，但守卫写在这里而不是靠
    # 调用方，与 `resolve_actor_by_any_name` 同。
    if not actor_name:
        return None

    candidates = actor_model._base_manager.filter(
        civilization=civilization,
        tenant_id=tenant_id,
        is_deleted=False,
    ).order_by("name")

    exact = candidates.filter(
        Q(name=actor_name)
        | Q(name_zh=actor_name)
        | Q(name_en=actor_name)
        | Q(name_egy=actor_name)
    ).first()
    if exact is not None:
        return exact

    for actor in candidates:
        powers = actor.powers_json
        if not isinstance(powers, dict):
            continue
        if actor_name in (powers.get("aliases") or []):
            return actor
    return None


def _candidates(node_model, node_name, court_code, node_order):
    """Undecided, unconfigured nodes matching one ROWS signature.

    三列必须同时相符。只用 node_name 会把一个租户自建的、名字碰巧一样的节点也
    卷进来；加上 court_code 与 node_order，则要求这一行确实是模板生成的那一步。
    """
    return node_model._base_manager.filter(
        node_name=node_name,
        court_code=court_code,
        node_order=node_order,
        status="PENDING",
        verdict="",
        decided_at__isnull=True,
        approver__isnull=True,
        approver_type="SYSTEM",
        approver_actor__isnull=True,
    )


def forwards(apps, schema_editor):
    ApprovalNode = apps.get_model("workflow", "ApprovalNode")
    Actor = apps.get_model("actors", "Actor")

    # 空库：什么都不写。见模块 docstring 的「空库守卫」。
    if not ApprovalNode._base_manager.exists():
        return

    skipped = []
    for node_name, court_code, node_order, civilization, actor_name in ROWS:
        for node in _candidates(ApprovalNode, node_name, court_code, node_order):
            tenant_id = node.workflow.tenant_id
            actor = _find_actor(Actor, actor_name, civilization, tenant_id)
            if actor is None:
                # 该租户的 cast 里没有这位。跳过而不是新建——节点保持 SYSTEM，
                # 也就是只能走 escalate，这是安全的一侧。
                skipped.append((node_name, tenant_id, actor_name))
                continue
            node.approver_type = "ACTOR"
            node.approver_actor = actor
            node.save(update_fields=["approver_type", "approver_actor"])

    if skipped:
        print(
            f"\n  workflow/0011: {len(skipped)} node(s) left as SYSTEM — the "
            f"named actor is not on that tenant's bench, so they stay "
            f"escalate-only:"
        )
        for node_name, tenant_id, actor_name in skipped:
            print(f"    {node_name} (tenant={tenant_id}) -> {actor_name} not found")


def backwards(apps, schema_editor):
    ApprovalNode = apps.get_model("workflow", "ApprovalNode")
    Actor = apps.get_model("actors", "Actor")

    for node_name, court_code, node_order, civilization, actor_name in ROWS:
        qs = ApprovalNode._base_manager.filter(
            node_name=node_name,
            court_code=court_code,
            node_order=node_order,
            status="PENDING",
            verdict="",
            decided_at__isnull=True,
            approver__isnull=True,
            approver_type="ACTOR",
            approver_actor__isnull=False,
        )
        for node in qs:
            tenant_id = node.workflow.tenant_id
            actor = _find_actor(Actor, actor_name, civilization, tenant_id)
            # 只回退**本迁移会指派的那一位**。有人后来把节点改指给别人，那是一
            # 次决定；回滚这个迁移不该顺手抹掉它。
            if actor is None or node.approver_actor_id != actor.pk:
                continue
            node.approver_type = "SYSTEM"
            node.approver_actor = None
            node.save(update_fields=["approver_type", "approver_actor"])


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0010_approvalnode_delete_cascade_id_and_more"),
        # 正向要按 name/name_zh/civilization/tenant/is_deleted 查 Actor；
        # 0006 加的是软删列，0003 加的是 tenant，两者都必须已在。
        ("actors", "0008_actor_delete_cascade_id"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
