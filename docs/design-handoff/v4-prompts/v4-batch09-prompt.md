# SoulLedger · Design v4 · 第九批 · 界域类型的叫法按种子重定(2026-11-06)

回复写到 `v4-batch09-reply.md`,三种语言写到 `v4-batch09-zh.json` / `v4-batch09-en.json` / `v4-batch09-egy.json`,发布到同一目录。这一批只有一件事,不用出稿子。

第八批第 7 条给了每个文明一套界域类型的叫法,已经进代码(`realms.types_by_civ.<文明>.<类型>`)。但哪类装了哪些界域,你是按界域码推断的,和仓库的种子数据(`backend/apps/actors/mythology/realms.py`)有出入。用户决定:**种子和路由不改,请按种子的实际归类重定叫法。**

## 种子的实际归类

类型是 `HELL` / `PURGATORY` / `BLISS` / `NEUTRAL` / `ANNIHILATION` 五个,哪类下面装了哪些界域如下(括号里是种子的中文名):

- DY BLISS: DY_01_HEAVEN(天堂)、DY_02_YANGLIU(杨柳宫)
- DY HELL: DY_COURT_01_QINGUANG(第一殿)、DY_COURT_02_CHUJIANG(第二殿)、DY_COURT_03_SONGDI(第三殿)、DY_COURT_04_WUGUAN(第四殿)、DY_COURT_05_YANLUO(第五殿)、DY_COURT_06_BIANCHENG(第六殿)、DY_COURT_07_TAISHAN(第七殿)、DY_COURT_08_DUSHI(第八殿)、DY_COURT_09_PINGDENG(第九殿)、DY_COURT_10_ZHUANLUN(第十殿)
- DY PURGATORY: DY_00_PURGATORY(待审所)
- EG PURGATORY: EG_DUAT_ENTRY(杜阿特入口)、EG_SEVEN_ARRWT(七道通路)、EG_HALL_TWO_TRUTHS(真理殿堂)、EG_TWENTYONE_SEBKHET(二十一道门户)
- EU BLISS: EU_HEAVEN(天堂)
- EU HELL: EU_HELL_1ST(第一层地狱)、EU_HELL_2ND(第二层地狱)、EU_HELL_3RD(第三层地狱)、EU_HELL_4TH(第四层地狱)、EU_HELL_5TH(第五层地狱)、EU_HELL_6TH(第六层地狱)、EU_HELL_7TH(第七层地狱)、EU_HELL_8TH(第八层地狱)、EU_HELL_9TH(第九层地狱)、EU_ANTINFERNO(地狱前庭)
- EU NEUTRAL: EU_ACHERON(阿刻戎渡口)、EU_PLATO_MEADOW(岔路草原)
- EU PURGATORY: EU_PURGATORY(炼狱)、EU_PURGATORY_T1_PRIDE(炼狱第一层)、EU_PURGATORY_T2_ENVY(炼狱第二层)、EU_PURGATORY_T3_WRATH(炼狱第三层)、EU_PURGATORY_T4_SLOTH(炼狱第四层)、EU_PURGATORY_T5_AVARICE(炼狱第五层)、EU_PURGATORY_T6_GLUTTONY(炼狱第六层)、EU_PURGATORY_T7_LUST(炼狱第七层)、EU_EARTHLY_PARADISE(地上乐园)
- GR BLISS: GR_ISLES_OF_THE_BLESSED(至福岛)
- GR HELL: GR_TARTARUS(塔尔塔罗斯)
- GR NEUTRAL: GR_ACHERON(阿刻戎渡口)
- EG BLISS: EG_AARU(芦苇原)
- EG ANNIHILATION: EG_ANNIHILATION(第二次死亡,显示名「湮灭」)

几处要注意:
- 地府十殿是 `HELL`,地府没有 `NEUTRAL`。你给的地府中立类叫法「殿司」现在没有界域用到;概览表里十殿会读成地狱类的叫法。`/realms` 页上十殿另按「殿」显示,不受影响。
- 埃及真理殿堂(两真之殿)是 `PURGATORY`,不是 `NEUTRAL`。
- `EU_PLATO_MEADOW`(岔路草原)码是 EU 开头,但它是希腊《理想国》的审判草原,类型 `NEUTRAL`,和阿刻戎渡口同一类,所以会和渡口用同一个叫法。
- 欧洲 `EU_ANTINFERNO`(前庭)是 `HELL`;`/realms` 页另有一个例外把它显示成中立。

## 要做的

每个文明每个用得到的类型给一个叫法,三种语言。没有界域的类型不用给。一个类型下面装着性质不同的界域时(如欧洲 `PURGATORY` 同时有炼狱七层和地上乐园、希腊 `NEUTRAL` 同时有渡口和审判草原),给一个能同时盖住它们的词,或在回复里说明你建议怎样拆(拆需要改种子,要用户另定)。

一律按 v4;第七、八批已定的其他文字不动。
