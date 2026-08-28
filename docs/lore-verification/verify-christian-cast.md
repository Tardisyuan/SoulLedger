# 基督教侧人物数据核实报告

范围：SoulLedger `EUROPEAN` 租户中的**基督教**部分。希腊罗马侧（Hades / Minos / Aeacus / Rhadamanthus / Charon / Cerberus / Lethe）不在本报告范围内，仅在与基督教条目发生耦合处点到为止。
纪律：只研究，未修改仓库任何文件。

---

## 一、当前入库数据清单

### 1.1 Actor（`backend/apps/actors/management/commands/seed_mythology.py` L304-350，`EUROPEAN_ACTORS`）

基督教侧共 **4 个** Actor（其余 7 个是希腊罗马/但丁侧）：

| # | name | name_zh | role | realm_code | title_zh | description |
|---|------|---------|------|-----------|----------|-------------|
| 1 | God | 上帝 | **OVERSEER** | EU_HEAVEN | 全能者 | "Supreme deity - final judge of souls in Christian tradition" |
| 2 | Michael | 米迦勒 | **JUDGE** | EU_HEAVEN | 大天使长米迦勒 | "Leader of the archangels - weighs souls at the heavenly throne" |
| 3 | Gabriel | 加百列 | **CONDUIT** | EU_HEAVEN | 加百列 | "Messenger angel - guides souls to judgment and heaven" |
| 4 | Satan | 撒旦 | **JUDGE** | EU_HELL_9TH | 堕落者撒旦 | "The adversary - ruler of the ninth circle of Hell, final tempter" |

注：`name_egy` 列上 Gabriel 被写成 `"Gabrielle"`（法语女名），Michael 写成 `"Mikael"`。这一列本是给埃及侧用的转写栏，欧洲行填的是随手编的拉丁化拼写，无来源。

### 1.2 Realm（同文件 L149-172，`EUROPEAN_REALMS`）

11 个：EU_HEAVEN（天堂）、EU_PURGATORY（炼狱）、EU_HELL_1ST…9TH（但丁九圈）。
基督教教义性的只有前两个（天堂 / 炼狱），九圈全部来自但丁《神曲·地狱篇》，是文学作品而非教义。

**发现一处明确的字段错误**：`EU_HELL_2ND` 的 `name_zh` 是「贪食深渊」，但 `name_en` 是 `"Second Circle - Lust"`、description 是 "Lustful souls - tossed by violent winds"。但丁第二圈是**色欲（Lussuria）**，第三圈才是暴食。中文别名串位了一圈。

### 1.3 组织节点（`backend/apps/org/management/commands/init_organizations.py` L50-57）

```
天堂 (HEAVEN, level 0)
├── 大天使团 (HEAVEN_ANGEL)
└── 天堂执行层 (HEAVEN_EXEC)
```
扁平两层，**九级天使体系完全没有落地**。「天堂执行层」不对应任何传统概念，是管理系统模板套用产物。

### 1.4 文档

- `docs/02_天使九级 hierarchy.md`（与 `欧洲天堂地狱/02_天使九级 hierarchy.md` 同内容）
- `docs/01_欧洲天堂地狱整体架构.md` L12：顶层图写「上帝（终极审判者）」
- `docs/README.md` L182：「审判核心：十殿阎王 | **上帝／末日审判** | 奥西里斯 + 42 判官」

**关键缺失**：`grep 基督|耶稣|Christ|Jesus` 在这三份基督教文档中**零命中**。整个欧洲侧的审判框架里没有出现过基督。见第四节。

---

## 二、九级天使的准确数据

### 2.1 出处与文本状况

体系出自伪狄奥尼修斯《天阶体系论》(Περὶ τῆς οὐρανίας ἱεραρχίας / *De Coelesti Hierarchia*)，约公元 5 世纪末～6 世纪初，作者托名《使徒行传》17:34 的雅典人狄奥尼修斯。九级的**名称**全部取自新约既有词汇（西 1:16、弗 1:21、罗 8:38、彼前 3:22、帖前 4:16），伪狄奥尼修斯做的是**排序与三三分组**，不是发明名称。

分组见该书第六至九章：
- 第六章：「哪一级是第一，哪一级居中，哪一级最末」
- 第七章：撒拉弗、基路伯、座天使 —— 第一阶
- 第八章：主治者、能者、权者 —— 中阶（Parker 1897/1899 英译作 Lordships / Powers / Authorities）
- 第九章：掌权者、总领天使、天使 —— 末阶

