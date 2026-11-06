# SoulLedger · Design v4 · 第十一批 · 进代码后的第二批补遗(2026-11-06)

回复写到 `v4-batch11-reply.md`,三种语言写到 `v4-batch11-zh.json` / `v4-batch11-en.json` / `v4-batch11-egy.json`(扁平 `键: 值`),第 3 条的稿子用 `V4Batch11.dc.html`,都发布到同一目录。第九、十批如果还没回,和这一批分开回。第七、八批已定的文字不动,除非下面点名。

v4 的官员端(队列、审判台、「不过」理由面板、判决文书、官员 App 滑卡审判)已经进代码。这一批是进代码时冒出来、只有你能定的事。

## 1. 中文「待定」一词两用

第七批把「暂缓 / 延后」统一叫「待定」(放进待定、待定分组)。但仓库里裁决 `PURGATORY`(欧洲炼狱、天平摇摆这类「不过也不不过」的判)的中文本来就叫「待定」。现在同一个词指两件事:

| 键 | 中文 | 英文 | egy |
|---|---|---|---|
| `judgment.verdicts.purgatory` | 待定 | Purgatory | Nen Smen Djer |
| `souls.detail.verdict_purgatory` | 待定 | Purgatory | Nen Smen Djer |
| `judgment.claim.groups.deferred` | 待定 | Deferred | Sedjer |
| `officer_app.queue.deferred` | 待定 | Deferred | Sedjer |
| `officer_app.case.defer` | 待定 | Move to Deferred | Sedjer |
| `soul_app.timeline.pending` | 待定 | Pending | Nen Wedja Djer |

审判台上现在临时写「放进待定」来和裁决区分。请定:裁决 `PURGATORY` 改叫什么(欧洲可以叫「炼狱」,但它四文明共用,埃及天平摇摆也是它),或者「放进待定」那一组改叫什么。三种语言都给,并把要改的键列全(仓库里还有带「待定」二字的句子,你搜一遍)。灵魂端时间线的 `pending`「待定」是另一个意思(还没判),看要不要一起改。

## 2. 官员 App 两句已过时的 egy

官员 App 原来不能结案,现在加了「滑卡审判」。中文和英文已改,egy 还是旧意思(「宣判与盖印在官员台」),请重写:

| 键 | 中文(新) | 英文(新) | egy(旧) |
|---|---|---|---|
| `officer_app.queue.scope_note` | 手机上可以认领、查看、写评议,并在「滑卡审判」里结案。自选去处与引用条文请在官员台。 | On the phone you can claim, read, comment, and conclude in Swipe to judge. Choosing a destination and citing articles are done at the desk. | Em Medjat Ba: Shesep, Maa Hena Sesh Wesheb. Djed Wedja Hena Khetem: Em Medjat Sab. |
| `officer_app.queue.desk_only` | 待宣判 · 可在「滑卡审判」里结案 | Ready for verdict · conclude it in Swipe to judge | Nen Djed Wedja Djer · Em Medjat Sab |

## 3. 希腊判「通过」时选文书(新屏,补稿)

后端要求希腊的案子判「通过」和「不过」都先选文书(《高尔吉亚》或《理想国》)。第七批只画了「不过」那一侧(先选文书、再选理由、再选可医 / 不可医)。「通过」这一侧现在是我们自己补的:网页在盖印确认层第 1 步只列两套文书;官员 App 右滑后弹一个只问这一件事的底页。请补这两处的稿子(网页 + App,深浅各一),和一句说明为什么要选。

## 4. egy 待补(14 个)

中文和英文已有,egy 空着(先回退中文)。请按词表规矩补齐,新词根单列。

| 键 | 中文 | 英文 |
|---|---|---|
| `judgment.claim.refused.defer_reason_required` | 写一句理由，才能放进待定 | Write a reason to move it to Deferred |
| `judgment.fail_reason_errors.curability_required` | 加上标记：可医或不可医。 | Add the mark: curable or incurable. |
| `judgment.fail_reason_errors.fail_reason_contradicts_record` | 灵魂的登记里没有这一项，判语不能这样写。 | The soul's record does not say this, so the verdict cannot say it. |
| `judgment.fail_reason_errors.fail_reason_invalid` | 这个理由不是本殿这一判能给的，请重新选。 | That reason is not one this hall's verdict can give. Choose again. |
| `judgment.fail_reason_errors.fail_reason_not_failed` | 理由和可医标记只随「不过」一起落印。 | Reasons and the curability mark go with a Fail verdict only. |
| `judgment.fail_reason_errors.fail_reason_not_selectable` | 理由由天平列出，不能另选。 | The scale lists the reasons; none can be chosen. |
| `judgment.fail_reason_errors.fail_reason_note_required` | 选了「其他」，要写一句。 | “Other” needs one line. |
| `judgment.fail_reason_errors.fail_reason_note_too_long` | 这一句不能超过 500 字。 | The line can be at most 500 characters. |
| `judgment.fail_reason_errors.fail_reason_required` | 选一个理由，才算判完。 | Choose a reason to finish the judgment. |
| `judgment.fail_reason_errors.greek_account_required` | 先选这一判写在哪一篇：《高尔吉亚》或《理想国》。 | Choose the account the verdict is written in: Gorgias or Republic. |
| `judgment.fail_reason_errors.greek_mark_not_applicable` | 只有希腊的案子才选文书和可医标记。 | Only a Greek case takes an account or a curability mark. |
| `judgment.fail_reason_errors.incurable_is_eternal_in_tartarus` | 不可医者永罚于塔尔塔罗斯，不能另选去处或写年数。 | The incurable are cast into Tartarus for ever; no other destination or term. |
| `judgment.greek_account_label` | 这一判写在哪一篇 | The account this verdict is written in |
| `officer_app.queue.open_swipe` | 滑卡审判 | Swipe to judge |
## 规矩

一律按 v4;冲突写在回复里;每条回复带编号。
