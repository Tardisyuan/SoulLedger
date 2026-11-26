"""The assistant's per-account rate limits (soul side and officer side). Moved out of `views.py` (2026-11-26):
the audit, judgment and moderation views throttle their AI actions with `OfficerAssistThrottle`; `views.py`
re-exports both."""
from rest_framework import throttling

from apps.core.throttling import ClientIPIdentMixin
from apps.soul_assist import config


class AssistThrottle(ClientIPIdentMixin, throttling.UserRateThrottle):
    """按灵魂账号计。速率是生效配置(管理页可改,没改过就是 `DEFAULT_THROTTLE_RATES["assist"]`)。"""

    scope = "assist"
    side = "soul"

    def get_rate(self):
        return config.effective().rate(self.side)


class OfficerAssistThrottle(AssistThrottle):
    """按官员账号计。两端的每殿开关共用(Q3 = A),每小时次数在管理页上各一个数;
    没改过时两端都是 `DEFAULT_THROTTLE_RATES["assist"]`。"""

    scope = "assist_officer"
    side = "officer"
