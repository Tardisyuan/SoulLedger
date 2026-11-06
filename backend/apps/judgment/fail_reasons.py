"""「不过」的理由(v4 D6,用户 2026-11-06)与希腊落印时的两样标记(D7、D8)。

结案判 FAILED 时,判官从本文明的一套代码里选理由(Design v4 定稿 `reject_reason.*`,S10 屏);存在
`Judgment.fail_reasons`(代码列表)与 `fail_reason_note`(选「其他」时写的一句)。

**必填**,依据是定稿本身:理由面板的标题是 `reject.sheet.title`「选一个理由，才算判完」,希腊的标记写着
`reject.sheet.required`「必选」,S10 的说明是「没选时『不过 · 落印』是灰的」。所以经结案接口
(`POST /judgment/{id}/conclude/`,视图显式传 `require_fail_reason=True`)结原审 FAILED 时必须带理由;
进程内的服务调用(申诉改判、审批流、种子、测试帮手)一律不要求,带不带 `by` 都一样 —— 那些路径的输入不是
理由面板。给了就校验,无论谁给。

各文明一套(代码只是标识,文字在语言包 `reject_reason.*`):

* 地府 —— 一个罪目(`ChineseOffence`,二至九殿所掌,docs/11 §2.2)或 `OTHER`。选了罪目就写回
  `Judgment.offence`:自动选殿按它(`DispositionService._route_chinese`),判语「所犯 X,属第 n 殿所掌」与
  实际去处读的是同一列。
* 欧洲 —— 恰好一项:`MORTAL_SIN`(有未悔的大罪)/ `DENIED_IMMORTALITY`(否认灵魂不灭,→ 第 6 圈)/
  `NEUTRAL`(登记为中立者,前庭)/ `OTHER`。后两项读的是灵魂登记里的两个事实(`Soul.denied_immortality`、
  `Soul.neutral_in_life`),登记里没有就拒(`fail_reason_contradicts_record`):判语不能说一件登记没说的事。
  「哪一宗大罪」不在这里选,取本案引用的七宗罪条文(D9,`cited_deadly_sins`),不挂圈号(`8308204` 撤回过)。
* 希腊 —— 按所选的文书(`greek_account`):《高尔吉亚》`PERJURY` / `INJUSTICE`(524e-525a 的「伪誓与不义的疤痕」,
  可多选);《理想国》`MANY_DEATHS` / `BETRAYAL` / `ENSLAVEMENT`(615b-c);两套都有 `OTHER`。另加必选的
  可医 / 不可医标记(`greek_curability`,Grg. 526b-c「加上标记」),不可医者永罚(525b-c、Rep. 615c-616a)。
* 埃及 —— 不能选:理由由天平与 42 条否定告白自动列出(`reject.sheet.eg_auto`「理由由天平自动列出，不能另选」),
  给了就拒(`fail_reason_not_selectable`)。告白不实的序号见 `confessions.untruthful_ordinals`。

希腊的文书(`greek_account`,D8):官员落印时选《高尔吉亚》(`GORGIAS`,岔路两条路)或《理想国》(`REPUBLIC`,
千年那一路),文书按它渲染(`verdict_doc.gr.*` / `verdict_doc.gr_er.*`)。两篇不合并(Design 第五批)。经接口结
希腊的 PASSED / FAILED 必选;它只决定文书,不改路由。
"""
from apps.judgment.models import ChineseOffence, GreekAccount, GreekCurability, Verdict
from apps.souls.models import Civilization

OTHER = "OTHER"
NOTE_MAX = 500  # 列宽;PostgreSQL 强制 varchar(n),SQLite 不管(CLAUDE.md「SQLITE HIDES」)

EUROPEAN = ("MORTAL_SIN", "DENIED_IMMORTALITY", "NEUTRAL", OTHER)
GREEK = {
    GreekAccount.GORGIAS: ("PERJURY", "INJUSTICE", OTHER),
    GreekAccount.REPUBLIC: ("MANY_DEATHS", "BETRAYAL", "ENSLAVEMENT", OTHER),
}

#: 炼狱七台的条文 → 七宗罪(v4 键 `reject_reason.eu.sin.*`)。D9:欧洲文书「哪一宗大罪」只读这张表。
DEADLY_SIN_BY_STATUTE = {
    "EU-DS-T1": "pride", "EU-DS-T2": "envy", "EU-DS-T3": "wrath", "EU-DS-T4": "sloth",
    "EU-DS-T5": "greed", "EU-DS-T6": "gluttony", "EU-DS-T7": "lust",
}


