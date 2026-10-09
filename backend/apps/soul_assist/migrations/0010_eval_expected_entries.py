"""评测集补 `expected_entries`(docs/ARCHITECTURE-soul-assist.md §7.6):0004 起草的每条用例写上期望命中的条目,
并为每个帮助条目补到至少一条中文、一条英文用例 —— 检索命中率才量得到整份语料,而不是只量常问的那几条。

**来源仍只有两处**:App 与后台的建议问题,以及条目头里的 `questions`。不来自提问原文。
用例以 `(side, question)` 识别(与 0004 的 `undraft` 同一把钥匙):正向只给 `expected_entries` 为空的行填,
管理员已经在页面上写过的不动;反向把这些问题的 `expected_entries` 清空、删掉这里新增的用例。
`tests/test_assist_rag.py` 钉住:这里点名的条目在该端、该语言的语料里都存在,且每个条目两种语言各至少一条。
"""
from django.db import migrations

# 0004 的用例 → 期望条目。`codes` 与 `officer-disabled-buttons` 是 PINNED,总在上下文里,命中是必然的;
# 仍写上,评测页上才看得出这条题考的是哪一条。
FILL = {
    "soul": {
        "我为什么不能申请？": ["rebirth-apply"],
        "被驳回了还能申诉吗？": ["rebirth-appeal"],
        "我的申请到哪一步了？": ["rebirth-review"],
        "你能替我提交转生申请吗？": ["assistant"],
        "下一站什么时候开始？": ["sentence-plan"],
        "各站的状态是什么意思？": ["sentence-states"],
        "受刑结束后可以申请转生吗？": ["sentence-plan"],
        "我还要受刑多久？": ["sentence-plan"],
        "本世页上的状态是什么意思？": ["soul-states"],
        "暂居是什么意思？": ["residence"],
        "我能看到前世的记录吗？": ["past-lives"],
        "怎么写信给殿司？": ["letters"],
        "为什么有的灵魂不能直接说话？": ["letters"],
        "殿司多久会回信？": ["letters"],
        "我的帖子为什么别人看不到？": ["circle"],
        "怎么关注别人？": ["circle"],
        "长明灯是什么？": ["circle"],
        "切换语言会影响什么？": ["language"],
        "通知会告诉我哪些事？": ["notifications"],
        "问一问会保存我的提问吗？": ["assistant"],
        "Can I appeal after a rejection?": ["rebirth-appeal"],
        "What does residing mean?": ["residence"],
        "How do I follow someone?": ["circle"],
        "Does Ask keep my questions?": ["assistant"],
    },
    "officer": {
        "我的队列里有几件案子？": ["officer-judgment-queue"],
        "怎么认领案件？": ["officer-judgment-queue"],
        "暂缓是什么意思？": ["officer-judgment-queue"],
        "你能告诉我是哪个灵魂在等吗？": ["officer-assistant"],
        "有多少审批在等我？": ["officer-workflow"],
        "推进和越级推进有什么区别？": ["officer-workflow"],
        "为什么我点不了批准？": ["officer-disabled-buttons"],
        "为什么这个按钮不见了？": ["officer-disabled-buttons"],
        "你能帮我批准吗？": ["officer-assistant"],
        "收件箱里有几封信待回复？": ["officer-soul-inbox"],
        "怎么回复灵魂的来信？": ["officer-soul-inbox"],
        "删掉的东西怎么恢复？": ["officer-recycle-bin"],
        "调度由谁批准？": ["officer-dispatch"],
        "转生申请由谁决定？": ["officer-rebirth-applications"],
        "判官和殿主有什么区别？": ["officer-roles"],
        "怎么立即运行定时任务？": ["officer-scheduler"],
        "How many approvals are waiting for me?": ["officer-workflow"],
    },
}

# (screen, question, expected_tools, must_include, must_not_include, locale, expected_entries)
SOUL = [
    ("applications", "暂不能提交是什么意思？", ["rebirth"], [], [], "zh-Hans", ["codes"]),
    ("applications", "我为什么没有转生？", ["rebirth"], [], [], "zh-Hans", ["no-rebirth"]),
    ("settings", "忘记密码怎么办？", [], ["邮箱"], [], "zh-Hans", ["account"]),
    ("life", "本世余额是什么意思？", [], ["功"], [], "zh-Hans", ["this-life-ledger"]),
    ("applications", "How do I apply for rebirth?", ["rebirth"], [], [], "en", ["rebirth-apply"]),
    ("applications", "Where is my application now?", ["rebirth"], [], [], "en", ["rebirth-review"]),
    ("applications", "Why can't I apply?", ["rebirth"], [], [], "en", ["codes"]),
    ("applications", "Why is there no rebirth for me?", ["rebirth"], [], [], "en", ["no-rebirth"]),
    ("sentence", "When does the next station begin?", ["sentence_plan"], [], [], "en", ["sentence-plan"]),
    ("sentence", "What do the station states mean?", [], [], [], "en", ["sentence-states"]),
    ("life", "What does my state on this page mean?", ["me"], [], [], "en", ["soul-states"]),
    ("life", "Can I see my past lives?", [], ["Past lives"], [], "en", ["past-lives"]),
    ("life", "What does the balance mean?", [], [], [], "en", ["this-life-ledger"]),
    ("letters", "How do I write to the hall?", [], ["Letters"], [], "en", ["letters"]),
    ("settings", "What does switching the language change?", [], [], [], "en", ["language"]),
    ("settings", "What will notifications tell me?", [], [], [], "en", ["notifications"]),
    ("settings", "I forgot my password", [], [], [], "en", ["account"]),
]

