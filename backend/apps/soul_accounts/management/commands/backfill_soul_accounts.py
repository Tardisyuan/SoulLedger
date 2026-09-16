"""为「已死亡、未转世」的灵魂补建本世账号,并按渠道发送初始密码。

「已死亡、未转世」= current_state 不是 ALIVE。本世 = life_index;一个转过世又
死了的灵魂,它的本世是新的一世,补的就是新一世的号。

幂等:本世已有账号的跳过(`provision_account` 本身幂等,且不重发密码)。
无联系方式的进待交付(`InitialCredential.status = PENDING`)。

    manage.py backfill_soul_accounts --dry-run
    manage.py backfill_soul_accounts [--tenant CN_DIYU] [--limit 500]
"""
from django.core.management.base import BaseCommand

from apps.soul_accounts.delivery import pick_delivery
from apps.soul_accounts.models import AccountOrigin, SoulAccount
from apps.soul_accounts.services import SoulAccountError, provision_account
from apps.souls.models import Soul, SoulState


class Command(BaseCommand):
    help = "为已死亡、未转世的灵魂补建本世灵魂账号(幂等,--dry-run 只报告)。"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--tenant", help="只处理这个租户编码")
        parser.add_argument("--limit", type=int, default=0)

    def handle(self, *args, dry_run=False, tenant=None, limit=0, **options):
        souls = Soul.objects.exclude(current_state=SoulState.ALIVE).filter(tenant__isnull=False).order_by("pk")
        if tenant:
            souls = souls.filter(tenant__code=tenant)
        created = skipped = failed = pending = 0
        for soul in souls.iterator():
            if limit and created >= limit:
                break
            if SoulAccount.objects.filter(soul=soul, cycle=soul.life_index).exists():
                skipped += 1
                continue
            if dry_run:
                created += 1
                pending += 0 if pick_delivery(soul) else 1
                continue
            try:
                account, was_created = provision_account(soul, AccountOrigin.BACKFILL)
            except SoulAccountError as exc:
                failed += 1
                self.stderr.write(f"{soul.pk}: {exc.code}")
                continue
            if not was_created:
                skipped += 1
                continue
            created += 1
            if account.credentials.filter(status="PENDING").exists():
                pending += 1
        verb = "将开通" if dry_run else "已开通"
        self.stdout.write(
            f"{verb} {created} 个;其中待交付 {pending} 个;已有账号跳过 {skipped} 个;失败 {failed} 个。"
        )
