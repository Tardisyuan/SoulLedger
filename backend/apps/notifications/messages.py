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
        "sentence_node_active": {"title": "受刑节点开始", "body": "灵魂「{{soul}}」已到达，受刑计划第 {{order}} 站在 {{tenant}} 开始执行。"},
        "sentence_node_done": {"title": "受刑节点结束", "body": "灵魂「{{soul}}」受刑计划第 {{order}} 站（{{tenant}}）已结束。"},
        "sentence_node_waiting": {"title": "刑满暂留", "body": "灵魂「{{soul}}」在 {{tenant}} 的第 {{order}} 站刑满，因有未结案审判暂留当地；结案或撤案后回归。"},
        "sentence_node_refused": {"title": "受刑节点被拒", "body": "{{tenant}} 拒绝了灵魂「{{soul}}」受刑计划第 {{order}} 站的调拨，该节点已退回待执行。"},
        "sentence_plan_completed": {"title": "受刑计划完成", "body": "灵魂「{{soul}}」的受刑计划已全部完成。"},
        "cross_sentence_submitted": {"title": "联审节点已填写", "body": "{{tenant}} 已填写灵魂「{{soul}}」受刑计划第 {{order}} 站的处置。"},
        "dispatch_return_blocked": {
            "title": "暂居回归被拦下",
            "body": "灵魂「{{soul}}」的暂居回归被未结案审判拦下，共 {{count}} 件；结案或撤案后才能回归。",
        },
    },
    "en": {
        "sentence_node_active": {"title": "Sentence stop begun", "body": "Soul {{soul}} has arrived. Stop {{order}} of its sentence plan begins in {{tenant}}."},
        "sentence_node_done": {"title": "Sentence stop ended", "body": "Stop {{order}} ({{tenant}}) of the sentence plan of soul {{soul}} has ended."},
        "sentence_node_waiting": {"title": "Held after serving", "body": "Soul {{soul}} has served stop {{order}} in {{tenant}} and stays there while a judgment is open. It returns once the judgment is concluded or withdrawn."},
        "sentence_node_refused": {"title": "Sentence stop refused", "body": "{{tenant}} refused the transfer for stop {{order}} of the sentence plan of soul {{soul}}. The stop is pending again."},
        "sentence_plan_completed": {"title": "Sentence plan completed", "body": "Soul {{soul}} has served every stop of its sentence plan."},
        "cross_sentence_submitted": {"title": "Joint sentence submitted", "body": "{{tenant}} has submitted stop {{order}} of the sentence plan of soul {{soul}}."},
        "dispatch_return_blocked": {
            "title": "Residence return blocked",
            "body": (
                "Soul {{soul}} cannot return home while judgments stay open ({{count}}). "
                "It returns once they are concluded or withdrawn."
            ),
        },
    },
    "egy": {
        "sentence_node_active": {"title": "Mekher Wetep Tepy", "body": "{{soul}}: Iyi Seth. Mekher {{order}} Wetep Em {{tenant}}."},
        "sentence_node_done": {"title": "Mekher Wetep Seth", "body": "{{soul}}: Mekher {{order}} ({{tenant}}) Wetep Seth."},
        "sentence_node_waiting": {"title": "Hemes Smen", "body": "{{soul}}: Mekher {{order}} Em {{tenant}} Wetep Seth; Hemes Smen Em Wedja. Wedja Pehwy, Iyi Er Taui Tepy."},
        "sentence_node_refused": {"title": "Mekher Khesef Seth", "body": "{{tenant}}: Hab Mekher {{order}} En {{soul}} Khesef Seth. Mekher Em Smen."},
        "sentence_plan_completed": {"title": "Wetep Nebt Seth", "body": "{{soul}}: Mekher Nebt Wetep Seth."},
        "cross_sentence_submitted": {"title": "Mekher Sesh Seth", "body": "{{tenant}}: Mekher {{order}} En {{soul}} Sesh Seth."},
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
}


def render(locale, kind, params):
    entry = MESSAGES[locale][kind]
    body = entry["body"]
    for name, value in params.items():
        body = body.replace("{{" + name + "}}", str(value))
    return entry["title"], body