### 2.2 九级正表（狄奥尼修斯次序，自高而下）

| 序 | 希腊文（狄氏原文） | 拉丁文（武加大/阿奎那） | 英文（通行） | Parker 1897 英译 | 中文（通行/维基·百度） | 新约出处 |
|---|---|---|---|---|---|---|
| 1 | Σεραφίμ (Seraphim) | Seraphim | Seraphim | Seraphim | 炽天使／撒拉弗 | 赛 6:2（旧约） |
| 2 | Χερουβίμ (Cherubim) | Cherubim | Cherubim | Cherubim | 智天使／基路伯 | 创 3:24、结 10（旧约） |
| 3 | Θρόνοι (Thronoi) | Throni | Thrones | Thrones | 座天使 | 西 1:16 |
| 4 | Κυριότητες (Kyriotetes) | Dominationes | Dominions / Dominations | Lordships | **主天使** | 西 1:16、弗 1:21 |
| 5 | Δυνάμεις (Dynameis) | Virtutes | **Virtues** | Powers | **力天使** | 弗 1:21、彼前 3:22、罗 8:38 |
| 6 | Ἐξουσίαι (Exousiai) | Potestates | **Powers** | Authorities | **能天使** | 西 1:16、弗 1:21、彼前 3:22 |
| 7 | Ἀρχαί (Archai) | Principatus | Principalities | Principalities | **权天使** | 西 1:16、弗 1:21、罗 8:38 |
| 8 | Ἀρχάγγελοι | Archangeli | Archangels | Archangels | 大天使／总领天使 | 帖前 4:16、犹 9 |
| 9 | Ἄγγελοι | Angeli | Angels | Angels | 天使 | 通篇 |

三阶分组：**1-3 / 4-6 / 7-9**。项目文档的分组是对的。

**5/6 两级是英译陷阱**：希腊文 δυνάμεις（力量）经拉丁 *virtutes* 变成英文 "Virtues"，希腊文 ἐξουσίαι（权柄）经拉丁 *potestates* 变成英文 "Powers"。所以英文 "Powers" 对应的希腊词不是 δυνάμεις 而是 ἐξουσίαι。Parker 1897 直接从希腊文译，因此他写 Powers / Authorities，与拉丁系英文 Virtues / Powers 错位一格 —— **同一个东西，两套译名，极易混**。

### 2.3 项目文档 `docs/02` 的具体错误

| 位置 | 文档写的 | 应为 | 性质 |
|---|---|---|---|
| L21-22 图 | 第 7 级中文标「力天使」，英文标 Principalities | 通行中文 Principalities = 权天使；力天使 = Virtues（第 5 级） | 图与正文自相矛盾（正文 L105 又把 Principalities 叫「掌权天使」） |
| L81-98 | 能天使 = Virtues，权天使 = Powers | 通行中文：力天使 = Virtues，能天使 = Powers | 与中文维基/百度百科通行译名全部错位一格 |
| L105 | Principalities 译「掌权天使」 | 通行为「权天使」（该文档自己 L90 已把「权天使」给了 Powers，所以只能另造一词） | 连锁错误 |
| **L120** | Archangels「希伯来语 Sarafim（领袖）」 | **Sarafim 就是撒拉弗（炽天使），意为「燃烧者」，与总领天使毫无关系**；Archangel 是希腊文 ἀρχάγγελος，非希伯来文 | **硬伤，明确的伪造/张冠李戴** |
| L48 | 智天使「四翼（以赛亚书6：鹰翅）」 | 赛 6 讲的是**撒拉弗**六翼，不是基路伯；基路伯四翼四脸出自结 1:6 + 结 10:20 | 经文引错 |
| L79 | 主天使（Dominions）出处「彼前 3:22」 | 彼前 3:22 希腊原文只有 ἀγγέλων / ἐξουσιῶν / δυνάμεων（天使、权柄、能力），**没有 κυριότητες**。Dominions 的出处是西 1:16、弗 1:21 | 经文引错 |
| L55-66 | Thrones = Ophanim | 二者等同是**犹太传统（结 1 的「轮」）与狄奥尼修斯体系的后世嫁接**，不出自狄氏原文；迈蒙尼德的十级表里 Ophanim 与 Seraphim 是分开的两级 | 文档 L66 自己加了保留，处理算克制，但正文标题直接写 "Thrones / Ophanim" 仍是过度断言 |
| L127-134 | 「被提名的大天使」四位 | 米迦勒是**唯一**在正典中被称 archangel 的（犹 9）；加百列在正典中从未被称 archangel（路 1:19 只说「我是站在神面前的加百列」）；拉斐尔出多俾亚传 12:15（天主教/东正教次经，新教不收）；乌列出以斯拉续书（连天主教也不收入正典） | 需按正典层级标注，文档只对拉斐尔/乌列标了「次经」 |
| L173-183 | 「米迦勒 = CEO/COO，加百列 = CMO」 | 无出处，是项目自造的类比 | 若入库需明确标为设计约定，不能当作传统数据 |

