# 但丁九层地狱 / 七宗罪 —— 数据核实报告

调查范围：基督教/但丁侧的**结构与罪罚**。人物由 `verify-christian-cast` 负责，希腊罗马侧由他人负责。
本报告**只研究，未修改仓库任何文件**。

---

## 0. 一句话结论

**「七宗罪 → 地狱九层」这个框架不成立。** 但丁的地狱按亚里士多德《尼各马可伦理学》的
incontinenza / malizia / matta bestialitade（不节制／恶意／狂兽性）分层，这是《地狱篇》第
十一歌 Virgil 亲口说出的；七宗罪的完整对应在**《炼狱篇》的七层山**，而且但丁在《炼狱篇》
第十七歌另给了一套「爱的三种偏差」理论来排序它们。项目把七宗罪的 `dante_circle` 种进
`Statute.payload`，等于把一个后世通俗化的错误映射写成了数据。

---

## 1. 当前入库内容清单

### 1.1 欧洲 Realm（`seed_mythology.py:149-172`，`EUROPEAN_REALMS`）

字段顺序（`seed_mythology.py:71-72`）：
`realm_code, name_local, name_zh, name_en, name_egy, realm_type, tier, description,
memory_reset_mechanism, is_eternal, cycle_limit`

| realm_code | name_local | name_zh | name_en | tier | description | memory_reset | is_eternal |
|---|---|---|---|---|---|---|---|
| EU_HEAVEN | 天堂 | 上帝之国 | Kingdom of Heaven | 1 | Eternal paradise… | LETHE | True |
| EU_PURGATORY | 炼狱 | 涤罪所 | Purgatory | 1 | Temporary purification… | LETHE | False |
| EU_HELL_1ST | 第一层地狱 | 幽冥边境 | First Circle - Limbo | 1 | Limbo - virtuous pagans, unbaptized infants | LETHE | True |
| EU_HELL_2ND | 第二层地狱 | **贪食深渊** | Second Circle - Lust | 2 | Lustful souls - tossed by violent winds | LETHE | True |
| EU_HELL_3RD | 第三层地狱 | 饕餮泥沼 | Third Circle - Gluttony | 3 | Gluttons - lie in icy sludge beneath rain and hail | LETHE | True |
| EU_HELL_4TH | 第四层地狱 | 贪婪深渊 | Fourth Circle - Greed | 4 | Avaricious and prodigal - push heavy weights | LETHE | True |
| EU_HELL_5TH | 第五层地狱 | 愤怒沼泽 | Fifth Circle - Anger | 5 | Wrathful and sullen - fight on the Stygian marsh | LETHE | True |
| EU_HELL_6TH | 第六层地狱 | 异端荒原 | Sixth Circle - Heresy | 6 | Heretics - burned in flaming tombs | LETHE | True |
| EU_HELL_7TH | 第七层地狱 | 暴力之渊 | Seventh Circle - Violence | 7 | Violent against neighbors, selves, God - in three rings | LETHE | True |
| EU_HELL_8TH | 第八层地狱 | 欺诈深渊 | Eighth Circle - Malebolge | 8 | Fraud - ten concentric fosses of Malebolge | LETHE | True |
| EU_HELL_9TH | 第九层地狱 | 叛徒冰湖 | Ninth Circle - Treachery | 9 | Traitors - frozen in the lake of Cocytus (Judas, Brutus) | LETHE | True |

**好消息：九个 realm 的英文 `description` 逐条都对得上但丁原文**（下文 §2 逐条核对）。
真正的问题在 name_zh、memory_reset、以及 Statute 层。

### 1.2 七条 `DEADLY_SIN` Statute（`seed_mythology.py:732-792`）

来源标注 `DEADLY_SIN_SOURCE`（`seed_mythology.py:718-724`）明写取自
`docs/03_七宗罪与地狱惩罚.md` §1/§4/§5。

| code | ord | title | latin | virtue | **dante_circle** | inferno_punishment_zh | **purg_terrace** | purg_purgation_zh |
|---|---|---|---|---|---|---|---|---|
| EU-DS-01 | 1 | 傲慢 Pride | Superbia | 谦逊 | **1** | 永无止境的追求 | **1** | 重生轻 |
| EU-DS-02 | 2 | 贪婪 Greed | Avaritia | 慷慨 | 4 | 互相推撞，重物压身 | **2** | 被火枷锁 |
| EU-DS-03 | 3 | 淫欲 Lust | Luxuria | 贞洁 | 2 | 狂风呼啸吹卷 | **3** | 火焰中行走 |
| EU-DS-04 | 4 | 愤怒 Wrath | Ira | 温柔 | 5 | 在黑水里互相撕咬 | **4** | 被烟熏 |
| EU-DS-05 | 5 | 懒惰 Sloth | Acedia | 热心 | **3** | 躺卧臭水烂泥 | **5** | 奔跑呼喊 |
| EU-DS-06 | 6 | 暴食 Gluttony | Gula | 节制 | 3 | 躺卧臭水烂泥 | **6** | 饥渴交加 |
| EU-DS-07 | 7 | 嫉妒 Envy | Invidia | 仁爱 | **8** | 与馋媚者、邪术师同罚，被铁笼囚禁 | **7** | 被冷水浸泡 |

粗体 = 错误（详见 §3、§4）。

### 1.3 已有的 disclaimer（值得肯定）

