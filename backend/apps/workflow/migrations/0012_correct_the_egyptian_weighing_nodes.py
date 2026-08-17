"""Correct the two heart-weighing nodes that recorded Anubis and the assessors
as judges.

背景
----
`services.WORKFLOW_TEMPLATES` 的「欧西里斯称重流程」前两个节点，直到本迁移之前
写的是：

    阿努比斯 · 引渡审判    NodeType.TRIAL
    四十二神官 · 罪行核实   NodeType.TRIAL

两条都与考据相反，而且**名字与类型各说了一遍同一个错**：

* 阿努比斯**操秤**，不是判官。图版 III 铭文称他「O weigher of righteousness」，
  BD 30B 称「him who keepeth the scales」(Budge《亚尼纸草》1895；BM EA 9901
  Hunefer 同一场景独立印证)。判词由托特记录并宣读、奥西里斯接纳。
  `docs/lore-verification/README.md` 的位置错误表里就有「Anubis | judge |
  operates the scales」这一行，`verify-egyptian.md` §7 第 8 条把
  `Anubis → JUDGE` 记作 wrong in kind。
* 四十二条否定告白是亡者入殿时**一次说完的陈述**(BD 125B)，不是一个审级；
  四十二判官不作裁断，也没有什么可「核实」。

前端的同一套流程已按考据改过(`Anubis · 引导与称量`、`42审判者 · 否定告白`，
两者在 `frontend/src/config/workflow-node-types.ts` 里都判读为 EVALUATION)，后端
是留在旧读法上的那一侧。模板已改；这个迁移管**已经落库的行**。

为什么需要迁移而不是只改模板
--------------------------
`ApprovalNode` 行是建流程时从模板拷出来的，改模板只影响**以后**建的流程。已存的
行会一直带着 `引渡审判`/`TRIAL` —— 同一件事在数据库里留着第三个答案。

本地开发库(`backend/db.sqlite3`)实测 `workflow_approvalnode` 0 行；生产库
(`192.168.2.115:5432`)从此环境不可达(`nc -z -w 3` 退出码 1)，无法自行查询。
`0011` 的 docstring 记录了 2026-08-15 对生产库的实测：30 行全部分布在 3 个
「十殿审判流程」，没有埃及行——但那是**别人测的**，不是本次执行的查询。既然无法
自证「哪里都没有这样的行」，就按仓库惯例写一个空库 no-op、可逆的数据迁移：命中
就修，没命中就什么都不做。

改哪些行 —— 与 0011 的过滤条件**不同**，这一点是有意的
--------------------------------------------------
`0011` 只改 `status=PENDING` 且未决的节点，理由是它写的是一个**新事实**(该由谁
批)，给已决节点追加一个「本应由谁批」会把事后补记伪装成当时的事实。

本迁移写的不是新事实，是**对一处从一开始就写错的描述的更正**：阿努比斯在这个节
点被创建的那一刻就不是判官。把一个已决节点的步骤名从「引渡审判」改成「引导与称
量」，不改动 `approver` / `verdict` / `decided_at` / `status` 中的任何一列——谁批
的、批了什么、什么时候批的，一个字都没动。所以这里按**签名**(node_name +
court_code + node_order)匹配，不按状态过滤，并且明确只写 `node_name` 与
`node_type` 两列。

`ROWS`/`RENAMES` 为什么与 0011 的表并存
-------------------------------------
`0011` 的 `ROWS` 里那一行仍写着 `阿努比斯 · 引渡审判`，**必须**仍这样写：迁移记
录的是当时的事实。一个还停在 0010 的库里，节点名就是旧的；0011 先按旧名回填审批
人，0012 再改名，顺序本身就是对的。把 0011 的表改成新名字会让那种库悄悄漏掉回
填。`apps/workflow/tests.py::TestTemplateApproverBasis` 因此不再能把 0011 的表
和活模板逐字相等地比——它现在经由本模块的 `RENAMES` 比，两份仍不会各走各的。

空库守卫
--------
空的 `workflow_approvalnode` 表是全新安装：没有旧行要更正，`WorkflowService`
从此按新模板建节点。realms/0014、judgment/0013、workflow/0011 都带同一个守卫。

可逆性
------
`backwards` 只把**本迁移可能写过的那批行**改回去：签名匹配新名字、且
`node_type` 正好是正向会写的那一个。有人后来把类型改成别的，那是一次决定，回滚
本迁移不该顺手抹掉它。正反向都可重复执行，
`backend/tests/test_workflow_egyptian_node_reading.py` 用 `migration_round_trip`
夹具做 forward → reverse → forward 的**数据**比对。

全部行访问走 `_base_manager`：迁移里没有租户上下文，`ApprovalNode` 目前没有自己
的 manager 覆写，但一并用 `_base_manager` 以免将来加上一个，与 0011 同。
"""
from django.db import migrations

#: (old_name, new_name, court_code, node_order, old_node_type, new_node_type)
#:
#: 冻结在这里而不是从 `services.WORKFLOW_TEMPLATES` 导入，理由与 `0011.ROWS`
#: 相同：迁移记录的是当时的事实，模板是活代码。`apps/workflow/tests.py::
#: TestTemplateApproverBasis` 交叉断言这张表的**新名字一侧**与活模板一致，所以
#: 两份不会各走各的。
RENAMES = [
    (
        "阿努比斯 · 引渡审判",
        "阿努比斯 · 引导与称量",
        "Hall of Two Truths",
        1,
        "TRIAL",
        "EVALUATION",
    ),
    (
        "四十二神官 · 罪行核实",
        "四十二神官 · 否定告白",
        "Hall of Two Truths",
        2,
        "TRIAL",
        "EVALUATION",
    ),
]


def _matching(node_model, node_name, court_code, node_order, node_type):
    """本迁移一个签名对应的行。

    三列同时相符才算：只按 node_name 会把某个租户自建的、名字碰巧一样的节点也
    卷进来。`node_type` 也要相符，这样正向不会重写一个已经被人手工改成别的类型
    的节点，反向也只回退自己写过的那种。与 `0011._candidates` 同一条分工。
    """
    return node_model._base_manager.filter(
        node_name=node_name,
        court_code=court_code,
        node_order=node_order,
        node_type=node_type,
    )


def forwards(apps, schema_editor):
    ApprovalNode = apps.get_model("workflow", "ApprovalNode")

    # 空库：什么都不写。见模块 docstring 的「空库守卫」。
    if not ApprovalNode._base_manager.exists():
        return

    for old_name, new_name, court, order, old_type, new_type in RENAMES:
        _matching(ApprovalNode, old_name, court, order, old_type).update(
            node_name=new_name, node_type=new_type
        )


def backwards(apps, schema_editor):
    ApprovalNode = apps.get_model("workflow", "ApprovalNode")

    for old_name, new_name, court, order, old_type, new_type in RENAMES:
        _matching(ApprovalNode, new_name, court, order, new_type).update(
            node_name=old_name, node_type=old_type
        )


class Migration(migrations.Migration):

    dependencies = [
        # 0011 按 `阿努比斯 · 引渡审判` 这个**旧**名字回填审批人，所以它必须先
        # 跑完。反过来会让它在一张已经改名的表上静默地什么都找不到。
        ("workflow", "0011_backfill_ten_court_approvers"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
