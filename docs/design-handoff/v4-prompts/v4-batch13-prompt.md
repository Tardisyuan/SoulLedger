# SoulLedger · Design v4 · 第十三批 · 「去处计划」剩下的正文(2026-11-07)

回复写到 `v4-batch13-reply.md`,三种语言写到 `v4-batch13-zh.json` / `v4-batch13-en.json` / `v4-batch13-egy.json`(扁平 `键: 值`),放在同一目录。第七至十二批已定的文字不动,除非下面点名。

第九、十二批都已落进代码:计划层底键已是中性的「去处计划」,地府原词在 `<键>_by_civ.cn`;灵魂层按 `<键>_by_civ.<文明>.<类型>`(类型:HELL 受罚 / PURGATORY 涤罪 / BLISS 福地;希腊按《理想国》判的另有 `gr_republic`)。代码查找次序:`_by_civ.<文明>.<类型>` → `_by_civ.<文明>` → 底键。

剩下的是你上一批没给词、而正文里仍写着「受刑…」的键。请照第十二批的分层规则补齐。需要时用 `_by_civ` 键,不需要分文明的直接给新的中性底键。不要改键名。

## 1. 官员通知正文 `official_notify.*.body`(计划层,9 条)

`sentence_node_active`、`sentence_node_done`、`sentence_node_refused`、`sentence_node_not_dispatched`、`cross_sentence_submitted`、`sentence_plan_amended`、`sentence_request_pending`、`sentence_request_decided`、`sentence_plan_cancelled`。现在的三语见文末附录。上一批只给了 `sentence_plan_completed.body`。

## 2. 灵魂推送 `soul_push.*`(灵魂层,按文明 × 类型)

- `sentence_completed`:只有 cn.BLISS / gr.BLISS / gr_republic.BLISS 有词。欧洲炼狱、埃及各类、各文明地狱现在读底键「受刑已全部服完」。
- `sentence_waiting`:**title 完全没有 `title_by_civ`**,福地里也显示「一站刑满，暂留原地」。body 只有 cn.BLISS / gr.BLISS / eu.PURGATORY 有词。
- `sentence_pardoned`:只有 eu.PURGATORY 有词。

## 3. 计划层其他键(没有 `_by_civ`)

`sentence_plan.plan_label`、`accept_title`、`reject_title`、`cancel_title`、`cancelled`、`inbox_title`、`inbox_show_all`、`cross.title`、`amend.title`、`list_title`、`list_subtitle`、`list_empty`;`officer_app.todo.group_sentence_change`、`events.groups.punishment`、`soul_app.errors.sentence_in_progress`、`disposition.release_warning`、`appeals.amend_impact`、`appeals.error.plan_busy`。
另有一条不在语言包里:管理员的建议问题「全部待处理的受刑请求有几件？」/ "How many sentence requests are pending in all?",请一并给三语。
`demo.tour.cn.5.*`、`demo.tour.target.soul_plan` 是地府专用的演示导览,如果你认为原词合适,回复里说一声即可。

## 4. 要你定的

灵魂层底键有意保留「受刑」,因为受罚那一层读的就是底键。但 `soul_app.sentence.all_done_title`、`blocked_title`、`blocked_link` 在欧洲天国、埃及芦苇原(BLISS)仍读底键。要不要给 `eu.BLISS` / `eg.BLISS` 补词?

