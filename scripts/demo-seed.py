"""Seed for the Vercel demo's recording (scripts/demo-record.sh). Never run this against a database you care about.

Data goes in through the same services production uses (`die`, `conclude`, the plan and dispatch services, the
workflow's `complete_node`), so what gets recorded is what the app really answers. Names are mythological; there is
no real person's data in here. Every soul's fate is written out in `PLAN`; add a line to add a soul.
"""
import os
import random
import sys
from datetime import timedelta
from io import StringIO
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "demo_settings")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import django  # noqa: E402

django.setup()

from django.core.management import call_command  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.audit.models import AuditAction, AuditLog  # noqa: E402
from apps.authentication.models import User  # noqa: E402
from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey, TudiGod, WebhookConfig  # noqa: E402
from apps.dispatch.models import ParticipantRole  # noqa: E402
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService  # noqa: E402
from apps.judgment import appeals, claims  # noqa: E402
from apps.judgment.models import (  # noqa: E402
    CityGod,
    CityGodStatus,
    DuatStage,
    Judgment,
    JudgmentComment,
    Verdict,
)
from apps.notifications.models import UserNotification  # noqa: E402
from apps.realms.models import Realm  # noqa: E402
from apps.reincarnation.services import ReincarnationService, drink_soup  # noqa: E402
from apps.sentence_plan.models import SentencePlan  # noqa: E402
from apps.social.models import (  # noqa: E402
    Comment,
    Follow,
    Post,
    Report,
    ReportEntry,
    SensitiveWord,
    SocialMute,
    UserProfile,
)
from apps.soul_accounts import rebirth  # noqa: E402
from apps.soul_accounts import services as accounts  # noqa: E402
from apps.souls.models import Soul  # noqa: E402
from apps.souls.record_models import SoulRecord  # noqa: E402
from apps.tenants.models import Tenant  # noqa: E402
from apps.workflow.models import ApprovalWorkflow  # noqa: E402
from tests.sentence_plan_support import execute_only, serve, stop_realm  # noqa: E402

random.seed(20261102)
NOW = timezone.now()

HALL_NAMES = {"CN_DIYU": "中国地府", "EU_HEAVEN_HELL": "欧洲天堂地狱", "EG_DUAT": "埃及杜阿特", "GR_HADES": "希腊冥府"}
CITY_GODS = {"CN_DIYU": "都城隍", "EU_HEAVEN_HELL": "Saint Peter's Gate", "EG_DUAT": "Thoth's Scribes", "GR_HADES": "Charon's Ferry"}

OFFICERS = {
    "CN_DIYU": [("cui_jue", "崔珏", "JUDGE"), ("heibai", "黑白无常", "OFFICER"), ("zhong_kui", "钟馗", "JUDGE"), ("meng_po", "孟婆", "MODERATOR")],
    "EU_HEAVEN_HELL": [("minos", "Minos", "JUDGE"), ("uriel", "Uriel", "OFFICER"), ("beatrice", "Beatrice", "MODERATOR")],
    "EG_DUAT": [("anubis", "Anubis", "JUDGE"), ("thoth", "Thoth", "OFFICER"), ("maat", "Ma'at", "MODERATOR")],
    "GR_HADES": [("rhadamanthus", "Rhadamanthus", "JUDGE"), ("aeacus", "Aeacus", "OFFICER"), ("hermes", "Hermes", "MODERATOR")],
}

