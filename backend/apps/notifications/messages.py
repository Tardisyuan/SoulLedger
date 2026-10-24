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
        "cross_sentence_submitted": {"title": "跨域审判节点已填写", "body": "{{tenant}} 已填写灵魂「{{soul}}」受刑计划第 {{order}} 站的处置。"},
        "password_help_requested": {"title": "重设密码求助", "body": "有人在登录页以账号「{{username}}」请求重设密码。核实身份后，请到用户管理为其重置。"},
        "password_help_requested_moderator": {"title": "重设密码求助", "body": "有人在登录页以账号「{{username}}」请求重设密码。核实身份后，请联系管理员为其重置。"},
        "impersonation_started": {"title": "有人在以你的身份查看", "body": "{{by}} 正在以你的身份查看（只读，最长 {{minutes}} 分钟）。理由：{{reason}}。整个过程记进审计日志。"},
        "soul_inbox_assigned": {"title": "来信交给你办", "body": "灵魂「{{soul}}」写给殿司的信已由 {{by}} 交给你办理。"},
        "judgment_reassign_requested": {"title": "请求改派", "body": "{{by}} 请求改派案件 {{soul}}"},
        "judgment_reassign_requested_with_reason": {"title": "请求改派", "body": "{{by}} 请求改派案件 {{soul}}。理由：{{reason}}"},
        "dispatch_proposed": {"title": "收到移交提案", "body": "{{source}} 提议把灵魂「{{soul}}」移交到你殿，等你批准。"},
        "dispatch_approved": {"title": "移交提案已批准", "body": "{{target}} 批准了你殿移交灵魂「{{soul}}」的提案。"},
        "dispatch_rejected": {"title": "移交提案被驳回", "body": "{{target}} 驳回了你殿移交灵魂「{{soul}}」的提案。理由：{{reason}}"},
        "dispatch_rejected_bare": {"title": "移交提案被驳回", "body": "{{target}} 驳回了你殿移交灵魂「{{soul}}」的提案。"},
        "dispatch_cancelled": {"title": "移交提案已被发起方取消", "body": "{{source}} 取消了移交灵魂「{{soul}}」的提案。理由：{{reason}}"},
        "dispatch_return_blocked": {
            "title": "暂居回归被拦下",
            "body": "灵魂「{{soul}}」的暂居回归被未结案审判拦下，共 {{count}} 件；结案或撤案后才能回归。",
        },
        "judgment_reassigned_away": {"title": "案件已改派", "body": "{{by}} 把你手上的案件 {{soul}} 改派给了 {{to}}。理由：{{reason}}"},
        "judgment_released_for_you": {"title": "案件已被放回", "body": "{{by}} 替你放回了案件 {{soul}}，它回到了待认领。理由：{{reason}}"},
        "judgment_deferred_for_you": {"title": "案件已暂缓", "body": "{{by}} 暂缓了你手上的案件 {{soul}}。理由：{{reason}}"},
        "judgment_undeferred_for_you": {"title": "案件已取消暂缓", "body": "{{by}} 取消了你手上案件 {{soul}} 的暂缓。理由：{{reason}}"},
        "officer_handover_received": {"title": "官员交接", "body": "{{by}} 把 {{from}} 手上的事交给了你：审判 {{judgments}} 件、申诉 {{appeals}} 件、城隍 {{city_gods}} 位、书信 {{letters}} 封。"},
        "death_sync_retry_failed": {"title": "死亡登记重试仍失败", "body": "死亡登记 {{reference}} 第 {{count}} 次重试仍失败（{{reason}}），请到死亡同步页查看。"},
        "workflow_assigned": {"title": "审批待你处理", "body": "灵魂「{{soul}}」的审批流「{{workflow}}」轮到你处理。"},
        "workflow_node_passed": {"title": "流程通知", "body": "灵魂「{{soul}}」的审批流「{{workflow}}」经过「{{node}}」。"},
        "workflow_timeout_reminder": {"title": "审批超时", "body": "灵魂「{{soul}}」的审批流「{{workflow}}」在「{{node}}」已超过 {{hours}} 小时未处理，请尽快处理。"},
        "workflow_timeout_escalated": {"title": "审批超时", "body": "灵魂「{{soul}}」的审批流「{{workflow}}」在「{{node}}」已超过 {{hours}} 小时未处理，已转交给你。"},
        "workflow_pick_nodes": {"title": "请为本域选站", "body": "{{soul}} · {{realm}}发起的审批流程，本域排第 {{order}}。轮到本域之前请选好。"},
        "workflow_pick_waiting": {"title": "流程在等本域选站", "body": "{{soul}} · {{realm}}的站已走完，选好本域这一段才能继续。"},
        "workflow_pick_overdue": {"title": "{{realm}}超过 3 天未选站", "body": "{{soul}} · 审批流程停在{{realm}}门口已 {{n}} 天。可以再提醒，或按默认流程走。"},
        "workflow_nodes_adjusted": {"title": "审批流程的站有变动", "body": "{{soul}} · {{by}}:加回 {{added}},跳过 {{skipped}}。理由:{{reason}}"},
        "workflow_pick_withdrawn": {"title": "选站待办已撤回", "body": "跨域审判「{{title}}」已取消,{{soul}}的选站不用再做。"},
        "cross_judgment_concluded": {"title": "跨域审判已结案", "body": "跨域审判「{{title}}」已结案，结论：通过。"},
        "cross_judgment_concluded_fail": {"title": "跨域审判已结案", "body": "跨域审判「{{title}}」已结案，结论：否决。"},
        "cross_judgment_cancelled": {"title": "跨域审判已取消", "body": "跨域审判「{{title}}」已取消。理由：{{reason}}"},
        "scheduled_task_failed": {"title": "定时任务失败", "body": "定时任务「{{task}}」执行失败：{{error}}"},
        "scheduled_task_overdue": {"title": "定时任务没有运行", "body": "定时任务「{{task}}」应在 {{expected_at}} 运行，至今没有运行记录。"},
        "soul_account_provisioning_failed": {"title": "灵魂账号开通失败", "body": "灵魂「{{soul}}」已登记死亡,但灵魂账号没有开成。请运行 {{command}} 补开。"},
        "rebirth_status_under_review": {"title": "转生申请状态更新", "body": "您的转生申请状态:审批中。"},
        "rebirth_status_rejected": {"title": "转生申请状态更新", "body": "您的转生申请状态:已驳回。"},
        "rebirth_status_appealing": {"title": "转生申请状态更新", "body": "您的转生申请状态:申诉中。"},
        "rebirth_status_appeal_rejected": {"title": "转生申请状态更新", "body": "您的转生申请状态:申诉被驳回。"},
        "rebirth_status_approved": {"title": "转生申请状态更新", "body": "您的转生申请状态:已批准。"},
        "cooldown_decided_approved": {"title": "缩短冷却申请有了结果", "body": "您的缩短冷却申请:已批准。"},
        "cooldown_decided_rejected": {"title": "缩短冷却申请有了结果", "body": "您的缩短冷却申请:已驳回。"},
        "assistant_cap_warning": {"title": "助手本月花费已到上限的 80%", "body": "本月估算花费 {{spent}},上限 {{cap}}。到上限时助手会自动关闭;每月 1 日早上 8 点(北京时间)换月。"},
        "assistant_cap_closed": {"title": "助手已自动关闭:本月花费到达上限", "body": "本月估算花费 {{spent}} 已到上限 {{cap}},助手总开关已自动关闭。次月 1 日早上 8 点(北京时间)会自动重开;也可以到「助手管理」页调高上限后手动打开。"},
        "assistant_reopened": {"title": "助手已自动重开:新的一个月", "body": "上个月助手因花费到达上限被自动关闭,本月已自动重开(每月 1 日早上 8 点北京时间换月)。"},
        "city_god_case_received": {"title": "城隍收案待初审", "body": "灵魂「{{soul}}」的案子已交到{{city_god}}，等待初审。"},
        "city_god_case_returned": {"title": "城隍退回补正", "body": "{{city_god}}退回了灵魂「{{soul}}」的案子，需要补正资料。经办：{{by}}。批语：{{reason}}"},
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
        "password_help_requested": {"title": "Password reset help", "body": "Someone on the sign-in page asked for a password reset for account {{username}}. Once you have confirmed who is asking, reset it under User Management."},
        "password_help_requested_moderator": {"title": "Password reset help", "body": "Someone on the sign-in page asked for a password reset for account {{username}}. Once you have confirmed who is asking, ask an administrator to reset it."},
        "impersonation_started": {"title": "Someone is viewing as you", "body": "{{by}} is viewing the console as you (read only, up to {{minutes}} minutes). Reason: {{reason}}. The whole session is recorded in the audit log."},
        "soul_inbox_assigned": {"title": "A letter handed to you", "body": "{{by}} handed you the letter soul {{soul}} wrote to the hall."},
        "judgment_reassign_requested": {"title": "Reassignment requested", "body": "{{by}} asks for the case of {{soul}} to be reassigned"},
        "judgment_reassign_requested_with_reason": {"title": "Reassignment requested", "body": "{{by}} asks for the case of {{soul}} to be reassigned. Reason: {{reason}}"},
        "dispatch_proposed": {"title": "Dispatch proposal received", "body": "{{source}} proposes to send soul {{soul}} to your hall. It awaits your approval."},
        "dispatch_approved": {"title": "Dispatch proposal approved", "body": "{{target}} approved your hall's proposal to send soul {{soul}}."},
        "dispatch_rejected": {"title": "Dispatch proposal rejected", "body": "{{target}} rejected your hall's proposal to send soul {{soul}}. Reason: {{reason}}"},
        "dispatch_rejected_bare": {"title": "Dispatch proposal rejected", "body": "{{target}} rejected your hall's proposal to send soul {{soul}}."},
        "dispatch_cancelled": {"title": "Dispatch proposal cancelled by its sender", "body": "{{source}} cancelled its proposal to send soul {{soul}}. Reason: {{reason}}"},
        "dispatch_return_blocked": {
            "title": "Residence return blocked",
            "body": (
                "Soul {{soul}} cannot return home while judgments stay open ({{count}}). "
                "It returns once they are concluded or withdrawn."
            ),
        },
        "judgment_reassigned_away": {"title": "Case reassigned", "body": "{{by}} reassigned your case of {{soul}} to {{to}}. Reason: {{reason}}"},
        "judgment_released_for_you": {"title": "Case released", "body": "{{by}} released your case of {{soul}}; it is unclaimed again. Reason: {{reason}}"},
        "judgment_deferred_for_you": {"title": "Case deferred", "body": "{{by}} deferred your case of {{soul}}. Reason: {{reason}}"},
        "judgment_undeferred_for_you": {"title": "Case no longer deferred", "body": "{{by}} lifted the deferral on your case of {{soul}}. Reason: {{reason}}"},
        "officer_handover_received": {"title": "Work handed over to you", "body": "{{by}} handed {{from}}'s work to you: {{judgments}} judgments, {{appeals}} appeals, {{city_gods}} city gods, {{letters}} letters."},
        "death_sync_retry_failed": {"title": "Death registration retry failed", "body": "Retry {{count}} of death registration {{reference}} failed again ({{reason}}). See the Death Sync page."},
        "workflow_assigned": {"title": "Approval waiting on you", "body": "The approval flow {{workflow}} of soul {{soul}} is waiting on you."},
        "workflow_node_passed": {"title": "Approval flow update", "body": "The approval flow {{workflow}} of soul {{soul}} has passed {{node}}."},
        "workflow_timeout_reminder": {"title": "Approval overdue", "body": "Step {{node}} of the approval flow {{workflow}} of soul {{soul}} has waited over {{hours}} hours. Please handle it soon."},
        "workflow_timeout_escalated": {"title": "Approval overdue", "body": "Step {{node}} of the approval flow {{workflow}} of soul {{soul}} has waited over {{hours}} hours and has been passed to you."},
        "workflow_pick_nodes": {"title": "Pick this realm's stations", "body": "{{soul}} · approval flow from {{realm}}; this realm is no. {{order}}. Pick before your turn."},
        "workflow_pick_waiting": {"title": "A flow is waiting for this realm to pick", "body": "{{soul}} · {{realm}}'s stations are done; it continues once this realm picks."},
        "workflow_pick_overdue": {"title": "{{realm}} hasn't picked in 3 days", "body": "{{soul}} · the flow has waited at {{realm}} for {{n}} days. Remind again, or go with the default flow."},
        "workflow_nodes_adjusted": {"title": "Stations changed in an approval flow", "body": "{{soul}} · {{by}}: restored {{added}}, skipped {{skipped}}. Reason: {{reason}}"},
        "workflow_pick_withdrawn": {"title": "Pick-stations task withdrawn", "body": "The cross-realm judgment \"{{title}}\" was cancelled; no need to pick stations for {{soul}}."},
        "cross_judgment_concluded": {"title": "Cross-realm judgment concluded", "body": "The cross-realm judgment {{title}} has concluded: passed."},
        "cross_judgment_concluded_fail": {"title": "Cross-realm judgment concluded", "body": "The cross-realm judgment {{title}} has concluded: rejected."},
        "cross_judgment_cancelled": {"title": "Cross-realm judgment cancelled", "body": "The cross-realm judgment {{title}} was cancelled. Reason: {{reason}}"},
        "scheduled_task_failed": {"title": "Scheduled task failed", "body": "Scheduled task {{task}} failed: {{error}}"},
        "scheduled_task_overdue": {"title": "Scheduled task did not run", "body": "Scheduled task {{task}} was due at {{expected_at}}; no run has been recorded since."},
        "soul_account_provisioning_failed": {"title": "Soul account could not be opened", "body": "Soul {{soul}} is registered as dead, but its soul account was not opened. Run {{command}} to open it."},
        "rebirth_status_under_review": {"title": "Rebirth application update", "body": "Your rebirth application is under review."},
        "rebirth_status_rejected": {"title": "Rebirth application update", "body": "Your rebirth application was rejected."},
        "rebirth_status_appealing": {"title": "Rebirth application update", "body": "Your rebirth application is under appeal."},
        "rebirth_status_appeal_rejected": {"title": "Rebirth application update", "body": "The appeal on your rebirth application was rejected."},
        "rebirth_status_approved": {"title": "Rebirth application update", "body": "Your rebirth application was approved."},
        "cooldown_decided_approved": {"title": "Cooldown shortening decided", "body": "Your request to shorten the cooldown was approved."},
        "cooldown_decided_rejected": {"title": "Cooldown shortening decided", "body": "Your request to shorten the cooldown was rejected."},
        "assistant_cap_warning": {"title": "Assistant spend at 80% of this month's cap", "body": "Estimated spend this month is {{spent}} against a cap of {{cap}}. The assistant switches off at the cap; the month rolls over on the 1st at 8:00 Beijing time."},
        "assistant_cap_closed": {"title": "Assistant switched off: monthly cap reached", "body": "Estimated spend this month, {{spent}}, has reached the cap of {{cap}}, and the assistant master switch is off. It switches back on by itself on the 1st at 8:00 Beijing time, or raise the cap on the Assistant admin page and switch it on by hand."},
        "assistant_reopened": {"title": "Assistant switched back on: new month", "body": "The assistant was switched off last month when spend reached the cap. It is back on for the new month (the month rolls over on the 1st at 8:00 Beijing time)."},
        "city_god_case_received": {"title": "New case for first review", "body": "The case of {{soul}} has reached {{city_god}} and is waiting for first review."},
        "city_god_case_returned": {"title": "Case returned for correction", "body": "{{city_god}} returned the case of {{soul}}: the record needs correcting. By {{by}}. Note: {{reason}}"},
    },
    "egy": {
        "password_help_requested": {"title": "Dbh · Wehem Sekhem", "body": "Wa Dbh Wehem Sekhem En Aq «{{username}}» Em Aq. Maa Tepy; Er Khet: Wehem Sekhem Em Iri Remetj."},
        "password_help_requested_moderator": {"title": "Dbh · Wehem Sekhem", "body": "Wa Dbh Wehem Sekhem En Aq «{{username}}» Em Aq. Maa Tepy; Er Khet: Dbh Sab Hery Er Wehem Sekhem."},
        "dispatch_return_blocked": {"title": "Ankh Er Taui Khesef", "body": "{{soul}}: Ankh Er Taui Khesef In Wedja {{count}}. Wedja Pehwy, Ankh Er Taui."},
        "sentence_node_active": {"title": "Sekhet Wetep Tepy", "body": "{{soul}}: Iyi Seth. Sekhet {{order}} Wetep Em {{tenant}}."},
        "sentence_node_done": {"title": "Sekhet Wetep Seth", "body": "{{soul}}: Sekhet {{order}} ({{tenant}}) Wetep Seth."},
        "sentence_node_waiting": {"title": "Hemes Smen", "body": "{{soul}}: Sekhet {{order}} Em {{tenant}} Wetep Seth; Hemes Smen Em Wedja. Wedja Pehwy, Iyi Er Taui Tepy."},
        "sentence_node_refused": {"title": "Sekhet Khesef Seth", "body": "{{tenant}}: Hab Sekhet {{order}} En {{soul}} Khesef Seth. Sekhet Em Smen."},
        "sentence_plan_completed": {"title": "Wetep Neb Seth", "body": "{{soul}}: Sekhet Neb Wetep Seth."},
        "cross_sentence_submitted": {"title": "Sekhet Sesh Seth", "body": "{{tenant}}: Sekhet {{order}} En {{soul}} Sesh Seth."},
        "sentence_plan_amended": {"title": "Wetep Khemen Seth", "body": "{{soul}}: Wetep Khemen Seth Em {{tenant}}."},
        "sentence_request_pending": {"title": "Dbh Wetep Em Smen", "body": "{{tenant}}: Dbh Wetep En {{soul}}. Sab Wedja Tepy Er Wedja."},
        "sentence_request_decided": {"title": "Dbh Wetep Wedja Seth", "body": "{{soul}}: Dbh-Ek Wedja Seth In Sab Wedja Tepy."},
        "sentence_plan_cancelled": {"title": "Wetep Sehen Seth", "body": "{{soul}}: Wetep Sehen Seth. Ky Wetep Nen; Wetep Neb Seth."},
        "soul_inbox_assigned": {"title": "Sesh Hab Er-Ek", "body": "{{soul}}: Sesh Hab In {{by}} Er-Ek."},
        "judgment_reassign_requested": {"title": "Dbh Hab Ky", "body": "{{by}}: Dbh Hab Ky Wedja En {{soul}}"},
        "dispatch_proposed": {"title": "Dbh Hab-Ba Iyi", "body": "{{source}}: Dbh Hab-Ba Ba «{{soul}}» Er Wesekhet-Ek. Er Hesy-Ek."},
        "dispatch_approved": {"title": "Dbh Hab-Ba Hesy Seth", "body": "{{target}}: Hesy Dbh Hab-Ba Ba «{{soul}}» Em Wesekhet-Ek."},
        "dispatch_rejected": {"title": "Dbh Hab-Ba Khesef Seth", "body": "{{target}}: Khesef Dbh Hab-Ba Ba «{{soul}}» Em Wesekhet-Ek. Khet Khesef: {{reason}}"},
        "dispatch_rejected_bare": {"title": "Dbh Hab-Ba Khesef Seth", "body": "{{target}}: Khesef Dbh Hab-Ba Ba «{{soul}}» Em Wesekhet-Ek."},
        "dispatch_cancelled": {"title": "Dbh Hab-Ba Sehen Seth Em Tepy Iri", "body": "{{source}}: Sehen Dbh Hab-Ba Ba «{{soul}}». Khet Sehen: {{reason}}"},
        "impersonation_started": {"title": "Ky Maa Em Ba-Ek", "body": "{{by}} Maa Em Ba-Ek (Maa Wa · At {{minutes}} Er Aa). Khet: {{reason}}. Iri Neb: Sesh Em Medew Maa."},
        "judgment_reassign_requested_with_reason": {"title": "Dbh Hab Ky Seth", "body": "{{by}}: Dbh Hab Ky · Sep {{soul}}. Khet: {{reason}}"},
        "death_sync_retry_failed": {"title": "Sesh Mut: Nen Iri Wehem", "body": "Sesh Mut {{reference}}: Wehem Iri {{count}} · Nen Iri Wehem ({{reason}}). Maa Senb Mut."},
        "cross_judgment_concluded": {"title": "Wedja Ta Ky Khetem Seth", "body": "Wedja Ta Ky «{{title}}» Khetem Seth: Menkh."},
        "cross_judgment_concluded_fail": {"title": "Wedja Ta Ky Khetem Seth", "body": "Wedja Ta Ky «{{title}}» Khetem Seth: Nen Menkh."},
        "judgment_deferred_for_you": {"title": "Sep Sedjer Seth", "body": "{{by}}: Sedjer Sep-Ek {{soul}}. Khet: {{reason}}"},
        "judgment_reassigned_away": {"title": "Sep Hab Ky Seth", "body": "{{by}}: Hab Ky Sep-Ek {{soul}} Er {{to}}. Khet: {{reason}}"},
        "judgment_released_for_you": {"title": "Sep Sehen Shesep Seth", "body": "{{by}}: Sehen Shesep Sep-Ek {{soul}} · Nen Shesep Djer. Khet: {{reason}}"},
        "judgment_undeferred_for_you": {"title": "Sedjer Fekh Seth", "body": "{{by}}: Sedjer Fekh · Sep-Ek {{soul}}. Khet: {{reason}}"},
        "scheduled_task_failed": {"title": "Baku Ahet: Nen Iri", "body": "Baku Ahet «{{task}}»: Nen Iri. {{error}}"},
        "scheduled_task_overdue": {"title": "Baku Ahet: Ahet Sesh, Nen Iri", "body": "Baku Ahet «{{task}}»: Ahet {{expected_at}} Er Iri; Nen Sesh Iri Er Djer"},
        "workflow_assigned": {"title": "Wat Hesy · Er-Ek Emu", "body": "{{soul}} · Wat Hesy «{{workflow}}»: Er-Ek Emu."},
        "workflow_node_passed": {"title": "Sedjem Wat", "body": "{{soul}} · Wat Hesy «{{workflow}}»: Shem Seth «{{node}}»."},
        "workflow_timeout_escalated": {"title": "Wat Hesy: Unut Khetem", "body": "{{soul}} · Wat Hesy «{{workflow}}» · «{{node}}»: Unut {{hours}}, Nen Iri. Hab Er-Ek."},
        "workflow_timeout_reminder": {"title": "Wat Hesy: Unut Khetem", "body": "{{soul}} · Wat Hesy «{{workflow}}» · «{{node}}»: Unut {{hours}}, Nen Iri. Iri Em Khet Seth."},
        "workflow_pick_nodes": {"title": "Setep Sekhet Ta Pen", "body": "{{soul}} · Wat Hesy {{realm}}: Ta Pen Hesb {{order}}. Setep Er Tepy Ta Pen."},
        "workflow_pick_waiting": {"title": "Wat Hesy Em Smen · Ta Pen Setep Sekhet", "body": "{{soul}} · {{realm}}: Shem Seth. Setep Sekhet Ta Pen, Er Khet Shem."},
        "workflow_pick_overdue": {"title": "{{realm}}: Nen Setep Sekhet · Hru 3", "body": "{{soul}} · Wat Hesy Em Smen · {{realm}} · Hru {{n}}. Wehem Sedjem Sab, Er Shem Mi Wat Hesy Tepy."},
        "workflow_nodes_adjusted": {"title": "Wat Hesy: Sekhet Khemen Seth", "body": "{{soul}} · {{by}}: Redi Wehem {{added}} · Iri Tepy {{skipped}}. Khet: {{reason}}"},
        "workflow_pick_withdrawn": {"title": "Setep Sekhet Sehen Seth", "body": "Wedja Ta Ky «{{title}}» Sehen Seth. {{soul}}: Nen Setep Sekhet."},
        "assistant_cap_closed": {"title": "Hehy Medu Khetem Seth: Hesb Abed Er Pehwy", "body": "Hesb Tepy Abed Pen: {{spent}} · Er Pehwy {{cap}}. Wen-Khetem Neb Khetem Seth. Abed Mawy: Hru 1, Unut 8 — Wen Djes-Ef. Er: Khemen Er Pehwy Em Smen Hehy Medu, Wen Em Djeret."},
        "assistant_cap_warning": {"title": "Hehy Medu: Hesb Abed Pen 80% Er Pehwy", "body": "Hesb Tepy Abed Pen: {{spent}} · Er Pehwy {{cap}}. Er Pehwy: Khetem Djes-Ef. Abed Mawy: Hru 1, Unut 8."},
        "assistant_reopened": {"title": "Hehy Medu Wen Wehem Seth: Abed Mawy", "body": "Abed Tepy: Hesb Er Pehwy, Hehy Medu Khetem Djes-Ef. Abed Pen: Wen Wehem Seth (Abed Mawy: Hru 1, Unut 8)."},
        "cooldown_decided_approved": {"title": "Dbh Khebi Ahet Qebeh · Wedja Mawy", "body": "Dbh Khebi Ahet Qebeh-Ek: Hesy Seth."},
        "cooldown_decided_rejected": {"title": "Dbh Khebi Ahet Qebeh · Wedja Mawy", "body": "Dbh Khebi Ahet Qebeh-Ek: Khesef Seth."},
        "cross_judgment_cancelled": {"title": "Wedja Ta Ky Sehen Seth", "body": "Wedja Ta Ky «{{title}}» Sehen Seth. Khet: {{reason}}"},
        "rebirth_status_under_review": {"title": "Dbh Wehem Mesut · Kheperu Mawy", "body": "Dbh Wehem Mesut-Ek: Em Wedja."},
        "rebirth_status_approved": {"title": "Dbh Wehem Mesut · Kheperu Mawy", "body": "Dbh Wehem Mesut-Ek: Hesy Seth."},
        "rebirth_status_rejected": {"title": "Dbh Wehem Mesut · Kheperu Mawy", "body": "Dbh Wehem Mesut-Ek: Khesef Seth."},
        "rebirth_status_appealing": {"title": "Dbh Wehem Mesut · Kheperu Mawy", "body": "Dbh Wehem Mesut-Ek: Em Nehet."},
        "rebirth_status_appeal_rejected": {"title": "Dbh Wehem Mesut · Kheperu Mawy", "body": "Dbh Wehem Mesut-Ek: Nehet Khesef Seth."},
        "soul_account_provisioning_failed": {"title": "Aq Ba Nen Iri", "body": "{{soul}}: Sesh Mut Seth; Aq Ba Nen Iri. Iri {{command}}: Aq Ba Iri."},
        "city_god_case_received": {"title": "Chenghuang: Sep Mawy · Nen Maa Djer", "body": "{{soul}}: Sep Iyi Er {{city_god}} · Nen Maa Djer."},
        "city_god_case_returned": {"title": "Chenghuang Khesef Er Khemen", "body": "{{city_god}}: Sep {{soul}} Khesef Er Khemen. Sab: {{by}}. Khet: {{reason}}"},
    },
}