`DANTE_MAPPING_NOTE`（`seed_mythology.py:725-730`）、`EU-DS-05` / `EU-DS-07` 的
`notes`、以及 `apps/judgment/models.py:144-147` 的 `DEADLY_SIN` docstring，都已声明
"a moral taxonomy plus a literary punishment scheme, not canon law"、"the circle recorded
here is that document's mapping, not a claim that Dante wrote the sin into that circle"。

**这些注释是诚实的，但不够。** 它们说的是「这是 docs/03 的映射，不是但丁写的」，
读起来像是"存在轻微出入"；实际情况是 `dante_circle` 这个字段本身在但丁体系里**没有定义**
（七宗罪里有三条根本没有对应的圈），而 `purgatorio_terrace` 是有确定答案的、可以直接查证
的，项目填错了 5 条。诚实的注释盖不住一个字段填的是错的值。

### 1.4 数据库状态

本地 `backend/db.sqlite3` 里**没有** `judgment_statute` 表（`sqlite_master` 只有
`judgment_judgment` / `dispatch_crosstenantjudgment*`）。上述七条以代码为准；实际落库
可能在 Postgres 或另一个 DB。

---

## 2. 但丁《地狱篇》九圈的准确内容

**分层依据（一手文献）**：《地狱篇》第十一歌，Virgil 引亚里士多德：

> "…those words / With which thine Ethics thoroughly discusses / The dispositions three,
> that Heaven abides not,— / **Incontinence, and Malice, and insane / Bestiality**?"
> …"**Incontinence / Less God offendeth**, and less blame attracts?"
> —— Longfellow 1867 英译，Inf. XI.79-84, 82-83（公版，Project Gutenberg #1001）

即：上层地狱（2-5 圈）= incontinenza 不节制；下层地狱（狄斯城内，6-9 圈）= malizia 恶意
（暴力 + 欺诈）与 matta bestialitade 狂兽性（背叛）。**七宗罪不在这套坐标里。**

### 2.1 九圈全表

| 圈 | Canto | 罪 | 刑罚（contrapasso） | 守卫者 | 项目 description 是否正确 |
|---|---|---|---|---|---|
| — 前庭 Antinferno | III | 中立者 ignavi（既不忠上帝也不叛）+ 地狱之门 + Acheron 河 | 被牛虻黄蜂追刺，蛆虫食其血泪 | **Charon**（摆渡 Acheron） | **项目完全没有这个 realm** |
| 1 Limbo | IV | 未受洗婴儿 + 有德异教徒（荷马、亚里士多德、萨拉丁、阿维森纳…） | 无肉刑，只有「无望而有欲」(sanza speme vivemo in disio) | —（Virgil 本人居此） | ✅ 正确 |
| 2 Lust 淫欲 | V | 情欲 | 永被狂风吹卷 | **Minos**（在此圈入口判罪，尾巴绕圈数 = 判入第几圈） | ✅ 正确 |
| 3 Gluttony 暴食 | VI | 饕餮 | 冰冷污泥中，被冷雨、冰雹、黑雪浇淋 | **Cerberus** | ✅ 正确 |
| 4 Greed 贪婪 | VII | 吝啬者 avari + 挥霍者 prodighi（**两组人，不只贪婪**） | 推巨石对撞，互骂 | **Plutus** | ✅ 正确（"Avaricious and prodigal" 写对了） |
| 5 Wrath 愤怒 | VII-VIII | 愤怒者 iracondi（外显）+ 忧郁/懒怠者 accidiosi/tristi（内抑） | Styx 沼中互相撕咬 / 沉在泥下吐泡 | **Phlegyas**（摆渡 Styx） | ✅ 正确 |
| 6 Heresy 异端 | IX-XI | 异端，尤指否认灵魂不朽的伊壁鸠鲁派 | 烈焰石棺中焚烧 | 狄斯城墙上的**堕天使 + 三复仇女神 Furies + Medusa**，由**天使信使**开门 | ✅ 正确 |
| 7 Violence 暴力（**三环 gironi**） | XII-XVII | | | **Minotaur**（入口） | ✅ 写了 "in three rings" |
| ├ 环1 | XII | 对他人的暴力（杀人、劫掠、暴君） | 沉于沸血河 Phlegethon | **Centaurs**（Chiron, Nessus, Pholus）持弓射浮出者 | |
| ├ 环2 | XIII | 对自己的暴力（自杀 + 挥霍毁产者） | 自杀者化为荆棘枯树，**Harpies** 啄食其叶；毁产者被黑母犬撕咬 | **Harpies** | |
| └ 环3 | XIV-XVII | 对上帝/自然/技艺的暴力（亵渎、鸡奸、放高利贷） | 灼热沙漠 + 永落火雨；亵渎者仰卧，鸡奸者不停奔跑，放贷者蹲坐 | —（出口由 **Geryon** 载下） | |
| 8 Fraud 欺诈（**十囊 Malebolge**） | XVIII-XXX | | | **Geryon**（载入） | ✅ 写了 "ten concentric fosses" |
| ├ 囊1 | XVIII | 拉皮条者 + 诱奸者 | 被长角魔鬼反向鞭打 | | |
| ├ 囊2 | XVIII | **谄媚者 flatterers** | 浸在粪便中 | | |
| ├ 囊3 | XIX | 买卖圣职者 simoniacs | 倒插石孔，脚底燃火 | | |
| ├ 囊4 | XX | **占卜者、术士、星相家** | 头颅反扭 180°，只能倒退行走 | | |
| ├ 囊5 | XXI-XXII | 贪赃枉法者 barrators | 沉于沸沥青 | **Malebranche** 魔鬼队 | |
| ├ 囊6 | XXIII | 伪善者 hypocrites | 穿外镀金内灌铅的斗篷缓行 | | |
| ├ 囊7 | XXIV-XXV | 盗贼 | 被蛇追咬，与蛇互换形体 | | |
| ├ 囊8 | XXVI-XXVII | **恶谋士（Ulysses、Guido da Montefeltro）** | 各自裹在一束火焰中 | | |
| ├ 囊9 | XXVIII-XXIX | 制造分裂者（Mohammed、Bertran de Born） | 被魔鬼持剑反复劈开 | | |
| └ 囊10 | XXIX-XXX | 伪造者（炼金术士、伪币、伪证、冒名） | 各类恶疾：癞疮、狂躁、水肿、高热 | | |
| 9 Treachery 背叛（**四带**，冻湖 Cocytus） | XXXI-XXXIV | | | **Giants**（井沿），Antaeus 放二人下去 | ✅ 正确 |
| ├ Caina | XXXII | 背叛血亲 | 冻在冰中，头朝上 | | |
| ├ Antenora | XXXII-XXXIII | 背叛国家/党派（Ugolino / Ruggieri） | 冻在冰中，头朝上 | | |
| ├ Tolomea | XXXIII | 背叛宾主 | 仰面冻结，泪水在眼中结冰封住眼睛 | | |
| └ Giudecca | XXXIV | 背叛恩主（**Judas / Brutus / Cassius**） | 完全埋在冰下；三人被 Lucifer 三张嘴嚼咬 | **Lucifer/Dis** | |

