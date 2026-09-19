"""首次部署灵魂聊天:注册 Synapse 服务账号并免限速(docs/DEPLOYMENT.md「灵魂聊天」)。幂等。

`scripts/synapse-init.sh` 生成 homeserver.yaml、`up -d synapse` 之后跑一次:
`$DC exec backend python manage.py setup_matrix`。不跑也能用 —— 第一次聊天请求会
自行注册服务账号 —— 但那样它带着默认限速,灵魂一多就被 Synapse 429。
"""
from django.core.management.base import BaseCommand, CommandError

from apps.chat.matrix import MatrixError, get_client


class Command(BaseCommand):
    help = "Register the Synapse service account (admin) and exempt it from rate limits"

    def handle(self, *args, **options):
        try:
            user = get_client().setup_service_account()
        except MatrixError as exc:
            raise CommandError(f"Synapse: {exc} {exc.errcode}".rstrip()) from exc
        self.stdout.write(f"matrix service account ready: {user} (ratelimit overridden)")
