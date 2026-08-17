"""Give the three saved 「紧急审判流程」 templates the priority they were always
meant to carry.

背景
----
`frontend/src/config/workflow-templates.ts` 里有三套预设叫「紧急审判流程」——中国、
欧洲、埃及各一套。`a77a41e` 之前它们写的是 `caseType: "EMERGENCY"`，而 `CaseType`
没有这个成员，所以**存不下来**（400）。`a77a41e` 把它们按案件类别分别归入
SPECIAL / ROUTINE / DIVINE_TRIAL，并在注释里写明：急缓不是案件类别，急缓留给
`ApprovalWorkflow.priority`。

于是从 `a77a41e` 到 `0013` 之间存下来的这三套模板，把「这是给急件用的程序」这句话
丢在了半路上：case_type 不再说它，模板上又还没有一列能说它。本迁移就是把这句话补回
已经落库的那些行——**只补这三套**。

为什么这不是在猜
--------------
`0013` 刚刚用 `default=0` 建了这一列，所以此刻库里每一行的 priority 都是 0，而且**没
有任何一行的 0 是有人选的**：在这一列存在之前，谁也没法在模板上表达急缓。所以这里不
存在「覆盖掉用户的决定」这种风险——0 在这一刻的含义是「尚未表态」。这也是本迁移必须
紧跟 0013、而不是过一阵子再补的原因：一旦有人真的把某套紧急模板手动设成 0，那个 0 就
是一次决定，而本迁移分辨不出来。`priority=0` 因此也写进了匹配条件：已经是 1（或 2）
的行不动。

匹配条件
--------
`(name, civilization, case_type)` 三列同时相符，与 `0012._matching` 同一条分工：只按
名字会把某个租户自建的、名字碰巧叫「紧急审判流程」的别的模板一起卷进来。三个签名就是
上面三套预设各自的 `(name, civilization, caseType)`。

`0011` / `0012` 的那条分工在这里同样成立：本迁移只写 `priority` 一列，不碰 `nodes_json`、
`is_active`、`name` 中的任何一个。

空库守卫
--------
空的 `workflow_workflowtemplate` 表是全新安装：没有旧行要更正，往后从
`/workflow` 存下来的紧急预设会自带 `priority=1`（前端 `WorkflowEditor` 现在会把它
POST 上来）。realms/0014、judgment/0013、workflow/0011、workflow/0012 都带同一个守卫。

可逆性
------
`backwards` 只把**本迁移可能写过的那批行**改回 0：签名相符、且 priority 正好是正向会
写的那个 1。有人后来把它改成 2，那是一次决定，回滚本迁移不该顺手抹掉它。正反向都可
重复执行；`backend/tests/test_workflow_template_priority.py` 用 `migration_round_trip`
夹具做 forward → reverse → forward 的**数据**比对。

全部行访问走 `_base_manager`：迁移里没有租户上下文，而 `WorkflowTemplate.objects` 是
`TenantManager`——用它会让这个迁移在没有 contextvar 的情况下看到的行数取决于运行环境。
`all_objects` 也是同一个管理器，但 `_base_manager` 是 0011/0012 用的那个，保持一致。
"""
from django.db import migrations

#: (name, civilization, case_type) —— 三套「紧急审判流程」预设各自的签名。
#:
#: 冻结在这里而不是从前端预设或 `services.WORKFLOW_TEMPLATES` 导入，理由与
#: `0011.ROWS` / `0012.RENAMES` 相同：迁移记录的是当时的事实，预设是活代码。
#: `backend/tests/test_workflow_template_priority.py` 交叉断言这张表与
#: `workflow-templates.ts` 里 `priority: 1` 的那几套一致，所以两份不会各走各的。
EMERGENCY_TEMPLATES = [
    ("紧急审判流程", "CHINESE", "SPECIAL"),
    ("紧急审判流程", "EUROPEAN", "ROUTINE"),
    ("紧急审判流程", "EGYPTIAN", "DIVINE_TRIAL"),
]

#: 正向写入的值，也是反向唯一肯回退的值。
URGENT = 1
NORMAL = 0


def _matching(template_model, name, civilization, case_type, priority):
    return template_model._base_manager.filter(
        name=name,
        civilization=civilization,
        case_type=case_type,
        priority=priority,
    )


def forwards(apps, schema_editor):
    WorkflowTemplate = apps.get_model("workflow", "WorkflowTemplate")

    # 空库：什么都不写。见模块 docstring 的「空库守卫」。
    if not WorkflowTemplate._base_manager.exists():
        return

    for name, civilization, case_type in EMERGENCY_TEMPLATES:
        _matching(WorkflowTemplate, name, civilization, case_type, NORMAL).update(
            priority=URGENT
        )


def backwards(apps, schema_editor):
    WorkflowTemplate = apps.get_model("workflow", "WorkflowTemplate")

    for name, civilization, case_type in EMERGENCY_TEMPLATES:
        _matching(WorkflowTemplate, name, civilization, case_type, URGENT).update(
            priority=NORMAL
        )


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0013_add_workflow_template_priority"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