### 2.2 逐条核对项目的九个 description

| realm | 判定 |
|---|---|
| EU_HELL_1ST "Limbo - virtuous pagans, unbaptized infants" | ✅ |
| EU_HELL_2ND "Lustful souls - tossed by violent winds (Dante's Inferno)" | ✅（但 name_zh 是错的，见 §5） |
| EU_HELL_3RD "Gluttons - lie in icy sludge beneath rain and hail" | ✅ |
| EU_HELL_4TH "Avaricious and prodigal - push heavy weights (Dante)" | ✅ 特别好，写出了挥霍者 |
| EU_HELL_5TH "Wrathful and sullen - fight on the Stygian marsh" | ✅（严格说 sullen 是沉在泥下不是 fight，小瑕疵） |
| EU_HELL_6TH "Heretics - burned in flaming tombs" | ✅ |
| EU_HELL_7TH "Violent against neighbors, selves, God - in three rings" | ✅ |
| EU_HELL_8TH "Fraud - ten concentric fosses of Malebolge" | ✅ |
| EU_HELL_9TH "Traitors - frozen in the lake of Cocytus (Judas, Brutus)" | ✅ |

**九个 realm 的英文描述没有一条造假。** 这与埃及四十二判官的情况完全不同。

---

## 3. 核心结论：七宗罪 → 九层这个框架**不成立**

### 3.1 但丁自己给出的分层依据不是七宗罪

见 §2 开头的 Inf. XI 一手引文。地狱按 **不节制 / 恶意（暴力+欺诈）/ 狂兽性（背叛）** 分层。
Wikipedia 的 *Inferno (Dante)* 条目直述："The seven deadly sins do *not* structure Dante's Hell"，
与一手文本一致。

### 3.2 七宗罪里有三条在地狱**根本没有对应的圈**

| 七宗罪 | 但丁地狱里有没有专属的圈 |
|---|---|
| 傲慢 Superbia | **没有**。地狱没有傲慢圈。 |
| 嫉妒 Invidia | **没有**。地狱没有嫉妒圈。 |
| 懒惰 Acedia | **没有**独立的圈。学界通常把第五圈沉在 Styx 泥下的 accidiosi/tristi 与 acedia 联系起来，但但丁本人把他们写成「内抑的愤怒」——UT Austin *Danteworlds* 明说这一页把 sullenness 当作 "anger that is repressed"，并**没有**把它接到 acedia 上。这是一个学界有争议、但绝不能写成确定值的点。 |
| 淫欲 Luxuria | 第二圈 ✅ |
| 暴食 Gula | 第三圈 ✅ |
| 贪婪 Avaritia | 第四圈 ✅（但那一圈同时装着挥霍者——**这不是「贪婪」一条罪**） |
| 愤怒 Ira | 第五圈 ✅ |

也就是说：只有 incontinenza 那四圈（2-5）碰巧和四条七宗罪重合，因为「不节制」这个古典
范畴和这四条罪的语义确实相邻。**这是重合，不是对应关系。** 而 6-9 圈（异端、暴力、
欺诈、背叛）在七宗罪里完全没有位置，反过来傲慢/嫉妒/懒惰在地狱里完全没有位置。

### 3.3 七宗罪的完整对应在《炼狱篇》，而且但丁另有一套排序理论

《炼狱篇》第十七歌，Virgil 讲「爱的三种偏差」：

