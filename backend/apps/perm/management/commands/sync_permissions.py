"""补齐代码里有、数据库里没有的权限码名,连同它们的默认授予。

    python manage.py sync_permissions --dry-run   # 只列出会做什么
    python manage.py sync_permissions

只做一件事:`DEFAULT_PERMISSIONS` 里的码名,数据库里**没有存活的 Permission 行**的,
建一行,并按 `ROLE_PERMISSIONS` 授给默认持有它的角色。**已有的码名一行都不碰** ——
管理员在权限矩阵里对它们做过的授予与收回原样保留。

为什么这不改变任何人的实际权限(对已有 Role 行的角色):`apps/perm/checker.py` 对
没有 Permission 行的码名按 `ROLE_PERMISSIONS` 字典作答,有行之后按 RolePermission
作答。这里建的行恰好授给字典里的那批角色,所以两条路径给出同一个答案;变的只是
这个码名从此出现在权限矩阵里,可以被单独授予或收回。

为什么不是数据迁移:迁移是冻结的快照,不能读活的 `DEFAULT_PERMISSIONS` —— 读了,
同一个迁移在不同版本上就做不同的事。而这里要的恰是「代码此刻有、库里没有的那些」,
不止一个码名:`judgment.*`、`dispatch.return`、`sentence_plan.cancel` 在
`DEFAULT_PERMISSIONS` 里明写「不由迁移播种」,哪些已经被管理后台的「初始化」建过行,
每个库不一样。「初始化」本身不能用来补:它先删掉每个角色的全部授予再按字典重建,
会抹掉管理员的改动。

`Role` 行缺失的角色不补建,只报告:那个角色在数据库路径上本来就对每个已播种码名
答「无」(见 checker 的注释),补建角色是另一件事。
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission


def missing_permissions():
    """[(codename, name, category, [默认持有它的角色名])],只含库里没有存活行的码名。"""
    present = set(Permission.objects.values_list("codename", flat=True))
    return [
        (codename, name, category, [r for r, codes in ROLE_PERMISSIONS.items() if codename in codes])
        for codename, name, category in DEFAULT_PERMISSIONS
        if codename not in present
    ]


class Command(BaseCommand):
    help = "Create Permission rows (and their default role grants) for codenames missing from the database."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List what would be created; write nothing.")

    def handle(self, *args, dry_run=False, **options):
        missing = missing_permissions()
        if not missing:
            self.stdout.write("Nothing to do: every codename in DEFAULT_PERMISSIONS has a Permission row.")
            return
        roles = {r.name: r for r in Role.objects.filter(name__in=ROLE_PERMISSIONS)}
        prefix = "[dry-run] would create" if dry_run else "created"
        with transaction.atomic():
            for codename, name, category, holders in missing:
                granted = [r for r in holders if r in roles]
                absent = [r for r in holders if r not in roles]
                line = f"{prefix} {codename} -> {', '.join(granted) or '(no role)'}"
                if absent:
                    line += f"  [no Role row, not granted: {', '.join(absent)}]"
                self.stdout.write(line)
                if dry_run:
                    continue
                perm = Permission.objects.create(codename=codename, name=name, category=category)
                RolePermission.objects.bulk_create(
                    [RolePermission(role=roles[r], permission=perm) for r in granted]
                )
        if not dry_run:
            # bulk_create sends no post_save, so the cache signal never sees these grants.
            invalidate_all_permissions()
        self.stdout.write(f"{len(missing)} codename(s) {'to create' if dry_run else 'created'}.")
