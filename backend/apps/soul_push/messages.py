"""推送文案。**权威在 `packages/core/messages/{zh-Hans,en,egy}.json` 的 `soul_push` 命名空间**,
这里是它的副本。

为什么是副本而不是运行时读 JSON:后端镜像只 `COPY backend/`(backend/Dockerfile),
`packages/` 不在容器里。两份一致由 `tests/test_soul_push_messages_match_the_language_packs.py`
逐字钉住 —— 改了一边另一边不跟,测试红。

推送出现在锁屏上,旁人看得见。所以文案**只说「有了结果」,不说是批准还是驳回**,
不含驳回理由、证据、新身份、密码;具体内容要打开 App(登录后)才看得到。
「结果是否在通知里区分批准 / 驳回」待用户确认。
"""
DEFAULT_LOCALE = "zh-Hans"

MESSAGES = {
    "zh-Hans": {
        "rebirth_submitted": {"title": "转生申请已提交", "body": "你的转生申请已进入审批,有结果时会通知你。"},
        "rebirth_appeal_submitted": {"title": "申诉已提交", "body": "你的申诉已进入复核,有结果时会通知你。"},
        "rebirth_result": {"title": "转生申请有了结果", "body": "你的转生申请有了结果,打开 App 查看。"},
        "judgment_result": {"title": "审判有了结论", "body": "你的审判有了结论,打开 App 查看。"},
        "disposition_executed": {"title": "处置已执行", "body": "你的处置已执行,打开 App 查看。"},
    },
    "en": {
        "rebirth_submitted": {
            "title": "Rebirth application submitted",
            "body": "Your rebirth application is under review. You will be notified when there is a result.",
        },
        "rebirth_appeal_submitted": {
            "title": "Appeal submitted",
            "body": "Your appeal is under review. You will be notified when there is a result.",
        },
        "rebirth_result": {
            "title": "Rebirth application decided",
            "body": "There is a result on your rebirth application. Open the app to see it.",
        },
        "judgment_result": {
            "title": "Judgment concluded",
            "body": "Your judgment has concluded. Open the app to see it.",
        },
        "disposition_executed": {
            "title": "Disposition carried out",
            "body": "Your disposition has been carried out. Open the app to see it.",
        },
    },
    "egy": {
        "rebirth_submitted": {"title": "Wehem Mesut Dbh Seth", "body": "Dbh Ek Em Sheemtet. Sedjem Ek Em Wedja."},
        "rebirth_appeal_submitted": {"title": "Wehem Medu Seth", "body": "Wehem Medu Ek Em Sheemtet. Sedjem Ek Em Wedja."},
        "rebirth_result": {"title": "Wehem Mesut Wedja", "body": "Wedja Er Dbh Ek. Wen Medjat Er Maa."},
        "judgment_result": {"title": "Wedja Pehwy", "body": "Wedja Ek Pehwy. Wen Medjat Er Maa."},
        "disposition_executed": {"title": "Wetep Iri", "body": "Wetep Ek Iri. Wen Medjat Er Maa."},
    },
}


def render(locale, kind):
    pack = MESSAGES.get(locale) or MESSAGES[DEFAULT_LOCALE]
    return pack[kind]["title"], pack[kind]["body"]