## 附录:扫描结果(键 · 现在的三语)

    souls.dedication.body	[]
      zh: 阳间亲属为这个灵魂做的法事，由官员代登。只计功德；只对审判中、受刑中的灵魂有效。
      en: A rite the soul's living relatives held for it, entered by an officer. Counts as merit only; only for souls being judged or serving a sentence.
      egy: Iri Em Ankh Er Ba Pen; Sab Sesh. Nefer Wa · Ba Em Wedja Er Em Shepet Wa.
    souls.dedication.not_eligible	[]
      zh: 只能登给审判中或受刑中的灵魂。{{name}}现在是「{{state}}」。
      en: Only for souls being judged or serving a sentence. {{name}} is {{state}} now.
      egy: Ba Em Wedja Er Em Shepet Wa. {{name}}: {{state}}.
    souls.diyu_station_desc.EIGHTEEN_HELLS	[]
      zh: 民间相传的受刑之所（与十殿并行的另一种说法）。
      en: Where punishment happens in the popular telling (a rival account to the ten courts).
      egy: None
    disposition.release_warning	[]
      zh: 记下期满，灵魂离开这一站：受刑计划还有下一站就去下一站，没有就等候转生（或终局）。不可撤销。
      en: Records the term as served and the soul leaves this stop: to the next stop of its sentence plan, or, if none is left, to await rebirth (or its final rest). This can't be undone.
      egy: Sesh Shepet Khetem; Ba Per Em Sekhet Pen: Er Sekhet Khery Em Wetep; Nen Sekhet Ky: Em Smen Wehem Mesut (Er Pehwy). Nen Sehen.
    soul_app.errors.sentence_in_progress	[]
      zh: 受刑计划尚未完成（刑期未满也算），完成后才能申请转生
      en: Your sentence plan is not finished (a term not yet served counts). You can apply once it is complete
      egy: Wetep-Ek Nen Neb Seth — Hena Shepet Nen Khetem Djer. Dbh Wehem Mesut Er Khet Wetep Neb
    soul_app.sentence.section_title	[cn,eg,eu,gr,gr_republic]
      zh: 我的受刑
      en: My sentence
      egy: Shepet-I
    soul_app.sentence.state.active	[cn,eg,eu,gr,gr_republic]
      zh: 受刑中
      en: Serving
      egy: Em Shepet
    soul_app.sentence.all_done_title	[cn,gr,gr_republic]
      zh: 受刑已全部服完
      en: Your sentence is fully served
      egy: Shepet Wetep-Neb Seth
    soul_app.sentence.blocked_title	[cn,gr,gr_republic]
      zh: 受刑尚未服完
      en: Your sentence is not yet served
      egy: Shepet Nen Khetem Djer
    soul_app.sentence.blocked_link	[cn,gr,gr_republic]
      zh: 看我的受刑
      en: See my sentence
      egy: Maa Shepet-I
    soul_app.assist.delete_body	[]
      zh: 从{{screen}}开始的这段会话会立即从你这里消失，不能恢复。它不影响你的申请、受刑或任何记录。
      en: This conversation, started on {{screen}}, disappears from here at once and cannot be brought back. It does not touch your applications, your sentence or any record.
      egy: Medew Pen Em {{screen}}: Fekh Emu; Nen Ankh Wehem. Nen Khemen Dbh, Shepet Er Sesh Neb.
    soul_app.help.a_disposition	[]
      zh: 审判结案之后，对你去向的安排：例如去哪里受刑、往哪一道投生。
      en: What is decided for you once a judgment is concluded: where you serve a sentence, or which path you are reborn into.
      egy: Er Khet Wedja Khetem: Wat-Ek — Shepet Em Ta Ky, Er Wehem Mesut Em Wat Ky.
    soul_push.sentence_completed.title	[cn,gr,gr_republic]
      zh: 受刑已全部服完
      en: Sentence fully served
      egy: Shepet Wetep-Neb Seth
    soul_push.sentence_completed.body	[cn,gr,gr_republic]
      zh: 你的受刑已全部服完，打开灵魂簿查看。
      en: Your sentence is fully served. Open Soul Ledger to see it.
      egy: Shepet-Ek Wetep-Neb Seth. Wen Medjat Ba Er Maa.
    official_notify.sentence_node_active.body	[]
      zh: 灵魂「{{soul}}」已到达，受刑计划第 {{order}} 站在 {{tenant}} 开始执行。
      en: Soul {{soul}} has arrived. Stop {{order}} of its sentence plan begins in {{tenant}}.
      egy: {{soul}}: Iyi Seth. Sekhet {{order}} Wetep Em {{tenant}}.
    official_notify.sentence_node_done.body	[]
      zh: 灵魂「{{soul}}」受刑计划第 {{order}} 站（{{tenant}}）已结束。
      en: Stop {{order}} ({{tenant}}) of the sentence plan of soul {{soul}} has ended.
      egy: {{soul}}: Sekhet {{order}} ({{tenant}}) Wetep Seth.
    official_notify.sentence_node_refused.body	[]
      zh: {{tenant}} 拒绝了灵魂「{{soul}}」受刑计划第 {{order}} 站的调拨，该节点已退回待执行。
      en: {{tenant}} refused the transfer for stop {{order}} of the sentence plan of soul {{soul}}. The stop is pending again.
      egy: {{tenant}}: Hab Sekhet {{order}} En {{soul}} Khesef Seth. Sekhet Em Smen.
    official_notify.sentence_node_not_dispatched.body	[]
      zh: 灵魂「{{soul}}」受刑计划第 {{order}} 站（{{tenant}}）没能发起调拨，该节点仍待执行，请处理后重新发起。
      en: The transfer for stop {{order}} ({{tenant}}) of the sentence plan of soul {{soul}} could not be started. The stop is still pending; sort out the cause and start it again.
      egy: {{soul}}: Sekhet {{order}} ({{tenant}}) · Hab-Ba Nen Tepy. Sekhet Em Smen Djer; Iri Khet, Er Khet Wehem Tepy.
    official_notify.cross_sentence_submitted.body	[]
      zh: {{tenant}} 已填写灵魂「{{soul}}」受刑计划第 {{order}} 站的处置。
      en: {{tenant}} has submitted stop {{order}} of the sentence plan of soul {{soul}}.
      egy: {{tenant}}: Sekhet {{order}} En {{soul}} Sesh Seth.
    official_notify.sentence_plan_amended.body	[]
      zh: 灵魂「{{soul}}」的受刑计划已变更，涉及 {{tenant}}。
      en: The sentence plan of soul {{soul}} has changed, involving {{tenant}}.
      egy: {{soul}}: Wetep Khemen Seth Em {{tenant}}.
    official_notify.sentence_request_pending.body	[]
      zh: {{tenant}} 就灵魂「{{soul}}」的受刑计划提出了请求，等待原判官决定。
      en: {{tenant}} has filed a request on the sentence plan of soul {{soul}}. It awaits the original judge.
      egy: {{tenant}}: Dbh Wetep En {{soul}}. Sab Wedja Tepy Er Wedja.
    official_notify.sentence_request_decided.body	[]
      zh: 你就灵魂「{{soul}}」受刑计划提出的请求已由原判官决定，打开查看。
      en: The original judge has decided your request on the sentence plan of soul {{soul}}. Open it to see.
      egy: {{soul}}: Dbh-Ek Wedja Seth In Sab Wedja Tepy.
    official_notify.sentence_plan_cancelled.body	[]
      zh: 灵魂「{{soul}}」的受刑计划已撤销，剩余刑期免除，按计划完成处理。
      en: The sentence plan of soul {{soul}} was cancelled. The rest of the sentence is waived and the plan counts as complete.
      egy: {{soul}}: Wetep Sehen Seth. Ky Wetep Nen; Wetep Neb Seth.
    sentence_plan.plan_label	[]
      zh: 第 {{cycle}} 轮受刑计划
      en: Sentence plan, cycle {{cycle}}
      egy: Wetep Sep {{cycle}}
    sentence_plan.node_states.ACTIVE	[]
      zh: 受刑中
      en: Serving
      egy: Em Shepet
    sentence_plan.accept_title	[]
      zh: 批准「{{soul}}」的受刑计划请求
      en: Accept the request on the sentence plan of {{soul}}
      egy: Sesen Dbh Wetep En {{soul}}
    sentence_plan.reject_title	[]
      zh: 驳回「{{soul}}」的受刑计划请求
      en: Reject the request on the sentence plan of {{soul}}
      egy: Khesef Dbh Wetep En {{soul}}
    sentence_plan.cancel_title	[]
      zh: 撤销「{{soul}}」的受刑计划
      en: Cancel the sentence plan of {{soul}}
      egy: Sehen Wetep En {{soul}}
    sentence_plan.cancelled	[]
      zh: 受刑计划已撤销
      en: Sentence plan cancelled
      egy: Wetep Sehen Seth
    sentence_plan.inbox_title	[]
      zh: 受刑请求
      en: Sentence requests
      egy: Dbh Wetep
    sentence_plan.inbox_show_all	[]
      zh: 查看全部受刑请求
      en: All sentence requests
      egy: Dbh Wetep Neb
    sentence_plan.cross.title	[]
      zh: 受刑计划各站
      en: Sentence plan stops
      egy: Sekhet Wetep
    sentence_plan.amend.title	[]
      zh: 结案时对受刑计划的改动
      en: Changes to the sentence plan
      egy: Khemen Wetep
    sentence_plan.list_title	[]
      zh: 受刑计划
      en: Sentence plans
      egy: Shepet
    sentence_plan.list_subtitle	[]
      zh: 本文明是原属、或有一站在本文明的受刑计划
      en: Plans this civilization owns or holds a stop of
      egy: Shepet: Per Tepy Er Sekhet Em Taui Pen
    sentence_plan.list_empty	[]
      zh: 没有符合条件的受刑计划
      en: No sentence plans match
      egy: Nen Shepet Em Setep Pen
    officer_app.todo.group_sentence_change	[]
      zh: 受刑计划变更
      en: Punishment plan changes
      egy: Dbh Khemen Shepet
    events.groups.punishment	[]
      zh: 受刑计划
      en: Punishment plans
      egy: Sesh Wetep
    appeals.amend_impact	[]
      zh: 改判后，受刑计划里还没执行的站改按新裁决；已经执行的每一站，给灵魂记一笔补偿功德。
      en: After the change, stations not yet served follow the new verdict; each station already served earns the soul one compensation merit.
      egy: Er Khet Khemen: Sekhet Nen Iri Djer → Mi Wedja Mawy. Sekhet Iri Seth Neb: Nefer Wa Er Ba.
    appeals.error.plan_busy	[]
      zh: 受刑计划正在重审、永久挂起，或有请求等原判官决定，现在不能改判。
      en: The sentence plan is being retried, held indefinitely, or has a request awaiting the original judge; it can't be changed now.
      egy: Shepet Nen Khemen Emu: Wedja Wehem, Sedjer, Er Dbh Em Smen Sab Wedja Tepy.
    demo.tour.cn.5.name	[]
      zh: 发落受刑
      en: Sentence
      egy: Sekhet Wetep
    demo.tour.cn.5.body	[]
      zh: 处置排成受刑计划，一站服完才到下一站。
      en: The disposition becomes a sentence plan, served stop by stop.
      egy: Wetep Em Sekhet Wetep: Sekhet Wa Khetem, Er Khet Sekhet Ky.
    demo.tour.target.soul_plan	[]
      zh: 灵魂详情 · 受刑计划
      en: Soul · sentence plan
      egy: Ba · Sekhet Wetep