# (name, merit, demerit, fate). Fates, most to least finished:
#   alive        never died
#   citygod      dead, still before the city god
#   queue        dead, sent on, waiting in the claim queue
#   claimed      as queue, in the demo judge's own hands
#   flow         concluded, the approval flow half walked
#   failed       concluded FAILED, flow walked, sentence being served
#   passed       concluded PASSED, flow walked, waiting to be reborn
#   reborn       the whole way round, once
SOULS = {
    "CN_DIYU": [
        ("屈原", 92, 8, "reborn"), ("窦娥", 70, 2, "queue"), ("梁山伯", 66, 5, "passed"), ("祝英台", 71, 4, "passed"),
        ("牛郎", 60, 10, "alive"), ("织女", 88, 1, "alive"), ("杜丽娘", 55, 12, "queue"), ("柳梦梅", 48, 9, "claimed"),
        ("白素贞", 40, 35, "flow"), ("法海", 30, 44, "flow"), ("曹操", 50, 80, "failed"), ("董卓", 4, 96, "failed"),
        ("秦桧", 3, 99, "failed"), ("陈世美", 12, 61, "queue"), ("潘金莲", 18, 52, "claimed"), ("聂小倩", 45, 20, "citygod"),
        ("宁采臣", 58, 6, "citygod"), ("刘伶", 33, 27, "alive"),
    ],
    "EU_HEAVEN_HELL": [
        ("Tristan", 62, 30, "flow"), ("Isolde", 64, 28, "passed"), ("Dido", 40, 55, "queue"), ("Francesca da Rimini", 35, 45, "failed"),
        ("Paolo Malatesta", 34, 46, "failed"), ("Faust", 41, 70, "failed"), ("Ulysses", 50, 60, "queue"), ("Orlando", 77, 13, "passed"),
        ("Roland", 85, 9, "passed"), ("Guinevere", 60, 25, "alive"), ("Lancelot", 66, 31, "alive"), ("Percival", 90, 3, "alive"),
    ],
    "EG_DUAT": [
        ("Sinuhe", 72, 18, "queue"), ("Khufu", 44, 40, "flow"), ("Nefertari", 91, 4, "passed"), ("Imhotep", 95, 2, "passed"),
        ("Hatshepsut", 83, 12, "queue"), ("Akhenaten", 30, 65, "flow"), ("Ani the Scribe", 80, 6, "passed"), ("Tutu", 75, 8, "alive"),
        ("Merit-Neith", 68, 14, "alive"), ("Setne", 22, 58, "failed"), ("Bata", 57, 21, "flow"), ("Anpu", 61, 19, "queue"),
    ],
    "GR_HADES": [
        ("Orpheus", 74, 16, "queue"), ("Eurydice", 80, 5, "passed"), ("Sisyphus", 9, 93, "failed"), ("Tantalus", 6, 97, "failed"),
        ("Achilles", 66, 42, "flow"), ("Patroclus", 73, 11, "passed"), ("Odysseus", 69, 37, "queue"), ("Penelope", 94, 2, "reborn"),
        ("Antigone", 88, 7, "alive"), ("Hector", 86, 10, "alive"), ("Ixion", 5, 88, "failed"), ("Alcestis", 92, 3, "queue"),
    ],
}

BIOS = {
    "屈原": "楚三闾大夫,投汨罗而死。", "窦娥": "含冤负屈,六月飞雪。", "曹操": "挟天子以令诸侯。", "秦桧": "以莫须有之罪杀岳飞。",
    "Faust": "Sold his soul for knowledge and did not read the terms.", "Sisyphus": "Cheated death twice; pushes a stone uphill.",
    "Orpheus": "Looked back.", "Tantalus": "Served his son to the gods.", "Imhotep": "Architect of the Step Pyramid.",
    "Nefertari": "The one for whom the sun shines.", "Roland": "Blew the horn too late at Roncevaux.",
}

PLACES = {
    "CN_DIYU": ["汨罗", "楚州", "会稽", "钱塘", "长安", "洛阳", "金陵"], "EU_HEAVEN_HELL": ["Ravenna", "Rimini", "Carthage", "Wittenberg", "Camelot", "Ithaca"],
    "EG_DUAT": ["Memphis", "Thebes", "Abydos", "Saqqara", "Amarna"], "GR_HADES": ["Thrace", "Corinth", "Phthia", "Argos", "Thebes"],
}

NOTES = {
    "PASSED": "功过相抵后仍有余善,准入轮回。", "FAILED": "恶业深重,依律发落。",
}


