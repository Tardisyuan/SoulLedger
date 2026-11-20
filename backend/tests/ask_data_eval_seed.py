"""问数评测的固定种子(docs/ARCHITECTURE-ask-data.md §7):两个殿,各几十条灵魂 / 案件 / 处置 / 受刑计划,时间钉死。

`apps/soul_assist/evalsets/ask_data.json` 的 `today` 是 2026-11-15:这里没有晚于它的时间。值全由序号 i 算出
(k = i + salt,salt 让两个殿的分布不同),所以同一份种子每次跑出同样的 gold 结果。各殿留一条软删的灵魂、案件与处置:
RLS 策略看不到它们,gold 也就不数它们。用 `bulk_create`,不走 `save()` 与信号:这里要的是行,不是业务流程。
"""
import uuid
from datetime import UTC, datetime, timedelta

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.sentence_plan.models import SentencePlan
from apps.souls.models import Soul

TODAY = datetime(2026, 11, 15, tzinfo=UTC)
T0 = datetime(2025, 1, 10, 9, 0, tzinfo=UTC)
STATES = ["DISPOSED", "DISPOSED", "JUDGING", "REINCARNATING", "SETTLED", "LOST", "ALIVE"]
VERDICTS = ["PASSED", "FAILED", "FAILED", "PURGATORY"]
OFFENCES = ["MURDER", "TRADE_FRAUD", "ENVY", "DEFYING_ELDERS", "ARSON"]
CONTINENTS = ["NANZHAN", "DONGSHENG", "XINIU", "BEIJULU"]
HALLS = {
    # 殿码: (文明, 殿名, 灵魂数, salt)
    "CN_DIYU": ("CHINESE", ["第一殿", "第五殿", "第十殿"], 30, 0),
    "EU_HEAVEN_HELL": ("EUROPEAN", ["天堂审判庭", "地狱审判庭"], 18, 3),
}


def _id(hall, kind, i):
    return uuid.uuid5(uuid.NAMESPACE_URL, f"ask-data-eval/{hall}/{kind}/{i}")


def seed(tenants):
    """tenants: {殿码: Tenant},键取自 HALLS。"""
    for code, tenant in tenants.items():
        _seed_hall(code, tenant, *HALLS[code])