### 2.4 次序分歧（必须记录，不能只挑一个）

**大额里高利（Gregory the Great）《福音书讲道集》第 34 篇**给出另一个次序，与狄奥尼修斯差在第 5 与第 7 位互换：

| 序 | 狄奥尼修斯 | 大额里高利 |
|---|---|---|
| 4 | Dominations | Dominations |
| 5 | **Virtues** | **Principalities** |
| 6 | Powers | Powers |
| 7 | **Principalities** | **Virtues** |

阿奎那《神学大全》I q.108 a.6 并列两说，评价额里高利之说「也合理」（*rationabilis*），但自己采狄奥尼修斯次序。**若要落地，必须把采用哪一说写进数据（如 `ordering_authority` 字段），而不是默认「九级只有一种排法」。**

### 2.5 若要落地，建议的数据形状（不实施，仅给数据）

```
choir_index | greek        | latin          | english       | zh(通行)   | zh(备选)   | triad | scripture
1  | Σεραφίμ      | Seraphim      | Seraphim       | 炽天使   | 撒拉弗     | 1 | Isa 6:2
2  | Χερουβίμ     | Cherubim      | Cherubim       | 智天使   | 基路伯     | 1 | Gen 3:24; Ezek 10
3  | Θρόνοι       | Throni        | Thrones        | 座天使   | 上座者     | 1 | Col 1:16
4  | Κυριότητες   | Dominationes  | Dominions      | 主天使   | 宰制者     | 2 | Col 1:16; Eph 1:21
5  | Δυνάμεις     | Virtutes      | Virtues        | 力天使   | 异能天使   | 2 | Eph 1:21; 1Pet 3:22
6  | Ἐξουσίαι     | Potestates    | Powers         | 能天使   | 大能天使   | 2 | Col 1:16; 1Pet 3:22
7  | Ἀρχαί        | Principatus   | Principalities | 权天使   | 率领者     | 3 | Col 1:16; Eph 1:21
8  | Ἀρχάγγελοι   | Archangeli    | Archangels     | 大天使   | 总领天使   | 3 | 1Thess 4:16; Jude 9
9  | Ἄγγελοι      | Angeli        | Angels         | 天使     | —          | 3 | passim
ordering_authority = "Pseudo-Dionysius, De Coelesti Hierarchia VI-IX"
variant: Gregory the Great, Hom. in Ev. 34 — swaps index 5 and 7
```

「zh(备选)」一列是中文天主教方面较常见的另一套译法（宰制者/异能/大能/率领者一路），与通行的「主力能权」不同源。**中文译名没有单一权威**，落地时应把两套都存下来，或至少标注采用哪一套 —— 这正是当前文档没做、结果自己跟自己打架的地方。

**同时必须落地的边界条件**：九级不是天主教的正式教义。1992 年《天主教教理》论天使部分（328-336 条）**不列举九级**，第 331 条只是引用西 1:16 的「有王座的、有主治的、有执政的、有掌权的」，第 335 条提到弥额尔、加俾额尔、辣法厄尔与护守天使，没有给出等级表。新教（加尔文《基督教要义》I.14.4）明确批评狄奥尼修斯的分级为无据的思辨。东正教则在礼仪层面沿用九级（11 月 8 日「总领天使弥迦勒暨诸无形力量集会」），并经大马士革的圣约翰传承。所以：**九级是天主教-东正教的神学传统与礼仪传统，不是全基督教的教义共识。**

---

## 三、逐项核实结论