- **爱之偏邪（amore del male / 指向他人之恶）** → 下三层：**傲慢、嫉妒、愤怒**
- **爱之不足（amore lento）** → 第四层：**懒惰**
- **爱之过度（amore troppo）** → 上三层：**贪婪、暴食、淫欲**

炼狱山七层由下而上（Purg. X-XXVII）：

| 层 | 罪 | 苦修 | Canto | 相对美德（但丁给的范例） |
|---|---|---|---|---|
| 1 | **傲慢** | 背负巨石弯腰而行 | X-XII | 谦逊 |
| 2 | **嫉妒** | 眼睑被铁丝缝合 | XIII-XV | 慷慨/仁爱 |
| 3 | **愤怒** | 行走于呛人的浓烟中 | XV-XVII | 温良 |
| 4 | **懒惰** | 不停奔跑呼喊 | XVIII-XIX | 热忱 |
| 5 | **贪婪**（含挥霍） | 面朝下俯卧于地 | XIX-XXII | 节制/慷慨 |
| 6 | **暴食** | 在够不到的果树下饥渴（Tantalus 式） | XXII-XXIV | 节制 |
| 7 | **淫欲** | 穿过巨大的火墙 | XXV-XXVII | 贞洁 |

守门天使在但丁额上刻七个 **P**（peccatum），每过一层擦去一个（Purg. IX）。**七宗罪在
《神曲》里的正确挂载点就是这里。**

### 3.4 判定

> **项目把 `dante_circle` 作为七宗罪 Statute 的一个 payload 字段，这个字段在但丁体系里
> 不存在。它是后世（尤其是英语通俗读物和网络"九层地狱"图表）把两套不同的分类系统硬套
> 在一起的产物。**
>
> 而 `purgatorio_terrace` 字段是**有**确定答案的，项目把它填错了 5/7 条（见 §4.2）。
>
> 现有的 `DANTE_MAPPING_NOTE` 免责声明写得诚实，但它免责的方向反了：它说"这是 docs/03
> 的映射不是但丁的"，可 `purgatorio_terrace` 那一半根本没有免责空间——那是可查证的、
> 项目填错的事实。

---

## 4. 逐条错误清单

### 4.1 `dante_circle` 字段（7 条中 3 条是无中生有）

| Statute | 入库值 | 但丁实际 | 判定 |
|---|---|---|---|
| EU-DS-01 傲慢 | circle 1，刑罚"永无止境的追求" | 第一圈是 **Limbo**，住的是有德异教徒和未受洗婴儿，与傲慢无关 | ❌ **两处错**。①傲慢在地狱无圈。②"永无止境的追求"其实是 Limbo 的 *sanza speme vivemo in disio*（"我们无望地活在渴望中"，Inf. IV.42）——把 Limbo 的处境挪用成了傲慢的刑罚 |
| EU-DS-02 贪婪 | circle 4 | 第四圈 ✅（但该圈同时是挥霍者，不是纯贪婪） | ⚠️ 大致对，语义不精确 |
| EU-DS-03 淫欲 | circle 2 | 第二圈 ✅ | ✅ |
| EU-DS-04 愤怒 | circle 5 | 第五圈 ✅ | ✅ |
| EU-DS-05 懒惰 | circle 3，刑罚"躺卧臭水烂泥" | 第三圈是**暴食**。懒惰在地狱无独立圈；若要挂，学界指向第五圈的 accidiosi（有争议） | ❌ 错。代码 notes 已承认"the punishment is gluttony's"，却仍把值写进去了 |
| EU-DS-06 暴食 | circle 3 | 第三圈 ✅ | ✅ |
| EU-DS-07 嫉妒 | circle 8，刑罚"与馋媚者、邪术师同罚，**被铁笼囚禁**" | 嫉妒在地狱**无圈**。第八囊袋 2 是谄媚者（浸粪便），囊袋 4 是术士/占卜者（头颅反扭）。**Malebolge 十囊中没有任何一囊用铁笼** | ❌❌ **最严重的一条：刑罚是编造的。** 把两个不相干囊袋的居民拼在一起，再安上一个但丁从未写过的刑具 |

### 4.2 `purgatorio_terrace` / `purgatorio_purgation_zh`（7 条中 5 条错）

| Statute | 入库层 | 入库苦修 | 但丁实际层 | 但丁实际苦修 | 判定 |
|---|---|---|---|---|---|
| 傲慢 | 1 | "重生轻" | **1** | 背负巨石弯腰 | ⚠️ 层对；"重生轻"语义不明，与"负重石"正好相反 |
| 贪婪 | 2 | "被火枷锁" | **5** | 面朝下俯卧于地 | ❌ 层错 + 苦修错 |
| 淫欲 | 3 | "火焰中行走" | **7** | 穿过火墙 | ❌ 层错（苦修方向对） |
| 愤怒 | 4 | "被烟熏" | **3** | 行于浓烟 | ❌ 层错（苦修对） |
| 懒惰 | 5 | "奔跑呼喊" | **4** | 不停奔跑呼喊 | ❌ 层错（苦修对） |
| 暴食 | 6 | "饥渴交加" | **6** | 果树下饥渴 | ✅ |
| 嫉妒 | 7 | "被冷水浸泡" | **2** | 眼睑被铁丝缝合 | ❌❌ 层错 + **苦修完全编造**。但丁的嫉妒者是缝眼，不是浸冷水 |

