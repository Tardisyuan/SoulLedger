"""把殿司收件箱每个会话的「谁最后说话」按 Synapse 时间线对一遍(`services.reconcile_inbox`)。幂等。

**上线 chat/0005 之后跑一次**:那条迁移加的 `last_from` / `last_soul_message_at` 在存量行上是空的
(库里没有正文,迁移答不出谁最后说话),于是存量会话既不在「待回复」也不在「已回复」,
直到有人打开它或来一封新信。这条命令替每一个会话问一次 Synapse。

之后不必再跑:三个写点(灵魂经后端发、官员回复、Synapse 回调)维护它。回调没配(`push_url`)时,
灵魂绕过 App 直接在 Matrix 里写的信只在官员打开线程时才被看见 —— 那时再跑这条也能补。
"""
from django.core.management.base import BaseCommand, CommandError

from apps.chat import services as svc
from apps.chat.matrix import MatrixError, get_client
from apps.chat.models import Conversation, ConversationKind


class Command(BaseCommand):
    help = "Recompute last_from / last_soul_message_at of every hall-inbox conversation from Synapse"

    def handle(self, *args, **options):
        try:
            client = get_client()
        except MatrixError as exc:
            raise CommandError(f"Synapse: {exc}") from exc
        done = failed = 0
        for conversation in Conversation.objects.filter(kind=ConversationKind.OFFICER_INBOX).iterator():
            try:
                svc.reconcile_inbox(conversation, client.recent_messages(conversation.room_id, limit=svc.INBOX_PEEK),
                                    client.service_user)
                done += 1
            except MatrixError as exc:
                failed += 1
                self.stderr.write(f"{conversation.room_id}: {exc}")
        self.stdout.write(f"reconciled {done} inbox conversation(s), {failed} failed")
        if failed:
            raise CommandError(f"{failed} conversation(s) could not be read from Synapse")
