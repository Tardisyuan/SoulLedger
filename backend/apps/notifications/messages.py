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
        "sentence_plan_cancelled": {"title": "受刑计划已撤销", "body": "灵魂「{{soul}}」的受刑计划已撤销，剩余刑期免除，按计划完成处理。"},
        "sentence_plan_amended": {"title": "受刑计划变更", "body": "灵魂「{{soul}}」的受刑计划已变更，涉及 {{tenant}}。"},
        "sentence_request_pending": {"title": "受刑计划请求待决", "body": "{{tenant}} 就灵魂「{{soul}}」的受刑计划提出了请求，等待原审判官决定。"},
        "sentence_request_decided": {"title": "受刑计划请求已决定", "body": "你就灵魂「{{soul}}」受刑计划提出的请求已由原审判官决定，打开查看。"},
        "sentence_node_active": {"title": "受刑节点开始", "body": "灵魂「{{soul}}」已到达，受刑计划第 {{order}} 站在 {{tenant}} 开始执行。"},
        "sentence_node_done": {"title": "受刑节点结束", "body": "灵魂「{{soul}}」受刑计划第 {{order}} 站（{{tenant}}）已结束。"},
        "sentence_node_waiting": {"title": "刑满暂留", "body": "灵魂「{{soul}}」在 {{tenant}} 的第 {{order}} 站刑满，因有未结案审判暂留当地；结案或撤案后回归。"},
        "sentence_node_refused": {"title": "受刑节点被拒", "body": "{{tenant}} 拒绝了灵魂「{{soul}}」受刑计划第 {{order}} 站的调拨，该节点已退回待执行。"},
        "sentence_plan_completed": {"title": "受刑计划完成", "body": "灵魂「{{soul}}」的受刑计划已全部完成。"},
        "cross_sentence_submitted": {"title": "联审节点已填写", "body": "{{tenant}} 已填写灵魂「{{soul}}」受刑计划第 {{order}} 站的处置。"},
        "password_help_requested": {"title": "忘记密码求助", "body": "账号「{{username}}」在登录页申请重置密码。核实身份后，请到用户管理为其重置。"},
        "password_help_requested_moderator": {"title": "忘记密码求助", "body": "账号「{{username}}」在登录页申请重置密码。核实身份后，请联系管理员为其重置。"},
        "dispatch_return_blocked": {
            "title": "暂居回归被拦下",
            "body": "灵魂「{{soul}}」的暂居回归被未结案审判拦下，共 {{count}} 件；结案或撤案后才能回归。",
        },
    },
    "en": {
        "sentence_plan_cancelled": {"title": "Sentence plan cancelled", "body": "The sentence plan of soul {{soul}} was cancelled. The rest of the sentence is waived and the plan counts as complete."},
        "sentence_plan_amended": {"title": "Sentence plan changed", "body": "The sentence plan of soul {{soul}} has changed, involving {{tenant}}."},
        "sentence_request_pending": {"title": "Sentence plan request pending", "body": "{{tenant}} has filed a request on the sentence plan of soul {{soul}}. It awaits the original judge."},
        "sentence_request_decided": {"title": "Sentence plan request decided", "body": "The original judge has decided your request on the sentence plan of soul {{soul}}. Open it to see."},
        "sentence_node_active": {"title": "Sentence stop begun", "body": "Soul {{soul}} has arrived. Stop {{order}} of its sentence plan begins in {{tenant}}."},
        "sentence_node_done": {"title": "Sentence stop ended", "body": "Stop {{order}} ({{tenant}}) of the sentence plan of soul {{soul}} has ended."},
        "sentence_node_waiting": {"title": "Held after serving", "body": "Soul {{soul}} has served stop {{order}} in {{tenant}} and stays there while a judgment is open. It returns once the judgment is concluded or withdrawn."},
        "sentence_node_refused": {"title": "Sentence stop refused", "body": "{{tenant}} refused the transfer for stop {{order}} of the sentence plan of soul {{soul}}. The stop is pending again."},
        "sentence_plan_completed": {"title": "Sentence plan completed", "body": "Soul {{soul}} has served every stop of its sentence plan."},
        "cross_sentence_submitted": {"title": "Joint sentence submitted", "body": "{{tenant}} has submitted stop {{order}} of the sentence plan of soul {{soul}}."},
        "password_help_requested": {"title": "Password help requested", "body": "Account {{username}} asked for a password reset from the sign-in page. Once you have confirmed who is asking, reset it under User Management."},
        "password_help_requested_moderator": {"title": "Password help requested", "body": "Account {{username}} asked for a password reset from the sign-in page. Once you have confirmed who is asking, ask an administrator to reset it."},
        "dispatch_return_blocked": {
            "title": "Residence return blocked",
            "body": (
                "Soul {{soul}} cannot return home while judgments stay open ({{count}}). "
                "It returns once they are concluded or withdrawn."
            ),
        },
    },
    "egy": {
        "sentence_plan_cancelled": {"title": "Wetep Sehen Seth", "body": "{{soul}}: Wetep Sehen Seth. Ky Wetep Nen; Wetep Neb Seth."},
        "sentence_plan_amended": {"title": "Wetep Khemen Seth", "body": "{{soul}}: Wetep Khemen Seth Em {{tenant}}."},
        "sentence_request_pending": {"title": "Dbh Wetep Em Smen", "body": "{{tenant}}: Dbh Wetep En {{soul}}. Hemsu Tepy Er Wedja."},
        "sentence_request_decided": {"title": "Dbh Wetep Wedja Seth", "body": "{{soul}}: Dbh Ek Wedja Seth Em Hemsu Tepy."},
        "sentence_node_active": {"title": "Sekhet Wetep Tepy", "body": "{{soul}}: Iyi Seth. Sekhet {{order}} Wetep Em {{tenant}}."},
        "sentence_node_done": {"title": "Sekhet Wetep Seth", "body": "{{soul}}: Sekhet {{order}} ({{tenant}}) Wetep Seth."},
        "sentence_node_waiting": {"title": "Hemes Smen", "body": "{{soul}}: Sekhet {{order}} Em {{tenant}} Wetep Seth; Hemes Smen Em Wedja. Wedja Pehwy, Iyi Er Taui Tepy."},
        "sentence_node_refused": {"title": "Sekhet Khesef Seth", "body": "{{tenant}}: Hab Sekhet {{order}} En {{soul}} Khesef Seth. Sekhet Em Smen."},
        "sentence_plan_completed": {"title": "Wetep Neb Seth", "body": "{{soul}}: Sekhet Neb Wetep Seth."},
        "cross_sentence_submitted": {"title": "Sekhet Sesh Seth", "body": "{{tenant}}: Sekhet {{order}} En {{soul}} Sesh Seth."},
        "password_help_requested": {"title": "Dbh · Nen Rekh Sekhem", "body": "Aq «{{username}}» Dbh Wehem Sekhem Em Aq. Maa Tepy; Er Khet: Wehem Sekhem Em Iri Remetj."},
        "password_help_requested_moderator": {"title": "Dbh · Nen Rekh Sekhem", "body": "Aq «{{username}}» Dbh Wehem Sekhem Em Aq. Maa Tepy; Er Khet: Dbh Sab Hery Er Wehem Sekhem."},
        "dispatch_return_blocked": {
            "title": "Ankh Er Taui Khesef",
            "body": "{{soul}}: Ankh Er Taui Khesef En Wedja {{count}}. Wedja Pehwy, Ankh Er Taui.",
        },
    },
}

