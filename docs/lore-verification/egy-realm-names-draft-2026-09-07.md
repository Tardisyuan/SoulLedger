# egy 语言包的 15 个 realm 名 —— 草案已撤回，结论是「保持现状」

**2026-09-07 第一版是一份补名字的草案。两路取证把它的前提推翻了，所以这份文件
改成记录证据与撤回理由。** 撤回的不是某几行拼写，是它赖以推演的整套词表。

留着而不删掉，是因为它记录了一次「看起来有依据的推演，其依据本身没有依据」——
而这个目录的存在理由（`README.md`）正是这一类失误。

---

## 一、撤回的是什么

第一版从 `egy.json` 的 11 个欧洲条目反推出两套词表，并据此为炼狱七台等 15 个
realm 拟名：

    序数  Tepy(1) Sena(2) Khemet(3) Ftu(4) Diu(5) Sesu(6) Sefekh(7) Khemenu(8) Pesdju(9)
    罪名  Limbo→Aalu  Lust→Sekht  Gluttony→Her  Greed→Aken  Anger→Fekh
          Heresy→Irtu  Violence→Heru  Malebolge→Nehala  Treachery→Seth

**读法本身没错**（这九行确与 `en.json` 同位逐行对应），**但把它当成一套词表是错的**：

1. **这九个词没有任何出处。** 全仓 grep：没有一份文档、一条注释、一个提交信息解释过
   其中任何一个。`codes` 行由 `051bf9a`（2026-05-17）引入，那个提交的标题是
   「fix: modal dark mode, pagination, CSS syntax errors, icon issue」；`names` 行由
   `4631214`（2026-08-02）引入。`docs/lore-verification/` 里搜这九个词，**唯一命中的
   是本文件第一版自己** —— 我推出的东西，成了它自己的唯一"来源"。
2. **`Sekht` 在同一份 bundle 里同时是两个不相干的东西。** 实测：

       realms.types.PURGATORY        = 'Sekht Amenti'
       realms.names.EU_PURGATORY     = 'Sekht Amenti'
       workflow.case_types.PURGATORY_REVIEW = 'Smen Sekht Amenti'
       realms.names.EU_HELL_2ND      = 'Mekher Sena - Sekht'    ← 第一版读作 Lust

   而仓库自己的考据 `verify-egyptian.md:302` 给出真实埃及语 `sḫt-iꜣrw` = Field of
   Reeds，**`sḫt` 就是「野/田」**。所以这不只是我读反了 —— **是这份 bundle 自己
   用同一个词指了两样东西**，而其中一样有考据支持、另一样没有。
3. **另外三个词是构造语里的泛用助词。** 全文词频：`Seth` 340 次、`Tepy` 76 次、
   `Her` 56 次（`Her Tepy`、`Em Tepy` = 上一个）。`Heru` 同时是荷鲁斯的别名
   （`actors_egyptian.py:199`）。`Aalu / Aken / Fekh / Nehala` 各只出现 2 次，
   仅在那两行地狱里，无任何旁证。序数里 Sena/Ftu/Diu/Sesu/Sefekh/Khemenu/Pesdju
   各只出现 1 次。

**在一套无来源、且至少有一处误读的词表上再生成 15 个名字，是把一次未署名的发明
乘以十五。**

## 二、仓库明文禁止这件事

`docs/lore-verification/README.md:46-49` —— 而且它比我引用的更直接，**点名了
「三宗罪」**：

> **Do not complete these lists.** Filling in the "missing" four evils, three
> virtues, or three sins is the one repair that is certainly wrong. Nothing is
> missing. The lists were attached to the wrong structure, and completing them
> only yields a more convincing forgery.

「Nothing is missing」这句尤其要紧：我把 Pride/Envy/Sloth 当成"缺口"来填，而这份
README 的意思是**它们本来就不该在那张表上**。这个目录记着 35 个不是判官的名字被当成
42 判官的教训，成因正是同一种"补全"冲动。

## 三、三个问题现在都有答案，都不需要你拍板

### 问题一：希腊领域要不要整体埃及化 → **不要，而且现状已经是对的**

我第一版写「现在没有任何既有希腊条目可参照」。**这句是错的。** egy 包里有 7 处手写的
希腊条目，而且它们揭示的规矩是**按层级分的**：

| 层级 | 做法 | 实例 |
|---|---|---|
| 文明标签 | **埃及化** | `home.civilizations.GREEK` = `Duat en Yunan`；短标签 = `Haunebut`；`ledger.civ.GREEK` = `Renpet Wehem` |
| 专名（人、地） | **保留原语转写** | 希腊：`home.civ_desc.GREEK` = `Khemet Wedja, Sesh Er, Mu Lethe` —— 普通名词埃及化（`Khemet`=三、`Mu`=水），而 **`Er` 与 `Lethe` 原样保留**。欧洲同条：`home.civ_desc.EUROPEAN` = `Wedja Meseh, Duat Sekhem, Duat en Dante, Itru Lethe` —— **`Dante` 也原样保留** |