def officer(username, display, role, tenant, password="demo-only-not-a-secret"):
    user, created = User.objects.get_or_create(username=username, defaults=dict(
        role=role, tenant=tenant, display_name=display, email=f"{username}@underworld.example"))
    if created:
        user.set_password(password)
        user.must_change_password = False
        user.save()
    return user


def walk(case, stop_before_last=False):
    flow = ApprovalWorkflow.all_objects.filter(judgment_id=case.pk).first()
    if flow is None:
        return
    walked = 0
    while True:
        flow = ApprovalWorkflow.all_objects.get(pk=flow.pk)
        if flow.current_node_id is None:
            return
        if stop_before_last and walked >= 1:
            return
        if not flow.complete_node(flow.current_node_id, "PASSED"):
            return
        walked += 1


def sent_on(case):
    Judgment.all_objects.filter(pk=case.pk, city_god_status=CityGodStatus.PENDING).update(city_god_status=CityGodStatus.SENT_ON)
    # The 70 days of embalming and the wait in 枉死城 are real time; a demo case has already sat them out.
    Judgment.all_objects.filter(pk=case.pk).update(held_until=None)
    Judgment.all_objects.filter(pk=case.pk, duat_stage=DuatStage.EMBALMING).update(duat_stage="")
    case.refresh_from_db()
    return case


MERITS = {
    "CHINESE": [("CHARITY", "饥年开仓,赈济乡里"), ("COMPASSION", "收养孤童三人"), ("HONESTY", "拾金不昧,守候失主"), ("PIETY", "奉养老母至终")],
    "EUROPEAN": [("CHARITY", "Gave a tenth to the poor of the parish"), ("COURAGE", "Held the pass alone"), ("PIETY", "Kept vigil through Lent"), ("COMPASSION", "Nursed the sick in the plague year")],
    "EGYPTIAN": [("PIETY", "Maintained the offerings at Abydos"), ("HONESTY", "Kept the granary measure true"), ("CHARITY", "Gave bread to the hungry"), ("WISDOM", "Taught the young scribes")],
    "GREEK": [("PIETY", "Buried the unburied at the roadside"), ("COURAGE", "Stood in the line at the river"), ("COMPASSION", "Received the suppliant at the hearth"), ("WISDOM", "Counselled peace in the assembly")],
}
DEMERITS = {
    "CHINESE": [("DECEPTION", "伪造地契,夺人田产"), ("CRUELTY", "苛待仆役,致其伤残"), ("GREED", "放贷取息逾倍"), ("MURDER", "教唆杀人,以灭其口")],
    "EUROPEAN": [("GREED", "Sold what was not his to sell"), ("DECEPTION", "Swore falsely before the bishop"), ("BLASPHEMY", "Mocked the sacrament"), ("CRUELTY", "Turned the wounded from the gate")],
    "EGYPTIAN": [("DECEPTION", "Moved the boundary stone"), ("GREED", "Took from the temple stores"), ("BLASPHEMY", "Defiled the sacred lake"), ("CRUELTY", "Struck the servant unjustly")],
    "GREEK": [("BLASPHEMY", "Boasted himself above the gods"), ("DECEPTION", "Broke an oath sworn on the Styx"), ("CRUELTY", "Violated the law of guests"), ("GREED", "Kept what the god was owed")],
}


def add_records(soul, kind, table, total, born):
    """Split a soul's score into a few entries. The scores on Soul are recalculated from these."""
    rows = table[soul.civilization]
    count = 2 if total < 40 else 3
    for j in range(count):
        weight = total // count + (total % count if j == 0 else 0)
        if weight <= 0:
            continue
        category, text = rows[(random.randint(0, 3) + j) % len(rows)]
        SoulRecord.objects.create(soul=soul, record_type=kind, category=category, description=text, weight=weight,
                                  event_year=born + 18 + j * 9, event_month=random.randint(1, 12), event_day=random.randint(1, 28))


