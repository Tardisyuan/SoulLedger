"""推送的发送端口与它的 Expo 实现。

端口是一个有两个方法的对象(`settings.SOUL_PUSH_SENDER` 是它的类路径,与
`apps/soul_accounts/delivery.py` 同一种换法):

* `send(messages) -> tickets`:messages ≤ 100 条,返回同序同长的 ticket 列表,
  每个是 `{"status": "ok", "id": ...}` 或 `{"status": "error", "message": ..., "details": {...}}`;
* `receipts(ids) -> {id: receipt}`:ids ≤ 1000;还没有回执的 id 不出现在结果里。

两个方法遇到「稍后再试就可能成功」的失败(429、5xx、网络)抛 `PushTransientError`,
其余整请求失败抛 `PushRequestError`。测试用假实现,**从不访问 Expo**。
"""
import requests
from django.conf import settings
from django.utils.module_loading import import_string

SEND_URL = "https://exp.host/--/api/v2/push/send"
RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
SEND_BATCH = 100
RECEIPT_BATCH = 1000
TIMEOUT_SECONDS = 15


class PushTransientError(Exception):
    pass


class PushRequestError(Exception):
    pass


class ExpoPushSender:
    def _post(self, url, body):
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        token = getattr(settings, "EXPO_ACCESS_TOKEN", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            response = requests.post(url, json=body, headers=headers, timeout=TIMEOUT_SECONDS, allow_redirects=False)
        except requests.RequestException as exc:
            raise PushTransientError(f"{type(exc).__name__}") from exc
        if response.status_code == 429 or response.status_code >= 500:
            raise PushTransientError(f"HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError:
            raise PushRequestError(f"HTTP {response.status_code}: 响应不是 JSON") from None
        errors = payload.get("errors") or []
        if any(e.get("code") == "TOO_MANY_REQUESTS" for e in errors):
            raise PushTransientError("TOO_MANY_REQUESTS")
        if errors or response.status_code != 200:
            codes = ",".join(str(e.get("code")) for e in errors) or f"HTTP {response.status_code}"
            raise PushRequestError(codes)
        return payload.get("data")

    def send(self, messages):
        tickets = self._post(SEND_URL, messages)
        if not isinstance(tickets, list) or len(tickets) != len(messages):
            # 对不上就无法知道哪条成功 —— 整批按请求失败处理,而不是按位置猜。
            raise PushRequestError("ticket 数与消息数不一致")
        return tickets

    def receipts(self, ids):
        data = self._post(RECEIPTS_URL, {"ids": list(ids)})
        return data if isinstance(data, dict) else {}


def get_sender():
    return import_string(getattr(settings, "SOUL_PUSH_SENDER", "apps.soul_push.expo.ExpoPushSender"))()