**只有傲慢（层）和暴食（层+苦修）是对的，7 条错 5 条。**
而 `docs/03` §5 还自称"顺序与天主教七宗罪排列一致"——它连自己那个（错的）七宗罪顺序
都没对齐，更不是但丁的顺序。

### 4.3 七宗罪本身：名录、拉丁名、次序、美德

**拉丁名 —— 全部正确** ✅
Superbia / Avaritia / Luxuria / Ira / Acedia / Gula / Invidia，拼写和对应都无误。

**相对美德 —— 可接受** ⚠️
谦逊/慷慨/贞洁/温柔/热心/节制/仁爱 = humility / generosity(liberality) / chastity /
patience(meekness) / diligence(zeal) / temperance / kindness(charity)，是流行的
"seven contrary virtues" 表。但要知道：这套表源自 Prudentius《Psychomachia》(c. 410)
的德恶对战传统，是**后世整理出来的常见配对，不是教会正式定义的清单**（各版本用词有出入，
如 charity vs. kindness 对 envy）。

**次序 —— 归属错误** ❌
`docs/03` §11 明写"**以下为天主教标准顺序（按大格雷高利排列）**：傲慢→贪婪→淫欲→愤怒→
懒惰→暴食→嫉妒"，v1.1 修改说明还特意说"修正七宗罪顺序（按大格雷高利标准）"。这个归属
是错的：

- **格里高利一世的实际次序**（《约伯记道德论》Moralia in Job XXXI.xlv.87，一手拉丁文）：
  > "Radix quippe cuncti mali superbia est" —— 傲慢是万恶之根。
  > 由此根发出的七大主罪（primae eius soboles septem sunt principalia vitia）：
  > **inanis gloria, invidia, ira, tristitia, avaritia, ventris ingluvies, luxuria**
  > = 虚荣、嫉妒、愤怒、忧伤、贪婪、暴食、淫欲。
  >
  > 注意：**在格里高利那里傲慢不是七条之一，而是七条之上的"万恶之根/众恶之后"**；
  > 七条里第一位是 inanis gloria（虚荣），并且有 tristitia（忧伤）而**没有** acedia。

- 项目/docs 用的次序 **Superbia-Avaritia-Luxuria-Ira-Acedia-Gula-Invidia** 也不是
  **SALIGIA** 助记词的次序。SALIGIA（约 13-14 世纪的拉丁首字母助记）是
  **S**uperbia-**A**varitia-**L**uxuria-**I**nvidia-**G**ula-**I**ra-**A**cedia。
  项目把 Invidia 挪到了最后、Ira/Acedia/Gula 顺序也不同——**是一个被打乱的 SALIGIA，
  却署了格里高利的名。**

- 阿奎那《神学大全》I-II q.84 沿用格里高利的七条（他称 "capital sins"，头罪），
  并同样把傲慢处理为诸罪之源。

**来源链条（docs/03 §1 概括为"由格雷高利在6世纪系统化"，方向对，细节缺）：**
Evagrius Ponticus 的**八邪念**（希腊文 gastrimargia 暴食、porneia 淫、philargyria 贪财、
lypē 忧伤、orgē 怒、akēdia 倦怠、kenodoxia 虚荣、hyperēphania 傲慢，4 世纪）
→ John Cassian 译入西方拉丁传统
→ **Gregory the Great**（约 590，Moralia）：把 tristitia 并入 acedia、把 vanagloria
并入 superbia、**新增 invidia**，并把 superbia 提升为根，得到七条。

**另有一处措辞错误**：`docs/03` 第 9 行「七宗罪…**又称"七相反美德"**」——完全说反了。
"七相反美德"(seven contrary virtues) 是与七宗罪**对立**的另一张表，不是七宗罪的别名。

### 4.4 `docs/03` §3 的九圈图与表（是 Statute 的上游）

| 位置 | 错误 |
|---|---|
| ASCII 图 | 把「林勃 Limbo」和「地狱外廊」画在九圈**之外/之上**，然后另起"第一圈：傲慢"。**Limbo 就是第一圈**（Inf. IV）。而"地狱外廊"（前庭 Antinferno，中立者）确实在九圈之外——图把该在圈内的搬出去、把两个不同的东西并列了 |
| 表：第一圈=傲慢 | ❌ 见 §4.1 |
| 表：第七圈代表人物 "Alexander the Great" | ⚠️ Inf. XII.107 只写 "Alessandro"。传统注家多指亚历山大大帝，但也有相当多注家认为是费莱的暴君 Alexander of Pherae。**这是有分歧的，不该写成定论** |
| 表：第八圈"尤利西斯（骗子）" | ⚠️ Ulysses 在第八囊，罪名是 **consiglieri frodolenti 恶谋士**，刑罚是裹在火焰中，不是笼统的"骗子" |
| 表：第二圈"埃及艳后、海伦" | ✅ Inf. V.63-65 确有 Cleopatra 和 Elena |
| 表：第六圈 "Epicurus等" | ✅ Inf. X.13-15 确指伊壁鸠鲁及其门徒 |
| 表：第九圈"犹大·加略人" | ✅ Giudecca，Inf. XXXIV |
| §3 图注"第八圈（十层囊袋）…偷窃者/伪君子"（伪君子重复两次） | 明显的复制粘贴错误 |

---

## 5. 炼狱与 Lethe