def make_soul(tenant, name, merit, demerit, i):
    born = random.randint(1940, 1985)
    soul = Soul.objects.create(
        name=name, tenant=tenant, description=BIOS.get(name, ""),
        birth_year=born, birth_month=random.randint(1, 12), birth_day=random.randint(1, 28),
        origin_location=PLACES[tenant.code][i % len(PLACES[tenant.code])],
    )
    add_records(soul, "MERIT", MERITS, merit, born)
    add_records(soul, "DEMERIT", DEMERITS, demerit, born)
    soul.refresh_from_db()
    return soul


def carry_out(soul, tenant, fate, judges, stats):
    if fate == "alive":
        return
    case = soul.die(location=soul.origin_location)
    soul.refresh_from_db()
    if case is None:
        case = Judgment.all_objects.filter(soul=soul).first()
    if fate == "citygod":
        return
    sent_on(case)
    judge = judges[tenant.code]
    if fate == "queue":
        return
    claims.claim(case.pk, judge)
    case.refresh_from_db()
    JudgmentComment.objects.create(judgment=case, author=judge, body=f"{soul.name}:卷宗已阅,证物齐备。", tenant=tenant)
    if fate == "claimed":
        return
    verdict = Verdict.FAILED if fate == "failed" or (fate == "flow" and tenant.code == "CN_DIYU") else Verdict.PASSED
    if tenant.code == "EG_DUAT":  # The scale decides in the Hall of Two Truths; anything else is refused.
        verdict = Verdict.FAILED if soul.demerit_score > soul.merit_score else Verdict.PASSED
    case.concluded_by = judge
    case.save(update_fields=["concluded_by"])
    case.conclude(verdict, NOTES.get(verdict, ""))
    if fate == "flow":
        walk(case, stop_before_last=True)
        return
    walk(case)
    soul.refresh_from_db()
    plan = SentencePlan.all_objects.filter(soul=soul, origin_judgment_id=case.pk).first()
    if plan is not None and plan.nodes.exists():
        # "failed": the sentence is being served; the others have served it.
        (execute_only if fate == "failed" else serve)(soul, plan, 1)
        soul.refresh_from_db()
    if fate == "reborn":
        if soul.home_civilization == "CHINESE":
            drink_soup(soul)
            soul.refresh_from_db()
        form = "HUMAN" if soul.home_civilization == "CHINESE" else "OTHER"
        ReincarnationService.complete_rebirth(soul=soul, disposition=None, new_identity=f"{soul.name}·来世", rebirth_form=form)
    stats[fate] = stats.get(fate, 0) + 1


def seed_souls(tenants, judges):
    stats = {}
    failures = []
    for code, rows in SOULS.items():
        tenant = tenants[code]
        for i, (name, merit, demerit, fate) in enumerate(rows):
            soul = make_soul(tenant, name, merit, demerit, i)
            try:
                carry_out(soul, tenant, fate, judges, stats)
            except Exception as exc:  # A soul stuck part way is still a soul; say which and carry on.
                failures.append(f"{code}/{name}/{fate}: {type(exc).__name__}: {str(exc)[:160]}")
    print("souls:", Soul.all_objects.count(), stats)
    for line in failures:
        print("  stuck:", line)


def seed_dispatches(tenants):
    """Two souls sent across the civilizations: one proposed, one approved."""
    pairs = [("EG_DUAT", "CN_DIYU", "Tutu", "外邦亡魂,移交第五殿"), ("CN_DIYU", "GR_HADES", "牛郎", "两界会审,押赴岔路草原"),
             ("GR_HADES", "CN_DIYU", "Hector", "战死异乡,请地府收押"), ("EU_HEAVEN_HELL", "EG_DUAT", "Percival", "请真理殿堂称心")]
    made = 0
    for i, (src, dst, name, reason) in enumerate(pairs):
        soul = Soul.objects.filter(name=name).first()
        dispatcher = User.objects.filter(tenant=tenants[src], role="OFFICER").first()
        approver = User.objects.filter(tenant=tenants[dst], role="OFFICER").first()
        try:
            soul.die(location=soul.origin_location)
            soul.refresh_from_db()
            record = DispatchService.propose(tenants[src], tenants[dst], soul, dispatcher, reason)
            if i == 3:
                DispatchService.approve(record, approver)
            made += 1
        except Exception as exc:
            print("  dispatch stuck:", src, dst, type(exc).__name__, str(exc)[:200])
    print("dispatches:", made)


