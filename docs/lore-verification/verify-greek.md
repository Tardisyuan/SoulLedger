# 希腊罗马冥界数据核实报告

范围：SoulLedger 仓库 `EU_HEAVEN_HELL` 租户中的**希腊罗马侧**数据。基督教/但丁侧由其他代理负责，本报告只在两套体系交叉处提及。
方法：只读。未修改仓库任何文件。
日期：2026-08-14

**总体结论先说**：埃及「四十二判官」那种**凭空编造人名**的问题，在希腊侧**不存在**——入库的 7 个希腊罗马条目全部是真实的古典人物/河流。问题全部是另一类：**位置错**、**出处混**、**把柏拉图/维吉尔/但丁三套不同体系当成一套**。共查出 12 处硬伤 + 1 个结构性缺口。

---

## 一、当前入库数据清单

### 1.1 Realm（`seed_mythology.py` `EUROPEAN_REALMS`，共 11 个）

| realm_code | 名称 | 出处 |
|---|---|---|
| EU_HEAVEN | 天堂 | 基督教 |
| EU_PURGATORY | 炼狱 | 但丁《炼狱篇》 |
| EU_HELL_1ST … EU_HELL_9TH | 地狱九层（Limbo/Lust/Gluttony/Greed/Anger/Heresy/Violence/Malebolge/Treachery） | 但丁《地狱篇》 |

**希腊地理（Tartarus / Elysium / Asphodel / 五条河）一个 realm 都没有。** 全部 11 个 realm 的 `memory_reset` 都写成 `"LETHE"`（含天堂和地狱九层）。

### 1.2 希腊罗马 Actor（`seed_mythology.py:304-350`）

| name | 中文名 | role | realm_code | 库中描述 |
|---|---|---|---|---|
| Charon | 卡戎 | CONDUIT | **EU_PURGATORY** | "Ferryman of the River **Styx**" |
| Minos | 米诺斯 | JUDGE | **EU_HELL_9TH** | "judge in the ninth circle, **assigns souls to their hell-circle**" |
| Cerberus | 刻耳柏洛斯 | GUARDIAN | **EU_HELL_1ST** | "Three-headed guardian… prevents living entry and dead exit" |
| Hades | 哈迪斯 | OVERSEER | **EU_HELL_1ST** | "sole overseer of the Greco-Roman infernal realm" |
| Aeacus | 艾亚哥斯 | JUDGE | **EU_HELL_9TH** | "holds the keys of the underworld, judges the souls of Europe" |
| Rhadamanthus | 拉达曼提斯 | JUDGE | **EU_HELL_9TH** | "brother of Minos, judges the souls of Asia" |
| Lethe | 忘川 | CONDUIT | **EU_PURGATORY** | "souls drink to **forget their past lives**" |

