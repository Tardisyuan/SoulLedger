# SoulLedger · egy 待补(2026-10-27 第二批)

上一批(57 条 + 孟婆汤 + 相册)已写进语言包和你的词表，谢谢。这批是之后新加的界面文案，共 33 条。

要求同前：只用词表里已有的词;确实没有的，给新词根建议并标明，同时给一个用现有词的暂代版本。占位符 `{{x}}` 原样保留。
新词根 Swri(饮)/ Nis(召唤)/ Wer(大)仍未采用，继续用暂代词(饮 → Shesep 等)。

回复：写进设计系统(发布)即可，Claude Code 会直接去读;格式是一个 JSON 对象 `{"键": "egy 文案", …}`,放在回复文件里，并把这些键加进词表。

| 键 | 中文 | English |
|---|---|---|
| `reincarnation.error.plan_in_progress` | {{name}}的受刑计划还没走完，不能转世。 | {{name}}'s sentence plan is not finished; no rebirth yet. |
| `reincarnation.error.eternal_sentence` | {{name}}受的是永久刑期，没有下一世。 | {{name}} serves an eternal sentence; there is no next life. |
| `reincarnation.error.rebirth_not_approved` | {{name}}的转生申请被驳回或还在审批中，不能转世。 | {{name}}'s rebirth application was rejected or is still under review; no rebirth. |
| `case.attachments.print_failed` | 附件清单读取失败,本页未列出附件;请回到屏幕上重试后再打印。 | The attachment list could not be loaded, so none are listed here. Retry on screen, then print again. |
| `soul_app.update_required.open_failed` | 没能打开应用商店。请在应用商店里搜索更新,或在浏览器里打开:{{url}} | Could not open the store. Search for the update in the store, or open this link in a browser: {{url}} |
| `soul_app.settings.row_load_failed` | 加载失败 | Could not load |
| `appeals.refusal.no_appeal_above_minos` | 米诺斯的判决是终裁，其上无可申诉 | Minos's judgment is final; there is no one above him to appeal to |
| `souls.events.PURGATORY_ASCENDED` | 出炼狱，升天堂 | Rose from purgatory to heaven |
| `souls.detail.rebirth_suggestion` | 第十殿按结案时的功过建议：{{form}} | Suggested by the tenth court from the merit and demerit at conclusion: {{form}} |
| `souls.detail.rebirth_pick_form` | 功过为负而未至地狱道，第十殿不作建议：请选择一道 | Negative merit, but not low enough for the hell path: the tenth court gives no suggestion. Choose a path. |
| `judgment.weighing.title` | 称心 | Weighing of the heart |
| `judgment.weighing.scale` | 心重 {{weight}} · 羽重 {{counterweight}} | Heart {{weight}} · feather {{counterweight}} |
| `judgment.weighing.gives` | 天平所给：{{verdict}} | The scale gives: {{verdict}} |
| `judgment.weighing.wavering_hint` | 「待定」「重审」= 天平摇摆：托特记下，另开一次称量，不发落。 | Pending or Retry = the scale wavers: Thoth records it and the heart is weighed again; no destination. |
| `judgment.weighing.contradicts` | 与天平不符 | Contradicts the scale |
| `judgment.weighing.result.LIGHTER` | 未重于羽 | Not heavier than the feather |
| `judgment.weighing.result.HEAVIER` | 重于羽 | Heavier than the feather |
| `judgment.weighing.result.WAVERING` | 天平摇摆 · 再称 | The scale wavers · weighed again |
| `judgment.weighing.recorded` | 托特所记：{{result}}（心重 {{weight}}） | Recorded by Thoth: {{result}} (heart {{weight}}) |
| `judgment.weighing.workflow_forced` | 埃及案必走称心流程：流程走完才能执行。 | An Egyptian case always runs the weighing flow; execution waits for it to finish. |
| `judgment.weighing.errors.verdict_contradicts_weighing` | 裁决与天平不符：心不重于羽只能判通过，重于羽只能判不通过。 | The verdict contradicts the scale: a heart not heavier than the feather passes, a heavier one fails. |
| `judgment.weighing.errors.wavering_has_no_destination` | 天平摇摆时不发落：清空发落再结案，会另开一次称量。 | A wavering scale sends the soul nowhere: clear the placement; a new weighing is opened. |
| `judgment.weighing.errors.wavering_with_open_cross` | 这件案子挂着未结的联审，先结联审再重称。 | A cross-realm judgment is open on this case; conclude it before weighing again. |
| `judgment.placement.errors.term_not_applicable` | 埃及的去处不服刑：芦苇原与第二死都没有刑期。 | Egyptian outcomes take no term: neither the Field of Reeds nor the second death is served. |
| `judgment.weighing.errors.weighing_in_progress` | 称心流程还没走完：托特、神庭、荷鲁斯、奥西里斯（或阿米特）走完之后才执行。 | The weighing flow is still running: execution waits for Thoth, the tribunal, Horus and Osiris (or Ammit). |
| `judgment.weighing.errors.weighing_rejected` | 称心流程被驳回：这件案子要重开或申诉，不能直接执行。 | A station refused the weighing flow: reopen or appeal the case; it cannot be executed. |
| `judgment.weighing.errors.weighing_wavers` | 天平摇摆的旧处置不执行：另开一次称量。 | A disposition parked by a wavering scale is not executed: open a new weighing. |
| `appeals.escalate` | 上诉 | Escalate |
| `appeals.escalate_title` | 上诉至申诉流程 | Escalate to the appeal court |
| `appeals.escalate_body` | 上一次复核维持了原判。上诉后由本文明的申诉流程逐站复核：任一站驳回即维持原判，走完由终审作出结论。流程审理中不能撤回，这一次也算一次申诉。 | The last review upheld the verdict. Escalated, the appeal goes station by station through this realm's appeal court: any station that rejects it upholds the verdict, and if it passes every station the final judge decides. It can't be withdrawn while the court hears it, and it counts as one appeal. |
| `appeals.ladder` | 申诉流程 · {{name}} | Appeal court · {{name}} |
| `appeals.refusal.not_escalatable` | 上一次复核维持原判之后才能上诉 | You can escalate only after a review has upheld the verdict |
| `appeals.error.ladder_running` | 这份申诉在申诉流程里，流程走完前不能认领或作结论 | This appeal is before the appeal court; it can't be claimed or decided until the court is done |
