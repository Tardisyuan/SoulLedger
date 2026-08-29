"""
Menu models for dynamic navigation based on user roles.

Tree structure with button resources — inspired by Snowy's resource system.
Supports DIRECTORY (folder) → MENU (page) → BUTTON (action) hierarchy.
"""
from django.db import models

from apps.core.models import AuditUserFields


class MenuType(models.TextChoices):
    DIRECTORY = "DIRECTORY", "目录"
    MENU = "MENU", "菜单"
    BUTTON = "BUTTON", "按钮"


class Menu(AuditUserFields, models.Model):
    """
    菜单模型 — 支持树形层级与按钮资源绑定。

    Hierarchy: DIRECTORY → MENU → BUTTON
    - DIRECTORY: 纯导航分组，无页面
    - MENU: 实际页面，有 path + component
    - BUTTON: 页面内操作按钮，绑定 permission codename
    """
    name = models.CharField(max_length=100)
    path = models.CharField(max_length=200, blank=True)
    icon = models.CharField(max_length=50, blank=True)
    order = models.IntegerField(default=0)
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="children"
    )
    menu_type = models.CharField(
        max_length=20,
        choices=MenuType.choices,
        default=MenuType.MENU,
    )
    permission = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="权限 codename，如 soul.read、judgment.create",
    )
    roles = models.JSONField(default=list)  # ["ADMIN", "GUARDIAN"]
    is_active = models.BooleanField(default=True)
    visible = models.BooleanField(default=True, help_text="是否在侧边栏显示")
    cache = models.BooleanField(default=True, help_text="是否缓存该菜单")
    component = models.CharField(max_length=200, blank=True)  # 前端组件路径

    class Meta:
        ordering = ["order", "id"]
        verbose_name = "Menu"
        verbose_name_plural = "Menus"

    def __str__(self):
        return f"[{self.menu_type}] {self.name}"

    def get_codename(self):
        """获取菜单对应的权限 codename.

        Dead code today — access control runs through `roles` and `permission`
        directly (see migration 0011's docstring), so this has no live caller.
        Kept correct anyway, because a method a future caller will trust on
        sight is worse dead than wrong: the path-derivation branch used to
        return `f"{parts[0]}.read"` unconditionally — plural URL segments
        (`/souls`, `/menus`) don't match the singular codenames they were
        guessing at (`soul.read`, `menu.read`), and nothing caught the
        mismatch. There is no reliable string transform for this — codename
        prefixes are singular for some modules (`soul`, `menu`) and plural for
        others (`realms`, `actors`) — so the fix is to check the guess against
        what actually exists rather than trust it. Found by the Stage 7
        design review.
        """
        if self.permission:
            return self.permission
        path = self.path.strip("/")
        if not path:
            return None
        guess = f"{path.split('/')[0].lower()}.read"
        from apps.perm.models import Permission
        if Permission.objects.filter(codename=guess).exists():
            return guess
        return None


class MenuButton(AuditUserFields, models.Model):
    """
    菜单按钮资源 — 页面内操作按钮，绑定权限 codename。

    每个 BUTTON 可以是 Menu(menu_type=BUTTON) 或独立的 MenuButton 记录。
    MenuButton 提供更细粒度的按钮管理，支持动态增删。
    """
    menu = models.ForeignKey(
        Menu,
        on_delete=models.CASCADE,
        related_name="buttons",
    )
    name = models.CharField(max_length=100, help_text="按钮显示名称")
    code = models.CharField(max_length=50, help_text="按钮编码，如 add/edit/delete/export")
    permission = models.CharField(
        max_length=100,
        help_text="权限 codename，如 soul.create、judgment.delete",
    )
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "id"]
        # Was `unique_together = [("menu", "code")]`. That form cannot carry a
        # condition, and without one a soft-deleted button kept its code
        # occupied by a row no filtered queryset can see: create -> delete ->
        # create-with-the-same-code answered 400 "already exists" while GET
        # showed nothing. Measured 2026-08-29 (alive=0, all=1). Unlike the
        # social constraints it degraded politely rather than 500ing, because
        # DRF generates a uniqueness validator for `unique_together` and not
        # for `Meta.constraints` -- the same root cause wearing a nicer face.
        constraints = [
            models.UniqueConstraint(
                fields=["menu", "code"],
                condition=models.Q(is_deleted=False),
                name="unique_menubutton_menu_code",
            ),
        ]
        verbose_name = "Menu Button"
        verbose_name_plural = "Menu Buttons"

    def __str__(self):
        return f"{self.menu.name} → {self.name} ({self.code})"