#: 通知类型 → 文案键。不在这里的类型照存下来的 title / message 原样返回。
KIND_BY_TYPE = {
    "DISPATCH_PROPOSED": "dispatch_proposed",
    "DISPATCH_APPROVED": "dispatch_approved",
    "DISPATCH_REJECTED": "dispatch_rejected",
    "DISPATCH_CANCELLED": "dispatch_cancelled",
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
    "SOUL_INBOX_ASSIGNED": "soul_inbox_assigned",
    "JUDGMENT_REASSIGN_REQUESTED": "judgment_reassign_requested",
    "IMPERSONATION_STARTED": "impersonation_started",
    "DEATH_SYNC_RETRY_FAILED": "death_sync_retry_failed",
    "WORKFLOW_ASSIGNED": "workflow_assigned",
    "JUDGMENT_CONCLUDED": "cross_judgment_concluded",
    "JUDGMENT_CLAIM_CHANGED": "judgment_reassigned_away",
    # 城隍初审:收案(给这位城隍名下的官员,没有就给本殿管理员)与退回补正(给本殿管理员),`apps/judgment/city_gods.py`。
    "CITY_GOD_CASE_RECEIVED": "city_god_case_received",
    "CITY_GOD_CASE_RETURNED": "city_god_case_returned",
}