#: 通知类型 → 文案键。不在这里的类型照存下来的 title / message 原样返回。
KIND_BY_TYPE = {
    "DISPATCH_RETURN_BLOCKED": "dispatch_return_blocked",
    "SENTENCE_NODE_ACTIVE": "sentence_node_active",
    "SENTENCE_NODE_DONE": "sentence_node_done",
    "SENTENCE_NODE_WAITING": "sentence_node_waiting",
    "SENTENCE_NODE_REFUSED": "sentence_node_refused",
    "SENTENCE_PLAN_COMPLETED": "sentence_plan_completed",
    "CROSS_SENTENCE_SUBMITTED": "cross_sentence_submitted",
    "SENTENCE_PLAN_AMENDED": "sentence_plan_amended",
    "SENTENCE_REQUEST_PENDING": "sentence_request_pending",
    "SENTENCE_REQUEST_DECIDED": "sentence_request_decided",
    "SENTENCE_PLAN_CANCELLED": "sentence_plan_cancelled",
    "PASSWORD_HELP_REQUESTED": "password_help_requested",
}


#: Per-recipient variants of a type's kind. A sender picks one by writing its
#: name into the row's `params["kind"]`; `kind_for` honours it only if it is
#: listed here under the type's own kind, so a row cannot name any other text.
#:
#: `password_help_requested_moderator`: a realm lead (殿主) is told about a
#: colleague's 「忘记密码」 but cannot open user management (ADMIN only), so
#: their text says to ask an administrator instead (2026-09-25 decision).
VARIANTS = {
    "password_help_requested": {"password_help_requested_moderator"},
}


def kind_for(notification_type, params):
    """The text a stored notification renders with: its type's kind, or the
    variant its `params` name when that variant belongs to that kind."""
    kind = KIND_BY_TYPE.get(notification_type)
    variant = (params or {}).get("kind")
    return variant if variant in VARIANTS.get(kind, ()) else kind


def render(locale, kind, params):
    entry = MESSAGES[locale][kind]
    body = entry["body"]
    for name, value in params.items():
        body = body.replace("{{" + name + "}}", str(value))
    return entry["title"], body
