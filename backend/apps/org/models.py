"""
Organization models - 组织架构
替代 civilization 作为多租户隔离的基础
"""
from django.db import models
from apps.core.models import AuditUserFields


class Organization(AuditUserFields):
    """
    组织架构 - 对应各文明/公司/部门

    设计参考 Snowy 的 SysOrg：
    - 自引用树形结构实现层级
    - category 区分文明体系
    - code 用于权限计算
    """
    name = models.CharField(
        max_length=100,
        help_text="组织名称：如 第一殿、冥王厅"
    )
    code = models.CharField(
        max_length=50,
        unique=True,
        help_text="唯一编码：如 DIYU_01、HEAVEN_01"
    )
    parent = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='children',
        help_text="父组织（平行部门）"
    )
    # 分类：对应原来的 civilization
    CATEGORY_CHOICES = [
        ('CHINESE', '中国地府'),
        ('EUROPEAN', '欧洲天堂地狱'),
        ('EGYPTIAN', '埃及冥界'),
    ]
    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
        help_text="所属文明体系"
    )
    # 层级深度（用于权限计算）
    level = models.IntegerField(
        default=0,
        help_text="层级深度：0=根组织"
    )
    # 排序
    sort = models.IntegerField(
        default=0,
        help_text="同级别排序"
    )
    # 扩展信息
    ext = models.JSONField(
        default=dict,
        blank=True,
        help_text="扩展信息JSON"
    )

    class Meta:
        db_table = 'organizations'
        verbose_name = 'Organization'
        verbose_name_plural = 'Organizations'
        ordering = ['category', 'level', 'sort']
        indexes = [
            models.Index(fields=['category']),
            models.Index(fields=['parent', 'sort']),
        ]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        # 自动计算层级深度
        if self.parent:
            self.level = self.parent.level + 1
        else:
            self.level = 0
        super().save(*args, **kwargs)

    def get_ancestors(self):
        """获取所有祖先组织"""
        ancestors = []
        current = self.parent
        while current:
            ancestors.append(current)
            current = current.parent
        return ancestors

    def get_children_recursive(self):
        """获取所有后代组织（包括自己）"""
        result = [self]
        children = list(self.children.all())
        while children:
            child = children.pop(0)
            result.append(child)
            children.extend(list(child.children.all()))
        return result


# 组织架构数据初始化已移至 management command:
#   apps/org/management/commands/init_organizations.py
# 运行: python manage.py init_organizations