def seed_social(tenants):
    authors = {code: list(User.objects.filter(tenant=t).exclude(role="SOUL")) for code, t in tenants.items()}
    lines = {
        "CN_DIYU": ["今日当值第五殿,孽镜台前无人敢抬头。", "孟婆汤新换了配方,说是少放了黄连。", "奈何桥下水位上涨,诸位摆渡注意。",
                    "崔判官的朱笔又断了,这是本月第三支。", "第一殿排队已到午门外,请勿喧哗。"],
        "EU_HEAVEN_HELL": ["The Ninth Circle's ice is holding nicely this season.", "Purgatory's terraces are repainted; mind the fresh mortar.",
                           "Minos asks everyone to stop counting his tail.", "Limbo book club meets Thursday. Virgil is bringing the Aeneid, again."],
        "EG_DUAT": ["The scales were recalibrated at dawn. Ammit is fed and resting.", "Forty-two assessors on shift; bring your negative confessions in order.",
                    "Boat of Ra departs at the twelfth hour sharp.", "Field of Reeds harvest: excellent."],
        "GR_HADES": ["Charon has raised the fare. Bring two obols.", "Cerberus had all three breakfasts. Approach calmly.",
                     "Lethe is high this week; do not drink before your paperwork.", "Sisyphus reports slight progress. It will not last."],
    }
    posts = []
    for code, rows in lines.items():
        for i, text in enumerate(rows):
            a = authors[code][i % len(authors[code])]
            posts.append(Post.objects.create(author=a, content=text, tenant=tenants[code]))
    for p in posts:
        for a in authors[p.tenant.code][:2]:
            if a.pk != p.author_id:
                Comment.objects.create(post=p, author=a, content="收到。" if p.tenant.code == "CN_DIYU" else "Noted.", tenant=p.tenant)
                Post.objects.filter(pk=p.pk).update(comment_count=Comment.objects.filter(post=p).count())
    for code, us in authors.items():
        for u in us:
            UserProfile.objects.get_or_create(user=u, defaults={"bio": "冥府当值"})
        for a in us:
            for b in us:
                if a.pk != b.pk and (a.pk < b.pk or a.username.startswith("demo_")):
                    Follow.objects.get_or_create(follower=a, following=b, tenant=tenants[code])
    t = tenants["CN_DIYU"]
    cn = [p for p in posts if p.tenant_id == t.pk]
    victim = authors["CN_DIYU"][1]
    for i, p in enumerate(cn[:3]):
        rep = Report.objects.create(tenant=t, target_type="POST", post=p, target_user=p.author, report_count=1 + i)
        for j in range(1 + i):
            ReportEntry.objects.create(report=rep, reporter=authors["CN_DIYU"][j % len(authors["CN_DIYU"])],
                                       reason=["SPAM", "ABUSE", "OTHER"][j % 3], detail="此帖有扰公堂清净")
    # 被举报的第一条已处理,让「已处理」一栏不空
    done = Report.objects.filter(tenant=t).first()
    done.status = "RESOLVED"
    done.resolution = "DISMISS"
    done.resolved_by = authors["CN_DIYU"][0]
    done.resolved_at = NOW - timedelta(hours=5)
    done.save()
    SocialMute.objects.create(tenant=t, user=victim, until=NOW + timedelta(days=7), reason="屡次灌水", created_by=authors["CN_DIYU"][0])
    for w, action in [("贿赂", "HIDE"), ("还阳秘方", "REVIEW"), ("徇私", "REVIEW")]:
        SensitiveWord.objects.create(tenant=t, word=w, action=action, category="")
    print("posts:", len(posts))


