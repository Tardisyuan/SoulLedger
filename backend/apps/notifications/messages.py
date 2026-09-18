"""官员站内通知里要分语言的那几种。**权威在 `packages/core/messages/{zh-Hans,en,egy}.json`
的 `official_notify` 命名空间**,这里是副本 —— 与 `apps/soul_push/messages.py` 同一个理由
(后端镜像里没有 `packages/`);逐字一致由 `tests/test_official_notify_messages_match_the_language_packs.py` 钉住。

官员没有存下来的语言偏好,所以**读的时候**才按请求的 `Accept-Language` 渲染
(`UserNotificationSerializer`);写库时存一份 zh-Hans,那是 WebSocket 推送与未知语言的兜底。
所以行上要留 `params`,不能只留渲染好的文本。
"""
DEFAULT_LOCALE = "zh-Hans"

MESSAGES = {
    "zh-Hans": {
        "dispatch_return_blocked": {
            "title": "暂居回归被拦下",
            "body": "灵魂「{{soul}}」的暂居回归被未结案审判拦下，共 {{count}} 件；结案或撤案后才能回归。",
        },
    },
    "en": {
        "dispatch_return_blocked": {
            "title": "Residence return blocked",
            "body": (
                "Soul {{soul}} cannot return home while judgments stay open ({{count}}). "
                "It returns once they are concluded or withdrawn."
            ),
        },
    },
    "egy": {
        "dispatch_return_blocked": {
            "title": "Ankh Er Taui Khesef",
            "body": "{{soul}}: Ankh Er Taui Khesef En Wedja {{count}}. Wedja Pehwy, Ankh Er Taui.",
        },
    },
}

#: 通知类型 → 文案键。不在这里的类型照存下来的 title / message 原样返回。
KIND_BY_TYPE = {"DISPATCH_RETURN_BLOCKED": "dispatch_return_blocked"}


def render(locale, kind, params):
    entry = MESSAGES[locale][kind]
    body = entry["body"]
    for name, value in params.items():
        body = body.replace("{{" + name + "}}", str(value))
    return entry["title"], body