### 3.1 Michael 与 Gabriel 属于哪一级 —— 这里确实存在冲突，而且传统内部没有定论

「Archangel」一词在传统里被两个互不兼容的意义共用：

- **意义 A（等级）**：狄奥尼修斯体系第 8 级，位于 Principalities 与 Angels 之间，**倒数第二低**。
- **意义 B（尊称）**：米迦勒这类「天使之首」的头衔。

阿奎那自己解释了这个歧义（ST I q.108 a.5）：总领天使夹在掌权天使与天使之间，对下是「首领」，对上是「天使」，所以被叫作「天使之君」。这解释了词义，但**没有解决米迦勒本人的定级**。历代说法至少三派（《天主教百科全书》"St. Michael the Archangel" 条目综述）：

1. **阿奎那**（ST I q.113 a.3）：米迦勒是**最低一级「天使」的君长**。
2. **希腊教父（巴西尔等）、以及 Salmerón、Bellarmine**：米迦勒**在全体天使之上**，被称 archangel 是因为他是众天使之长。
3. **波纳文图拉一系**：米迦勒是**炽天使之首**，即第一级。

罗马礼仪倾向第 2 派：称米迦勒为 *Princeps militiae caelestis*（天军之君）。

圣经层面：
- 米迦勒 —— 犹 9「天使长米迦勒」；帖前 4:16「天使长的声音」（archangel 一词在正典中仅这两处）；但 10:13「大君中的一位」（אַחַד הַשָּׂרִים הָרִאשֹׁנִים）；但 12:1「大君米迦勒」。
- 加百列 —— **正典中从未称为 archangel**。路 1:19 只说「我是站在神面前的加百列」。多俾亚传 12:15 说拉法厄尔是「侍立在上主荣耀之前的七位圣天使之一」，这是「七大天使」说法的来源，但它是次经，且**没有点名七位**。

→ **结论**：项目把 Michael 的 title 写成「大天使长米迦勒」（Leader of the archangels）是三派中的一派（第 2 派）的说法，不是无据，但**呈现为唯一答案是错的**；而把 Gabriel 也标成 "Archangel Gabriel" 是**通行俗称，不是正典称谓**。若要落地九级，这两位**不能简单塞进第 8 级** —— 正确做法是把「归属级别」做成带来源的可选字段，并记录三派分歧。

### 3.2 Michael 的 JUDGE 角色 —— 不成立

项目给 Michael 的 description 是 "weighs souls at the heavenly throne"，role = JUDGE。

- 「米迦勒称量灵魂」（psychostasis / 灵魂称量）是**中世纪图像学母题**，不是圣经也不是教义。学术共识：圣经与次经**都没有**把称量与米迦勒联系起来；这个母题源自古埃及称心，经希腊 psychostasia，约公元 4 世纪进入基督教艺术，中世纪才固定到米迦勒身上。
- 有礼仪依据的是米迦勒的**引导/护送**角色，不是审判：罗马安魂弥撒的奉献经（*Domine Jesu Christe, Rex gloriae…*）说 "sed signifer sanctus Michael repraesentet eas in lucem sanctam"（愿掌旗者圣米迦勒引他们进入圣光）。掌旗者、引路者 —— 这是 **CONDUIT**，不是 JUDGE。

→ Michael 更贴切的 role 是 CONDUIT（有礼仪文本支持）或 GUARDIAN（天军之君，启 12:7），**不是 JUDGE**。若坚持保留称量意象，必须在数据里标明「中世纪图像学，非教义」。

### 3.3 Gabriel 的 CONDUIT 角色 —— 部分成立但描述错了

Gabriel 是报信天使（但 8:16、但 9:21、路 1:11-20 报施洗约翰、路 1:26-38 报喜）。CONDUIT 若理解为「传讯」是对的。但项目的描述 "guides souls to judgment and heaven"（引导灵魂去受审、进天堂）**没有传统依据** —— 那是米迦勒的活（安魂弥撒奉献经），不是加百列的。加百列在传统里向**活人**报信，不引导**亡魂**。

另外 Gabriel 吹末日号角是**伊斯兰教**（Isrāfīl 常与之混）与后世民间说法；圣经里吹号的是「号筒的声音」与不具名的天使（帖前 4:16、启 8）。

### 3.4 God 标为 OVERSEER —— 定位不成立，而且暴露了整个欧洲侧的核心缺口