def seed_death_sync(tenants):
    for code, t in tenants.items():
        god = CityGod.all_objects.filter(tenant=t).first()
        for name, regions in [(f"{PLACES[code][0]}土地", PLACES[code][:2]), (f"{PLACES[code][2]}土地", PLACES[code][2:4])]:
            TudiGod.objects.get_or_create(tenant=t, name=name, defaults={"regions": regions, "city_god": god})
        key = ExternalApiKey.objects.create(tenant=t, name=f"{code} 阳间户籍同步", system_type="GOVERNMENT",
                                            key_hash=f"demo-{code}", key_prefix="sl_demo_")
        WebhookConfig.objects.create(tenant=t, api_key=key, url=f"https://registry.underworld.example/{code.lower()}/hook",
                                     events=["DEATH_REGISTERED"], signing_secret="demo")
        for i, soul in enumerate(Soul.all_objects.filter(tenant=t, current_state="JUDGING")[:3]):
            DeathRegistrationRequest.objects.create(tenant=t, api_key=key, idempotency_key=f"demo-{code}-{i}", source_system="阳间户籍",
                                                    source_reference_id=f"R-{1000 + i}", source_payload={}, status="PROCESSED", soul=soul,
                                                    source_ip="192.0.2.1", processing_duration_ms=120 + i)


def seed_accounts(tenants):
    made = 0
    for soul in Soul.all_objects.filter(current_state__in=["JUDGING", "DISPOSED", "REINCARNATING"]):
        try:
            if accounts.current_account_of(soul) is None:
                accounts.provision_account(soul, "OFFICER")
            made += 1
        except Exception as exc:
            print("  account stuck:", soul.name, type(exc).__name__, str(exc)[:140])
    n = 0
    for i, soul in enumerate(Soul.all_objects.filter(current_state="REINCARNATING")):
        account = accounts.current_account_of(soul)
        try:
            form = ("HUMAN", "ASURA", "ANIMAL")[i % 3] if soul.home_civilization == "CHINESE" else None
            rebirth.submit(account, form, "愿再世为人,弥补前愆。" if soul.home_civilization == "CHINESE" else "I ask to return.")
            n += 1
        except Exception as exc:
            print("  rebirth stuck:", soul.name, type(exc).__name__, str(exc)[:140])
    print("accounts:", made, "rebirth applications:", n)


def seed_appeals():
    made = {}
    for case in Judgment.all_objects.filter(verdict__isnull=False, is_final=True).exclude(civilization="GREEK"):
        account = accounts.current_account_of(case.soul)
        if account is None or made.get(case.tenant_id, 0) >= 2:
            continue
        try:
            appeals.file(account, case.pk, reason="证据未全,请求复审。", evidence="邻里证言三份")
            made[case.tenant_id] = made.get(case.tenant_id, 0) + 1
        except Exception as exc:
            print("  appeal stuck:", case.soul.name, type(exc).__name__, str(exc)[:120])
    print("appeals:", sum(made.values()))


def seed_queue_variety(tenants):
    """Somebody else's claim and a deferred case, so the queue's other two groups are not empty."""
    cn = tenants["CN_DIYU"]
    open_cases = list(Judgment.all_objects.filter(tenant=cn, verdict__isnull=True, claimed_by__isnull=True, city_god_status=CityGodStatus.SENT_ON))
    if len(open_cases) >= 3:
        claims.claim(open_cases[0].pk, User.objects.get(username="zhong_kui"))
        demo = User.objects.get(username="demo_judge")
        claims.claim(open_cases[1].pk, demo)
        claims.defer(open_cases[1].pk, demo, "待阳间证人到案", may_override=False)