def _seed_hall(code, tenant, civilization, courts, n, salt):
    chinese = civilization == "CHINESE"
    souls, judgments = [], []
    for i in range(n):
        k = i + salt
        death_year = 1960 + (k * 3) % 66
        soul = Soul(
            id=_id(code, "soul", i), tenant=tenant, home_tenant=tenant, name=f"eval {code} {i}",
            current_state=STATES[k % 7], birth_year=death_year - 30 - k % 50, death_year=death_year,
            death_month=1 + k % 12, death_day=1 + k % 28, merit_score=(k * 37) % 100, demerit_score=(k * 53) % 120,
            origin_region="EUROPE" if k % 5 == 0 else "ASIA",
            birth_continent=CONTINENTS[k % 4] if chinese else "",
            baptism="UNRECORDED" if chinese else ("BAPTISED" if k % 2 else "UNBAPTISED"),
            soup_taken_at=T0 + timedelta(days=20 * i) if chinese and k % 3 == 0 else None,
            create_time=T0 - timedelta(days=30) + timedelta(days=20 * i), is_deleted=i == n - 1,
        )
        souls.append(soul)
        opened = T0 + timedelta(days=22 * i, hours=i % 8)
        judgments.append(_judgment(code, tenant, soul, civilization, courts, i, k, opened, cycle=1))
        if i % 4 == 0 and opened + timedelta(days=60) <= TODAY:
            judgments.append(_judgment(code, tenant, soul, civilization, courts, 100 + i, k, opened + timedelta(days=60),
                                       cycle=2, final=k % 8 == 0))
    created = {j.pk: j.created_at for j in judgments}
    Soul.all_objects.bulk_create(souls)
    Judgment.all_objects.bulk_create(judgments)
    for pk, at in created.items():  # auto_now_add 在 bulk_create 时盖掉了给定值,再钉回去
        Judgment.all_objects.filter(pk=pk).update(created_at=at)

    dispositions, plans = [], []
    for j in judgments:
        if j.cycle != 1 or j.is_deleted or j.verdict not in ("FAILED", "PURGATORY"):
            continue
        k = j.k
        eternal = k % 11 == 2
        executed_at = j.concluded_at + timedelta(days=1) if k % 3 != 0 else None
        expired_at = executed_at + timedelta(days=200) if executed_at and k % 4 == 1 else None
        if expired_at and expired_at > TODAY:
            expired_at = None
        d = Disposition(
            id=_id(code, "disposition", k), tenant=tenant, soul_id=j.soul_id, judgment_id=j.pk, cycle=1,
            is_eternal=eternal, sentence_years=None if eternal else 5 + 10 * (k % 9),
            is_executed=executed_at is not None, executed_at=executed_at, expired_at=expired_at,
            memory_reset="MENGPO" if chinese else "NONE",
            term_start_year=executed_at.year if executed_at else None,
            term_start_month=executed_at.month if executed_at else None,
            term_start_day=executed_at.day if executed_at else None,
            is_deleted=len(dispositions) == 2,
        )
        d.pinned_created_at = j.concluded_at
        dispositions.append(d)
        status = ("HELD" if eternal else "COMPLETED" if expired_at else "ACTIVE" if executed_at
                  else "CANCELLED" if k % 2 else "ACTIVE")
        plans.append(SentencePlan(
            id=_id(code, "plan", k), tenant=tenant, soul_id=j.soul_id, cycle=1, status=status,
            origin_judgment_id=j.pk, completed_at=expired_at, create_time=j.concluded_at + timedelta(hours=1),
        ))
    Disposition.all_objects.bulk_create(dispositions)
    for d in dispositions:
        Disposition.all_objects.filter(pk=d.pk).update(created_at=d.pinned_created_at)
    SentencePlan.all_objects.bulk_create(plans)


def _judgment(code, tenant, soul, civilization, courts, i, k, opened, *, cycle, final=None):
    chinese = civilization == "CHINESE"
    final = k % 5 != 0 if final is None else final
    verdict = (VERDICTS[k % 4] if cycle == 1 else "FAILED") if final else None
    concluded = opened + timedelta(days=3 + k % 20) if final else None
    grievance = {1: "FILED", 3: "REJECTED"}.get(k % 6) or ("UPHELD" if k % 9 == 4 else "")
    untimely = chinese and cycle == 1 and k % 7 == 3
    j = Judgment(
        id=_id(code, "judgment", i), tenant=tenant, soul=soul, civilization=civilization,
        case_number=f"EVAL-{code}-{i:03d}", court=courts[k % len(courts)], cycle=cycle,
        kind="ORIGINAL" if cycle == 1 else "REOPEN", is_final=final, verdict=verdict, concluded_at=concluded,
        concluded_balance=soul.merit_score - soul.demerit_score if final else None,
        grievance_status=grievance, grievance_level=("MAJOR" if k % 2 else "MINOR") if grievance else "",
        grievance_filed_at=opened + timedelta(days=2) if grievance else None,
        grievance_decided_at=opened + timedelta(days=10) if grievance in ("REJECTED", "UPHELD") else None,
        offence=OFFENCES[k % 5] if chinese and verdict == "FAILED" else "",
        untimely=untimely, held_until=(opened + timedelta(days=30)).date() if untimely else None,
        wrongful_death_cause="ACCIDENT" if untimely else "",
        stale_since=opened + timedelta(days=30) if not final and k % 2 == 0 else None,
        claimed_at=opened + timedelta(days=1) if not final else None,
        is_deleted=cycle == 1 and i == 1,
    )
    j.created_at = opened
    j.k = k
    return j
