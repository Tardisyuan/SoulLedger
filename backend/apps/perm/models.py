"""
RBAC Permission models — 参考 Snowy SaToken 设计
"""
import uuid
from django.db import models
from apps.core.models import AuditUserFields


class Permission(AuditUserFields):
    """
    权限定义，如 soul.read, judgment.execute
    """
    codename = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=50)  # soul, karma, judgment, system

    class Meta:
        verbose_name = "Permission"
        verbose_name_plural = "Permissions"
        ordering = ["category", "codename"]

    def __str__(self):
        return f"{self.codename} ({self.name})"


class DataScope(AuditUserFields):
    """
    数据范围定义，用于行级权限过滤
    """
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50, unique=True)
    filter_type = models.CharField(
        max_length=20,
        choices=[
            ('realm', 'Realm范围'),
            ('civilization', '文明范围'),
            ('state', '状态范围'),
            ('custom', '自定义'),
        ],
        default='custom'
    )
    # 过滤规则，存储为JSON如 {"realm_id": 1} 或 {"civilization": "CHINA"}
    filter_rules = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = "Data Scope"
        verbose_name_plural = "Data Scopes"
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} ({self.name})"


class Role(AuditUserFields):
    """
    角色定义，如 ADMIN, JUDGE, GUARDIAN, VIEWER
    支持层级继承，子角色继承父角色的权限
    新增 scope 字段：GLOBAL=全局权限，ORG=组织级权限
    """
    name = models.CharField(max_length=20, unique=True)
    display_name = models.CharField(max_length=100)
    # 父角色，用于层级继承
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children'
    )
    # 角色作用域：GLOBAL=全局，ORG=组织级
    SCOPE_CHOICES = [
        ('GLOBAL', '全局'),
        ('ORG', '组织级'),
    ]
    scope = models.CharField(
        max_length=10,
        choices=SCOPE_CHOICES,
        default='ORG',
        help_text="作用域：GLOBAL=全局权限，ORG=组织级权限"
    )
    # ORG 角色专属组织（GLOBAL 角色此字段为空）
    organization = models.ForeignKey(
        'org.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='roles',
        help_text="ORG角色专属组织，GLOBAL角色此字段为空"
    )

    class Meta:
        verbose_name = "Role"
        verbose_name_plural = "Roles"
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.display_name})"

    def get_inherited_permissions(self, _visited=None):
        """
        获取继承的权限（包含自己的权限和所有祖先的权限）
        通过递归获取父角色权限形成继承链
        """
        if _visited is None:
            _visited = set()
        if self.pk in _visited:
            return set()  # Cycle detection
        _visited.add(self.pk)

        # 获取自己的直接权限
        own_permissions = set(
            rp.permission.codename
            for rp in self.permissions.all()
        )

        # 递归获取父角色权限
        inherited_permissions = set()
        if self.parent:
            inherited_permissions = self.parent.get_inherited_permissions(_visited)

        # 合并：自己的权限 + 继承的权限
        return own_permissions | inherited_permissions

    def get_ancestors(self):
        """
        获取所有祖先角色
        """
        ancestors = []
        current = self.parent
        while current is not None:
            ancestors.append(current)
            current = current.parent
        return ancestors

    def get_descendants(self):
        """
        获取所有后代角色
        """
        descendants = []
        children = list(self.children.all())
        while children:
            child = children.pop(0)
            descendants.append(child)
            children.extend(list(child.children.all()))
        return descendants


class RolePermission(AuditUserFields):
    """
    角色-权限关联
    """
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name="permissions"
    )
    permission = models.ForeignKey(
        Permission,
        on_delete=models.CASCADE,
        related_name="role_permissions"
    )
    # 权限生效条件，如 {"current_state": ["PENDING", "APPEALING"]}
    conditions = models.JSONField(
        default=dict,
        blank=True,
        help_text='权限生效条件，如 {"current_state": ["PENDING", "APPEALING"]}'
    )
    # 数据范围，用于更复杂的行级过滤
    data_scope = models.ForeignKey(
        DataScope,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='role_permissions'
    )

    class Meta:
        unique_together = ["role", "permission"]
        verbose_name = "Role Permission"
        verbose_name_plural = "Role Permissions"

    def __str__(self):
        return f"{self.role.name} -> {self.permission.codename}"