**基督教的审判者是基督，不是笼统的「上帝」。** 这是有明确经文和信经依据的，不是解释空间：

- 约 5:22「父不审判什么人，乃将审判的事全交与子」
- 徒 10:42「神所立定的，要作审判活人死人的主」
- 罗马书 14:10 / 林后 5:10「基督台前」(βῆμα τοῦ Χριστοῦ)
- 太 25:31-46 人子坐在荣耀宝座上分绵羊山羊
- 尼西亚信经：「他将在荣耀中再来，审判活人死人」

《天主教教理》1021-1022（私审判）明确说私审判是「把人的生命归结于基督」；1038-1041（末日审判）说基督在荣耀中偕众天使降来，分开万民。

→ 因此：
1. 把 God 标成 **OVERSEER**（旁观/管理者）而把 **JUDGE** 给了米迦勒，是把审判者与执行者对调了。基督教里审判者是三位一体的第二位格，不是「监督」。
2. 更严重的是：**Christ 根本不在 Actor 表里，也不在任何一份基督教文档里**（`grep 基督|耶稣|Christ|Jesus` 三份文档零命中）。项目的欧洲侧审判系统缺了信经明文规定的那个审判者。
3. 若要修，最小改动是新增 Christ 作为 JUDGE（realm EU_HEAVEN），God/圣父保留但不做 JUDGE。是否把三位一体拆成三个 Actor 是建模取舍，需另行决定 —— 神学上「上帝审判」与「基督审判」不矛盾（基督就是上帝），但数据上必须至少让「审判者」这一格指向基督。

### 3.5 Satan 标为 JUDGE —— 不成立

- 神学上：撒旦是**控告者**（启 12:10 ὁ κατήγωρ，「控告我们弟兄的」；伯 1-2 中的 הַשָּׂטָן 是天庭上的控方角色），从来不是审判者。他自己是被审判的对象（启 20:10）。
- 但丁那边也不成立：《地狱篇》第 34 歌的 Dis/Lucifer **冻在科奇土斯冰湖中心，三口咬着犹大、布鲁图、卡西乌斯**，是刑罚本身，不审判任何人。但丁的分派者是**米诺斯**（《地狱篇》第五歌，位于第二圈入口，不是第九圈 —— 项目把 Minos 也放在 EU_HELL_9TH，同样错位，但那属希腊罗马侧）。

→ Satan 若保留，合理的 role 是 EXECUTOR（刑罚承载/施行）或另立「ACCUSER」概念；JUDGE 明确错误。

### 3.6 「基督教有没有具名审判官团」—— **没有。这是本次核实最重要的发现。**

对照三个文明：
- 中国：十殿阎王 —— **有具名名录**，十位，各有殿次与职掌。
- 埃及：四十二判官 —— **有具名名录**，出自《亡灵书》第 125 章，逐条对应一句否定告白。
- 基督教：**没有任何对应物。**

具体说明：

1. **末日审判只有一位审判者：基督**（见 3.4）。信经、教理、经文一致，没有陪审团、没有判官席、没有分工。
2. **天使在审判中不是判官，是执行与召集**：太 13:41-42、太 25:31（天使随基督而来）、太 24:31（天使吹号招聚选民）。天使收割、分开、执行，**不裁决**。
3. **唯一带「多人审判」意味的经文是两处，且都不是判官名录**：
   - 太 19:28 / 路 22:30：十二使徒「坐在十二个宝座上，审判以色列十二个支派」。这是**十二使徒**，但经文没有把他们逐一列为具名判官分派职掌，注释传统普遍理解为「一同作证/一同治理」而非分案审理。
   - 林前 6:2-3：「圣徒要审判世界……岂不知我们要审判天使么」。这里的主体是**全体圣徒**，不是一个封闭的具名名单。
4. **不存在「私审判由谁主持」的具名分工**。天主教教理 1021-1022 只说私审判「把人的生命归结于基督」，没有第二个人格出场。
5. **米迦勒称量灵魂**是唯一看起来像「判官」的形象，但如 3.2 所述是中世纪图像学，不是教义，而且它是一个人，不是一个名录。

→ **结论：基督教传统里不存在与十殿、四十二判官同构的「具名审判者名录」。这个位置在基督教里结构上是空的 —— 不是资料没找到，是这套神学根本不用这个结构。**