#: `SYSTEM` 类型没有自己的文案键(它是各种运维消息的兜底类型);发送方把下面之一写进 `params["kind"]`
#: 才按语言渲染,别的 SYSTEM 行照存下来的原文返回。
SYSTEM_KINDS = {
    "scheduled_task_failed", "scheduled_task_overdue", "soul_account_provisioning_failed",
    # 给灵魂的转生申请 / 缩短冷却结果,一种状态一句(`apps/soul_accounts/rebirth.py`)。
    "rebirth_status_under_review", "rebirth_status_rejected", "rebirth_status_appealing",
    "rebirth_status_appeal_rejected", "rebirth_status_approved",
    "cooldown_decided_approved", "cooldown_decided_rejected",
    # 助手花费上限的三种提醒(`apps/soul_assist/usage.py`)。
    "assistant_cap_warning", "assistant_cap_closed", "assistant_reopened",
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
    # 驳回没写理由时用无理由的句子(没有「理由：」后面空着的一行)。
    "dispatch_rejected": {"dispatch_rejected_bare"},
    # 请求改派带了理由(手机端必填)就用带「理由」的句子;网页不带理由,旧通知也没有,仍是原句。
    "judgment_reassign_requested": {"judgment_reassign_requested_with_reason"},
    # 同一个 WORKFLOW_ASSIGNED 还用于知会节点经过、超时提醒 / 转交(`params["category"]` 另管通知类别)。
    # 第四十三批:选站待办、门口等待、逾期、加减站、撤回(apps/workflow/segments.py)也走 WORKFLOW_ASSIGNED。
    "workflow_assigned": {"workflow_node_passed", "workflow_timeout_reminder", "workflow_timeout_escalated",
                          "workflow_pick_nodes", "workflow_pick_waiting", "workflow_pick_overdue",
                          "workflow_nodes_adjusted", "workflow_pick_withdrawn"},
    "cross_judgment_concluded": {"cross_judgment_concluded_fail", "cross_judgment_cancelled"},
    # 替别人做的四件事共用一个类型(JUDGMENT_CLAIM_CHANGED),各自一句(apps/judgment/claims.py::_tell_holder)。
    "judgment_reassigned_away": {"judgment_released_for_you", "judgment_deferred_for_you", "judgment_undeferred_for_you",
                                 # 官员交接(apps/judgment/handover.py):给接手人的一条汇总。
                                 "officer_handover_received"},
}


