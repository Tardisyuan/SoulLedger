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
    category = models.CharField(max_length=50)  # soul, ledger, judgment, system

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
#
# 这份清单是 codename 的**目录**：视图声明的每个 codename 都必须在这里出现，
# 且必须至少被 ROLE_PERMISSIONS 里的一个角色持有。两条约束由
# apps/perm/test_codename_coverage.py 对全项目每个路由视图逐条断言。
#
# 曾经有 17 个 codename 只写在下面的 ROLE_PERMISSIONS 里而没进这份目录
# （soul.die、judgment.create、workflow.* 等）。后果不是"少一行文档"：
# apps/core/ws_permissions.py:62 和 apps/notifications/consumers.py:204 直接
# 把这份清单当作 ADMIN 的 WebSocket 权限集，缺一条 ADMIN 就收不到对应的
# 事件；apps/perm/views.py 的初始化/导入接口也只按这份清单建 Permission 行，
# 缺一条权限管理界面上就看不见、也没法单独授予或收回。补齐即可，
# 不需要迁移——迁移 0013/0015 早已把 workflow.* 落进 Permission 表。
DEFAULT_PERMISSIONS = [
    # soul 权限（CRUD + 两个自定义动作，ROLE_PERMISSIONS 一直在授予它们）
    ("soul.read", "查看灵魂", "soul"),
    ("soul.create", "创建灵魂", "soul"),
    ("soul.update", "编辑灵魂", "soul"),
    ("soul.delete", "删除灵魂", "soul"),
    ("soul.die", "宣告死亡", "soul"),
    ("soul.transition", "状态流转", "soul"),
    # judgment 权限
    ("judgment.read", "查看审判", "judgment"),
    ("judgment.create", "创建审判", "judgment"),
    ("judgment.execute", "执行审判", "judgment"),
    # disposition 权限（read + execute 二元，没有 disposition.manage）
    ("disposition.read", "查看处置", "disposition"),
    ("disposition.execute", "执行处置", "disposition"),
    # ledger 权限（原 karma.*，随 apps.karma → apps.ledger 一并改名，
    # 迁移 0016 负责把已入库的 Permission 行改名而非重建，以保住授权）
    ("ledger.read", "查看功德", "ledger"),
    ("ledger.manage", "管理功德", "ledger"),
    # reincarnation 权限
    ("reincarnation.read", "查看轮回", "reincarnation"),
    ("reincarnation.manage", "管理轮回", "reincarnation"),
    ("reincarnation.complete", "完成轮回", "reincarnation"),
    ("reincarnation.reborn", "执行转生", "reincarnation"),
    # dashboard 权限
    ("dashboard.read", "查看仪表盘", "dashboard"),
    # audit 权限
    ("audit.read", "查看审计日志", "audit"),
    # notification 权限
    ("notification.read", "查看通知", "notification"),
    # dispatch 权限（read/manage 二元，外加三个审批动作）
    ("dispatch.read", "查看调度", "dispatch"),
    ("dispatch.manage", "管理调度", "dispatch"),
    ("dispatch.approve", "批准调度", "dispatch"),
    ("dispatch.reject", "驳回调度", "dispatch"),
    ("dispatch.execute", "执行调度", "dispatch"),
    # workflow 权限（迁移 0013 建了前六条、0015 建了 escalate，
    # 这份目录当时漏了它们，补上以对齐 DB）
    ("workflow.read", "查看工作流", "workflow"),
    ("workflow.create", "创建工作流", "workflow"),
    ("workflow.update", "编辑工作流", "workflow"),
    ("workflow.delete", "删除工作流", "workflow"),
    ("workflow.approve", "审批工作流", "workflow"),
    ("workflow.advance", "推进工作流", "workflow"),
    ("workflow.escalate", "越级推进工作流", "workflow"),
    # cross-tenant judgment 权限
    # 注意：这一族目前**没有任何视图声明它**。看名字它显然是为
    # apps/dispatch/views.py 的 CrossTenantJudgmentViewSet 写的，但那个视图
    # 声明的是 dispatch.*。两族的持有者不同——cross_judgment.* 是
    # ADMIN/JUDGE/MODERATOR，dispatch.read 是 ADMIN/GUARDIAN/MODERATOR——
    # 所以改挂过去会让 GUARDIAN 丢掉跨域审判的读权限、JUDGE 凭空获得，
    # 属于策略变更而非改名，留给负责人定夺。
    ("cross_judgment.read", "查看跨域审判", "cross_judgment"),
    ("cross_judgment.create", "创建跨域审判", "cross_judgment"),
    # realms 权限
    ("realms.read", "查看领域", "realms"),
    # actors 权限
    ("actors.read", "查看角色", "actors"),
    # org 权限（read/manage 二元，同 ledger.*/disposition.* 的形状）
    ("org.read", "查看组织", "org"),
    ("org.manage", "管理组织", "org"),
    # system 权限
    ("system.settings", "系统设置", "system"),
    ("user.manage", "用户管理", "system"),
    # menu.read 是导航本身，不是菜单管理。它授予全部五个角色：能登录就得
    # 看得见左侧导航，否则 apps/menus/views.py 的 list/tree/list-public 一旦
    # 进入拦截就会把每个非 ADMIN 关在一棵空树前面。写操作仍归 menu.manage。
    ("menu.read", "查看菜单", "system"),
    ("menu.manage", "菜单管理", "system"),
]