### 5.1 但丁的炼狱山顶确实有 Lethe 和 Eunoè —— **这一点项目挂对了**

- Purg. XXVIII：Matelda 向但丁解释，地上乐园（Earthly Paradise，炼狱山顶的伊甸园）的水
  **不是**降雨形成的，而是直接出于神意，分向两边：
  一边**除去罪的记忆**（Lethe），另一边**恢复善行的记忆**（Eunoè）。
- Purg. XXXI：但丁在忏悔后被 Matelda 浸入 **Lethe**。
- Purg. XXXIII（末尾）：但丁饮 **Eunoè**，"纯净、准备好登上群星"（puro e disposto a
  salire a le stelle）——《炼狱篇》的最后一行。

所以 `Lethe` 作为 `CONDUIT` 挂在 `EU_PURGATORY` 上，**在但丁框架里是对的**——只要项目
认的是但丁的炼狱。**但少了 Eunoè。**

### 5.2 但丁的 Lethe 与希腊神话的 Lethe **不是同一个**

| | 希腊/罗马的 Lethe | 但丁的 Lethe |
|---|---|---|
| 位置 | 冥界（Hades）之中；维吉尔《埃涅阿斯纪》VI 卷在 Elysium | **炼狱山顶的地上乐园**——既不在地狱也不在天堂 |
| 作用 | 饮之**忘却整个前世**（全部记忆） | 只洗去**罪的记忆**，其余记忆完整保留 |
| 用途 | 《埃涅阿斯纪》VI：亡魂**转世投胎前**饮之 | 灵魂**登天堂前**的净化最后一步；但丁体系**没有轮回** |
| 有无对偶 | 无 | 有：**Eunoè**（希腊语"善念/好记忆"）——**但丁自创，古典神话中不存在** |

**判定**：项目 `docs/01` §四的对比表把"记忆消除：基督教=否，希腊=是（忘川河 Lethe）"
写成基督教没有忘川——这**与项目自己把 Lethe 挂在 EU_PURGATORY 的做法自相矛盾**。
两处必须选一个说法。按但丁：基督教侧有 Lethe，且作用与希腊的不同。

### 5.3 `memory_reset_mechanism = "LETHE"` 铺在全部 11 个欧洲 realm 上 —— ❌ 错

- **九个地狱圈全部标 LETHE 是明确错误。** 但丁的受罚者**保有记忆**：Francesca 完整复述
  自己的往事（Inf. V）、Ulysses 讲最后一次航行（Inf. XXVI）、Ugolino 讲塔中饿死（Inf. XXXIII）。
  Inf. X.100-108 Farinata 明说亡魂**能看远处的将来、看不见当下**，而与人世唯一的联系
  **就是记忆**。地狱里没有任何忘川。
- **EU_HEAVEN 标 LETHE** 勉强可辩（灵魂在登天堂前确实过 Lethe），但 Lethe 的地理位置
  在炼狱山顶，不在天堂，标在 Heaven 上会误导。
- **只有 EU_PURGATORY 标 LETHE 是对的。**

### 5.4 炼狱 realm 本身

项目只有**一个** `EU_PURGATORY`（tier=1）。但丁的炼狱是 **前炼狱（Ante-Purgatory，
Purg. I-IX，含被逐出教会者与迟悔者）+ 七层山 + 地上乐园**，共 9 个层次。
这一扁平化与地狱的扁平化是同一个问题（§6）。**特别值得注意的是：七宗罪真正该挂的
七层山，在项目里根本不存在。**

---

## 6. 扁平化成九个 realm 丢掉了什么

但丁的地狱按位置数至少 **24 个不同的处所**：前庭 1 + 圈 1-6 共 6 + 第七圈 3 环 +
第八圈 10 囊 + 第九圈 4 带 = 24。项目压成 9 个 realm，丢掉的是：

1. **前庭（Antinferno, Inf. III）整体消失**：地狱之门的铭文、中立者 ignavi、Acheron 河、
   摆渡人 Charon。项目把 Charon 挂在了 `EU_PURGATORY` 上（`seed_mythology.py:317`），
   而但丁的 Charon 在**地狱入口**摆渡 Acheron；炼狱那边是另一位驾船的**天使**。
   → 这条移交 `verify-christian-cast`。
2. **第八圈的十囊全部丢失** —— 这是《地狱篇》篇幅最大的部分（Canto XVIII-XXX，13 歌）。
   项目只剩一个 "Fraud"。谄媚、买卖圣职、占卜、贪赃、伪善、盗窃、恶谋、分裂、伪造
   九类罪与它们各自的 contrapasso 全部没有落点。**这直接导致 EU-DS-07（嫉妒）无处可放，
   于是被编了一个"铁笼"塞进第八圈**——扁平化和造假在这里是同一个因果链。
3. **第七圈三环丢失**：自杀者化树 + Harpies（Inf. XIII）是《地狱篇》最有名的意象之一，
   项目里没有对应位置。同时，"暴力"这一层同时装着杀人犯、自杀者和放高利贷者，
   在扁平模型里无法区分——而这三类的判罚逻辑（对他人/对自己/对神）完全不同。
4. **第九圈四带丢失**：Caina/Antenora/Tolomea/Giudecca 各自的背叛对象（血亲/国家/宾主/
   恩主）是但丁背叛观的核心区分，压成一个 "Treachery" 后，"背叛谁"这个维度消失了。