def kind_for(notification_type, params):
    """The text a stored notification renders with: its type's kind, or the
    variant its `params` name when that variant belongs to that kind."""
    kind = KIND_BY_TYPE.get(notification_type)
    variant = (params or {}).get("kind")
    if notification_type == "SYSTEM":
        return variant if variant in SYSTEM_KINDS else None
    return variant if variant in VARIANTS.get(kind, ()) else kind


#: 文明名,语言包 `souls.civilizations` 的副本(同上,`tests/test_official_notify_messages_match_the_language_packs.py`
#: 钉住逐字一致)。第四十三批的选站通知带 `realm_civ`(CHINESE / EGYPTIAN …),渲染时按语言换掉 `{{realm}}`
#: (「中国发起的审批流程」,同客户端的分段头与门口那句)—— 那里原来填的是租户展示名,库里是英文
#: (「Egyptian Afterlife」),中文句子里直接露出来。认不出文明时仍用 `realm`。
CIVILIZATION_NAMES = {
    "zh-Hans": {"CHINESE": "中国", "EUROPEAN": "欧洲", "EGYPTIAN": "埃及", "GREEK": "希腊"},
    "en": {"CHINESE": "Chinese", "EUROPEAN": "European", "EGYPTIAN": "Egyptian", "GREEK": "Greek"},
    "egy": {"CHINESE": "Sherer", "EUROPEAN": "Europa", "EGYPTIAN": "Kemet", "GREEK": "Haunebut"},
}


