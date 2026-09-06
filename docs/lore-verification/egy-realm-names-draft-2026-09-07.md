# 草案：egy 语言包缺失的 15 个 realm 名 —— 待审

**这是草案，不是已落地的内容。** `packages/core/messages/egy.json` 今天为这 15 个
realm 存的是种子的 `name_egy` 字段（`Ira`、`Tartaros`、`SevenArrwt` 这类拉丁/希腊词），
它们内容真实、无编造，但**与 egy 包其余部分的体例不符** —— 那一部分用的是构造的
埃及语（`Mekher Tepy - Aalu`、`Duat Pet - Sekht`、`Het Ntry`）。

按 `README.md` 的规矩，下表每条都标了**依据类别**。这份目录存在的原因正是
「来源类别被混淆」造成过实际损害（35 个不是判官的名字被当成 42 判官），所以
**推演**与**我编的**必须和**有依据**分开摆，不能混在一张看起来同质的表里。

---

## 一、从既有条目反推出的体例（有依据）

证据是 `packages/core/messages/egy.json` 自己的 11 个欧洲条目：

| realm_code | egy.names | egy.codes |
|---|---|---|
| `EU_HEAVEN` | `Het Ntry - Paradise` | `Het Ntry` |
| `EU_HELL_1ST` … `9TH` | `Mekher <序数> - <罪名>` | `Duat Pet - <罪名>` |
| `EU_PURGATORY` | `Sekht Amenti` | `Sekht Amenti` |

从中可读出两套可复用的词表：

**序数（来自九层地狱，1–9）**

    Tepy(1) Sena(2) Khemet(3) Ftu(4) Diu(5) Sesu(6) Sefekh(7) Khemenu(8) Pesdju(9)

**罪名（来自九层地狱，与但丁的罪名一一对应）**

    Limbo→Aalu   Lust→Sekht   Gluttony→Her   Greed→Aken   Anger→Fekh
    Heresy→Irtu  Violence→Heru  Malebolge→Nehala  Treachery→Seth

炼狱七台的七宗罪里，**有四个能直接复用**：Wrath=Anger→`Fekh`、Gluttony→`Her`、
Lust→`Sekht`、Avarice=Greed→`Aken`。

## 二、逐条草案

### 依据类别图例

- **【推演】** 完全由第一节的既有词表拼出，没有引入任何新词
- **【真词】** 埃及语里本就有这个词，且种子的 `name_egy` 已经用了它
- **【我编的】** 我造的词。**这一类必须由你定夺**，它们没有来源

| realm_code | 建议 names | 建议 codes | 依据 |
|---|---|---|---|
| `EU_PURGATORY_T1_PRIDE` | `Sekht Amenti Tepy - ?` | `Sekht Amenti Tepy` | 序数【推演】· 罪名 **Pride 无既有对应**【我编的】 |
| `EU_PURGATORY_T2_ENVY` | `Sekht Amenti Sena - ?` | `Sekht Amenti Sena` | 序数【推演】· **Envy 无既有对应**【我编的】 |
| `EU_PURGATORY_T3_WRATH` | `Sekht Amenti Khemet - Fekh` | `Sekht Amenti Khemet` | **全【推演】**（Anger→Fekh 已在第 5 层地狱） |
| `EU_PURGATORY_T4_SLOTH` | `Sekht Amenti Ftu - ?` | `Sekht Amenti Ftu` | 序数【推演】· **Sloth 无既有对应**【我编的】 |
| `EU_PURGATORY_T5_AVARICE` | `Sekht Amenti Diu - Aken` | `Sekht Amenti Diu` | **全【推演】**（Greed→Aken 已在第 4 层） |
| `EU_PURGATORY_T6_GLUTTONY` | `Sekht Amenti Sesu - Her` | `Sekht Amenti Sesu` | **全【推演】**（Gluttony→Her 已在第 3 层） |
| `EU_PURGATORY_T7_LUST` | `Sekht Amenti Sefekh - Sekht` | `Sekht Amenti Sefekh` | **全【推演】**（Lust→Sekht 已在第 2 层） |
| `EG_SEVEN_ARRWT` | `Arrwt Sefekh - Seven Gates` | `Arrwt Sefekh` | **【真词】** `arrwt` 是杜阿特门径的埃及语词，种子 `name_egy` 已作 `SevenArrwt`；`Sefekh`=7 来自上表 |
| `EG_TWENTYONE_SEBKHET` | `Sebkhet - Twenty-One Portals` | `Sebkhet` | **【真词】** `sebkhet` 是芦苇原门户的埃及语词，种子已作 `TwentyOneSebkhet` |
| `EU_EARTHLY_PARADISE` | `Sekht Hetep - Earthly Paradise` | `Sekht Hetep` | `Sekht Hetep`（「供奉之野」）是真实埃及语，但**用它译但丁的地上乐园是我的类比**【我编的】 |
| `EU_ACHERON` | `Mekher Rw - Acheron` | `Mekher Rw` | 【我编的】 |
| `GR_ACHERON` | 同上，但**必须与 EU_ACHERON 不同**（两个 realm_code，同一条河，分属两个文明） | | 【我编的】 |
| `GR_TARTARUS` | `Tartaros` | `Tartaros` | **【真词，但不是埃及语】** 直接留希腊语音译 —— 见下方「一个真问题」 |
| `GR_ISLES_OF_THE_BLESSED` | `Aaru - Isles of the Blessed`？ | | 【我编的】，且**可能有害** —— 见下 |

## 三、三个我不建议自己拍板的问题

**1. 希腊领域到底要不要埃及化。** egy 包把欧洲/但丁的地名整套译成了埃及语，
但希腊是**第四个文明，晚于那次翻译**（`ADDENDUM.md:142` 记录希腊是后加的）。
现在没有任何既有希腊条目可参照。两种做法都自洽：全部埃及化（与欧洲一致），
或保留希腊语音译（承认 egy 是一层「埃及视角的转写」，而非全盘替换）。
**我倾向后者**，因为 `Tartaros`/`Acheron` 本身就是转写而非翻译，但这是你的产品决定。

**2. `GR_ISLES_OF_THE_BLESSED` 不能借用 `Aaru`。** 至福岛与芦苇原是**两个文明各自的
善终归宿**，功能对等。但 `Aaru` 在这套系统里是 `EG_AARU` 的名字，两个 realm 共用一个
显示名会让跨文明列表里出现两行同名不同实的条目 —— 这正是 §4.6 显示契约要防的东西。

**3. Pride / Envy / Sloth 三个罪名没有既有对应，我不编。**
九层地狱只覆盖了但丁《地狱篇》的罪，炼狱七台里这三个是新的。要么你给词，
要么这三条保持现在的占位（`Superbia` / `Invidia` / `Acedia`，种子的 `name_egy`，
是拉丁文而非埃及语，但至少是真实存在的词）。

---

## 四、现状（若不改）

三份语言包的 `realms.names` / `realms.codes` 现在都是 43 键、零缺失、零死键，
由 `backend/tests/test_every_realm_has_its_three_names.py` 钉住 —— 其中一条断言
专门防「把键粘贴成值」这种假修复。**所以不改也不会有页面显示 i18n 键**；
未决的只是 egy 那 15 条的**风格一致性**，不是可用性。
