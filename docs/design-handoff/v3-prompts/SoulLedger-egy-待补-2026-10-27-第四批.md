# SoulLedger · egy 待补(2026-10-27 第四批)

第三批已写进语言包,Wer 已从废止名单划掉(2026-10-27 复用，义项：大 / 大写);`officerInvite.body` 采用了你建议的 Nis 写法。
这批是埃及两项新功能的界面文案，共 15 条:
- 入殿前阶段：木乃伊 70 天(案件暂缓)、早夭(不称心，直入芦苇原)、无名者 / 葬仪不当(到不了殿，永久暂缓)。
- 被阿米特吞噬后申诉作废(新状态「已作废」与拒绝原因)。

要求同前：只用词表里已有的词(含刚采用的 Swri / Nis / Wer / Djehuty / Shewet / Browser);确实没有的给新词根建议加暂代版本。占位符 `{{x}}` 原样保留。

回复：在设计系统发布 `egy-fill-2026-10-27-4.json`(只有 `{"键": "egy 文本"}`),并把键加进词表。

| 键 | 中文 | English |
|---|---|---|
| `appeals.status.VOID` | 已作废 | Void |
| `appeals.refusal.soul_devoured` | 灵魂已被阿米特吞噬，不复存在，无从申诉 | This soul was devoured by Ammit and no longer exists; there is no appeal |
| `judgment.duat_stage.EMBALMING` | 木乃伊制作中 | Being embalmed |
| `judgment.duat_stage.EARLY_DEATH` | 早夭 · 直入芦苇原 | Died young · straight to the Field of Reeds |
| `judgment.duat_stage.NAMELESS` | 无名者 · 不入冥界 | Nameless · does not enter the underworld |
| `judgment.duat_stage.IMPROPER_BURIAL` | 葬仪不当 · 旅程未竟 | Improper burial · journey unfinished |
| `judgment.claim.embalming` | 这桩审判候至 {{date}}：木乃伊尚未完成，灵魂还没启程前往两真之殿，到那天才能认领。 | This judgment is held until {{date}}: the embalming isn't finished and the soul hasn't set out for the Hall of Two Truths; it can't be claimed before then. |
| `judgment.claim.duat_unfinished` | 这桩审判不能认领：灵魂到不了两真之殿。 | This judgment can't be claimed: the soul cannot reach the Hall of Two Truths. |
| `judgment.claim.duat_barred_short` | 到不了殿，不能认领 | Can't reach the hall |
| `souls.duat_passage.label` | 入殿前情形 | Before the hall |
| `souls.duat_passage.NONE` | 葬仪如常 | Proper burial |
| `souls.duat_passage.EARLY_DEATH` | 婴儿或早夭 | Infant or early death |
| `souls.duat_passage.NAMELESS` | 无名者 | Nameless |
| `souls.duat_passage.IMPROPER_BURIAL` | 葬仪不当 | Improper burial |
| `souls.duat_passage.help` | 葬仪如常：木乃伊 70 天后灵魂启程前往两真之殿，此前审判不能认领。婴儿或早夭者不受审，直入芦苇原。无名者不入冥界；葬仪不当（身体不全、没有咒语）走不完旅程：这两种审判一直候着。 | Proper burial: after 70 days of embalming the soul sets out for the Hall of Two Truths; the judgment can't be claimed before then. An infant or early death is not judged and goes straight to the Field of Reeds. The nameless do not enter the underworld, and an improper burial (body not intact, no spells) cannot complete the journey: both judgments stay held. |
