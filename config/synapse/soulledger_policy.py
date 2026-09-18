"""Synapse 模块:房间的形状只有后端的服务账号能改。

后端(backend/apps/chat/services.py)决定谁能和谁说话;这个模块让「绕过后端」不可能:
灵魂拿着自己的 access token 直接 `POST /createRoom` 再邀请任意 mxid,就绕过了
「跨文明不能私聊」「非互关 24 小时一条」的全部规则。所以除服务账号外:

* 不能建房、不能邀请(含第三方邀请)、不能建别名、不能把房间发布到目录。

房间内的发言权由 power level 管(后端建房时写死,状态事件一律 100 级,只有服务账号
有 100),不在这里。

homeserver.yaml:

    modules:
      - module: soulledger_policy.SoulLedgerPolicy
        config:
          service_user: "@soulledger:<server_name>"

`tests/test_chat_synapse_integration.py` 对着真 Synapse 断言这几条拒绝。
"""
from synapse.api.errors import Codes
from synapse.module_api import NOT_SPAM, ModuleApi


class SoulLedgerPolicy:
    def __init__(self, config, api: ModuleApi):
        self._service = config["service_user"]
        api.register_spam_checker_callbacks(
            user_may_create_room=self._only_service,
            user_may_invite=self._only_service,
            user_may_send_3pid_invite=self._only_service,
            user_may_create_room_alias=self._only_service,
            user_may_publish_room=self._only_service,
        )

    @staticmethod
    def parse_config(config):
        if not str(config.get("service_user", "")).startswith("@"):
            raise ValueError("soulledger_policy: service_user 必须是完整 mxid")
        return config

    async def _only_service(self, user_id, *_args, **_kwargs):
        # 回调的第一个参数都是发起者 mxid;其余参数各回调不同,这里不需要。
        return NOT_SPAM if user_id == self._service else Codes.FORBIDDEN
