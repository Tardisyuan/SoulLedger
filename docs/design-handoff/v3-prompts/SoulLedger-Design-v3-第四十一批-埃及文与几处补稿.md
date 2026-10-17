# 第四十一批 · 埃及文复核与几处补稿(2026-10-17)

第四十批已全部落地并上线(main `b97d703f`)。落地时有几处要你再定，另外把这一轮所有还没有埃及文的词条一并列给你。
用词照旧：「会审」在 zh 里统一写「跨域审判」,en 写 "cross-realm judgment",egy 用已登记的 `Wedja Ta Ky`。

---

## 一、第四十批 egy 里用到了词表外的词(请确认或改写)

回复里写的是「egy 没有新词根」,但下面 8 条用到了 **Ak、Dem、Ip、Kheru、Pa** 这五个词，它们不在我们的封闭词表里(定稿词根 + 小词 + 旧账清单)。词表守卫不让未登记的词进语言包，所以这 8 条暂时退回中文显示。

请二选一：
- 这五个词是新词根：给出每个词的意思，我们登记进词表，原文照用；
- 或者用已登记的词改写这 8 条。

| 键 | zh | 你给的 egy |
|---|---|---|
| `crossJudgments.end_body` | 结束后不能再入席、召集或改结论。原审判可以结案。 | Er Khet: Nen Ak, Nen Dem, Nen Khemen Wedja. Wedja Tepy Khetem. |
| `crossJudgments.cancel_body` | 跨域审判不会有结论。席上的评议保留，只能看。原审判照常结案。 | Nen Wedja. Sesh Wesheb Smen · Maa Wa. Wedja Tepy Khetem Mi Pa. |
| `soul_app.settings.email_hint` | 忘记密码时，验证码发到这里。 | Mi Nen Rekh Sekhem: Ip Hab Hena. |
| `soul_app.settings.email_code_sent` | 验证码已发到 {{email}} | Ip Hab Seth Er {{email}} |
| `officer_app.search.placeholder` | 姓名、编号或案号 | Ren, Ip Er Ip Sep |
| `officer_app.search.no_soul` | 没有编号或姓名对得上的灵魂 | Nen Ba Hena Ren Er Ip |
| `officer_app.reassign.hint` | 本殿能审判的官员 · 手上件数少的在前 | Sab Wedja Wesekhet · Sep Kheru Tepy |
| `officer_app.rebirth.cross_civ_body` | 跨文明只能在初审定，要在电脑上定。现在批准，就按「不跨」定下来，以后不能再改。 | Taui Ky Em Wedja Tepy · Em Medjat Sab. Hesy Pa: «Nen», Nen Khemen. |

---

## 二、定时任务名与产品决定矛盾

`scheduler.jobs.judgment_auto_conclude_stale_for_tenant` 原来叫「自动结案久悬审判」。产品定了**审判永不自动结案**,30 天无进展只打「滞留」标记(字段 + 徽标 + 可筛选)。
zh / en 已改为「标记滞留审判」/ "Flag stale judgments"。egy 现在是 `Khetem Wedja Tepy Djes-Ef`(仍是「结案」的意思),请重写。

同一件事还要几个新词条的 egy:「滞留」徽标 `judgment.stale.label`、悬停说明「30 天无进展」`judgment.stale.hint`、筛选「滞留 · 全部」「只看滞留」。见附表。

---

## 三、朋友圈互动的「等 N 人」

你给的只有一种写法,`{{name}} 等 {{n}} 人对你的帖子表态`(长明灯、关注同理)。有两个问题：
1. 只有一个人时也会显示「某某等 1 人…」。请给**单独一人**的写法(zh / en / egy)。
2. en 的 "and {{n}} others" 里 n 是「除他以外的人数」,而 zh 的「等 n 人」是总人数。我们传的是总人数，英文会多算一个。请确认 en 改成哪种说法，或告诉我们 en 要传「其余人数」。

涉及的键:`soul_app.social.reacted_many`、`lamp_many`、`followed_many`。

---

## 四、转生登记簿与稿不同的三处(请确认可以，或给改法)

1. **转生形态是单选**,不是多选：后端的筛选只认一个值。
2. **「第几世」是数字输入框**,不是下拉单选：世数没有上限，下拉列不全。
3. **「去往」前没有 ⇄**:后端的转生记录里没有「去往哪个文明」,只有处置所在界域的代码。现在显示的是界域。要标 ⇄,后端得补字段。你觉得值得补，还是界域就够了?

---

## 五、新稿:殿设置的三项与一个开关

产品定了两件，都在**网页「殿设置」**里，要你给位置和文案(三语):

