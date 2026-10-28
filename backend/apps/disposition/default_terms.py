"""没写刑期的处置按界域给的默认刑期(用户 2026-10-29:执行即服刑、刑满才转世,所以每一站都要有个期满日)。

一张表,不是界域上的一列:默认值是「判官没写时先填什么」,不是界域的属性 —— 判官结案时照样写自己的
`term_years`(审判台「戊 · 发落」),之后照样 PATCH `sentence_years`;这里只在**没写**、且不是永久刑时填。
表外的界域(没有出处也没有工程设定的、永久的、埃及的两处)不填,行为与以前一样:没有期满日,执行即服完。

回填迁移 disposition/0017 抄了这张表的一份:迁移里不 import 运行时常量。改这里时
**不要**回头改那份 —— 那是当时回填用的值。

出处
* 希腊 —— 《理想国》卷十 615a-b:每件不义罚十倍,百年一期,地下之旅一千年(docs/02_希腊冥府审判与人物详解.md
  §4.3【已证】,`apps.ledger.readings.GREEK_CIRCUIT_YEARS`)。至福岛同为千年:§4.3「两条路程长度相同」,
  天上那一边是**由文意推出**(原文 615a 只直说了地下的千年),文档标【存疑】程度很小。
* 地府十殿(第二至第九殿)—— **工程设定**。《玉历宝钞》逐殿叙述,「没有条款编号,没有刑期年数」
  (docs/11_地府审判制度与冥律.md §1.1 表、§4.1);docs/04 十八层地狱的「以人间一年为一日」是二手民俗材料,
  文中明说「不得作为 seed 依据」。取 (殿序 − 1) × 10 年(二殿 10 年……九殿 80 年)。十殿按所掌罪类分、
  不是轻重阶梯(`DispositionService._route_chinese` 的注释),这里的递增只沿用系统自己没填罪目时按严重度分殿的
  那个次序;步长与申诉补偿的折算单位一致(`judgment.appeals.YEARS_PER_COMPENSATION_POINT["CHINESE"] = 10`)。
* 欧洲炼狱(总称与七层)—— **工程设定**:docs/01_欧洲、docs/03 都没写年数。每层 100 年。可参照的一手是但丁
  《炼狱》XXI.67-69 斯塔提乌斯在第五层「五百多年」、XXII.92-93 在第四层「四百多年」—— 那是一个人在一层的
  停留,不是每层的定额,所以没拿来当表值。地狱九圈是永久的,不在表里。
"""

GREEK_JOURNEY_YEARS = 1000

DEFAULT_TERM_YEARS = {
    # 希腊(《理想国》615a-b,见上)
    "GR_TARTARUS": GREEK_JOURNEY_YEARS,
    "GR_ISLES_OF_THE_BLESSED": GREEK_JOURNEY_YEARS,
    # 地府十殿(工程设定)
    "DY_COURT_02_CHUJIANG": 10,
    "DY_COURT_03_SONGDI": 20,
    "DY_COURT_04_WUGUAN": 30,
    "DY_COURT_05_YANLUO": 40,
    "DY_COURT_06_BIANCHENG": 50,
    "DY_COURT_07_TAISHAN": 60,
    "DY_COURT_08_DUSHI": 70,
    "DY_COURT_09_PINGDENG": 80,
    # 欧洲炼狱(工程设定)
    "EU_PURGATORY": 100,
    "EU_PURGATORY_T1_PRIDE": 100,
    "EU_PURGATORY_T2_ENVY": 100,
    "EU_PURGATORY_T3_WRATH": 100,
    "EU_PURGATORY_T4_SLOTH": 100,
    "EU_PURGATORY_T5_AVARICE": 100,
    "EU_PURGATORY_T6_GLUTTONY": 100,
    "EU_PURGATORY_T7_LUST": 100,
}


def default_term_years(realm_code, *, is_eternal=False):
    """这个界域没写刑期时的默认年数;永久刑、或表里没有,为 None。"""
    if is_eternal or not realm_code:
        return None
    return DEFAULT_TERM_YEARS.get(realm_code)


def fill(sentence_years, realm_code, *, is_eternal=False):
    """写了就用写的;没写就默认(可能仍是 None)。"""
    if sentence_years is not None:
        return sentence_years
    return default_term_years(realm_code, is_eternal=is_eternal)
