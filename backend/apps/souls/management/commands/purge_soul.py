"""永久删除回收站里的一个灵魂(运维用,用户 2026-11-14「加管理命令」;没有界面入口)。

    python manage.py purge_soul <灵魂 id 或灵魂编号> --tenant <殿代码> --actor <用户名> [--yes]

不带 `--yes` 只预演:打印会一起删掉多少条事件、会写下的那条审计,什么都不删。带 `--yes` 才走 `Soul.purge()`
(事件显式删除、同一事务里写审计,见那里的文档串)。

拒绝:殿不存在;灵魂不存在或不属于 `--tenant`;灵魂不在回收站(没有软删除)。
`--actor` 的规则与网页回收站相同(`recycle_bin_views._bin_scope`):在职的 ADMIN 官员,
且不绑殿(全局管理员)或绑的正是 `--tenant`。审计行的操作人记为他。
"""
import uuid

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.authentication.models import UserRole
from apps.events.models import SoulEvent
from apps.souls.models import Soul
from apps.tenants.models import Tenant


class Command(BaseCommand):
    help = "永久删除回收站里的一个灵魂及其全部事件,并留审计。默认只预演,--yes 才执行。"

    def add_arguments(self, parser):
        parser.add_argument("soul", help="灵魂 id(uuid)或灵魂编号 soul_code")
        parser.add_argument("--tenant", required=True, help="灵魂所属殿的代码,如 CN_DIYU")
        parser.add_argument("--actor", required=True, help="记为操作人的管理员用户名")
        parser.add_argument("--yes", action="store_true", help="真的执行;不带只预演")

    def handle(self, *args, soul, tenant, actor, yes, **options):
        hall = Tenant.objects.filter(code=tenant).first()
        if hall is None:
            raise CommandError(f"没有代码为 {tenant!r} 的殿。")

        user = get_user_model().objects.filter(username=actor, is_active=True).first()
        if (user is None or hasattr(user, "soul_account") or user.role != UserRole.ADMIN
                or user.tenant_id not in (None, hall.pk)):
            raise CommandError(f"{actor!r} 不是能管理 {tenant} 回收站的管理员(在职 ADMIN,不绑殿或绑本殿)。")

        try:
            target = Soul.all_objects.filter(pk=uuid.UUID(soul)).first()
        except ValueError:
            target = Soul.all_objects.filter(soul_code=soul).first()
        if target is None or target.tenant_id != hall.pk:
            raise CommandError(f"{tenant} 里没有灵魂 {soul!r}。")
        if not target.is_deleted:
            raise CommandError(f"灵魂 {target.pk} 不在回收站里:先删除(移入回收站)再永久删除。")

        events = SoulEvent.all_objects.filter(soul=target).count()
        preview = (f"灵魂 {target.pk}({target.name}),殿 {tenant}:连同 {events} 条事件永久删除;"
                   f"审计 DELETE soul {target.pk},操作人 {actor},changes={{'soul_events': ['{events}', '0']}}")
        if not yes:
            self.stdout.write(f"[预演,未删除] {preview}\n加 --yes 执行。")
            return
        deleted = target.purge(user=user)
        self.stdout.write(self.style.SUCCESS(f"已永久删除:灵魂 {target.pk},事件 {deleted} 条,审计已写。"))