# 默认角色权限矩阵
ROLE_PERMISSIONS = {
    "ADMIN": [
        "soul.read", "soul.create", "soul.update", "soul.delete", "soul.die", "soul.transition",
        "judgment.read", "judgment.create", "judgment.execute",
        "ledger.read", "ledger.manage",
        "reincarnation.read", "reincarnation.manage", "reincarnation.complete", "reincarnation.reborn",
        "disposition.read", "disposition.execute",
        "dashboard.read", "audit.read", "notification.read",
        "dispatch.read", "dispatch.manage", "dispatch.approve", "dispatch.reject", "dispatch.execute",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read",
        "org.read", "org.manage",
        "system.settings", "user.manage", "menu.read", "menu.manage",
        "workflow.read", "workflow.create", "workflow.update", "workflow.delete", "workflow.approve", "workflow.advance",
        # Migration 0015 grants this to ADMIN in the database (ADMIN_GRANTS =
        # ["workflow.escalate"]) — this static list had drifted from that intent
        # and omitted it. The drift was live: apps/core/ws_permissions.py reads
        # DEFAULT_PERMISSIONS (which does list workflow.escalate) as ADMIN's
        # WebSocket permission set, while REST enforcement falls back to this
        # dict for any unseeded codename — so ADMIN held escalate over the
        # socket and was denied it over REST. Found by the Stage 7 design review.
        "workflow.escalate",
    ],
    "JUDGE": [
        "soul.read", "soul.die", "soul.transition",
        "judgment.read", "judgment.create", "judgment.execute",
        "reincarnation.read", "reincarnation.manage",
        "ledger.read", "dashboard.read",
        "disposition.read",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read",
        "org.read",
        "notification.read", "menu.read",
        "workflow.read", "workflow.approve", "workflow.advance",
    ],
    "GUARDIAN": [
        "soul.read", "soul.update", "soul.transition",
        "reincarnation.read", "reincarnation.manage",
        "ledger.read", "dashboard.read",
        "disposition.read",
        "dispatch.read", "dispatch.manage",
        "realms.read", "actors.read",
        "org.read",
        "notification.read", "menu.read",
    ],
    # Realm lead: configures the approval flows for their own civilization.
    #
    # Scoping comes from the tenant, not the role — every user belongs to
    # exactly one tenant and non-ADMIN querysets are filtered to it, so one
    # role covers all three civilizations without any of its holders seeing
    # each other's. That is also why this must never be ADMIN: ADMIN bypasses
    # tenant isolation outright, so a "lead of Diyu" given ADMIN would quietly
    # be a lead of everywhere.
    #
    # Deliberately no workflow.approve / workflow.advance. The ten courts exist
    # to divide the decision; a lead who both designs the flow and approves at
    # any stage of it makes that division decorative. workflow.escalate is the
    # sanctioned way past a stalled flow instead — it demands a written reason
    # and always leaves an audit record naming who overrode which node.
    #
    # Also no user.manage: UserViewSet carries no tenant mixin, so that
    # codename grants edit access to every user in every tenant with no bound
    # on the role being assigned — a realm lead holding it could promote
    # themselves to ADMIN and step straight out of the isolation that defines
    # this role. No system.settings or menu.manage either: those are platform
    # concerns, not realm ones. And no soul.delete while deletion semantics are
    # still unsettled.
    "MODERATOR": [
        "workflow.read", "workflow.create", "workflow.update", "workflow.delete",
        "workflow.escalate",
        "soul.read", "soul.create", "soul.update", "soul.die", "soul.transition",
        "judgment.read", "judgment.create", "judgment.execute",
        "disposition.read", "disposition.execute",
        "reincarnation.read", "reincarnation.manage",
        "reincarnation.reborn", "reincarnation.complete",
        "ledger.read", "ledger.manage",
        "dispatch.read", "dispatch.manage",
        "dispatch.approve", "dispatch.reject", "dispatch.execute",
        "cross_judgment.read", "cross_judgment.create",
        "realms.read", "actors.read", "dashboard.read",
        "org.read", "org.manage",
        "audit.read", "notification.read", "menu.read",
    ],
    "VIEWER": [
        "soul.read", "reincarnation.read",
        "ledger.read", "dashboard.read",
        "realms.read", "actors.read",
        "org.read",
        "notification.read", "menu.read",
    ],
}