5. **上层/下层地狱的分界（狄斯城 Dis）消失**：第 6-9 圈在城墙之内，5 圈及以上在外。
   这个分界正是 incontinenza 与 malizia 的分界线——也就是但丁**唯一真正的分层依据**。
   扁平化把它抹掉后，九个圈看起来像一条线性严重度阶梯，恰好是**让"七宗罪套九层"看起来
   合理的那种误读**。
6. **每层的守卫者（Minos/Cerberus/Plutus/Phlegyas/Minotaur/Centaurs/Geryon/Malebranche/
   Giants）与 realm 的绑定关系丢失**：现在 Cerberus 挂在 `EU_HELL_1ST`（应为第三圈）、
   Minos 挂在 `EU_HELL_9TH`（应为第二圈入口）。→ 细节移交 `verify-christian-cast`，
   但这两条是 realm 归属错误，属结构问题。
7. **同一圈内多类罪人的并存关系丢失**：第四圈的吝啬者 vs 挥霍者、第五圈的暴怒者 vs
   忧郁者——这两对都是"同一恶德的两个方向"，是但丁的 contrapasso 设计。扁平模型只能
   记一个标签。

**唯一"没丢"的是**：九个 realm 的 `description` 里，第七、八、九圈都写了
"in three rings" / "ten concentric fosses" / "lake of Cocytus"，说明写 seed 的人知道有
细分。所以这是一个**自觉的简化**，不是无知——问题只在于 Statute 层把这个简化当成了
可以往里填精确 `dante_circle` 值的坐标系。

---

## 7. 来源清单

### 一手文献（《神曲》原文与公版译本）

| 来源 | 性质 | 用于 |
|---|---|---|
| Longfellow 1867 英译《神曲》，Project Gutenberg #1001 — https://www.gutenberg.org/files/1001/1001-h/1001-h.htm | **一手（公版译本）** | Inf. XI 的分类原文："Incontinence, and Malice, and insane Bestiality"；"Incontinence / Less God offendeth" |
| Gregory the Great, *Moralia in Job* XXXI.xlv.87（拉丁原文）— http://www.ldysinger.com/@texts/0600_greg-1/05_mor_31.htm | **一手（教父原典）** | "Radix quippe cuncti mali superbia est"；七主罪拉丁次序 inanis gloria, invidia, ira, tristitia, avaritia, ventris ingluvies, luxuria |
| 同上，Bliss 英译 — http://www.lectionarycentral.com/GregoryMoralia/Book31.html | 一手英译 | 交叉核对（该页分节标注方式与 §45.87 不直接对应，仅作旁证） |

### 学术研究 / 大学资源

| 来源 | 性质 | 用于 |
|---|---|---|
| *Danteworlds*, Guy P. Raffa, University of Texas at Austin — https://danteworlds.laits.utexas.edu/ （circle1, circle5, circle7 各页） | **学术（大学教学资源，有注家依据）** | 第七圈三环结构与守卫者；第五圈 iracondi/accidiosi 是"外显与内抑的愤怒"而**非** acedia；Limbo 居民 |
| University of Leeds, *Discover Dante*, Purgatorio — https://ahc.leeds.ac.uk/discover-dante/doc/purgatorio/page/5 | **学术（大学）** | 地上乐园、Lethe/Eunoè 的作用、Matelda |
| Alison Morgan, "Dante's Classification of Sin"（PDF）— https://www.alisonmorgan.co.uk/Articles/Dante's%20Classification%20of%20Sin%20AJ%20Morgan.pdf | 学术论文 | **本次未能读取**（PDF 为扫描件，本环境缺 poppler 无法渲染）。搜索摘要与上述一手引文一致，但**未直接核实，不作为结论依据** |
| Digital Dante, Columbia University（Barolini 注释）— https://digitaldante.columbia.edu/ | 学术 | **访问被 WAF 拦截（Anubis），未能取得内容** |
| Dartmouth Dante Project — http://dantelab.dartmouth.edu/ | 学术（历代注家全集） | **SSL 证书不匹配，未能取得内容** |

### 百科

| 来源 | 性质 | 用于 |
|---|---|---|
| Wikipedia, *Inferno (Dante)* — https://en.wikipedia.org/wiki/Inferno_(Dante) | 百科 | 九圈 + 三环 + 十囊 + 四带全表、Canto 编号、守卫者；明述 "The seven deadly sins do not structure Dante's Hell" |
| Wikipedia, *Purgatorio* — https://en.wikipedia.org/wiki/Purgatorio | 百科 | 七层山次序与苦修、前炼狱、七个 P、Lethe/Eunoè 的 Canto |
| Wikipedia, *Seven deadly sins* — https://en.wikipedia.org/wiki/Seven_deadly_sins | 百科 | Evagrius 八邪念希腊名、Cassian、Gregory 的合并/新增、SALIGIA、阿奎那 |
| Wikipedia, *Malebolge* / *Second circle of hell* / *Third circle of hell* / *Eunoe* / *Matelda* | 百科 | 交叉核对 |

### 评价

一手文献覆盖了本报告**两个最关键的结论**：地狱的分类依据（Inf. XI, Longfellow 公版）和
格里高利的实际次序（Moralia 拉丁原文）。九圈细分表与炼狱七层表主要依赖百科 + UT Austin
的教学资源，两者互相印证且与一手引文不冲突；这部分内容在但丁学界无争议，可信。
**未能取得 Digital Dante 与 Dartmouth Dante Project 的注家原文**，因此本报告对"某某注家
怎么说"一律不作断言。

