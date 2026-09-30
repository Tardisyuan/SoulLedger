"""推送文案。**权威在 `packages/core/messages/{zh-Hans,en,egy}.json` 的 `soul_push` 命名空间**,
这里是它的副本。

为什么是副本而不是运行时读 JSON:后端镜像只 `COPY backend/`(backend/Dockerfile),
`packages/` 不在容器里。两份一致由 `tests/test_soul_push_messages_match_the_language_packs.py`
逐字钉住 —— 改了一边另一边不跟,测试红。

推送出现在锁屏上,旁人看得见。2026-09-18 用户决定**区分批准 / 驳回**,但文案仍然
**不含**驳回理由原文、转生去向、判决内容、暂居去向、新身份、密码;具体内容要打开灵魂簿(登录后)才看得到。
"""
DEFAULT_LOCALE = "zh-Hans"

MESSAGES = {
    "zh-Hans": {
        "sentence_pardoned": {"title": "剩余刑期已赦免", "body": "你有刑期获赦，打开灵魂簿查看。"},
        "sentence_amended": {"title": "受刑计划有变动", "body": "你的受刑计划有变动，打开灵魂簿查看。"},
        "sentence_completed": {"title": "受刑已全部服完", "body": "你的受刑已全部服完，打开灵魂簿查看。"},
        "sentence_waiting": {"title": "一站刑满，暂留原地", "body": "你有一站刑期已满，打开灵魂簿查看。"},
        "rebirth_approved": {"title": "转生申请已批准", "body": "你的转生申请已批准,打开灵魂簿查看。"},
        "rebirth_rejected": {"title": "转生申请被驳回", "body": "你的转生申请被驳回,打开灵魂簿查看理由。"},
        "rebirth_appeal_rejected": {"title": "申诉被驳回", "body": "你对转生申请的申诉被驳回,打开灵魂簿查看理由。"},
        "judgment_result": {"title": "审判有了结论", "body": "你的审判有了结论,打开灵魂簿查看。"},
        "disposition_executed": {"title": "处置已执行", "body": "你的处置已执行,打开灵魂簿查看。"},
        "residence_approved": {"title": "即将暂居", "body": "你即将被调往另一文明暂居,打开灵魂簿查看。"},
        "residence_started": {"title": "暂居开始", "body": "你已被调往另一文明暂居,打开灵魂簿查看。"},
        "residence_returned": {"title": "暂居结束", "body": "你已回归原属文明,打开灵魂簿查看。"},
        "chat_message": {"title": "新书信", "body": "{{name}} 给你写了一封信,打开灵魂簿查看。"},
        "social_warned_post": {"title": "帖子收到警告", "body": "你的帖子收到警告：{{reason}}"},
        "social_warned_comment": {"title": "评论收到警告", "body": "你的评论收到警告：{{reason}}"},
        "social_warned_user": {"title": "账号收到警告", "body": "你的账号收到警告：{{reason}}"},
    },
    "en": {
        "sentence_pardoned": {"title": "Remaining term pardoned", "body": "Part of your term was pardoned. Open Soul Ledger to see it."},
        "sentence_amended": {"title": "Your sentence changed", "body": "Your sentence plan has changed. Open Soul Ledger to see it."},
        "sentence_completed": {"title": "Sentence fully served", "body": "Your sentence is fully served. Open Soul Ledger to see it."},
        "sentence_waiting": {"title": "A term is served; you stay for now", "body": "One of your terms is served. Open Soul Ledger to see it."},
        "rebirth_approved": {
            "title": "Rebirth application approved",
            "body": "Your rebirth application was approved. Open Soul Ledger to see it.",
        },
        "rebirth_rejected": {
            "title": "Rebirth application rejected",
            "body": "Your rebirth application was rejected. Open Soul Ledger to see why.",
        },
        "rebirth_appeal_rejected": {
            "title": "Appeal rejected",
            "body": "Your appeal on the rebirth application was rejected. Open Soul Ledger to see why.",
        },
        "judgment_result": {
            "title": "Judgment concluded",
            "body": "Your judgment has concluded. Open Soul Ledger to see it.",
        },
        "disposition_executed": {
            "title": "Disposition carried out",
            "body": "Your disposition has been carried out. Open Soul Ledger to see it.",
        },
        "residence_approved": {
            "title": "Residence approved",
            "body": "You are about to be moved to reside in another civilization. Open Soul Ledger to see it.",
        },
        "residence_started": {
            "title": "Residence begun",
            "body": "You have been moved to reside in another civilization. Open Soul Ledger to see it.",
        },
        "residence_returned": {
            "title": "Residence ended",
            "body": "You have returned to your home civilization. Open Soul Ledger to see it.",
        },
        "chat_message": {"title": "New letter", "body": "{{name}} wrote you a letter. Open Soul Ledger to read it."},
        "social_warned_post": {"title": "Your post was warned", "body": "Your post received a warning: {{reason}}"},
        "social_warned_comment": {
            "title": "Your comment was warned",
            "body": "Your comment received a warning: {{reason}}",
        },
        "social_warned_user": {
            "title": "Your account was warned",
            "body": "Your account received a warning: {{reason}}",
        },
    },
    "egy": {
        "sentence_pardoned": {"title": "Renpet Sepy Nedj Seth", "body": "Renpet-Ek Nedj Seth. Wen Medjat Ba Er Maa."},
        "sentence_amended": {"title": "Khemen-Shepet", "body": "Shepet-Ek Khemen Seth. Wen Medjat Ba Er Maa."},
        "sentence_completed": {"title": "Shepet Wetep-Neb Seth", "body": "Shepet-Ek Wetep-Neb Seth. Wen Medjat Ba Er Maa."},
        "sentence_waiting": {"title": "Renpet Khetem; Ahau", "body": "Renpet Wa Khetem Seth. Wen Medjat Ba Er Maa."},
        "rebirth_approved": {"title": "Dbh Wehem Mesut Hesy Seth", "body": "Dbh Wehem Mesut-Ek Hesy Seth. Wen Medjat Ba Er Maa."},
        "rebirth_rejected": {"title": "Dbh Wehem Mesut Khesef Seth", "body": "Dbh Wehem Mesut-Ek Khesef Seth. Wen Medjat Ba Er Maa Khet."},
        "rebirth_appeal_rejected": {"title": "Nehet Khesef Seth", "body": "Nehet-Ek Er Dbh Wehem Mesut Khesef Seth. Wen Medjat Ba Er Maa Khet."},
        "judgment_result": {"title": "Wedja Khetem", "body": "Wedja-Ek Khetem Seth. Wen Medjat Ba Er Maa."},
        "disposition_executed": {"title": "Wetep Iri Seth", "body": "Wetep-Ek Iri Seth. Wen Medjat Ba Er Maa."},
        "residence_approved": {"title": "Hemes Taui Ky Hesy", "body": "Hemes-Ek Em Taui Ky Hesy Seth. Wen Medjat Ba Er Maa."},
        "residence_started": {"title": "Hemes Tepy", "body": "Hemes-Ek Em Taui Ky Tepy Seth. Wen Medjat Ba Er Maa."},
        "residence_returned": {"title": "Hemes Khetem", "body": "Iyi-Ek Seth Er Nut-Ek. Wen Medjat Ba Er Maa."},
        "chat_message": {"title": "Shemes Renpi", "body": "{{name}}: Shemes Renpi Er-Ek. Wen Medjat Ba Er Maa."},
        "social_warned_post": {"title": "Sebayt Er Medu", "body": "Sebayt Er Medu-Ek: {{reason}}"},
        "social_warned_comment": {"title": "Sebayt Er Wesheb", "body": "Sebayt Er Wesheb-Ek: {{reason}}"},
        "social_warned_user": {"title": "Sebayt Er Aq", "body": "Sebayt Er Aq-Ek: {{reason}}"},
    },
}


def render(locale, kind, **params):
    """`params` 填 `{{占位符}}`(与语言包同一写法;chat_message 的 `name`、social_warned_* 的 `reason`)。"""
    pack = MESSAGES.get(locale) or MESSAGES[DEFAULT_LOCALE]
    title, body = pack[kind]["title"], pack[kind]["body"]
    for key, value in params.items():
        title, body = title.replace(f"{{{{{key}}}}}", value), body.replace(f"{{{{{key}}}}}", value)
    return title, body