# 默认角色列表
# 这份清单必须和 ROLE_PERMISSIONS 的键一一对应，由
# apps/perm/test_checker_grants.py 断言。MODERATOR 曾经只存在于
# ROLE_PERMISSIONS 和迁移 0014/0015 里而不在这份种子数据中，于是任何从零
# 建立的库都没有它的 Role 行，0014/0015 的授权便在 "role is None" 上整段
# 跳过——地区主宰在新装环境里是个有权限矩阵却没有实体的角色。
DEFAULT_ROLES = [
    ("ADMIN", "Administrator"),
    ("MODERATOR", "Realm Lead"),
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


class FieldPermission(models.Model):
    """
    字段级权限 - 控制 API 响应中字段的可见性与可编辑性。

    用于按角色动态控制：
    - 哪些字段在 API 响应中可见 (visible)
    - 哪些字段只读 (read_only)
    - 哪些字段可编辑 (editable)

    优先级：specific (role + model + field) > general (role + model + *)
    """
    role = models.ForeignKey(
        Role,
        on_delete=models.CASCADE,
        related_name='field_permissions',
    )
    model_name = models.CharField(
        max_length=100,
        help_text="模型名称，如 Soul, Judgment, User",
    )
    field_name = models.CharField(
        max_length=100,
        help_text="字段名，如 name, status, merit_score。使用 * 表示所有字段的默认规则",
    )
    visible = models.BooleanField(
        default=True,
        help_text="字段是否在 API 响应中可见",
    )
    read_only = models.BooleanField(
        default=False,
        help_text="字段是否只读（不可通过 API 修改）",
    )
    editable = models.BooleanField(
        default=True,
        help_text="字段是否可编辑（仅在 visible=True 时有意义）",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [("role", "model_name", "field_name")]
        ordering = ["role", "model_name", "field_name"]
        verbose_name = "Field Permission"
        verbose_name_plural = "Field Permissions"

    def __str__(self):
        return f"{self.role.name} → {self.model_name}.{self.field_name} (vis={self.visible}, ro={self.read_only})"

    @classmethod
    def get_field_rules(cls, role_name, model_name):
        """
        获取指定角色和模型的字段权限规则。

        Returns:
            dict: {field_name: {"visible": bool, "read_only": bool, "editable": bool}}
            None: if no rules defined (all fields visible/editable by default)
        """
        rules = cls.objects.filter(
            role__name=role_name,
            model_name=model_name,
            is_active=True,
        ).select_related('role')

        if not rules.exists():
            return None

        result = {}
        for rule in rules:
            result[rule.field_name] = {
                "visible": rule.visible,
                "read_only": rule.read_only,
                "editable": rule.editable,
            }
        return result