OFFICER = [
    ("about", "关于页讲什么？", [], [], [], "zh-Hans", ["officer-about"]),
    ("admin", "怎么开通或关闭问一问？", [], ["管理员"], [], "zh-Hans", ["officer-assistant-admin"]),
    ("cross-judgments", "什么时候激活联审？", [], ["参与方"], [], "zh-Hans", ["officer-cross-judgments"]),
    ("welcome", "怎么重看首次设置？", [], [], [], "zh-Hans", ["officer-first-run"]),
    ("other", "不登录能看到什么？", [], [], [], "zh-Hans", ["officer-landing"]),
    ("other", "账号被锁定了怎么办？", [], [], [], "zh-Hans", ["officer-login"]),
    ("notifications", "我的通知在哪？", [], [], [], "zh-Hans", ["officer-notifications"]),
    ("permissions", "权限矩阵怎么改？", [], ["管理员"], [], "zh-Hans", ["officer-permission-matrix"]),
    ("actors", "神祇名录是什么？", [], [], [], "zh-Hans", ["officer-reference-pages"]),
    ("sentence-requests", "怎么处理受刑请求？", [], [], [], "zh-Hans", ["officer-sentence-requests"]),
    ("moderation", "朋友圈怎么审核？", [], [], [], "zh-Hans", ["officer-social-moderation"]),
    ("souls", "怎么新建灵魂？", [], [], [], "zh-Hans", ["officer-souls-and-records"]),
    ("users", "怎么创建用户？", ["my_permissions"], ["管理员"], [], "zh-Hans", ["officer-users"]),
    ("about", "What is the about page?", [], [], [], "en", ["officer-about"]),
    ("other", "What can you do?", [], [], ["approved it for you"], "en", ["officer-assistant"]),
    ("admin", "How do I switch the assistant on or off?", [], [], [], "en", ["officer-assistant-admin"]),
    ("cross-judgments", "When do I activate a joint judgment?", [], [], [], "en", ["officer-cross-judgments"]),
    ("other", "Why is this button missing?", ["my_permissions"], [], [], "en", ["officer-disabled-buttons"]),
    ("dispatch", "Who approves a dispatch?", [], [], [], "en", ["officer-dispatch"]),
    ("welcome", "How do I redo the first-time setup?", [], [], [], "en", ["officer-first-run"]),
    ("judgment", "How many cases are in my queue?", ["judgment_queue_counts"], [], [], "en", ["officer-judgment-queue"]),
    ("other", "What can be seen without signing in?", [], [], [], "en", ["officer-landing"]),
    ("other", "My account is locked", [], [], [], "en", ["officer-login"]),
    ("notifications", "Where are my notifications?", [], [], [], "en", ["officer-notifications"]),
    ("permissions", "How do I change the permission matrix?", [], [], [], "en", ["officer-permission-matrix"]),
    ("rebirth-applications", "Who decides a rebirth application?", [], [], [], "en", ["officer-rebirth-applications"]),
    ("recycle-bin", "How do I restore something I deleted?", [], [], [], "en", ["officer-recycle-bin"]),
    ("actors", "What is the deity roster?", [], [], [], "en", ["officer-reference-pages"]),
    ("users", "What is the difference between a judge and a realm lead?", [], [], [], "en", ["officer-roles"]),
    ("scheduler", "How do I run a scheduled job now?", [], [], [], "en", ["officer-scheduler"]),
    ("sentence-requests", "How do I decide a sentence request?", [], [], [], "en", ["officer-sentence-requests"]),
    ("moderation", "How do I moderate the circle?", [], [], [], "en", ["officer-social-moderation"]),
    ("soul-inbox", "How many letters await a reply?", ["inbox_counts"], [], [], "en", ["officer-soul-inbox"]),
    ("souls", "How do I create a soul?", [], [], [], "en", ["officer-souls-and-records"]),
    ("users", "How do I create a user?", ["my_permissions"], [], [], "en", ["officer-users"]),
]


def fill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    for side, rows in FILL.items():
        for question, expected in rows.items():
            for case in Case.objects.using(alias).filter(side=side, question=question):
                if not case.expected_entries:
                    case.expected_entries = expected
                    case.save(using=alias, update_fields=["expected_entries"])
    Case.objects.using(alias).bulk_create([
        Case(side=side, screen=screen, question=q, expected_tools=tools, must_include=inc, must_not_include=exc,
             locale=locale, expected_entries=expected)
        for side, rows in (("soul", SOUL), ("officer", OFFICER))
        for screen, q, tools, inc, exc, locale, expected in rows
    ])


def unfill(apps, schema_editor):
    alias = schema_editor.connection.alias
    Case = apps.get_model("soul_assist", "AssistEvalCase")
    for side, rows in FILL.items():
        Case.objects.using(alias).filter(side=side, question__in=list(rows)).update(expected_entries=[])
    for side, rows in (("soul", SOUL), ("officer", OFFICER)):
        Case.objects.using(alias).filter(side=side, question__in=[r[1] for r in rows]).delete()


class Migration(migrations.Migration):
    dependencies = [("soul_assist", "0009_per_platform_api_keys")]
    operations = [migrations.RunPython(fill, unfill)]