def seed_cross_judgments(tenants):
    """One bench still sitting, one concluded. Both begin in the Fifth Court and sit with the Greeks."""
    cn, gr = tenants["CN_DIYU"], tenants["GR_HADES"]
    sitting = Soul.objects.create(name="哪吒", tenant=cn, merit_score=52, demerit_score=48, origin_location="陈塘关")
    done = Soul.objects.create(name="项羽", tenant=cn, merit_score=44, demerit_score=61, origin_location="乌江")
    for soul, conclude, title in ((sitting, False, "哪吒案·两界会审"), (done, True, "项羽案·两界会审")):
        try:
            case = sent_on(soul.die(location=soul.origin_location))
            cj = CrossTenantJudgmentService.create(title, "两界共审,先地府后冥河", cn, None)
            cj.judgment = case
            cj.save(update_fields=["judgment"])
            seat = CrossTenantJudgmentService.add_participant(cj, gr, None, ParticipantRole.CO_JUDGE, node_order=2)
            CrossTenantJudgmentService.submit_sentence(seat, stop_realm(gr), 10, "", None)
            CrossTenantJudgmentService.activate(cj)
            if conclude:
                CrossTenantJudgmentService.conclude(cj, "PASS", None)
                case.conclude(Verdict.FAILED, NOTES["FAILED"])
                walk(case)
        except Exception as exc:
            print("  cross stuck:", title, type(exc).__name__, str(exc)[:200])


def seed_audit(users):
    verbs = [(AuditAction.LOGIN, "auth", "登录"), (AuditAction.UPDATE, "soul", "修改功过"), (AuditAction.CREATE, "judgment", "开案"),
             (AuditAction.UPDATE, "role", "调整角色权限"), (AuditAction.DELETE, "post", "删除违规帖")]
    for i in range(60):
        u = users[i % len(users)]
        action, res, text = verbs[i % len(verbs)]
        row = AuditLog.objects.create(tenant=u.tenant, user=u, action=action, resource=res, resource_id=str(1000 + i), description=text,
                                      ip_address="192.0.2.10", user_agent="demo", changes={"note": ["", text]})
        AuditLog.objects.filter(pk=row.pk).update(timestamp=NOW - timedelta(hours=i * 3))


def seed_notifications(demo_users):
    texts = [("新案待认领", "第五殿队列有新案"), ("审批待办", "有一件结案等你批"), ("调拨通知", "有灵魂调入本殿")]
    for u in demo_users:
        for i, (title, body) in enumerate(texts):
            try:
                UserNotification.objects.create(user=u, title=title, message=body, is_read=i == 0)
            except Exception as exc:
                print("  notification:", type(exc).__name__, str(exc)[:140])
                return


def main():
    for code, name in HALL_NAMES.items():
        Tenant.objects.filter(code=code).update(display_name=name)
    tenants = {t.code: t for t in Tenant.objects.all()}
    print("tenants:", sorted(tenants))
    for code, name in CITY_GODS.items():
        CityGod.all_objects.get_or_create(tenant=tenants[code], name=name, defaults={"is_default": True})
    judges = {}
    for code, rows in OFFICERS.items():
        for username, display, role in rows:
            u = officer(username, display, role, tenants[code])
            if role == "JUDGE" and code not in judges:
                judges[code] = u
    demo = [officer("demo_admin", "太史令", "ADMIN", None), officer("demo_judge", "崔判官", "JUDGE", tenants["CN_DIYU"]),
            officer("demo_moderator", "孟婆", "MODERATOR", tenants["CN_DIYU"])]
    judges["CN_DIYU"] = demo[1]
    seed_souls(tenants, judges)
    seed_queue_variety(tenants)
    seed_cross_judgments(tenants)
    seed_dispatches(tenants)
    seed_social(tenants)
    seed_death_sync(tenants)
    seed_accounts(tenants)
    seed_appeals()
    seed_audit(list(User.objects.exclude(role="SOUL")[:12]))
    seed_notifications(demo)
    call_command("snapshot_balances", stdout=StringIO())
    print("realms:", Realm.all_objects.count(), "users:", User.objects.count(), "workflows:", ApprovalWorkflow.all_objects.count())


if __name__ == "__main__":
    main()