这直接说明项目的三文明同模板设计在欧洲侧是硬凑的：为了填「JUDGE」这一格，项目把 JUDGE 给了米迦勒（图像学母题）和撒旦（错误），又从希腊神话搬来米诺斯/艾亚哥斯/拉达曼提斯凑数（`EUROPEAN_ACTORS` 里 11 个 Actor 有 7 个是希腊罗马的，其中 3 个是判官）。**欧洲侧的「判官席」是靠希腊人填满的，基督教本身一个都没提供。**

---

## 四、宗派差异汇总

| 议题 | 天主教 | 东正教 | 新教（主流改革宗/信义宗） |
|---|---|---|---|
| 九级天使 | 是流传广泛的神学传统（阿奎那 ST I q.108），但 1992 年《教理》**不作教义列举** | 礼仪层面完整沿用（11/8「总领天使弥迦勒暨诸无形力量集会」），经大马士革的圣约翰传承狄奥尼修斯 | 加尔文《要义》I.14.4 直接批评狄奥尼修斯为无据思辨；路德同样不采纳。**一般不承认九级** |
| 炼狱 | 有（教理 1030-1032） | 无「炼狱」教义，但有为亡者祈祷与「苦路/关税站」等民间传统（非普遍教义） | **明确否定**（《奥格斯堡信条辩护》《三十九条》第 22 条） |
| 拉斐尔/乌列 | 拉斐尔在正典（多俾亚传）；乌列不在 | 拉斐尔在正典；乌列在部分礼书中被记念 | 多俾亚传属次经，**拉斐尔不在正典**；乌列更不在 |
| 末日审判者 | 基督（教理 1038-1041） | 基督 | 基督 —— **三派完全一致，无分歧** |
| 米迦勒的等级 | 三派并存（阿奎那=最低级之长；礼仪=天军之君；波纳文图拉=炽天使之首） | 通常视为总领天使之首、天军统帅（Ἀρχιστράτηγος） | 一般不定级，只承认犹 9 的「天使长」称谓 |
| 米迦勒称量灵魂 | 图像学传统，未进入教义 | 东方图像中亦有，同样非教义 | 不采纳 |

**对项目的含义**：欧洲侧现在事实上混了天主教的炼狱 + 但丁的九圈 + 三派并存的天使学 + 希腊判官，但数据里没有任何一处标注宗派归属。至少要有一个 `tradition` 维度（天主教/东正教/新教/但丁文学/希腊罗马），否则「基督教」这个标签下的数据自相矛盾。

---

## 五、来源清单与质量评估

### 一手文献（转录/公版译本）
| 来源 | URL | 性质 | 用于 |
|---|---|---|---|
| 伪狄奥尼修斯《天阶体系论》，John Parker 译（1897/1899 vol.2） | https://www.tertullian.org/fathers/areopagite_13_heavenly_hierarchy.htm | **一手文献公版英译的完整转录**，质量高，含章节标题原文 | 九级名称、三阶分组、章节归属 |
| 同上，CCEL 版 | https://www.ccel.org/ccel/dionysius/celestial.vii.html | 一手转录，另一独立托管 | 交叉核对第六至九章分组 |
| 阿奎那《神学大全》I q.108（New Advent 英译转录） | https://www.newadvent.org/summa/1108.htm | **一手文献英译转录**（Fathers of the English Dominican Province），高 | a.5 archangel 歧义原文；a.6 狄氏 vs 额里高利两种次序 |
| 《天主教教理》第 12 条（梵蒂冈官网） | https://www.vatican.va/content/catechism/en/part_one/section_two/chapter_three/article_12/i_the_particular_judgment.html 及 .../v_the_last_judgment.html | **教会官方文献**，最高权威 | 1021-1022 私审判归结于基督；1038-1041 末日审判由基督主持 |
| 《天主教教理》论天使（328-336） | https://www.vatican.va/archive/ENG0015/__P1A.HTM | 教会官方文献 | 证实教理**不列举**九级 |
| 罗马安魂弥撒奉献经拉丁原文 | https://extraordinaryform.org/handmissals/HandMissalRequiem.pdf | **礼书原文**，高 | "signifer sanctus Michael repraesentet eas in lucem sanctam" |
| 1 Peter 3:22 希腊文逐词 | https://biblehub.com/text/1_peter/3-22.htm | 一手经文文本工具，高（可自行核验） | 证实彼前 3:22 无 κυριότητες |

