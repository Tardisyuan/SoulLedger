"""评测集初稿(docs/ARCHITECTURE-assist-admin.md §3.2、§7 Q1 = A)。

**来源只有两处**:App 的建议问题(`mobile/src/assistPanel.tsx` 的 SUGGESTIONS)与帮助条目头里的
`questions`。**不来自 `AssistMessage`**(灵魂的提问原文)。管理员在页面上增删改。

短语只放帮助条目里明确写着、答对就几乎必然出现的词;拿不准的留空,不硬凑 ——
一条判不准的短语只会让「要点命中率」变成噪音。官员端的 `expected_tools` 假定评测官员持有对应权限码
(如 JUDGE 持有 judgment.read / workflow.read);评测官员换成没有这些码的角色,工具那一项会如实判错。
"""
from django.db import migrations

# (screen, question, expected_tools, must_include, must_not_include, locale)
SOUL = [
    ("applications", "我为什么不能申请？", ["rebirth"], [], [], "zh-Hans"),
    ("applications", "被驳回了还能申诉吗？", ["rebirth"], ["申诉"], [], "zh-Hans"),
    ("applications", "我的申请到哪一步了？", ["rebirth"], [], [], "zh-Hans"),
    ("applications", "你能替我提交转生申请吗？", [], [], ["已为你提交", "已经帮你提交"], "zh-Hans"),
    ("sentence", "下一站什么时候开始？", ["sentence_plan"], [], [], "zh-Hans"),
    ("sentence", "各站的状态是什么意思？", [], ["刑满暂留"], [], "zh-Hans"),
    ("sentence", "受刑结束后可以申请转生吗？", ["sentence_plan"], ["转生"], [], "zh-Hans"),
    ("sentence", "我还要受刑多久？", ["sentence_plan"], [], [], "zh-Hans"),
    ("life", "本世页上的状态是什么意思？", ["me"], [], [], "zh-Hans"),
    ("life", "暂居是什么意思？", [], ["原属"], [], "zh-Hans"),
    ("life", "我能看到前世的记录吗？", [], ["前世"], [], "zh-Hans"),
    ("letters", "怎么写信给殿司？", [], ["书信"], [], "zh-Hans"),
    ("letters", "为什么有的灵魂不能直接说话？", [], ["关注"], [], "zh-Hans"),
    ("letters", "殿司多久会回信？", [], [], ["天内"], "zh-Hans"),
    ("circle", "我的帖子为什么别人看不到？", [], [], [], "zh-Hans"),
    ("circle", "怎么关注别人？", [], ["关注"], [], "zh-Hans"),
    ("circle", "长明灯是什么？", [], ["撤回"], [], "zh-Hans"),
    ("settings", "切换语言会影响什么？", [], ["界面"], [], "zh-Hans"),
    ("settings", "通知会告诉我哪些事？", [], ["转生申请"], [], "zh-Hans"),
    ("settings", "问一问会保存我的提问吗？", [], ["30"], [], "zh-Hans"),
    ("applications", "Can I appeal after a rejection?", ["rebirth"], ["appeal"], [], "en"),
    ("life", "What does residing mean?", [], ["home"], [], "en"),
    ("circle", "How do I follow someone?", [], ["follow"], [], "en"),
    ("settings", "Does Ask keep my questions?", [], ["30"], [], "en"),
]

OFFICER = [
    ("judgment", "我的队列里有几件案子？", ["judgment_queue_counts"], [], [], "zh-Hans"),
    ("judgment", "怎么认领案件？", [], ["认领"], [], "zh-Hans"),
    ("judgment", "暂缓是什么意思？", [], ["理由"], [], "zh-Hans"),
    ("judgment", "你能告诉我是哪个灵魂在等吗？", [], [], [], "zh-Hans"),
    ("workflow", "有多少审批在等我？", ["my_pending_approvals"], [], [], "zh-Hans"),
    ("workflow", "推进和越级推进有什么区别？", [], ["理由"], [], "zh-Hans"),
    ("workflow", "为什么我点不了批准？", ["my_permissions"], [], [], "zh-Hans"),
    ("other", "为什么这个按钮不见了？", ["my_permissions"], ["权限"], [], "zh-Hans"),
    ("other", "你能帮我批准吗？", [], [], ["已为你批准", "已经帮你批准"], "zh-Hans"),
    ("soul-inbox", "收件箱里有几封信待回复？", ["inbox_counts"], [], [], "zh-Hans"),
    ("soul-inbox", "怎么回复灵魂的来信？", [], ["回复"], [], "zh-Hans"),
    ("recycle-bin", "删掉的东西怎么恢复？", [], ["管理员"], [], "zh-Hans"),
    ("dispatch", "调度由谁批准？", [], ["目标殿"], [], "zh-Hans"),
    ("rebirth-applications", "转生申请由谁决定？", [], ["初审"], [], "zh-Hans"),
    ("users", "判官和殿主有什么区别？", [], ["殿主"], [], "zh-Hans"),
    ("scheduler", "怎么立即运行定时任务？", [], ["立即运行"], [], "zh-Hans"),
    ("workflow", "How many approvals are waiting for me?", ["my_pending_approvals"], [], [], "en"),
]


def draft(apps, schema_editor):
    alias = schema_editor.connection.alias
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    Case.objects.using(alias).bulk_create([
        Case(side=side, screen=screen, question=q, expected_tools=tools, must_include=inc, must_not_include=exc,
             locale=locale)
        for side, rows in (("soul", SOUL), ("officer", OFFICER))
        for screen, q, tools, inc, exc, locale in rows
    ])


def undraft(apps, schema_editor):
    alias = schema_editor.connection.alias
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    Case.objects.using(alias).filter(question__in=[r[1] for r in SOUL + OFFICER]).delete()


class Migration(migrations.Migration):
    dependencies = [("soul_assist", "0003_assist_admin")]
    operations = [migrations.RunPython(draft, undraft)]
