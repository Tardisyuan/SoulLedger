"""数据范围 B7:删死字段(local-gates/rbac-2026-10-29/datascope-design.md)。

删 ``RowLevelDataScope``、``DataScope`` 两张表,``RolePermission.conditions`` / ``data_scope``,
``Role.scope`` / ``organization`` / ``parent``。数据范围从 B2 起只读 ``RoleDataScope``,这些列没有读者。

**行级规则表里有行就中止**:那是有人手写过的规则,删表会悄悄丢掉它 —— 先用 ``GET /api/v1/perm/export/``
导出留底(导出不含这张表,要另存就直接查表),清空后再迁。库里应为 0 行,这是兜底。

Backward:列与表加回来,内容为空(``scope`` 回到默认 ``ORG``、``conditions`` 回到 ``{}``)。
"""
from django.db import migrations


def refuse_if_row_scopes_exist(apps, schema_editor):
    alias = schema_editor.connection.alias
    count = apps.get_model('perm', 'RowLevelDataScope')._base_manager.using(alias).count()
    if count:
        raise RuntimeError(
            f"perm/0031: permissions_row_level_data_scope 里还有 {count} 行。先用 /api/v1/perm/export/ "
            "导出权限配置并另存这张表,清空它之后再迁移。"
        )


class Migration(migrations.Migration):

    dependencies = [
        ('perm', '0030_split_business_codenames'),
    ]

    operations = [
        migrations.RunPython(refuse_if_row_scopes_exist, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='rolepermission',
            name='data_scope',
        ),
        migrations.RemoveField(
            model_name='role',
            name='organization',
        ),
        migrations.RemoveField(
            model_name='role',
            name='parent',
        ),
        migrations.RemoveField(
            model_name='role',
            name='scope',
        ),
        migrations.RemoveField(
            model_name='rolepermission',
            name='conditions',
        ),
        migrations.DeleteModel(
            name='DataScope',
        ),
        migrations.DeleteModel(
            name='RowLevelDataScope',
        ),
    ]