### 教会/百科参考
| 来源 | URL | 性质 | 用于 | 评估 |
|---|---|---|---|---|
| 《天主教百科全书》"St. Michael the Archangel" | https://www.newadvent.org/cathen/10275b.htm | 1913 年天主教百科，**权威二手综述**，逐条注明其所引神学家 | 米迦勒定级三派分歧、罗马礼仪称谓 | 高。年代久（1913），但此条综述的是古典意见，未受时效影响 |
| 东正教 OrthodoxWiki "Angels" | https://orthodoxwiki.org/Angels | 教派维基，二手 | 东正教沿用九级 | 中。用于宗派立场的粗略定位，不用于细节 |
| 美国东正教会 OCA 圣徒条目 | https://www.oca.org/saints/lives/0201/10/03/102843-hieromartyr-dionysius-the-areopagite-bishop-of-athens | 教会官方网站 | 狄氏在东正教的接受史 | 中高 |
| 中文维基「天使等级」 | https://zh.wikipedia.org/zh-hans/天使等级 | 百科，二手 | **中文通行译名**（主/力/能/权） | 中。中文译名本无权威，此处只作「通行用法」证据，不作事实依据 |
| 百度百科「天使九级」 | https://baike.baidu.com/item/天使九级/4741077 | 百科，质量偏低 | 与中文维基交叉印证通行译名 | 低-中。**该条目混入大量「翅膀数量」等爱好者设定，非传统内容，已剔除** |

### 学术
| 来源 | URL | 性质 | 用于 | 评估 |
|---|---|---|---|---|
| Wikipedia "Weighing of souls" | https://en.wikipedia.org/wiki/Weighing_of_souls | 百科，带学术引注 | psychostasis 母题的非圣经性与埃及起源 | 中 |
| Iris Publishers, "Angelology and Anthropology: A Regional Case Study of the Weighing of Souls" | https://irispublishers.com/oajaa/fulltext/angelology-and-anthropology-a-regional-case-study-of-the-weighing-of-souls.ID.000541.php | 学术期刊论文 | 明确指出圣经与次经均未把称量与米迦勒相联 | 中高。**注：Iris Publishers 属开放获取出版社，同行评审严格程度存疑**，故此结论另与 UCM 的 psychostasis 讲义交叉印证 |
| Complutense (UCM) "Psychostasis or the Weighing of the Souls" | https://webs.ucm.es/centros/cont/descargas/documento21343.pdf | 大学教学材料 | 同上，交叉印证 | 中高 |
| Ben Crosby, "Calvin and Hooker on the Angels" | https://bencrosby.substack.com/p/calvin-and-hooker-on-the-angels | 神学研究者博客，引《要义》原文 | 加尔文对狄氏的批评（I.14.4） | 中。**二手转述**；若要引用，应回查《要义》I.14.4 原文 |
| 大额里高利《福音书讲道集》第 34 篇 | https://sites.google.com/site/aquinasstudybible/home/luke-commentary/gregory-the-great-homily-34-on-the-gospels | 爱好者站点的文本转载 | 额里高利次序 | 低-中。**该次序本身已由阿奎那 ST I q.108 a.6（高质量一手转录）独立证实**，此链接仅作补充，不单独承重 |

### 明确未采信的
- `salvationprayer.eu`、`bibleanalysis.org`、`learnreligions.com`、`medium.com` 等爱好者/内容农场站点 —— 搜索结果中出现，但其九级次序、职掌描述互相矛盾且无出处，**全部未用**。
- Grokipedia 条目 —— 未采信，无法核验其生成来源。
- 「天使翅膀数量」（六翼/五翼/四翼…递减）—— 中文网络流传甚广，**在狄奥尼修斯原文与圣经中均无依据**，是 ACG/奇幻设定回流。项目文档尚未采纳此说，是对的。

### 查不到 / 存疑，不下结论
- 中文天主教官方（思高圣经学会、中国天主教主教团）是否有**规范的九级中文译名表** —— 本次未找到可引用的官方页面。第 2.5 节「zh(备选)」一列来自零散的中文天主教文献用语，**未经权威核实，标为备选而非事实**。落地前应回查思高本西 1:16 与弗 1:21 的实际用词。

---

## 六、建议（仅建议，未实施）