第二行不是希腊特例，这一点是这次取证里最关键的：**欧洲的描述里 `Dante` 同样没有被
埃及化**。所以"专名保留"是这份 bundle 一以贯之的做法，不是希腊碰巧没做。

后端 `name_egy` 列印证同一条：它对**任何非埃及文明都不做埃及化**。欧洲演员是
`Kerberos` / `Mino` / `Satan`，欧洲领域是 `Limbo` / `Superbia` / `Lust`，
希腊是 `Tartaros` / `Aiakos` / `Kharon`。四个文明一以贯之。

所以 `Tartaros` / `Acheron` / `IslesOfTheBlest` **不是占位，是符合既定做法的正确值**。
`ebc2c06` 的提交信息把它们叫"占位"，那是当时的判断，现在收回。

> 顺带澄清：`GR_HADES` 不在任何语言包的 `realms.*` 里，这是对的 —— 它是**租户码**
> 不是 realm code。第一版把它列进"缺失"清单是错的。

### 问题二：`GR_ISLES_OF_THE_BLESSED` 不能借 `Aaru` → **不借就行，问题自解**

第一版提出这条，是因为它自己打算给至福岛安一个埃及名，而唯一现成的"善终归宿"埃及词
就是 `Aaru`。既然问题一的结论是希腊专名保留，就没有人会去借 `Aaru`：现值
`IslesOfTheBlest` 与 `EG_AARU` 的 `Aaru` 天然不同名。

**这条不需要方案，它是上一个错误的派生物。** 记在这里是为了说明：一个"待解决的问题"
可能整个来自一个不该做的决定 —— 撤销那个决定，问题一起消失。

### 问题三：Pride / Envy / Sloth → **参照已查全，答案是"没有"，且不必造**

42 判官的告白（`actors_egyptian.py:279-452`，与 `42-assessors.md` 同源）逐条查过：

- **每一条的"罪"都只有英文转述**，埃及语只存在于判官的**名字**。入库时
  `seeding.py:362` 把 `name_egy` 设为判官名，不是罪名。
- **Pride**：3 条近义告白，全是英文（#37 raising the voice haughtily、#39 insolence、
  #40 seeking distinctions for oneself）
- **Envy**：0 条。全 42 条 grep envy/jealous/covet 零命中
- **Sloth**：0 条

其余埃及语料同样没有：`statutes_egyptian.py` 只有两个指针常量、无文本；
`docs/03_七宗罪与地狱惩罚.md` 全篇但丁与格里高利、零埃及概念；
`docs/02_奥西里斯审判详解.md:190-208` 自己声明 v1.0 的分类与示例条文是伪造的。

egy 包里唯一有真实埃及形态的"过失"词是 `Isfet`（`egy.json:727,885`），泛指，
不对应任何具体罪。

**所以三个罪名保持现状的拉丁文** `Superbia` / `Invidia` / `Acedia`。它们不是凑数：
那是但丁传统自己的词，且与后端 `name_egy` 对全部欧洲领域的做法（`Limbo`、`Lust`、
`Superbia`）完全一致。

## 四、这轮真正查出来的一条问题（未处置）

**`EU_HELL_1ST` … `9TH` 在 egy 包里的那九个埃及化名字，是全仓唯一一处"给非埃及专名
造埃及名"的地方，而它没有出处。** 它同时与三样东西冲突：

- 与同一份 bundle 里 `Er` / `Lethe` 保留原名的做法冲突
- 与后端 `name_egy` 对欧洲领域一律给 `Limbo` / `Superbia` 的做法冲突
- 因此**同一个领域经两条渠道到屏幕上会是两种风格**：语言包渠道
  （`app/realms/page.tsx:161`）给 `Mekher Tepy - Aalu`，后端渠道
  （`realms/models.py:107` 按 `Accept-Language` 选 `name_egy`）给 `Limbo`

这个分歧**早于本轮**，不是这次改出来的。要不要统一（把那九行也改回原名，或反过来）
是一个真问题，但它属于欧洲不属于希腊，且会动到已在线的显示值 —— 单独提出，
**本轮不动**。

## 五、现状（不改的后果）

三份语言包的 `realms.names` / `realms.codes` 都是 43 键、零缺失、零死键，由
`backend/tests/test_every_realm_has_its_three_names.py` 钉住（其中一条专防"把键
粘贴成值"的假修复）。**没有任何页面会显示 i18n 键。** 撤回这份草案不产生任何回退。
