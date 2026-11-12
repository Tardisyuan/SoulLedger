"""推送文案。**权威在 `packages/core/messages/{zh-Hans,en,egy}.json` 的 `soul_push` 命名空间**,
这里是它的副本。

为什么是副本而不是运行时读 JSON:后端镜像只 `COPY backend/`(backend/Dockerfile),
`packages/` 不在容器里。两份一致由 `tests/test_soul_push_messages_match_the_language_packs.py`
逐字钉住 —— 改了一边另一边不跟,测试红。

推送出现在锁屏上,旁人看得见。2026-09-18 用户决定**区分批准 / 驳回**,但文案仍然
**不含**驳回理由原文、转生去向、判决内容、暂居去向、新身份、密码;具体内容要打开灵魂簿(登录后)才看得到。
"""
DEFAULT_LOCALE = "zh-Hans"

#: 文明 → 语言包 `_by_civ` 的短码(与 packages/core 的 `civShortCode` 同一张表)。
PLAN_CIV_SHORT = {"CHINESE": "cn", "EUROPEAN": "eu", "EGYPTIAN": "eg", "GREEK": "gr"}

MESSAGES = {
    "zh-Hans": {
        "sentence_pardoned": {"title": "剩余刑期已赦免", "body": "你有刑期获赦，打开灵魂簿查看。", "title_by_civ": {"eu": {"PURGATORY": "余下涤罪期已蒙减免"}}, "body_by_civ": {"eu": {"PURGATORY": "你的涤罪期有一部分蒙减免，打开灵魂簿查看。"}}},
        "sentence_amended": {"title": "去处有变动", "body": "你的去处计划有变动，打开灵魂簿查看。", "title_by_civ": {"cn": "受刑计划有变动"}, "body_by_civ": {"cn": "你的受刑计划有变动，打开灵魂簿查看。"}},
        "sentence_completed": {"title": "受刑已全部服完", "body": "你的受刑已全部服完，打开灵魂簿查看。", "title_by_civ": {"cn": {"BLISS": "停留期已满"}, "gr": {"BLISS": "停留期已满"}, "gr_republic": {"BLISS": "千年已满"}, "eu": {"PURGATORY": "涤罪已全部完成", "BLISS": "去处计划已全部走完", "NEUTRAL": "去处计划已全部走完"}, "eg": "去处计划已全部走完"}, "body_by_civ": {"cn": {"BLISS": "你在天界的停留期已满，打开灵魂簿查看。"}, "gr": {"BLISS": "你在至福岛的停留期已满，打开灵魂簿查看。"}, "gr_republic": {"BLISS": "你在天上的千年已满，打开灵魂簿查看。"}, "eu": {"PURGATORY": "你的涤罪已全部完成，打开灵魂簿查看。", "BLISS": "你的去处计划已全部走完，打开灵魂簿查看。", "NEUTRAL": "你的去处计划已全部走完，打开灵魂簿查看。"}, "eg": "你的去处计划已全部走完，打开灵魂簿查看。"}},
        "sentence_waiting": {"title": "一站刑满，暂留原地", "body": "你有一站刑期已满，打开灵魂簿查看。", "body_by_civ": {"cn": {"BLISS": "你有一站停留期已满，打开灵魂簿查看。"}, "gr": {"BLISS": "你有一站停留期已满，打开灵魂簿查看。"}, "eu": {"PURGATORY": "你有一层涤罪已完成，打开灵魂簿查看。"}, "gr_republic": {"BLISS": "你在天上的千年已满，暂留原地，打开灵魂簿查看。"}}, "title_by_civ": {"cn": {"BLISS": "一站停留期满，暂留原地"}, "gr": {"BLISS": "一站停留期满，暂留原地"}, "eu": {"PURGATORY": "一层涤罪已完成，暂留原地"}, "gr_republic": {"BLISS": "天上千年已满，暂留原地"}}},
        "rebirth_approved": {"title": "转生申请已批准", "body": "你的转生申请已批准，打开灵魂簿查看。"},
        "rebirth_rejected": {"title": "转生申请被驳回", "body": "你的转生申请被驳回，打开灵魂簿查看理由。"},
        "rebirth_appeal_rejected": {"title": "申诉被驳回", "body": "你对转生申请的申诉被驳回，打开灵魂簿查看理由。"},
        "cooldown_shortening_approved": {"title": "缩短冷却申请已批准", "body": "你的缩短冷却申请已批准，打开灵魂簿查看新的冷却截止。"},
        "cooldown_shortening_rejected": {"title": "缩短冷却申请被驳回", "body": "你的缩短冷却申请被驳回，打开灵魂簿查看理由。"},
        "judgment_result": {"title": "审判有了结论", "body": "你的审判有了结论，打开灵魂簿查看。"},
        "appeal_upheld": {"title": "申诉复核：维持原判", "body": "你的申诉已复核，维持原判。打开灵魂簿查看复核意见。"},
        "appeal_amended": {"title": "申诉复核：已改判", "body": "你的申诉已复核，原判已改。打开灵魂簿查看新的裁决。"},
        "wangsi_upheld": {"title": "冤情申诉：属实 · 提前释放", "body": "你的冤情申诉经审核属实，已提前出枉死城。打开灵魂簿查看。"},
        "wangsi_upheld_late": {"title": "冤情申诉：属实", "body": "你的冤情申诉经审核属实。打开灵魂簿查看审核意见。"},
        "wangsi_delivered": {"title": "冤情申诉：属实 · 已超度", "body": "你的冤情申诉经审核属实，已超度出枉死城。打开灵魂簿查看。"},
        "wangsi_rejected": {"title": "冤情申诉：不属实", "body": "你的冤情申诉经审核不属实。打开灵魂簿查看审核意见。"},
        "disposition_executed": {"title": "处置已执行", "body": "你的处置已执行，打开灵魂簿查看。"},
        "residence_approved": {"title": "即将暂居", "body": "你即将被调往另一文明暂居，打开灵魂簿查看。"},
        "residence_started": {"title": "暂居开始", "body": "你已被调往另一文明暂居，打开灵魂簿查看。"},
        "residence_returned": {"title": "暂居结束", "body": "你已回归原属文明，打开灵魂簿查看。"},
        "chat_message": {"title": "新书信", "body": "{{name}} 给你写了一封信，打开灵魂簿查看。"},
        "social_warned_post": {"title": "帖子收到警告", "body": "你的帖子收到警告：{{reason}}"},
        "social_warned_comment": {"title": "评论收到警告", "body": "你的评论收到警告：{{reason}}"},
        "social_warned_user": {"title": "账号收到警告", "body": "你的账号收到警告：{{reason}}"},
        "mfa_reset_by_officer": {"title": "两步验证已关闭", "body": "本殿官员 {{name}} 已关闭你的两步验证"},
        "push_device_claimed": {"title": "推送设备已被另一个账号登记", "body": "你的推送设备已被另一个账号登记，这部设备不再收到你的通知。如果不是你本人换的手机，请联系殿司。"},
        "export_ready": {"title": "资料已准备好", "body": "你申请导出的资料已准备好，7 天内可取。打开灵魂簿保存。"},
        "content_hidden_post": {"title": "帖子已被隐藏", "body": "你的帖子被殿司隐藏，打开灵魂簿查看。"},
        "content_hidden_comment": {"title": "评论已被隐藏", "body": "你的评论被殿司隐藏，打开灵魂簿查看。"},
        "content_deleted_post": {"title": "帖子已被删除", "body": "你的帖子被殿司删除。"},
        "content_deleted_comment": {"title": "评论已被删除", "body": "你的评论被殿司删除。"},
        "content_approved_post": {"title": "帖子已通过审核", "body": "你的帖子已通过审核，大家都看得到了。"},
        "content_approved_comment": {"title": "评论已通过审核", "body": "你的评论已通过审核，大家都看得到了。"},
        "content_restored_post": {"title": "帖子已恢复", "body": "你的帖子已恢复显示。"},
        "content_restored_comment": {"title": "评论已恢复", "body": "你的评论已恢复显示。"},
        # 隐藏 / 删除时官员选了理由(2026-10-16 用户定):带理由的另一套;没选理由的老客户端仍用上面那套。
        "content_hidden_post_reason": {"title": "帖子已被隐藏", "body": "你的帖子被殿司隐藏：{{reason}}"},
        "content_hidden_comment_reason": {"title": "评论已被隐藏", "body": "你的评论被殿司隐藏：{{reason}}"},
        "content_deleted_post_reason": {"title": "帖子已被删除", "body": "你的帖子被殿司删除：{{reason}}"},
        "content_deleted_comment_reason": {"title": "评论已被删除", "body": "你的评论被殿司删除：{{reason}}"},
        # 第四十批 S-a:标题是 Design 的原文;正文是评论的开头(`{{text}}`,不再加字)。
        "comment": {"title": "{{name}} 评论了你的帖子", "body": "{{text}}"},
        "reply": {"title": "{{name}} 回复了你的评论", "body": "{{text}}"},
        # 禁言(2026-11-01 审查 P3):殿司说了理由就带上,没写理由的用前一条。
        "social_muted": {"title": "你已被禁言", "body": "你被禁言 {{days}} 日，期间朋友圈只读，也不能与灵魂通信。"},
        "social_muted_reason": {"title": "你已被禁言", "body": "你被禁言 {{days}} 日：{{reason}}"},
    },
    "en": {
        "sentence_pardoned": {"title": "Remaining term pardoned", "body": "Part of your term was pardoned. Open Soul Ledger to see it.", "title_by_civ": {"eu": {"PURGATORY": "Remaining cleansing remitted"}}, "body_by_civ": {"eu": {"PURGATORY": "Part of your cleansing was remitted. Open Soul Ledger to see it."}}},
        "sentence_amended": {"title": "Your placement changed", "body": "Your placement plan has changed. Open Soul Ledger to see it.", "title_by_civ": {"cn": "Your sentence changed"}, "body_by_civ": {"cn": "Your sentence plan has changed. Open Soul Ledger to see it."}},
        "sentence_completed": {"title": "Sentence fully served", "body": "Your sentence is fully served. Open Soul Ledger to see it.", "title_by_civ": {"cn": {"BLISS": "Stay over"}, "gr": {"BLISS": "Stay over"}, "gr_republic": {"BLISS": "The thousand years are over"}, "eu": {"PURGATORY": "Cleansing complete", "BLISS": "Placement plan complete", "NEUTRAL": "Placement plan complete"}, "eg": "Placement plan complete"}, "body_by_civ": {"cn": {"BLISS": "Your stay in the heavens is over. Open Soul Ledger to see it."}, "gr": {"BLISS": "Your stay on the Isles of the Blessed is over. Open Soul Ledger to see it."}, "gr_republic": {"BLISS": "Your thousand years in the heavens are over. Open Soul Ledger to see it."}, "eu": {"PURGATORY": "Your cleansing is complete. Open Soul Ledger to see it.", "BLISS": "Your placement plan is complete. Open Soul Ledger to see it.", "NEUTRAL": "Your placement plan is complete. Open Soul Ledger to see it."}, "eg": "Your placement plan is complete. Open Soul Ledger to see it."}},
        "sentence_waiting": {"title": "A term is served; you stay for now", "body": "One of your terms is served. Open Soul Ledger to see it.", "body_by_civ": {"cn": {"BLISS": "One of your stays is over. Open Soul Ledger to see it."}, "gr": {"BLISS": "One of your stays is over. Open Soul Ledger to see it."}, "eu": {"PURGATORY": "One stage of your cleansing is complete. Open Soul Ledger to see it."}, "gr_republic": {"BLISS": "Your thousand years in the heavens are over; you remain for now. Open Soul Ledger to see it."}}, "title_by_civ": {"cn": {"BLISS": "A stay is over; you remain for now"}, "gr": {"BLISS": "A stay is over; you remain for now"}, "eu": {"PURGATORY": "A stage of cleansing is complete; you remain for now"}, "gr_republic": {"BLISS": "Your thousand years are over; you remain for now"}}},
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
        "cooldown_shortening_approved": {
            "title": "Cooldown shortening approved",
            "body": "Your request to shorten the cooldown was approved. Open Soul Ledger to see the new end date.",
        },
        "cooldown_shortening_rejected": {
            "title": "Cooldown shortening rejected",
            "body": "Your request to shorten the cooldown was rejected. Open Soul Ledger to see why.",
        },
        "judgment_result": {
            "title": "Judgment concluded",
            "body": "Your judgment has concluded. Open Soul Ledger to see it.",
        },
        "appeal_upheld": {
            "title": "Appeal reviewed: the verdict stands",
            "body": "Your appeal has been reviewed and the verdict stands. Open Soul Ledger to read the reviewer's note.",
        },
        "appeal_amended": {
            "title": "Appeal reviewed: the verdict was changed",
            "body": "Your appeal has been reviewed and the verdict was changed. Open Soul Ledger to see the new verdict.",
        },
        "wangsi_upheld": {
            "title": "Grievance upheld: released early",
            "body": "Your grievance was found true and you have been released early from the City of Wrongful Death. "
                    "Open Soul Ledger to see it.",
        },
        "wangsi_upheld_late": {
            "title": "Grievance upheld",
            "body": "Your grievance was found true. Open Soul Ledger to read the reviewer's note.",
        },
        "wangsi_delivered": {
            "title": "Grievance upheld: delivered",
            "body": "Your grievance was found true and you have been delivered from the City of Wrongful Death. "
                    "Open Soul Ledger to see it.",
        },
        "wangsi_rejected": {
            "title": "Grievance not upheld",
            "body": "Your grievance was not found true. Open Soul Ledger to read the reviewer's note.",
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
        "mfa_reset_by_officer": {
            "title": "Two-step verification turned off",
            "body": "{{name}}, an officer of your hall, turned off your two-step verification",
        },
        "push_device_claimed": {
            "title": "Your push device was registered by another account",
            "body": "Your push device was registered by another account and no longer gets your notifications. If you did not change phones yourself, contact your hall.",
        },
        "export_ready": {
            "title": "Your data is ready",
            "body": "The data export you asked for is ready for 7 days. Open Soul Ledger to save it.",
        },
        "content_hidden_post": {
            "title": "Your post was hidden",
            "body": "An officer hid your post. Open Soul Ledger to see it.",
        },
        "content_hidden_comment": {
            "title": "Your comment was hidden",
            "body": "An officer hid your comment. Open Soul Ledger to see it.",
        },
        "content_deleted_post": {"title": "Your post was deleted", "body": "An officer deleted your post."},
        "content_deleted_comment": {"title": "Your comment was deleted", "body": "An officer deleted your comment."},
        "content_approved_post": {
            "title": "Your post was approved",
            "body": "Your post passed review and is now visible to everyone.",
        },
        "content_approved_comment": {
            "title": "Your comment was approved",
            "body": "Your comment passed review and is now visible to everyone.",
        },
        "content_restored_post": {"title": "Your post was restored", "body": "Your post is visible again."},
        "content_restored_comment": {"title": "Your comment was restored", "body": "Your comment is visible again."},
        "content_hidden_post_reason": {"title": "Your post was hidden", "body": "An officer hid your post: {{reason}}"},
        "content_hidden_comment_reason": {
            "title": "Your comment was hidden",
            "body": "An officer hid your comment: {{reason}}",
        },
        "content_deleted_post_reason": {"title": "Your post was deleted", "body": "An officer deleted your post: {{reason}}"},
        "content_deleted_comment_reason": {
            "title": "Your comment was deleted",
            "body": "An officer deleted your comment: {{reason}}",
        },
        "comment": {"title": "{{name}} commented on your post", "body": "{{text}}"},
        "reply": {"title": "{{name}} replied to your comment", "body": "{{text}}"},
        "social_muted": {
            "title": "You are muted",
            "body": "You are muted for {{days}} days: the circle is read-only and you cannot write to other souls.",
        },
        "social_muted_reason": {"title": "You are muted", "body": "You are muted for {{days}} days: {{reason}}"},
    },
    "egy": {
        "sentence_pardoned": {"title": "Renpet Sepy Nedj Seth", "body": "Renpet-Ek Nedj Seth. Wen Medjat Ba Er Maa.", "title_by_civ": {"eu": {"PURGATORY": "Renpet Sepy Nedj Seth"}}, "body_by_civ": {"eu": {"PURGATORY": "Renpet-Ek Nedj Seth. Wen Medjat Ba Er Maa."}}},
        "sentence_amended": {"title": "Wat Khemen Seth", "body": "Wetep-Ek Khemen Seth. Wen Medjat Ba Er Maa.", "title_by_civ": {"cn": "Khemen-Shepet"}, "body_by_civ": {"cn": "Shepet-Ek Khemen Seth. Wen Medjat Ba Er Maa."}},
        "sentence_completed": {"title": "Shepet Wetep-Neb Seth", "body": "Shepet-Ek Wetep-Neb Seth. Wen Medjat Ba Er Maa.", "title_by_civ": {"cn": {"BLISS": "Renpet Hemes Khetem Seth"}, "gr": {"BLISS": "Renpet Hemes Khetem Seth"}, "gr_republic": {"BLISS": "Renpet 1000 Khetem Seth"}, "eu": {"PURGATORY": "Isfet Fekh Neb Seth", "BLISS": "Wetep Neb Khetem Seth", "NEUTRAL": "Wetep Neb Khetem Seth"}, "eg": "Wetep Neb Khetem Seth"}, "body_by_civ": {"cn": {"BLISS": "Renpet Hemes Em Tianjie Khetem Seth. Wen Medjat Ba Er Maa."}, "gr": {"BLISS": "Renpet Hemes Em Ta Nefer Khetem Seth. Wen Medjat Ba Er Maa."}, "gr_republic": {"BLISS": "Renpet 1000 Em Pet Khetem Seth. Wen Medjat Ba Er Maa."}, "eu": {"PURGATORY": "Wat-Ek · Isfet Fekh Neb Seth. Wen Medjat Ba Er Maa.", "BLISS": "Wetep-Ek Neb Khetem Seth. Wen Medjat Ba Er Maa.", "NEUTRAL": "Wetep-Ek Neb Khetem Seth. Wen Medjat Ba Er Maa."}, "eg": "Wetep-Ek Neb Khetem Seth. Wen Medjat Ba Er Maa."}},
        "sentence_waiting": {"title": "Renpet Khetem; Ahau", "body": "Renpet Wa Khetem Seth. Wen Medjat Ba Er Maa.", "body_by_civ": {"cn": {"BLISS": "Renpet Hemes Wa Khetem Seth. Wen Medjat Ba Er Maa."}, "gr": {"BLISS": "Renpet Hemes Wa Khetem Seth. Wen Medjat Ba Er Maa."}, "eu": {"PURGATORY": "Isfet Fekh Sekhet Wa Khetem Seth. Wen Medjat Ba Er Maa."}, "gr_republic": {"BLISS": "Renpet 1000 Em Pet Khetem; Ahau. Wen Medjat Ba Er Maa."}}, "title_by_civ": {"cn": {"BLISS": "Renpet Hemes Khetem; Ahau"}, "gr": {"BLISS": "Renpet Hemes Khetem; Ahau"}, "eu": {"PURGATORY": "Isfet Fekh Sekhet Wa Khetem; Ahau"}, "gr_republic": {"BLISS": "Renpet 1000 Khetem; Ahau"}}},
        "rebirth_approved": {"title": "Dbh Wehem Mesut Hesy Seth", "body": "Dbh Wehem Mesut-Ek Hesy Seth. Wen Medjat Ba Er Maa."},
        "rebirth_rejected": {"title": "Dbh Wehem Mesut Khesef Seth", "body": "Dbh Wehem Mesut-Ek Khesef Seth. Wen Medjat Ba Er Maa Khet."},
        "rebirth_appeal_rejected": {"title": "Nehet Khesef Seth", "body": "Nehet-Ek Er Dbh Wehem Mesut Khesef Seth. Wen Medjat Ba Er Maa Khet."},
        "cooldown_shortening_approved": {"title": "Khebi Ahet Qebeh Hesy Seth", "body": "Khebi Ahet Qebeh-Ek Hesy Seth. Wen Medjat Ba Er Maa Ahet Qebeh."},
        "cooldown_shortening_rejected": {"title": "Khebi Ahet Qebeh Khesef Seth", "body": "Khebi Ahet Qebeh-Ek Khesef Seth. Wen Medjat Ba Er Maa Khet."},
        "judgment_result": {"title": "Wedja Khetem", "body": "Wedja-Ek Khetem Seth. Wen Medjat Ba Er Maa."},
        "appeal_upheld": {"title": "Nehet: Wedja Tepy Smen", "body": "Nehet Maa Seth: Wedja Tepy Smen. Wen Medjat Ba Er Maa."},
        "appeal_amended": {"title": "Nehet: Wedja Khemen Seth", "body": "Nehet Maa Seth: Wedja Khemen Seth. Wen Medjat Ba Er Maa."},
        "disposition_executed": {"title": "Wetep Iri Seth", "body": "Wetep-Ek Iri Seth. Wen Medjat Ba Er Maa."},
        "residence_approved": {"title": "Hemes Taui Ky Hesy", "body": "Hemes-Ek Em Taui Ky Hesy Seth. Wen Medjat Ba Er Maa."},
        "residence_started": {"title": "Hemes Tepy", "body": "Hemes-Ek Em Taui Ky Tepy Seth. Wen Medjat Ba Er Maa."},
        "residence_returned": {"title": "Hemes Khetem", "body": "Iyi-Ek Seth Er Nut-Ek. Wen Medjat Ba Er Maa."},
        "chat_message": {"title": "Shemes Mawy", "body": "{{name}}: Shemes Mawy Er-Ek. Wen Medjat Ba Er Maa."},
        "social_warned_post": {"title": "Sebayt Er Medu", "body": "Sebayt Er Medu-Ek: {{reason}}"},
        "social_warned_comment": {"title": "Sebayt Er Wesheb", "body": "Sebayt Er Wesheb-Ek: {{reason}}"},
        "social_warned_user": {"title": "Sebayt Er Aq", "body": "Sebayt Er Aq-Ek: {{reason}}"},
        "mfa_reset_by_officer": {"title": "Khetem Aq Sep Sen", "body": "Sab {{name}}: Khetem Aq Sep Sen-Ek Seth."},
         "export_ready": {"title": "Djama-Ek Iri Seth", "body": "Redi Per Djama-Ek Iri Seth · Wenen Hru 7. Wen Medjat Ba, Sau."},
        "content_approved_comment": {"title": "Wesheb-Ek Hesy Seth", "body": "Wesheb-Ek Hesy Seth. Neb Maa."},
        "content_approved_post": {"title": "Medu-Ek Hesy Seth", "body": "Medu-Ek Hesy Seth. Neb Maa."},
        "content_deleted_comment": {"title": "Wesheb-Ek Fekh Seth", "body": "Sab Wesekhet Fekh Wesheb-Ek."},
        "content_deleted_comment_reason": {"title": "Wesheb-Ek Fekh Seth", "body": "Sab Wesekhet Fekh Wesheb-Ek. Khet: {{reason}}"},
        "content_deleted_post": {"title": "Medu-Ek Fekh Seth", "body": "Sab Wesekhet Fekh Medu-Ek."},
        "content_deleted_post_reason": {"title": "Medu-Ek Fekh Seth", "body": "Sab Wesekhet Fekh Medu-Ek. Khet: {{reason}}"},
        "content_hidden_comment": {"title": "Wesheb-Ek Imen Seth", "body": "Sab Wesekhet Imen Wesheb-Ek. Wen Medjat Ba Er Maa."},
        "content_hidden_comment_reason": {"title": "Wesheb-Ek Imen Seth", "body": "Sab Wesekhet Imen Wesheb-Ek. Khet: {{reason}}"},
        "content_hidden_post": {"title": "Medu-Ek Imen Seth", "body": "Sab Wesekhet Imen Medu-Ek. Wen Medjat Ba Er Maa."},
        "content_hidden_post_reason": {"title": "Medu-Ek Imen Seth", "body": "Sab Wesekhet Imen Medu-Ek. Khet: {{reason}}"},
        "content_restored_comment": {"title": "Wesheb-Ek Wen Wehem", "body": "Wesheb-Ek Wen Wehem Seth."},
        "content_restored_post": {"title": "Medu-Ek Wen Wehem", "body": "Medu-Ek Wen Wehem Seth."},
        "comment": {"title": "{{name}}: Wesheb · Medu-Ek", "body": "{{text}}"},
        "reply": {"title": "{{name}}: Wesheb Er Wesheb-Ek", "body": "{{text}}"},
        "wangsi_upheld": {"title": "Nehet Maat · Per Tepy Seth", "body": "Nehet-Ek Maat: Per Tepy Seth Em Nut Mut Nen Maat. Wen Medjat Ba Er Maa."},
        "wangsi_upheld_late": {"title": "Nehet Maat", "body": "Nehet-Ek Maat. Wen Medjat Ba Er Maa Wesheb."},
        "wangsi_delivered": {"title": "Nehet Maat · Seshem Seth", "body": "Nehet-Ek Maat: Seshem Seth Em Nut Mut Nen Maat. Wen Medjat Ba Er Maa."},
        "wangsi_rejected": {"title": "Nehet Nen Maat", "body": "Nehet-Ek Nen Maat. Wen Medjat Ba Er Maa Wesheb."},
        "social_muted": {"title": "Gerh Er-Ek", "body": "Gerh Hru {{days}}: Shemsu Maa Wa; Nen Shemes Ba."},
        "social_muted_reason": {"title": "Gerh Er-Ek", "body": "Gerh Hru {{days}}: {{reason}}"},
        "push_device_claimed": {"title": "Medjat Sedjem: Aq Ky Sesh Seth", "body": "Medjat Sedjem-Ek: Aq Ky Sesh Seth. Medjat Pen: Nen Sedjem-Ek Emu. Nen Khemen-Ek Medjat? Hab Er Wesekhet."},
    },
}


#: 处置理由的显示名,`content_*_reason` 的 `{{reason}}` 用(选「其他」时用官员写的那句,不查这里)。
#: 权威是语言包 `social_moderation.reason`(与灵魂举报同一份 `ReportReason`);副本理由同 MESSAGES,
#: 一致由同一个测试文件钉住。
REASON_LABELS = {
    "zh-Hans": {"SPAM": "垃圾信息", "ABUSE": "辱骂骚扰", "SEXUAL": "色情内容", "ILLEGAL": "违法有害", "OTHER": "其他"},
    "en": {"SPAM": "Spam", "ABUSE": "Abuse", "SEXUAL": "Sexual content", "ILLEGAL": "Illegal or harmful", "OTHER": "Other"},
    "egy": {"SPAM": "Medu Mehy", "ABUSE": "Medu Kher", "SEXUAL": "Khet Hemet", "ILLEGAL": "Betau", "OTHER": "Ky"},
}


def reason_label(locale, code):
    return (REASON_LABELS.get(locale) or REASON_LABELS[DEFAULT_LOCALE]).get(code, code)


def render(locale, kind, civ=None, place=None, **params):
    """`params` 填 `{{占位符}}`(与语言包同一写法;chat_message 的 `name`、social_warned_* 的 `reason`)。

    `civ`(`cn` / `eu` / `eg` / `gr`,或按次序查的一串:希腊按《理想国》判的是 `("gr_republic", "gr")`)与
    `place`(去处类型)选 Design v4 第十二批的 `<字段>_by_civ.<文明>[.<类型>]`:计划一层只按文明
    (`sentence_amended`),灵魂自己那一层按文明 × 去处类型;都没有就是底键(与 core 的 `civKey` 同一次序)。"""
    pack = MESSAGES.get(locale) or MESSAGES[DEFAULT_LOCALE]
    # egy 可以缺 Design 还没给词的种类(`egyPendingKeys.json` 里的 `soul_push.<kind>`):读作 zh-Hans。
    entry = pack.get(kind) or MESSAGES[DEFAULT_LOCALE][kind]

    civs = (civ,) if isinstance(civ, str) else tuple(civ or ())

    def word(field):
        for one in civs:
            chosen = entry.get(f"{field}_by_civ", {}).get(one)
            if isinstance(chosen, dict):
                chosen = chosen.get(place) if place else None
            if isinstance(chosen, str):
                return chosen
        return entry[field]

    title, body = word("title"), word("body")
    for key, value in params.items():
        title, body = title.replace(f"{{{{{key}}}}}", value), body.replace(f"{{{{{key}}}}}", value)
    return title, body