1. **地址、办理时间、电话**:三个可选文本项。灵魂 App 的帮助页在本殿没开书信时，在「请到{{hall}},带上交付单」下面显示这三行，没填的行不显示。灵魂端的显示样子你在第四十批 S-d 已经给过，这次只缺**网页殿设置里填写的地方**。
2. **「允许灵魂自己改联系邮箱」开关**:默认开。关掉后，灵魂 App 设置里改邮箱那一行显示「要改联系邮箱，请到本殿，带上交付单」(第四十批 S-b 已给)。这次只缺**网页上的开关和说明**。

---

## 附：还没有 egy 的词条(共 119 条)

下面是这一轮做的、还没有埃及文的全部词条(zh / en 已定)。请按词表给 egy;如果某条你觉得 zh 本身该改，也可以一并说。
第一节那 8 条、第二节的任务名也在表里。

| 键 | zh-Hans | en |
|---|---|---|
| `breadcrumb.menu.group_rebirth` | 轮回 | Reincarnation |
| `breadcrumb.menu.sentence_plans` | 受刑计划 | Sentence Plans |
| `crossJudgments.cancel_body` | 跨域审判不会有结论。席上的评议保留，只能看。原审判照常结案。 | There will be no conclusion. Seat comments stay, read-only. The original judgment closes as usual. |
| `crossJudgments.cancel_error` | 没能取消，请重试 | Couldn't cancel it. Try again. |
| `crossJudgments.cancel_reason` | 理由 · 必填 | Reason · required |
| `crossJudgments.end_body` | 结束后不能再入席、召集或改结论。原审判可以结案。 | After this, no one can join, convene or change the conclusion. The original judgment can then be closed. |
| `crossJudgments.end_error` | 没能结束，请重试 | Couldn't end it. Try again. |
| `crossJudgments.filter.search` | 搜索标题 | Search title |
| `crossJudgments.filter.side` | 我方 | Our side |
| `crossJudgments.filter.side_initiated` | 我方发起 | Initiated by us |
| `crossJudgments.filter.side_participating` | 我方参与 | We take part |
| `crossJudgments.original_judgment` | 原审判 | Original judgment |
| `crossJudgments.original_soul` | 灵魂 | Soul |
| `dashboard.todo.approvals` | 审批待我处理 | Approvals waiting on you |
| `dashboard.todo.cooldowns` | 缩短冷却待批 | Cooldown requests to decide |
| `dashboard.todo.letters` | 待我回的书信 | Letters awaiting your reply |
| `dashboard.todo.rebirths` | 转生申请待批 | Rebirth applications to decide |
| `dashboard.todo.reports` | 举报待处理 | Reports to review |
| `dashboard.todo.sentence_requests` | 受刑请求 | Sentence plan requests |
| `dashboard.todo.unassigned_letters` | 未分配的书信 | Unassigned letters |
| `death_sync.filter.from` | 收到日期起 | Received from |
| `death_sync.filter.search` | 灵魂姓名 / 来源编号 / 幂等键 | Soul name / source reference / idempotency key |
| `death_sync.filter.to` | 收到日期止 | Received to |
| `death_sync.webhooks.inactive` | 这个 Webhook 已停用 | This webhook is disabled |
| `death_sync.webhooks.redeliver` | 重投 | Redeliver |
| `death_sync.webhooks.redeliver_failed` | 重投没能发起 | Could not redeliver |
| `death_sync.webhooks.redeliver_not_finished` | 这条投递还在自动重试，等它放弃后再重投 | This delivery is still being retried; redeliver once it has given up |
| `death_sync.webhooks.redelivered` | 已重新排入投递 | Queued for delivery again |
| `death_sync.webhooks.send_test` | 发测试事件 | Send test event |
| `death_sync.webhooks.test_event` | 测试事件 | Test event |
| `death_sync.webhooks.test_failed` | 测试事件没能发起 | Could not send the test event |
| `death_sync.webhooks.test_sent` | 测试事件已排入投递，结果见下方投递记录 | Test event queued; see the delivery log below |
| `judgment.claim.load_more` | 再载入（还有 {{n}} 件） | Load more ({{n}} left) |
| `judgment.stale.filter_all` | 滞留 · 全部 | Stale · all |
| `judgment.stale.filter_only` | 只看滞留 | Stale only |
| `judgment.stale.hint` | 30 天无进展 | No progress in 30 days |
| `judgment.stale.label` | 滞留 | Stale |
| `menu_buttons.where.detail_actions` | 详情页操作区 | Detail page actions |
| `menu_buttons.where.detail_header` | 详情页页头 | Detail page header |
| `menu_buttons.where.detail_more` | 详情页 ⋯ | Detail page ⋯ |
| `menu_buttons.where.list_top` | 列表页右上 | List page, top right |
| `menu_buttons.where.row_more` | 列表行 ⋯ | List row ⋯ |
| `menu_buttons.where.section_top` | 列表每段右上 | Each list section, top right |
| `notifications.open_assistant` | 去助手管理 | Open assistant admin |
| `notifications.open_cross_judgment` | 打开跨域审判 | Open the cross-realm judgment |
| `notifications.open_death_sync` | 去死亡同步 | Open death sync |
| `notifications.open_failed` | 打不开：找不到这条记录了 | Could not open: the record is gone |
| `notifications.open_letter` | 打开来信 | Open the letter |
| `notifications.open_scheduler` | 去定时任务 | Open scheduled tasks |
| `notifications.open_sentence_plan` | 打开受刑计划 | Open the sentence plan |
| `notifications.open_sentence_requests` | 去受刑请求 | Open sentence requests |
| `notifications.open_soul` | 打开灵魂 | Open the soul |
| `notifications.open_workflow` | 打开审批 | Open the approval |
| `officer_app.comment.load_failed` | 没取到评议 | Couldn't load comments |
| `officer_app.cosign.more` | 更多（还有 {{n}} 人） | More ({{n}} more) |
| `officer_app.letter.earlier` | 更早的信 | Earlier letters |
| `officer_app.letter.earlier_failed` | 没取到更早的信 | Couldn't load earlier letters |
| `officer_app.list.more_failed` | 没能加载更多 | Couldn't load more |
| `officer_app.queue.claim_taken` | 已被别人认领 | Someone else claimed it first |
| `officer_app.reassign.hint` | 本殿能审判的官员 · 手上件数少的在前 | Officers here who can judge · fewest cases first |
| `officer_app.rebirth.cross_civ_body` | 跨文明只能在初审定，要在电脑上定。现在批准，就按「不跨」定下来，以后不能再改。 | Cross-civilisation can only be set at first review, on a computer. Approving now sets it to "no" for good. |
| `officer_app.search.no_soul` | 没有编号或姓名对得上的灵魂 | No soul matches this name or number |
| `officer_app.search.placeholder` | 姓名、编号或案号 | Name, number or case number |
| `official_notify.cross_judgment_concluded.body` | 跨域审判「{{title}}」已结案，结论：通过。 | The cross-realm judgment {{title}} has concluded: passed. |
| `official_notify.cross_judgment_concluded.title` | 跨域审判已结案 | Cross-realm judgment concluded |
| `official_notify.cross_judgment_concluded_fail.body` | 跨域审判「{{title}}」已结案，结论：否决。 | The cross-realm judgment {{title}} has concluded: rejected. |
| `official_notify.cross_judgment_concluded_fail.title` | 跨域审判已结案 | Cross-realm judgment concluded |
| `official_notify.judgment_deferred_for_you.body` | {{by}} 暂缓了你手上的案件 {{soul}}。理由：{{reason}} | {{by}} deferred your case of {{soul}}. Reason: {{reason}} |
| `official_notify.judgment_deferred_for_you.title` | 案件已暂缓 | Case deferred |
| `official_notify.judgment_reassigned_away.body` | {{by}} 把你手上的案件 {{soul}} 改派给了 {{to}}。理由：{{reason}} | {{by}} reassigned your case of {{soul}} to {{to}}. Reason: {{reason}} |
| `official_notify.judgment_reassigned_away.title` | 案件已改派 | Case reassigned |
| `official_notify.judgment_released_for_you.body` | {{by}} 替你放回了案件 {{soul}}，它回到了待认领。理由：{{reason}} | {{by}} released your case of {{soul}}; it is unclaimed again. Reason: {{reason}} |
| `official_notify.judgment_released_for_you.title` | 案件已被放回 | Case released |
| `official_notify.judgment_undeferred_for_you.body` | {{by}} 取消了你手上案件 {{soul}} 的暂缓。理由：{{reason}} | {{by}} lifted the deferral on your case of {{soul}}. Reason: {{reason}} |
| `official_notify.judgment_undeferred_for_you.title` | 案件已取消暂缓 | Case no longer deferred |
| `official_notify.scheduled_task_failed.body` | 定时任务「{{task}}」执行失败：{{error}} | Scheduled task {{task}} failed: {{error}} |
| `official_notify.scheduled_task_failed.title` | 定时任务失败 | Scheduled task failed |
| `official_notify.scheduled_task_overdue.body` | 定时任务「{{task}}」应在 {{expected_at}} 运行，至今没有运行记录。 | Scheduled task {{task}} was due at {{expected_at}}; no run has been recorded since. |
| `official_notify.scheduled_task_overdue.title` | 定时任务没有运行 | Scheduled task did not run |
| `official_notify.workflow_assigned.body` | 灵魂「{{soul}}」的审批流「{{workflow}}」轮到你处理。 | The approval flow {{workflow}} of soul {{soul}} is waiting on you. |
| `official_notify.workflow_assigned.title` | 审批待你处理 | Approval waiting on you |
| `official_notify.workflow_node_passed.body` | 灵魂「{{soul}}」的审批流「{{workflow}}」经过「{{node}}」。 | The approval flow {{workflow}} of soul {{soul}} has passed {{node}}. |
| `official_notify.workflow_node_passed.title` | 流程通知 | Approval flow update |
| `official_notify.workflow_timeout_escalated.body` | 灵魂「{{soul}}」的审批流「{{workflow}}」在「{{node}}」已超过 {{hours}} 小时未处理，已转交给你。 | Step {{node}} of the approval flow {{workflow}} of soul {{soul}} has waited over {{hours}} hours and has been passed to you. |
| `official_notify.workflow_timeout_escalated.title` | 审批超时 | Approval overdue |
| `official_notify.workflow_timeout_reminder.body` | 灵魂「{{soul}}」的审批流「{{workflow}}」在「{{node}}」已超过 {{hours}} 小时未处理，请尽快处理。 | Step {{node}} of the approval flow {{workflow}} of soul {{soul}} has waited over {{hours}} hours. Please handle it soon. |
| `official_notify.workflow_timeout_reminder.title` | 审批超时 | Approval overdue |
| `recycle_bin.all_types` | 全部类型 | All types |
| `recycle_bin.no_match` | 没有符合筛选的条目 | Nothing matches these filters |
| `recycle_bin.search` | 搜索名称、删除理由、删除人或原位置 | Search name, reason, deleted by or location |
| `sentence_plan.cross.view` | 查看跨域审判 | View the joint judgment |
| `sentence_plan.filter.awaiting_redispatch` | 待重发的调拨 | Dispatch to resend |
| `sentence_plan.filter.pending_request` | 有待决定的请求 | Request pending |
| `sentence_plan.filter.search` | 搜索灵魂姓名 | Search soul name |
| `sentence_plan.filter.status` | 状态 | Status |
| `sentence_plan.list_empty` | 没有符合条件的受刑计划 | No sentence plans match |
| `sentence_plan.list_subtitle` | 本文明是原属、或有一站在本文明的受刑计划 | Plans this civilization owns or holds a stop of |
| `sentence_plan.list_title` | 受刑计划 | Sentence plans |
| `soul_app.assist.history_more` | 更早的会话 | Older conversations |
| `soul_app.chat.find.circle_error` | 没能读到你的圈子。 | Couldn't load your circle. |
| `soul_app.cooldown.approved_days` | 批准时还剩 {{n}} 天 | {{n}} days left when approved |
| `soul_app.settings.email_code_sent` | 验证码已发到 {{email}} | Code sent to {{email}} |
| `soul_app.settings.email_hint` | 忘记密码时，验证码发到这里。 | Password reset codes are sent here. |
| `soul_app.settings.email_new` | 新邮箱 | New email |
| `soul_app.settings.email_taken` | 这个邮箱已被其他账号使用。 | This email is already used by another account. |
| `soul_mail.email_changed.note` | 以后的验证码发到 {{email}}。如非本人操作，请尽快到本殿。 | Codes now go to {{email}}. If this was not you, come to your hall as soon as you can. |
| `soul_mail.email_changed.text` | 联系邮箱已改。以后的验证码发到 {{email}}。如非本人操作，请尽快到本殿。 | Your contact email was changed. Codes now go to {{email}}. If this was not you, come to your hall as soon as you can. |
| `soul_mail.email_changed.title` | 联系邮箱已改 | Contact email changed |
| `soul_mail.email_code.title` | 联系邮箱验证码 | Contact email code |
| `users.organization` | 所属机构 | Organization |
| `users.organization_column` | 机构 · 职务 | Organization · Position |
| `users.organization_none` | 不属于任何机构 | No organization |
| `users.position` | 职务 | Position |
| `workflow.filter.all` | 全部 | All |
| `workflow.filter.civilization` | 文明 | Civilization |
| `workflow.filter.clear` | 清除筛选 | Clear filters |
| `workflow.filter.from` | 创建日期（起） | Created from |
| `workflow.filter.search` | 搜索流程名、灵魂或案件类型 | Search workflow, soul or case type |
| `workflow.filter.to` | 创建日期（止） | Created to |