同租户的基督教侧：God(OVERSEER/EU_HEAVEN)、Michael(JUDGE)、Gabriel(CONDUIT)、Satan(JUDGE/**EU_HELL_9TH**)。

### 1.3 其他入库/配置点

- `consolidate_eu_pantheon.py:92-99` `GRECO_ROMAN_EXPECTED`：只审 **role**，**完全不审 realm**——所以上表所有位置错误都能通过审计。
- `consolidate_eu_pantheon.py:261-267`：对 Lethe 只打印一行「Purgatory placement matches Dante's Purgatorio」，不改。
- `backend/tests/test_seed_mythology.py:112-123`：测试锁死的也只有 name→role，没有 realm 断言。
- `frontend/src/config/workflow-templates.ts:129-140` `EUROPEAN_GREEK`「希腊冥界流程」：**Minos 初审 → Aeacus 复核 → Rhadamanthus 终审**。
- `docs/04_希腊冥界详解.md`：地理、五河、三判官表、审判流程图。
- `fix_actor_civilization.py:46-47`：Pluto、Lethe 从 CHINESE 改判 EUROPEAN（历史修复）。
- `SPEC.md:44` 仍写 European actors 为「St. Peter、Hades、Satan」，`SPEC.md:1786` 写「St. Peter, Hades, Satan, Michael, Lucifer」——与实际 seed 不符（St. Peter / Lucifer 根本没入库）。

---

## 二、逐项核实

### 2.1 三位审判者：Minos / Aeacus / Rhadamanthus

**出处确认：柏拉图《高尔吉亚篇》524a**（不是 523e；523e 是宙斯宣布改革的铺垫，具体分工在 524a）。Perseus 上的 W.R.M. Lamb 译文（Loeb，公版）原文：

> 判决在「the meadow at the dividing of the road, whence are the two ways leading, one to the Isles of the Blest, and the other to Tartarus」进行；「those who come from Asia shall Rhadamanthus try, and those from Europe, Aeacus; and to Minos I will give the privilege of the final decision」（如另两人有疑义时）。
> 来源：https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0178:text%3DGorg.:page%3D524 （一手文献公版英译）

所以项目里 Aeacus=欧洲、Rhadamanthus=亚洲、Minos=终裁，**这三条分工是对的，且确实出自柏拉图**。

**但「三判官」不是希腊通说，而基本上是柏拉图的版本。** 各家差异极大：

| 作者 | Minos | Rhadamanthus | Aeacus |
|---|---|---|---|
| 荷马《奥德赛》11.568-571 | 唯一的审判者：「Minos, the glorious son of Zeus, golden sceptre in hand, giving judgment to the dead」（在 Hades 的宽门大屋里）。注意荷马这里是 θεμιστεύειν——给亡灵**裁断/立法**，学界对「是审判生前罪行还是仲裁亡灵纠纷」有分歧 | 不是判官。《奥德赛》4.563-565 说他**住在极乐原**：「to the Elysian plain… where dwells fair-haired Rhadamanthus」 | 不出现 |
| 赫西俄德 | — | — | — |
| 品达《奥林匹亚颂》2 | 不提 | 是**克罗诺斯的辅弼**、至福岛上的裁断者：「according to the righteous counsels of Rhadamanthys」，「the great father keeps him close beside him as his partner」 | 不是判官 |
| 柏拉图《高尔吉亚篇》524a | 终裁 | 审亚洲 | 审欧洲 |
| 维吉尔《埃涅阿斯纪》6 | 6.426-433：「Wise Minos there the urn of justice moves, / And holds assembly of the silent shades, / Hearing the stories of their lives and deeds」——而且位置在**冤死者/夭折者那一区**，不是最底层 | 6.566：「Cretan Rhadamanth / His kingdom keeps, and from unpitying throne / Chastises and lays bare the secret sins」——他**统治并惩罚塔尔塔罗斯**，不是分流官 | **完全不出现** |

来源：
- Od. 11.568-571 https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0136:book=11:card=567 （一手，Murray/Loeb 公版）
- Od. 4.563-565 https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0136:book=4:card=561 （同上）
- Pindar Ol. 2 https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0162:book=O.:poem=2 （一手公版英译）
- Aen. 6.426-433 https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=426 （一手，T.C. Williams 公版）
- Aen. 6.548-579 https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=548 （同上）
- Aeacus 生平/持钥匙：https://en.wikipedia.org/wiki/Aeacus （百科；其所引一手为 Plato *Gorg.* 524a、Isocrates *Evagoras* 15、图像学的「持权杖与冥府钥匙」引 Pindar *Isthm.* 7.47 与 Apollodorus 3.12.6）

**判定**：
- 库里 Aeacus 描述「holds the keys of the underworld, judges the souls of Europe」——两半都有据（钥匙是图像学传统，欧洲是柏拉图）。✅
- 库里 Rhadamanthus「brother of Minos, judges the souls of Asia」——✅（兄弟关系见荷马《伊利亚特》14.321-322 欧罗巴为宙斯生 Minos 与 Rhadamanthys；本次未逐字取证该行，标为未验证）。
- 前端工作流 **Minos 初审 → Rhadamanthus 终审 = 把柏拉图整个倒过来了**。柏拉图里 Minos 才是终裁者。❌
- `docs/04` 判官表写 Minos「管辖：普通亡灵」——**无出处**。柏拉图是「另两人有疑义时的终裁」，荷马是「唯一裁断者」，都不是「普通亡灵」这一档。❌
- `docs/04` 写 Aeacus「埃勾斯之父」——**事实错误**。Aeacus 是宙斯与仙女 Aegina 之子，其子为 Peleus、Telamon、Phocus，是**阿基琉斯的祖父**（《奥德赛》11.538 称阿基琉斯为「the son of Aeacus」即 Aeacides）。Aegeus（埃勾斯）是 Pandion 之子、忒修斯之父，与 Aeacus 毫无关系。❌

### 2.2 **三判官挂 `EU_HELL_9TH` 是否成立 —— 不成立**

两套体系被硬缝在一起，而且**对两边都错**：

**对柏拉图错**：柏拉图的审判发生在「岔路口的草地」（meadow at the dividing of the road），一边通至福岛、一边通塔尔塔罗斯——这是**分流点/入口**，在惩罚之前。希腊冥界根本没有「第九层」这个概念（分层的是但丁）。

**对但丁错**：
- 但丁自己的 Minos 站在**第二圈入口**（《地狱篇》V.4-15，Longfellow 公版译文：「Thus I descended out of the first circle / Down to the second… There standeth Minos horribly, and snarls; / Examines the transgressions at the entrance; / Judges, and sends according as he girds him」，用尾巴缠几圈就下第几层）。
- **Aeacus 和 Rhadamanthus 在《神曲》里根本不作为冥界判官出现**——但丁只借了 Minos 一个。
- 但丁的第九圈是 Cocytus 冰湖 + Judecca + 路西法，人物是叛徒。项目自己把 **Satan 也放在 EU_HELL_9TH**——于是第九圈同时住着但丁的撒旦和三个希腊判官。

**内部还自相矛盾**：seed 里 Minos 的描述是「judge in the **ninth circle**, **assigns souls to their hell-circle**」。「给灵魂分配所属圈层」正是但丁笔下 Minos 在**第二圈入口**干的事；一个负责分配圈层的判官不可能坐在最底那一圈。这一行等于把「但丁的职能」和「错误的位置」写在同一个字符串里。

来源：
- Dante *Inferno* III / V / VI，Longfellow 英译（公版）https://www.gutenberg.org/files/1001/1001-h/1001-h.htm （一手作品的公版译本）

### 2.3 Hades / Pluto —— 合并对，理由不够准确

**结论：把 Pluto 与 Hades 合并成一行是对的**（同一位神），**但代码里写的理由「Pluto 是 Hades 的罗马名」是简化失真的**。

查证要点（来源：https://en.wikipedia.org/wiki/Pluto_(mythology) 百科，但其引证链清楚，一手锚点见下）：

1. **Πλούτων（Plouton）本身是希腊名，不是拉丁名。** 荷马、赫西俄德等古风期文献里没有 Plouton 这个名字；它从公元前 5 世纪起随**厄琉息斯秘仪**流行，词根是 πλοῦτος（财富）。
2. **一手锚点**：柏拉图《克拉底鲁篇》403a——人们怕「Hades」（被解作 ἀειδής「不可见者」）这个名字，所以改称 Plouton，因为财富自地下涌出。来源：https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0172:text%3DCrat.:section%3D403a （一手公版英译）
3. **真正的罗马本土冥神是 Dis Pater 和 Orcus**；Pluto 只是把希腊 Plouton 拉丁化。西塞罗把 Dis（Dives「富有者」）等同于希腊的 Plouton。所以「Pluto=罗马名」这句话，准确说法是：**Pluto 是希腊崇拜称号 Plouton 的拉丁转写，罗马本土对应词是 Dis Pater / Orcus**。
4. **两个名字的「性格」有别但不是两位神**。Kevin Clinton 的图像学分析：Plouton 常作持谷穗的成熟男性（丰饶/财富面向），Hades 强调幽暗；公元前 5 世纪起「Hades」越来越多地指**地点**而非神。百科原话：「Pluto and Hades differ in character, but they are not distinct figures」。→ 合并成一行不算错，但严格说是把**同一神的两个崇拜面向**折叠了。
5. **Plutus（Ploutos，财神）的混淆**是真实且古老的：Ploutos 是德墨忒尔与 Iasion 之子（赫西俄德《神谱》969-974），与 Plouton 名字近似；厄琉息斯有把 Ploutos 当作「神童诞生地」的 ploutonion。学界（Burkert、Farnell 等）认为这不是单纯口误，而是「地下=财富=丰饶」的神学关联。**本项目无风险**：Plutus 从未入库。

**建议**（不实施）：`consolidate_eu_pantheon.py:357` 的 soft-delete reason 和 `seed_mythology.py:331-334` 的注释，把「Pluto is Hades' Roman name」改成更准确的一句，例如「Plouton 是 Hades 的希腊崇拜称号，Pluto 为其拉丁转写；罗马本土对应为 Dis Pater/Orcus」。

**顺带**：Hades 的 realm 被设成 `EU_HELL_1ST`（但丁的 Limbo，善良异教徒区）。这在两套体系里都无据——但丁的地狱没有「哈迪斯统治」这一层，但丁笔下的 Dis（狄斯）指的是**狄斯之城**（第六圈城墙，《地狱篇》VIII-IX）和路西法本人。

### 2.4 Charon（卡戎）—— 渡哪条河：Styx 是罗马/通俗说法，希腊与但丁都是 Acheron

- **荷马里根本没有卡戎**（《伊利亚特》《奥德赛》均不出现）。最早的文本痕迹是残篇史诗《Minyas》（约公元前 6 世纪）。
- **希腊文献 → Acheron / 阿刻戎湖**：欧里庇得斯《阿尔刻斯提斯》252-256（Perseus 英译）：「I see the two-oared boat in **the lake**. **Charon, the ferryman of the dead**, his hand on the boat-pole, calls me now: 'Why are you tarrying?'」——用的是「湖」（λίμνη，即阿刻戎湖）。百科归纳：Pindar、Aeschylus、Euripides、Plato、Callimachus、Pausanias 都把卡戎放在 Acheron。
- **罗马诗人 → Styx**：Propertius、Ovid、Statius 用 Styx，很可能是跟着维吉尔走的。
- **维吉尔两条都用**：《埃涅阿斯纪》6.295-297「Hence the way leads to that Tartarean stream / Of **Acheron**, whose torrent fierce and foul / Disgorges in **Cocytus** all its sands」，而渡过的水又被称作 **Stygian**（6.323 起，众神以之起誓）。所以维吉尔本人就是 Acheron/Styx 混用的源头。
- **但丁明确是 Acheron**：《地狱篇》III「To thee, upon the dismal shore of **Acheron**」。

来源：
- Eur. *Alc.* 252-256 https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0088:card=252 （一手公版英译）
- Verg. *Aen.* 6.295-330 https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=295 （一手公版英译）
- 综述 https://en.wikipedia.org/wiki/Charon （百科，含 Styx/Acheron 分歧的作者归属）

**判定**：
- 角色 CONDUIT ✅。
- 库中 title「Ferryman of **Styx**」是罗马/通俗版本，**与本仓库自己的 `docs/04` 流程图（入口写 Acheron）直接冲突**，也与但丁冲突。❌（不算「假」，但既然同租户共用但丁 realm，写 Acheron 才自洽。）
- **realm=EU_PURGATORY 更成问题**：希腊的卡戎在冥界入口，但丁的卡戎在**地狱门口的 Acheron**（《地狱篇》III）。但丁的炼狱确实有渡船，但船夫是**天使舵手**（《炼狱篇》II），不是卡戎。所以卡戎挂炼狱两边都不成立。❌
- 术语：`docs/04` 多处（第 19、126、149 行）用「**喀戎**」称 Charon。中文惯例里「喀戎」是马人**喀戎（Chiron, Χείρων）**，卡戎（Charon）是另一位。seed 用「卡戎」是对的，文档与 seed 不一致。❌

### 2.5 Cerberus（刻耳柏洛斯）—— GUARDIAN 对，头数分歧真实存在

- **赫西俄德《神谱》311-312（最早）：五十个头**。Evelyn-White 公版英译：「the brazen-voiced hound of Hades, **fifty-headed**, relentless and strong」，为 Typhaon 与 Echidna 之子，与 Orthus、勒拿九头蛇同胞。来源：https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0130:card=306 （一手公版英译）
- **阿波罗多洛斯《书库》2.5.12：三个狗头 + 龙尾 + 背上各种蛇头**，位置在**冥府之门 / 阿刻戎之门**（赫拉克勒斯第十二功）。来源：https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0022:text%3DLibrary:book%3D2:chapter%3D5:section%3D12 （一手公版英译）
- **维吉尔**：三喉（tergeminus / 三张嘴）。
- **但丁《地狱篇》VI**：「Cerberus, monster cruel and uncouth, / With his **three gullets** like a dog is barking / Over the people that are there submerged」——**第三圈，看守饕餮者**。
- 「三头是通行说法」✅；「赫西俄德说五十头」✅（本次已逐字取证）。另有「品达说一百头」的说法在二手文献中常见，**本次未取证，不采信**。

**判定**：
- 「Three-headed」✅（阿波罗多洛斯/维吉尔/但丁），但项目文本把它当唯一说法，赫西俄德的五十头未见于任何文档。
- 「prevents living entry and dead exit」——「进得去出不来」通常引《神谱》769-773（对进者摇尾、对想出去者吞噬）。**本次多次尝试未能取到该段原文，标为未验证**；这是二手转述中极常见的一句，谨慎起见不当作已证。
- **realm=EU_HELL_1ST（Limbo）**：希腊传统是**冥府大门**，但丁明确是**第三圈**。两边都不是第一圈。❌（唯一勉强的辩护：第一圈是过了 Acheron 之后的第一站，位置上最接近「门」。）

### 2.6 希腊冥界地理 —— 缺口是真实的

各处逐一（注明作者，不合成「标准版」）：

| 地点 | 是什么 | 出处（本次取证情况） |
|---|---|---|
| **Tartarus 塔尔塔罗斯** | 赫西俄德：囚禁提坦的深渊，离地面之远与天离地相等（《神谱》720ff，**本次未取证原文**）。维吉尔：三重墙 + 火河 Phlegethon + Tisiphone 守门 + Rhadamanthus 统治与刑罚（Aen. 6.548-579，**已取证**） | Aen. 6 card=548（一手公版） |
| **Elysium 极乐原** | 荷马：不是死后奖赏而是**特定人物免死的去处**——普罗透斯预言墨涅拉俄斯将被送往「the Elysian plain and the bounds of the earth… where dwells fair-haired Rhadamanthus, and where life is easiest for men」，无雪无雨，西风吹拂（Od. 4.563-568，**已取证**）。品达：至福岛，需连续三世（两边各三次）不行不义者方得入，Rhadamanthys 在克罗诺斯身旁裁断（Ol. 2，**已取证**） | 见上 |
| **Asphodel Meadows 常春花草原** | 荷马：阿基琉斯的魂「departed with long strides over the **field of asphodel**」（Od. 11.538-540，**已取证**）。**注意：荷马并没有说这是「中庸之人的专区」**——阿基琉斯这样的英雄也走在上面。「Tartarus/Asphodel/Elysium 三分」是后世（尤其现代教科书）的系统化 | Od. 11 card=538（一手公版）；https://en.wikipedia.org/wiki/Asphodel_Meadows （百科，自陈「其与冥界其他区域的关系仍不确定」） |
| **Styx 斯提克斯** | 赫西俄德：俄刻阿诺斯长女、诸神起誓之河（《神谱》775-806，**本次未取证原文**）。维吉尔：Stygian palus，众神畏其誓 | Aen. 6 card=295（一手公版） |
| **Acheron 阿刻戎** | 痛苦之河/冥界入口之水，卡戎渡口；维吉尔：其激流把泥沙倾入 Cocytus | 同上 |
| **Cocytus 科库托斯** | 哀哭之河；维吉尔：Acheron 注入之。但丁把 Cocytus 改造成**第九圈的冰湖** | 同上 + Dante *Inf.* XXXII-XXXIV |
| **Phlegethon 火河** | 维吉尔：「Infernal Phlegethon, which whirls along / Loud-thundering rocks」，绕塔尔塔罗斯 | Aen. 6 card=548 |
| **Lethe 忘川** | 见下节 | |

（荷马《奥德赛》10.513-514 Circe 指路时列出 Pyriphlegethon、Cocytus（Styx 的支流）与 Acheron——Perseus 该 card 本次多次 503，**未取证**。）

**缺口判定：是真实缺口。** 11 个 EU realm 全是但丁的。结果是：
- 三位希腊判官**无处可判**——柏拉图给他们的分流终点（至福岛 / 塔尔塔罗斯）在系统里不存在；
- 前端「希腊冥界流程」（Minos→Aeacus→Rhadamanthus）走完之后，灵魂只能落进**但丁的九圈**；
- 卡戎、忘川作为「河」被建成 Actor（CONDUIT）而不是地点，因为系统里没有可以承载河流的 realm。

**但是要小心**：不要照抄「三分法」建三个 realm 就当成希腊「标准版」——荷马、赫西俄德、品达、柏拉图、维吉尔的地理各不相同（荷马无道德分流，柏拉图是二分岔路，维吉尔才有比较完整的分区）。建 realm 的话应当明确标注「按哪位作者」。

### 2.7 Lethe 的归属 —— realm 是但丁的，描述是维吉尔的

**但丁确实把 Lethe 放在炼狱山顶。** 《炼狱篇》XXVIII 地上乐园：Matelda 解释两条水——**Lethe 洗去罪的记忆**，**Eunoe 恢复善行的记忆**；并说古代诗人在帕纳索斯山上歌咏黄金时代时，「Dreamed of this place perhaps upon Parnassus」（XXVIII 结尾，维吉尔与斯塔提乌斯相视而笑）。所以 **realm=EU_PURGATORY 在但丁框架内是对的**，`consolidate_eu_pantheon.py:266` 那句注释没说错。

**但这里恰恰藏着两套体系的混合**：

1. **但丁的 Lethe ≠ 希腊/维吉尔的 Lethe**。维吉尔《埃涅阿斯纪》6.703ff：忘川边聚集着无数将要**再次投胎**的魂，饮水以忘（「forever flowed / The river Lethe, through its land of calm. / Nations unnumbered roved and haunted there」，安基塞斯解释他们注定轮回）。但丁的炼狱**没有轮回**，他的 Lethe 只抹去**罪的记忆**。
2. 而项目 Lethe 那一行的描述写的是 **"souls drink to forget their past lives"**——**这是维吉尔的忘川（轮回前饮忘），不是但丁的**。于是同一行：**realm 取但丁，语义取维吉尔**。❌
3. **Eunoe 完全缺失**。Eunoe 是**但丁自创**（古典神话中无此河）；只搬 Lethe 不搬 Eunoe，等于取了但丁地上乐园的一半。
4. Lethe 被登记为 `civilization=EUROPEAN` 的 **Actor（CONDUIT，「忘川河神」）**，与 Charon 并列在同一 realm。作为神格化河流可以辩护（古典中 Lethe 亦有人格化传统），但它在但丁那里是**地点**不是**人物**。
5. **全部 11 个 EU realm 的 `memory_reset` 都是 `"LETHE"`**——包括天堂和地狱九层。但丁的地狱里没有人喝忘川水（罪人恰恰要永远记得），天堂更不是。这是 schema 层面的一刀切。❌

来源：
- Dante *Purg.* XXVIII（Lethe/Eunoe/Parnassus）：https://en.wikipedia.org/wiki/Matelda 及 https://ahc.leeds.ac.uk/discover-dante/doc/purgatorio/page/5 （大学教学页面/百科，二手；Eunoe 为但丁自创、Lethe 只忘罪这两点在两处一致）
- Verg. *Aen.* 6.703ff：https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=703 （一手公版英译）

---

## 三、希腊与但丁两套体系被混在一起的地方（重点汇总）

| # | 位置 | 混合内容 | 严重度 |
|---|---|---|---|
| 1 | `seed_mythology.py:320,340,344` | **Minos/Aeacus/Rhadamanthus 全挂 EU_HELL_9TH**。柏拉图的判官坐在岔路口，但丁的 Minos 在第二圈入口，Aeacus/Rhadamanthus 在《神曲》里不存在。第九圈是但丁的叛徒冰湖 + 路西法（项目里 Satan 也在这一层） | **高** |
| 2 | `seed_mythology.py:322` | Minos 描述自相矛盾：「ninth circle」+「assigns souls to their hell-circle」（后者是但丁第二圈入口的职能） | 高 |
| 3 | `workflow-templates.ts:135-137` | Minos 初审 / Rhadamanthus 终审，**把柏拉图的终裁者降为初审** | 高 |
| 4 | `seed_mythology.py:317-319` | Charon 挂 **EU_PURGATORY**；但丁的卡戎在地狱门口的 Acheron，炼狱的船夫是天使 | 高 |
| 5 | `seed_mythology.py:318-319` | Charon「Ferryman of **Styx**」——罗马/通俗版，与本仓库 `docs/04` 图示的 Acheron、与但丁的 Acheron 都冲突 | 中 |
| 6 | `seed_mythology.py:323` | Cerberus 挂 **EU_HELL_1ST**；但丁在第三圈，希腊在冥府大门 | 中 |
| 7 | `seed_mythology.py:337` | Hades 挂 **EU_HELL_1ST（Limbo）**；但丁的地狱无「哈迪斯统治层」，Dis 指狄斯之城/路西法 | 中 |
| 8 | `seed_mythology.py:347-349` | Lethe：**realm 取但丁（炼狱山顶），描述取维吉尔（轮回前饮忘）**；且缺 Eunoe | 中 |
| 9 | `EUROPEAN_REALMS` 全部 11 行 | `memory_reset="LETHE"` 一刀切，天堂与地狱九层都「喝忘川」 | 中 |
| 10 | `consolidate_eu_pantheon.py:92-99` / `test_seed_mythology.py:112-123` | 审计与测试**只锁 role 不锁 realm**——上面 1、4、6、7 全部能过审。这正是「验证机制静默失效」的又一例 | **高（结构性）** |

---

## 四、Pluto/Hades 合并判断是否正确

**结论：合并本身正确，理由文本需要修正。**

- ✅ 同一位神，不该有两个 OVERSEER 行。合并后保留 Hades 也合理（希腊本名、系统其余希腊人物都用希腊名）。
- ⚠️ 「Pluto 是 Hades 的罗马名」不准确：**Πλούτων 是希腊崇拜称号**（前 5 世纪起随厄琉息斯秘仪流行，古风期文献无此名），Pluto 只是它的拉丁转写；**罗马本土冥神名是 Dis Pater 与 Orcus**。
- ⚠️ 严格说，Hades 与 Plouton 是同一神的**两种面向**（幽暗掠夺者 vs 丰饶赐富者），古人对此有意识（柏拉图《克拉底鲁篇》403a 的委婉语解释；Clinton 的图像学区分）。合并为一行是产品化取舍，不是史实错误，但代码注释不该把它说成单纯的「译名重复」。
- ✅ Plutus（Ploutos，财神，德墨忒尔与 Iasion 之子）与 Plouton 的混淆在古代就存在且有神学含义，但**本项目未入库 Plutus，无实际风险**。

---

## 五、缺失的希腊地理

系统里**零个**希腊 realm。缺的是：Tartarus、Elysium（/至福岛）、Asphodel Meadows，以及 Styx / Acheron / Lethe / Phlegethon / Cocytus 五河。

后果链：柏拉图给三判官指定的两个去向（至福岛、塔尔塔罗斯）都不存在 → 三判官的判决只能落到但丁的九圈 → 「希腊冥界流程」实质上是一条通往但丁地狱的流程 → 河流被迫建模成 Actor 而非地点。

`docs/04_希腊冥界详解.md` 已经把这些地理写得相当完整（且第 107-113 行主动标注了「哀痛沼泽/至福岛属现代附加」，这一点做得好），但**文档里的东西一条都没进数据库**。

---

## 六、各文献版本差异一览（不要合成「标准版」）

- **审判**：荷马只有 Minos 且不做道德分流；品达是 Rhadamanthys 在至福岛辅弼克罗诺斯；柏拉图才是「三人分区 + Minos 终裁」；维吉尔是 Minos 持骨签瓮 + Rhadamanthus 统治塔尔塔罗斯，无 Aeacus。
- **卡戎**：荷马无此神；希腊作者放 Acheron；罗马诗人放 Styx；维吉尔两者混用；但丁 Acheron。
- **刻耳柏洛斯**：赫西俄德五十头；阿波罗多洛斯三头+龙尾+蛇；维吉尔三喉；但丁三喉且在第三圈。
- **常春花草原**：荷马只说「常春花之野」，英雄亦行其上；「中庸者专区」是后世系统化。
- **极乐原**：荷马是给特定人物的免死之地；品达是需三世无不义的至福岛。
- **忘川**：维吉尔=轮回前饮忘；柏拉图《理想国》10 卷是「忘川平原的 Ameles 河」（**本次未取证**）；但丁=只忘罪，并配自创的 Eunoe。

---

## 七、来源清单（按性质标注）

**一手文献 / 公版英译（Perseus，Loeb 或同期公版）**
1. Plato, *Gorgias* 524a — https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0178:text%3DGorg.:page%3D524
2. Plato, *Cratylus* 403a — https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0172:text%3DCrat.:section%3D403a
3. Homer, *Odyssey* 11.568-571（Minos 裁断）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0136:book=11:card=567
4. Homer, *Odyssey* 11.538-540（常春花之野）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0136:book=11:card=538
5. Homer, *Odyssey* 4.563-568（Elysium / Rhadamanthus）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0136:book=4:card=561
6. Hesiod, *Theogony* 306-315（Cerberus 五十头，Evelyn-White 1914）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0130:card=306
7. Pindar, *Olympian* 2（至福岛、Rhadamanthys）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0162:book=O.:poem=2
8. Virgil, *Aeneid* 6.295-330（Acheron/Cocytus/Charon/未葬者）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=295
9. Virgil, *Aeneid* 6.426-433（Minos 与骨签瓮）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=426
10. Virgil, *Aeneid* 6.548-579（Tartarus、Phlegethon、Rhadamanthus）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=548
11. Virgil, *Aeneid* 6.703ff（Lethe 与轮回）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.02.0054:book=6:card=703
12. Euripides, *Alcestis* 252-256（Charon 在「湖」上）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0088:card=252
13. Apollodorus, *Library* 2.5.12（Cerberus 三头 + 龙尾）— https://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0022:text%3DLibrary:book%3D2:chapter%3D5:section%3D12
14. Dante, *Inferno*（Longfellow 公版英译；III=Charon/Acheron，V=Minos 第二圈，VI=Cerberus 三喉第三圈）— https://www.gutenberg.org/files/1001/1001-h/1001-h.htm

**百科 / 二手综述（用于归纳分歧与引证链，非终审依据）**
15. https://en.wikipedia.org/wiki/Pluto_(mythology) （Plouton/Hades/Dis Pater/Ploutos；引 Clinton、Farnell、Burkert、Cicero、Strabo）
16. https://en.wikipedia.org/wiki/Charon （Acheron vs Styx 的作者归属）
17. https://en.wikipedia.org/wiki/Aeacus （生平、子嗣、持钥匙的图像学，引 Pindar *Isthm.* 7.47、Apollodorus 3.12.6）
18. https://en.wikipedia.org/wiki/Rhadamanthus （引 Plato *Gorg.* 524a、Homer *Od.* 4.564、Virgil）
19. https://en.wikipedia.org/wiki/Asphodel_Meadows （自陈与其他冥界区域关系不确定）
20. https://en.wikipedia.org/wiki/Matelda ；https://ahc.leeds.ac.uk/discover-dante/doc/purgatorio/page/5 （利兹大学 Discover Dante 教学页，二手：Lethe 只忘罪、Eunoe 为但丁自创）

**尝试过但不可用**：theoi.com（403，全站拒绝抓取）；digitaldante.columbia.edu（Anubis 反爬）；sacred-texts.com（403）；dantelab.dartmouth.edu（证书错误）。Perseus 部分 card 间歇性 503。

**本次未能取证、故未采信的条目**：赫西俄德《神谱》769-773（Cerberus 对进者摇尾、对出者吞噬）；《神谱》720-745（Tartarus 深度）；《神谱》775-806（Styx 誓言）；《奥德赛》10.513-514（Circe 列河名）；《伊利亚特》14.321-322（Minos 与 Rhadamanthys 同母）；「品达说 Cerberus 一百头」；柏拉图《理想国》10.621a（忘川平原）。

---

## 八、建议（**仅建议，未实施**）

按性价比排序：

1. **给审计和测试加 realm 断言**（`consolidate_eu_pantheon.GRECO_ROMAN_EXPECTED` 与 `test_seed_mythology.py`）。现在只锁 role，是所有位置错误能长期存活的原因。这是唯一能防止复发的改动。
2. **决定一条产品路线，然后一致执行**——不要继续两边都沾：
   - **路线 A（纯但丁）**：只留但丁用到的希腊人物（Minos、Charon、Cerberus），按但丁归位：Minos→EU_HELL_2ND 入口（或建一个「地狱前庭」realm），Charon→Acheron/地狱门（不是炼狱），Cerberus→EU_HELL_3RD。删掉 Aeacus/Rhadamanthus（但丁没有他们），Hades 亦无位可安。
   - **路线 B（希腊独立）**：新建希腊 realm（Acheron 渡口 / 审判岔路 / Tartarus / Asphodel / Elysium），三判官挂「审判岔路」，Charon 挂渡口，Cerberus 挂冥府门，Hades 作为全域 OVERSEER，Lethe 归 Asphodel/轮回口。并明确标注「依柏拉图《高尔吉亚篇》+ 维吉尔《埃涅阿斯纪》6」。
   - 若非要共存，至少给 Actor 加「所属文本传统」字段（Homer / Plato / Virgil / Dante），让混用可见。
3. **修前端 `EUROPEAN_GREEK` 顺序**：Rhadamanthus（亚洲）与 Aeacus（欧洲）是**并列分区**，Minos 是**终裁**——现在的「初审→复核→终审」串行链本身就不符合柏拉图；至少应把 Minos 放在最后。
4. **修 Charon 文案**：Styx → Acheron（或写「Acheron；罗马诗人作 Styx」）。
5. **修 Lethe 文案**：与 realm 对齐——若留在炼狱就写但丁义（洗去罪的记忆），并考虑补 Eunoe；若要维吉尔义（轮回前饮忘）就不该挂炼狱。
6. **修 `docs/04_希腊冥界详解.md`** 三处：Aeacus「埃勾斯之父」→ 删除或改「阿基琉斯之祖父」；Minos「普通亡灵」→「另二人存疑时终裁（柏拉图 *Gorg.* 524a）」；「喀戎」→「卡戎」（喀戎是马人 Chiron）；顺带第 133 行「阿斯福德牧场」与 v1.1 已修正的「阿斯福得草原」自相矛盾。
7. **`memory_reset` 一刀切**：EU 全部 realm 都是 LETHE，需要按 realm 区分（但丁地狱不饮忘川）。
8. **`SPEC.md:44 / 1786`** 与实际 seed 不符（写着 St. Peter、Lucifer，实际未入库），属文档漂移。

---

*非希腊侧但顺带发现（留给基督教侧代理）*：`seed_mythology.py:156` `EU_HELL_2ND` 的中文别名写作「贪食深渊」（暴食），而英文是「Second Circle - Lust」（色欲）——但丁第二圈是色欲、第三圈才是暴食，中英文对不上。

---

## 附录（2026-08-25）：§7「未能取证」中的一条已取证

本节是**后加的**，不改上面任何一行。上面的报告日期是 2026-08-14，其结论是那一次
所见；这里只记录后来补上的证据，以免读者据一条已过期的「未取证」判断当前代码在
无据引用。

- **柏拉图《理想国》10.621a（忘川平原）—— 已取证**，出处：Perseus canonical XML
  `tlg0059.tlg030.perseus-eng2`（Loeb, Paul Shorey），`<milestone unit="section">`
  标记逐节定位。文本作 **the Plain of Oblivion（Λήθης πεδίον）** 与
  **the River of Forgetfulness（Ἀμέλης）**，与 §6 所记「忘川平原的 Ameles 河」相符。

  **并且补上一条 §6 未记的分辨**：Shorey 在 621a 的注中写明，*把那条河本身叫作
  Lethe 是后世文献的用法*——柏拉图那里，**平原**属于勒忒，**河**叫阿墨勒斯。本系统
  `GREEK_REALMS` 的 `memory_reset_mechanism="LETHE"` 是本系统枚举成员的名字，不是在
  主张《理想国》如此称呼那条河；此点记在 `GR-ER-11` 的 `source_notes` 上。

  另有一处 §6 未记而与「一刀切」相关：621a 说众魂**都必须饮下定量**，而
  「没有被智慧所救的，饮得比必需的多」——**强制但不等量**。`MemoryResetMechanism`
  只记机制、没有份量的位置，所以这个程度差**没有被建模**，也不应从已播种的值里读出来。

- 其余各条（《神谱》769-773 / 720-745 / 775-806、《奥德赛》10.513-514、
  《伊利亚特》14.321-322、「品达说 Cerberus 一百头」）**本次仍未取证**，维持不采信。

取证动机：`GORGIAS` 与 `REPUBLIC_ER` 两套 corpus 于本日落库，共 22 条，
转录英文用 Jowett（Gutenberg 公版），Stephanus 分节用 Perseus/Loeb 定位。
Gorgias 侧同样按此法逐节核对（Lamb 1925）。详见
`backend/apps/actors/mythology/statutes_gorgias.py` 与 `statutes_republic.py`。