class FailReasonRefusedError(Exception):
    """理由或希腊标记不成立。什么都没写(结案事务里、写入之前抛)。"""

    def __init__(self, message, code, status=400, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra


def allowed(civilization, account="") -> tuple:
    if civilization == Civilization.CHINESE:
        return (*ChineseOffence.values, OTHER)
    if civilization == Civilization.EUROPEAN:
        return EUROPEAN
    if civilization == Civilization.GREEK:
        return GREEK.get(account, ())
    return ()


def check(judgment, verdict, civilization, *, reasons, note, account, curability, required) -> None:
    """拒绝不成立的组合;成立时什么都不改(写入在 `apply`)。`required` = 经接口结原审。"""
    reasons = list(reasons or ())
    greek = civilization == Civilization.GREEK
    if (account or curability) and not greek:
        raise FailReasonRefusedError("Only a Greek case is stamped with an account or a curability mark",
                                     "greek_mark_not_applicable")
    if greek and verdict in (Verdict.PASSED, Verdict.FAILED) and required and not account:
        raise FailReasonRefusedError("Choose the account the verdict is written in: GORGIAS or REPUBLIC",
                                     "greek_account_required", choices=list(GreekAccount.values))
    if verdict != Verdict.FAILED:
        if reasons or note or curability:
            raise FailReasonRefusedError("Reasons and the curability mark go with a FAILED verdict only",
                                         "fail_reason_not_failed")
        return
    if civilization == Civilization.EGYPTIAN:
        if reasons or note:
            raise FailReasonRefusedError("The scale lists the reasons; none can be chosen",
                                         "fail_reason_not_selectable")
        return
    choices = allowed(civilization, account)
    if not reasons:
        if required and choices:
            raise FailReasonRefusedError("Choose a reason: the case is not decided until one is chosen",
                                         "fail_reason_required", choices=list(choices))
    else:
        unknown = [r for r in reasons if r not in choices]
        single = civilization in (Civilization.CHINESE, Civilization.EUROPEAN)
        if unknown or len(set(reasons)) != len(reasons) or (single and len(reasons) != 1):
            raise FailReasonRefusedError(
                "Not a reason this hall's verdict can give" + (" (choose exactly one)" if single else ""),
                "fail_reason_invalid", choices=list(choices), invalid=unknown)
    if OTHER in reasons and not (note or "").strip():
        raise FailReasonRefusedError("「Other」 needs one sentence", "fail_reason_note_required")
    if len(note or "") > NOTE_MAX:
        raise FailReasonRefusedError(f"The sentence is longer than {NOTE_MAX} characters", "fail_reason_note_too_long")
    soul = judgment.soul
    if ("DENIED_IMMORTALITY" in reasons and not soul.denied_immortality) or (
            "NEUTRAL" in reasons and not soul.neutral_in_life):
        raise FailReasonRefusedError("The soul's record does not say this", "fail_reason_contradicts_record")
    if greek and required and not curability:
        raise FailReasonRefusedError("Mark the soul curable or incurable (Gorgias 526b-c)", "curability_required",
                                     choices=list(GreekCurability.values))


def apply(judgment, verdict, civilization, *, reasons, note, account, curability) -> None:
    """把已校验的理由与标记写到案子上(调用方随结案一起 save)。"""
    judgment.fail_reasons = list(reasons or ()) if verdict == Verdict.FAILED else []
    judgment.fail_reason_note = (note or "").strip() if verdict == Verdict.FAILED else ""
    judgment.greek_account = account or ""
    judgment.greek_curability = curability or ""
    if civilization == Civilization.CHINESE and judgment.fail_reasons and judgment.fail_reasons[0] != OTHER:
        judgment.offence = judgment.fail_reasons[0]


def cited_deadly_sins(judgment) -> list[str]:
    """D9:本案引用了哪几台的条文,就是哪几宗;没引用是空列表(文书不写那一句)。只读,不存。"""
    codes = [c.statute.code for c in judgment.citations.all() if not getattr(c, "is_deleted", False)]
    return [DEADLY_SIN_BY_STATUTE[code] for code in codes if code in DEADLY_SIN_BY_STATUTE]