# 默认权限矩阵
DEFAULT_PERMISSIONS = [
    # soul 权限
    ("soul.read", "查看灵魂", "soul"),
    ("soul.create", "创建灵魂", "soul"),
    ("soul.update", "编辑灵魂", "soul"),
    ("soul.delete", "删除灵魂", "soul"),
    # judgment 权限
    ("judgment.read", "查看审判", "judgment"),
    ("judgment.execute", "执行审判", "judgment"),
    # karma 权限
    ("karma.read", "查看功德", "karma"),
    ("karma.manage", "管理功德", "karma"),
    # reincarnation 权限
    ("reincarnation.read", "查看轮回", "reincarnation"),
    ("reincarnation.manage", "管理轮回", "reincarnation"),
    # dashboard 权限
    ("dashboard.read", "查看仪表盘", "dashboard"),
    # audit 权限
    ("audit.read", "查看审计日志", "audit"),
    # notification 权限
    ("notification.read", "查看通知", "notification"),
    # dispatch 权限
    ("dispatch.read", "查看调度", "dispatch"),
    ("dispatch.manage", "管理调度", "dispatch"),
    # cross-tenant judgment 权限
    ("cross_judgment.read", "查看跨域审判", "cross_judgment"),
    ("cross_judgment.create", "创建跨域审判", "cross_judgment"),
    # realms 权限
    ("realms.read", "查看领域", "realms"),
    # actors 权限
    ("actors.read", "查看角色", "actors"),
    # system 权限
    ("system.settings", "系统设置", "system"),
    ("user.manage", "用户管理", "system"),
    ("menu.manage", "菜单管理", "system"),
]


# 默认角色权限矩阵
ROLE_PERMISSIONS = {
    "ADMIN": [
        "soul.read", "soul.create", "soul.update", "soul.delete",
        "judgment.read", "judgment.execute",
        "karma.read", "karma.manage",
        "reincarnation.read", "reincarnation.manage",
        "dashboard.read", "audit.read", "notification.read",
        "dispatch.read", "dispatch.manage",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read",
        "system.settings", "user.manage", "menu.manage",
    ],
    "JUDGE": [
        "soul.read", "judgment.read", "judgment.execute",
        "reincarnation.read", "reincarnation.manage",
        "karma.read", "dashboard.read",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read",
    ],
    "GUARDIAN": [
        "soul.read", "soul.update",
        "reincarnation.read", "reincarnation.manage",
        "karma.read", "dashboard.read",
        "dispatch.read", "dispatch.manage",
        "realms.read", "actors.read",
    ],
    "VIEWER": [
        "soul.read", "reincarnation.read",
        "karma.read", "dashboard.read",
        "realms.read", "actors.read",
    ],
}

# 默认角色列表
DEFAULT_ROLES = [
    ("ADMIN", "Administrator"),
    ("JUDGE", "Judge"),
    ("GUARDIAN", "Guardian"),
    ("VIEWER", "Viewer"),
]


class RowLevelDataScope(models.Model):
    """
    行级数据范围 - 行级访问控制
    例如：JUDGE 角色只能看和处理 status=PENDING 的灵魂
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # 关联角色（使用 perm.Role 的 name 字段）
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='row_level_scopes'
    )

    # 文明范围（使用 CharField，因为 souls.Civilization 是 TextChoices 不是模型）
    civilization = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        help_text='文明：CHINA, EUROPE, EGYPT'
    )

    # 模型名称
    model_name = models.CharField(max_length=50)  # 'Soul', 'Judgment'

    # 过滤条件（JSON 存储）
    filter_conditions = models.JSONField(
        default=dict,
        help_text='过滤条件，如 {"current_state": "ALIVE"}'
    )

    # 权限类型
    SCOPE_TYPES = [
        ('READ', '读取'),
        ('WRITE', '写入'),
        ('DELETE', '删除'),
    ]
    scope_type = models.CharField(max_length=10, choices=SCOPE_TYPES)

    # 优先级（数值越大优先级越高）
    priority = models.IntegerField(default=0)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'permissions_row_level_data_scope'
        indexes = [
            models.Index(fields=['role', 'model_name']),
        ]

    def __str__(self):
        return f"{self.role.name} - {self.model_name} ({self.scope_type})"
