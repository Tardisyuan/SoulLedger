"""
Data migration: fold CamelCase resource spellings into the lowercase form
that every other write path already uses ('RolePermission' → 'rolepermission',
'Role' → 'role').

背景：
- apps/audit/signals.py 里 _invalidate_permission_cache（Role / RolePermission
  的专用处理器）之前直接把 CamelCase 的 model_name（instance._meta.label 的
  最后一段）写进 resource 字段。其余写路径（_create_audit_log、
  create_batch_audit_log）都走 _get_resource_name，用 label_lower 取全小写
  的模型名。结果同一个逻辑资源在数据库里长期以两种大小写并存：现网
  rolepermission 101 行、RolePermission 100 行，Role 目前只观察到全小写。
- resource 字段没有唯一约束，审计列表接口的 resource__icontains 过滤器碰巧
  不区分大小写，掩盖了这个问题；但任何按 resource 做 group by / count 的
  代码都会把它们当成两个不同的资源。写路径已在同一次改动里改成
  resource=model_name.lower()（见 signals.py），这里把历史行折叠到统一的
  小写拼写，避免继续污染尚未失效的旧数据。

可逆性：
- 这是一次多对一的折叠（两种历史拼写合并成一种），不是一对一改名，严格
  意义上不可逆——折叠之后无法从 'rolepermission' 反推哪一行原本就是小写、
  哪一行是从 'RolePermission' 折过来的。
- backward 提供的是"尽力而为"的对称操作：把当前 resource 为小写形式的行
  改回 CamelCase。这会连带影响折叠前就已经是小写的行，但不删行、不动
  其它字段，足以支持"回滚这次部署"这类场景，且正向/反向可以反复执行
  而不报错（幂等）。
"""
from django.db import migrations

# (CamelCase spelling written by the old _invalidate_permission_cache path,
#  lowercase canonical spelling written by every other path)
FOLDS = [
    ("Role", "role"),
    ("RolePermission", "rolepermission"),
]


def forward(apps, schema_editor):
    AuditLog = apps.get_model("audit", "AuditLog")
    # 0008_alter_auditlog_managers renamed the default manager to
    # all_objects, so the historical model has no `objects`.
    for camel, lower in FOLDS:
        AuditLog.all_objects.filter(resource=camel).update(resource=lower)


def backward(apps, schema_editor):
    AuditLog = apps.get_model("audit", "AuditLog")
    for camel, lower in FOLDS:
        AuditLog.all_objects.filter(resource=lower).update(resource=camel)


class Migration(migrations.Migration):

    dependencies = [
        ("audit", "0008_alter_auditlog_managers"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
