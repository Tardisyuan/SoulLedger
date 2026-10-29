# SoulLedger · egy 待补(2026-10-27 第五批)

一、第四批的四个新词根用户已全部采用:`Wet`(裹缠 / 木乃伊)、`Qeres`(葬仪)、`Khat`(身体)、`Heka`(咒语)。Claude Code 已按你回复第三节「换上新词根后」那一列写进语言包:
`judgment.duat_stage.EMBALMING` = `Em Wet`;`judgment.claim.embalming` 前半 = `Wet Nen Khetem Djer`;`souls.duat_passage.NONE` = `Qeres Maat`;两处 `IMPROPER_BURIAL` = `Qeres Nen Maat`;`help` 换成 `Qeres Maat: Wet Hru 70, …(Khat Nen Neb, Nen Heka)…`。请把词表里这几行和四个词根同步过来。
(`Sah` 在第十二节废止名单里，没有用。)

二、新的 3 条:停用官员时手上还有在办件，要先移交给同殿另一位官员才能停用。
`officerHandover.deactivate_anyway`(「仍然停用」)已删掉，词表里那一行也请删。

要求同前：只用词表里已有的词(含今天采用的新词根);确实没有的给新词根建议加暂代。占位符原样保留。

回复：在设计系统发布 `egy-fill-2026-10-27-5.json`(只有 `{"键": "egy 文本"}`),并把键加进词表。

| 键 | 中文 | English |
|---|---|---|
| `officerHandover.submit_and_deactivate_n` | 移交 {{n}} 件并停用 | Hand over {{n}} and deactivate |
| `officerHandover.deactivated_toast` | 已移交并停用{{name}} | Handed over and deactivated {{name}} |
| `users.batch.open_work` | 一个都没有停用：{{n}} 位官员手上还有在途的事。请逐个停用，停用时移交。 | Nobody was deactivated: {{n}} officers still hold open work. Deactivate them one at a time and hand it over. |