按严重程度排序：

**P0 —— 事实错误，改法明确**
1. `docs/02_天使九级 hierarchy.md` L120：删除「Archangels 希伯来语 Sarafim（领袖）」。Sarafim 是撒拉弗，与总领天使无关。这是纯粹的张冠李戴。
2. 同文档 L48：基路伯的翅膀出处从「以赛亚书6」改为「以西结书 1:6 + 10:20」。赛 6 是撒拉弗。
3. 同文档 L79：主天使（Dominions）删去「彼前 3:22」，只留西 1:16、弗 1:21。
4. `seed_mythology.py` L156：`EU_HELL_2ND` 的 `name_zh`「贪食深渊」改为色欲（如「色欲之风」），与其 `name_en` "Second Circle - Lust" 一致。
5. `seed_mythology.py` L314-316：Satan 的 role 从 JUDGE 改掉（EXECUTOR 或另立控告者概念）。撒旦在神学上是控告者、在但丁里是刑具，两边都不是判官。

**P1 —— 定位错误，需要设计决策**
6. 引入 **Christ 作为 JUDGE**。这是欧洲侧最大的空缺：信经明文的审判者不在数据里。God 可保留但不宜是 OVERSEER-兼-final judge 的模糊态。
7. Michael 的 role 从 JUDGE 改为 CONDUIT 或 GUARDIAN（安魂弥撒奉献经的掌旗引路者；启 12:7 的天军统帅）。若保留「称量灵魂」的描述，必须标注为中世纪图像学而非教义。
8. Gabriel 的 description 删去「引导灵魂受审」—— 那是米迦勒的职能。加百列向活人报信，不引导亡魂。

**P2 —— 结构问题**
9. `EUROPEAN_ACTORS` 应拆出 `tradition` 维度（天主教 / 东正教 / 新教 / 但丁文学 / 希腊罗马），否则同一张表里混着教义、文学与异教神话，无法判断任何一行的效力层级。这也是希腊罗马侧代理会遇到的同一个问题。
10. 若要落地九级：用第 2.5 节的表，**必须带 `ordering_authority` 字段**（狄氏 vs 额里高利），并且 Michael/Gabriel 的「所属级别」应为可空 + 带来源的多值字段，不能填一个数字了事。九级本身应标注为「天主教-东正教神学传统，非全基督教教义，天主教教理不列举」。
11. `init_organizations.py` 的「天堂执行层」(HEAVEN_EXEC) 无传统对应物，是管理模板产物，建议要么删除，要么明确标为系统自造节点。

**P3 —— 元问题，值得单独讨论**
12. **不要为了填满模板而给基督教捏造判官席。** 三文明同构是这个项目的设计前提，但基督教在「具名判官名录」这一格是真空的，且这个真空是神学结构性的（独一审判者）。正确处理是让欧洲侧的这一格**显式为空并说明原因**，而不是用米迦勒、撒旦、米诺斯去填。埃及四十二判官的伪造正是「必须填满」这个压力的产物；欧洲侧现在处在同一个压力下，只是还没有伪造出名单来 —— 它选择了另一条路：把希腊判官算作欧洲的。

---

*核实时间：2026-08-14。本报告未修改仓库任何文件。*

---

## 附录（2026-08-28）：§3.3 那句「吹号角是伊斯兰教」需要更正

本节是**后加的**，不改上面任何一行。2026-08-27 考据审计（commit `6ec90e5`，落点
`backend/apps/actors/mythology/actors_european.py` 的 Gabriel 行）更正了一处本报告
也带着的说法：

- §3.3 写「Gabriel 吹末日号角是**伊斯兰教**（Isrāfīl 常与之混）与后世民间说法」。
  前半句不成立：**伊斯兰传统里吹末日号角的就是 Isrāfīl（伊斯拉菲尔），不是吉卜利勒
  （Jibrīl／Gabriel）**——把号角给 Gabriel 并不是伊斯兰的说法，而是**基督教后世与
  民间的附会**。「非圣经」这一半仍然对（帖前 4:16 是「神的号吹响」，未点任何天使名；
  启 8 的吹号者不具名）。seed 中 Gabriel 行的描述现按此写明。

同轮欧洲侧另两处更正不在本报告范围（Limbo 名单与 Inf. V.6 的引行），见
`statutes_inferno_entries.py` 与 `actors_european.py`。
