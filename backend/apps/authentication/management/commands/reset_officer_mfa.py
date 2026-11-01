"""重置一位官员的两步验证(运维用):`python manage.py reset_officer_mfa <用户名> --reason "…"`。

给「没有别人能替他重置」的那一种情形:全系统唯一的 ADMIN(或本殿唯一能管人的官员)手机丢了、恢复码也没了,
而邮箱自助重置只重置密码、不关两步验证 —— 此前唯一的出路是进 Django shell 手删行(review-2026-11-01 P3)。
与网页上管理员的「重置两步验证」同一个函数(`mfa.admin_reset`):验证器、恢复码、「不再询问」设备全清,
全部会话结束;理由必填,进审计(审计行的操作人记为该官员本人,描述里写明是命令行)。
能跑这条命令的人本来就能动数据库;它只是让这件事有审计、有理由、不会删错表。
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.authentication import mfa


class Command(BaseCommand):
    help = "重置一位官员的两步验证(手机与恢复码都丢了、又没有别的管理员能替他重置时用)。理由必填,进审计。"

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--reason", required=True)

    def handle(self, *args, username, reason, **options):
        reason = (reason or "").strip()
        if not reason:
            raise CommandError("--reason 不能为空:它写进审计。")
        user = get_user_model().objects.filter(username=username).first()
        if user is None or hasattr(user, "soul_account"):
            # 灵魂账号的两步验证在 SoulMfa,由官员在灵魂账号页重置;这里只认官员。
            raise CommandError(f"没有用户名为 {username!r} 的官员。")
        if not mfa.is_enabled(user):
            raise CommandError(f"{username} 没有开启两步验证,无需重置。")
        mfa.admin_reset(user, actor=None, reason="(manage.py reset_officer_mfa)" + reason)
        self.stdout.write(self.style.SUCCESS(f"已重置 {username} 的两步验证,全部会话已结束。下次登录只要密码。"))
