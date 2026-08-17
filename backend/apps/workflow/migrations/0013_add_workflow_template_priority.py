"""Give `WorkflowTemplate` a `priority` column: the default urgency of the
procedure the template describes.

这是一次纯 schema 变更，没有数据部分——**故意的**，理由值得写下来。

`AddField(default=0)` 会把所有既有行写成 0。这看起来像是「猜了一个值」，其实不是：
在这一列存在之前，没有任何一行能表达「本模板是给急件用的」，所以没有哪一行携带着一个
被这次默认值覆盖掉的决定。0 是「未表态」，不是「表态为普通」。

真正需要判断的那一批行——用「紧急审判流程」这个名字存下来的三套预设——由紧随其后的
`0014_backfill_emergency_template_priority` 单独处理，那一支才是数据迁移，才有可逆
性、`_base_manager`、空库守卫和往返测试。两件事分开写，是为了让「加一列」和「决定某
些既有行的值」各自可以被单独回滚：回退 0014 只是把那三套预设放回 0，回退 0013 才是
把这一列本身拿掉。

反向即 `RemoveField`，Django 自动生成，会丢掉列里的全部数据；这正是回退一个新列应有
的语义，且 0014 依赖本迁移，所以回退顺序上 0014 的数据回滚一定先发生。
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0012_correct_the_egyptian_weighing_nodes"),
    ]

    operations = [
        migrations.AddField(
            model_name="workflowtemplate",
            name="priority",
            field=models.IntegerField(
                default=0,
                help_text="Default priority for workflows built from this template: 0=normal, 1=urgent, 2=critical",
            ),
        ),
    ]