def render(locale, kind, params):
    # egy 可以缺 Design 还没给词的种类(`egyPendingKeys.json` 里的 `official_notify.<kind>`):读作 zh-Hans,
    # 与前端「egy 缺键读 zh-Hans」同一条规则。
    entry = MESSAGES[locale].get(kind) or MESSAGES[DEFAULT_LOCALE][kind]
    title, body = entry["title"], entry["body"]
    if params.get("realm_civ"):
        names = CIVILIZATION_NAMES.get(locale, CIVILIZATION_NAMES[DEFAULT_LOCALE])
        params = {**params, "realm": names.get(params["realm_civ"], params.get("realm", ""))}
    # Titles are filled too: `workflow_pick_overdue` (第四十三批) is the first title that names something.
    for name, value in params.items():
        title = title.replace("{{" + name + "}}", str(value))
        body = body.replace("{{" + name + "}}", str(value))
    return title, body


def render_all(notification_type, params):
    """`{locale: {"title", "message"}}` for every locale with copy for this row, or None when the row has no
    kind / params or the params leave a `{{…}}` unfilled (an old row). The WebSocket push uses it: the channel
    group does not know each socket's language, so the client picks its own."""
    kind = kind_for(notification_type, params)
    if not kind or not params:
        return None
    out = {}
    for locale in MESSAGES:
        title, body = render(locale, kind, params)
        if "{{" in title + body:
            return None
        out[locale] = {"title": title, "message": body}
    return out