### 版权

《神曲》原文（14 世纪）与 Longfellow 1867、Cary 译本均为公版，上文引用为短句。
未引用 Hollander、Mandelbaum、Sayers 等在版译本的正文。

---

## 8. 建议（**不实施**，仅列出）

按严重程度排序。

### P0 — 造假与错值

1. **删除 `EU-DS-07`（嫉妒）payload 里的 `inferno_punishment_zh`**：
   "与馋媚者、邪术师同罚，被铁笼囚禁" 是编造的。Malebolge 十囊中没有铁笼，且但丁
   没有把嫉妒者放进第八圈。这是本次核实中**唯一一处凭空捏造的刑罚**。
2. **修正 5 条 `purgatorio_terrace` 与对应的 `purgatorio_purgation_zh`**：
   贪婪→5（面朝下俯卧）、淫欲→7（穿过火墙）、愤怒→3（浓烟）、懒惰→4（奔跑呼喊）、
   嫉妒→2（**眼睑被铁丝缝合**，不是"被冷水浸泡"）。傲慢的"重生轻"应改为"背负巨石"。
   这一组是**有唯一正确答案**的事实错误。
3. **修正 `EU_HELL_2ND` 的 `name_zh`**：现为 "贪食深渊"（暴食），该圈是**淫欲**。
   与同一行的 `name_en` "Second Circle - Lust" 自相矛盾。建议 "淫欲之风" 一类。

### P1 — 框架问题

4. **`dante_circle` 字段建议整体移除或改名**。它把两套互不相干的分类系统当成一个坐标。
   若要保留但丁的圈层信息，正确做法是**在 realm 侧**记录（realm 本身已经写对了），
   而不是在七宗罪 Statute 上挂一个圈号。
   若坚持保留，至少应对傲慢/嫉妒/懒惰三条置空（`null`），并在字段说明里写明
   "但丁地狱不按七宗罪分层，这三条在《地狱篇》中无对应圈层"。
5. **`memory_reset_mechanism`**：九个地狱 realm 应改为"无"（但丁的受罚者保有记忆，
   Inf. X.100-108）。只有 `EU_PURGATORY` 保留 LETHE。`EU_HEAVEN` 若保留需加注说明
   Lethe 位于炼狱山顶而非天堂。
6. **补 `Eunoè`**：项目挂了 Lethe 却没有 Eunoè。在但丁体系里两条河是一对，
   且 Eunoè 是但丁自创（古典神话没有），单挂 Lethe 会让人误以为直接沿用了希腊的忘川。
7. **消除 `docs/01` §四的自相矛盾**：该表写"基督教 记忆消除=否"，与项目把 Lethe 挂在
   EU_PURGATORY 冲突。

### P2 — 文档源头

8. `docs/03_七宗罪与地狱惩罚.md` 是这批数据的**唯一来源且零引用**。至少需要：
   - §1 第 9 行"又称'七相反美德'" —— 删掉，说反了。
   - §1 的次序不能署"按大格雷高利排列"。格里高利的实际次序是
     inanis gloria/invidia/ira/tristitia/avaritia/ventris ingluvies/luxuria，且傲慢是根不是七之一。
     项目用的次序是被打乱的 SALIGIA。要么改成真正的 SALIGIA 并署 SALIGIA，
     要么改成格里高利的次序并署 Moralia XXXI.45。
   - §3 的 ASCII 图 —— Limbo 就是第一圈，不在九圈之外；第一圈不是傲慢。
   - §3 表"第七圈 Alexander the Great" —— 注明注家有分歧（大帝 vs. 费莱的亚历山大）。
   - §5 炼狱七层顺序整表重写（见 §3.3）。
   - 全文加脚注：Inf. XI 的分类依据、Purg. XVII 的爱之三偏差。
9. **`DANTE_MAPPING_NOTE` 的措辞需要改**。现在写的是"这是那份文档的映射，不是断言但丁
   把这条罪写进了那个圈"，语气像是在标注一处存疑。实际情况更强：**但丁的地狱根本不按
   七宗罪分层**，而且 `purgatorio_terrace` 那一半是可查证且填错的。免责声明不应被用来
   替错值背书。

### P3 — 结构（大改，需评估）

10. 若要让但丁侧真正立得住，最小的正确化不是把九圈拆成 24 个 realm，而是**给炼狱补七层**
    —— 因为**七宗罪的正确挂载点就是炼狱七层**。补上 `EU_PURGATORY_T1..T7` 之后，
    七条 Statute 就有了一个在但丁体系里**真实存在**的锚点，`dante_circle` 那个假坐标
    也就可以退休了。这比拆 Malebolge 十囊的收益高得多、改动小得多。
11. 前庭（Antinferno）缺一个 realm。Charon 现挂在 `EU_PURGATORY` 上无处可去，
    正是因为它缺位。
12. Cerberus（现 EU_HELL_1ST，应第三圈）与 Minos（现 EU_HELL_9TH，应第二圈入口）
    的 realm 归属错误 —— 已通报 `verify-christian-cast`。

---

*核实完成于 2026-08-14。全程未修改仓库任何文件。*
