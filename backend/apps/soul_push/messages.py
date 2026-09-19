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
        "sentence_pardoned": {"title": "受刑计划已撤销", "body": "你的剩余刑期已免除,可以申请转生,打开灵魂簿查看。"},
        "sentence_amended": {"title": "受刑计划有变更", "body": "你的受刑计划有变更,打开灵魂簿查看。"},
        "sentence_completed": {"title": "受刑完毕", "body": "你的受刑已全部完毕,可以申请转生,打开灵魂簿查看。"},
        "sentence_waiting": {"title": "刑满暂留", "body": "本站刑满,等待审判结案后回归,打开灵魂簿查看。"},
        "rebirth_approved": {"title": "转生申请已批准", "body": "你的转生申请已批准,打开灵魂簿查看。"},
        "rebirth_rejected": {"title": "转生申请被驳回", "body": "你的转生申请被驳回,打开灵魂簿查看理由。"},
        "rebirth_appeal_rejected": {"title": "申诉被驳回", "body": "你对转生申请的申诉被驳回,打开灵魂簿查看理由。"},
        "judgment_result": {"title": "审判有了结论", "body": "你的审判有了结论,打开灵魂簿查看。"},
        "disposition_executed": {"title": "处置已执行", "body": "你的处置已执行,打开灵魂簿查看。"},
        "residence_approved": {"title": "即将暂居", "body": "你即将被调往另一文明暂居,打开灵魂簿查看。"},
        "residence_started": {"title": "暂居开始", "body": "你已被调往另一文明暂居,打开灵魂簿查看。"},
        "residence_returned": {"title": "暂居结束", "body": "你已回归原属文明,打开灵魂簿查看。"},
    },
    "en": {
        "sentence_pardoned": {"title": "Sentence plan cancelled", "body": "The rest of your sentence is waived and you may apply for rebirth. Open Soul Ledger to see it."},
        "sentence_amended": {"title": "Sentence plan changed", "body": "Your sentence plan has changed. Open Soul Ledger to see it."},
        "sentence_completed": {"title": "Sentence served", "body": "You have served your whole sentence and may apply for rebirth. Open Soul Ledger to see it."},
        "sentence_waiting": {"title": "Held after serving", "body": "You have served this stop and wait for a judgment to close before returning. Open Soul Ledger to see it."},
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
    },
    "egy": {
        "sentence_pardoned": {"title": "Wetep Sehen Seth", "body": "Ky Wetep Ek Nen; Dbh Ankh Wen. Wen Medjat Ba Er Maa."},
        "sentence_amended": {"title": "Wetep Khemen Seth", "body": "Wetep Ek Khemen Seth. Wen Medjat Ba Er Maa."},
        "sentence_completed": {"title": "Wetep Neb Seth", "body": "Wetep Ek Neb Seth; Dbh Ankh Wen. Wen Medjat Ba Er Maa."},
        "sentence_waiting": {"title": "Hemes Smen", "body": "Mekher Ek Wetep Seth; Hemes Smen Er Wedja Pehwy. Wen Medjat Ba Er Maa."},
        "rebirth_approved": {"title": "Dbh Hesy Seth", "body": "Dbh Ek Hesy Seth. Wen Medjat Ba Er Maa."},
        "rebirth_rejected": {"title": "Dbh Khesef Seth", "body": "Dbh Ek Khesef Seth. Wen Medjat Ba Er Maa Khet."},
        "rebirth_appeal_rejected": {"title": "Nehet Khesef Seth", "body": "Nehet Ek Khesef Seth. Wen Medjat Ba Er Maa Khet."},
        "judgment_result": {"title": "Wedja Khetem", "body": "Wedja Ek Khetem. Wen Medjat Ba Er Maa."},
        "disposition_executed": {"title": "Wetep Iri Seth", "body": "Wetep Ek Iri Seth. Wen Medjat Ba Er Maa."},
        "residence_approved": {"title": "Hemes Taui Ky Hesy", "body": "Ek Er Hemes Em Taui Ky. Wen Medjat Ba Er Maa."},
        "residence_started": {"title": "Hemes Tepy", "body": "Ek Hemes Em Taui Ky. Wen Medjat Ba Er Maa."},
        "residence_returned": {"title": "Hemes Khetem", "body": "Ek Wehem Er Taui Tepy Ek. Wen Medjat Ba Er Maa."},
    },
}


def render(locale, kind):
    pack = MESSAGES.get(locale) or MESSAGES[DEFAULT_LOCALE]
    return pack[kind]["title"], pack[kind]["body"]
