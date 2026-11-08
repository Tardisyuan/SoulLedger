"""Seed for the Vercel demo's recording (scripts/demo-record.sh). Never run this against a database you care about.

Data goes in through the same services production uses (`die`, `conclude`, the plan and dispatch services, the
workflow's `complete_node`), so what gets recorded is what the app really answers. Names are mythological; there is
no real person's data in here. Every soul's fate is written out in `PLAN`; add a line to add a soul.
"""
import json
import math
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

from django.apps import apps  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.db.models import DateTimeField, Q  # noqa: E402
from django.utils import timezone  # noqa: E402

from apps.audit.models import AuditAction, AuditLog  # noqa: E402
from apps.authentication.models import User  # noqa: E402
from apps.death_sync.models import DeathRegistrationRequest, ExternalApiKey, TudiGod, WebhookConfig  # noqa: E402
from apps.dispatch.models import ParticipantRole  # noqa: E402
from apps.disposition.models import Disposition  # noqa: E402
from apps.events.models import SoulEvent  # noqa: E402
from apps.dispatch.services import CrossTenantJudgmentService, DispatchService  # noqa: E402
from apps.judgment import appeals, claims, confessions  # noqa: E402
from apps.actors.models import Actor  # noqa: E402
from apps.judgment.models import (  # noqa: E402
    CityGod,
    CityGodStatus,
    DuatStage,
    Judgment,
    JudgmentComment,
    NegativeConfession,
    Statute,
    Verdict,
)
from apps.judgment.services import CitationRefusedError, StatuteCitationService  # noqa: E402
from apps.ledger.models import BalanceSnapshot, SoulCensusSnapshot  # noqa: E402
from apps.ledger.snapshots import census_tenant  # noqa: E402
from apps.notifications.models import UserNotification  # noqa: E402
from apps.org.management.commands.init_organizations import INITIAL_ORGANIZATIONS, ORGANIZATION_NAME_EN  # noqa: E402
from apps.org.models import Organization  # noqa: E402
from apps.org.ownership import default_owner_org, tenant_root  # noqa: E402
from apps.realms.models import Realm  # noqa: E402
from apps.reincarnation.services import ReincarnationService, drink_soup  # noqa: E402
from apps.sentence_plan.models import SentencePlan, SentencePlanRequest  # noqa: E402
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
from apps.social import soul_circle  # noqa: E402
from apps.soul_accounts import rebirth  # noqa: E402
from apps.soul_accounts import services as accounts  # noqa: E402
from apps.soul_accounts.models import SoulAccount  # noqa: E402
from apps.souls.models import Soul  # noqa: E402
from apps.souls.record_models import SoulRecord  # noqa: E402
from apps.tenants.models import Tenant  # noqa: E402
from apps.workflow.models import ApprovalWorkflow  # noqa: E402
from tests.sentence_plan_support import execute_only, serve  # noqa: E402

random.seed(20261102)
NOW = timezone.now()

CITY_GODS = {"CN_DIYU": "都城隍", "EU_HEAVEN_HELL": "Saint Peter's Gate", "EG_DUAT": "Thoth's Scribes", "GR_HADES": "Charon's Ferry"}

# Roles follow docs/ (user 2026-11-07, EU-3 / EU-23 / EG-8). Europe: Christ is the one judge, at the particular
# judgment (docs/01_欧洲天堂地狱整体架构.md §一, CCC 1021-1022) — so the demo judge is Christ, and Minos, who only
# assigns the damned their circle at the second circle's mouth (docs/03:178), is an officer, not a judge; Saint
# Peter judges nobody. Egypt: Anubis operates the balance and is not a judge (docs/01_埃及冥界整体架构.md §1.2) —
# an officer; Ma'at is the standard itself, the feather, and no office at all, so the hall's moderator is Isis, who
# stands behind Osiris' throne in the hall (docs/02_奥西里斯审判详解.md, Budge pl. IV). Thoth stays the demo judge
# (the user's 2026-10-28 decision: he sits as an assessor and records, docs/01 埃及 §1.2).
OFFICERS = {
    "CN_DIYU": [("cui_jue", "崔珏", "JUDGE"), ("heibai", "黑白无常", "OFFICER"), ("zhong_kui", "钟馗", "JUDGE"), ("meng_po", "孟婆", "OFFICER")],
    "EU_HEAVEN_HELL": [("minos", "Minos", "OFFICER"), ("uriel", "Uriel", "OFFICER"), ("beatrice", "Beatrice", "MODERATOR")],
    "EG_DUAT": [("anubis", "Anubis", "OFFICER"), ("horus", "Horus", "OFFICER"), ("isis", "Isis", "MODERATOR")],
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
#   served       the sentence served and the soup drunk: the last page of the first life (the tour's protagonist)
#   reborn       the whole way round, once
#   full         as reborn, by way of a FAILED verdict and a served sentence
# A case still open is open now, so its soul died this year: those are ordinary people. The ancients all have finished lives.
SOULS = {
    "CN_DIYU": [
        # Twice: the first life, which the tour follows, and the same person gone round, whom /rebirths lists.
        ("屈原", 86, 12, "served"), ("屈原", 86, 12, "full"), ("窦娥", 70, 2, "passed"), ("梁山伯", 66, 5, "passed"), ("祝英台", 71, 4, "passed"),
        ("牛郎", 60, 10, "alive"), ("织女", 88, 1, "alive"), ("杜丽娘", 55, 12, "passed"), ("柳梦梅", 48, 9, "passed"),
        ("白素贞", 40, 35, "failed"), ("法海", 30, 44, "failed"), ("曹操", 50, 80, "failed"), ("董卓", 4, 96, "failed"),
        ("秦桧", 3, 99, "failed"), ("陈世美", 12, 61, "failed"), ("潘金莲", 18, 52, "failed"), ("聂小倩", 45, 20, "passed"),
        ("宁采臣", 58, 6, "passed"), ("刘伶", 33, 27, "alive"),
        ("李靖", 64, 22, "due"), ("杨戬", 71, 17, "due"), ("钱塘君", 38, 49, "due"),
        ("周德海", 70, 2, "queue"), ("林秀英", 55, 12, "queue"), ("陈建国", 12, 61, "queue"), ("王桂兰", 48, 9, "claimed"), ("赵志强", 18, 52, "claimed"),
        ("孙玉梅", 40, 35, "flow"), ("马国栋", 30, 44, "flow"), ("胡春花", 45, 20, "citygod"), ("郑立民", 58, 6, "citygod"),
    ],
    "EU_HEAVEN_HELL": [
        ("Tristan", 62, 30, "purgatory"), ("Isolde", 64, 28, "passed"), ("Dido", 40, 55, "failed"), ("Francesca da Rimini", 35, 45, "failed"),
        ("Paolo Malatesta", 34, 46, "failed"), ("Faust", 41, 70, "failed"), ("Ulysses", 50, 60, "failed"), ("Orlando", 77, 13, "passed"),
        ("Roland", 85, 9, "passed"), ("Guinevere", 60, 25, "alive"), ("Lancelot", 66, 31, "purgatory"), ("Percival", 90, 3, "alive"),
        ("Marco Bellini", 40, 55, "queue"), ("Anna Keller", 50, 60, "queue"),
        # Concluded this week, the approval half walked: a judge's own recent work on /events (Europe had none).
        ("Lucia Ferri", 58, 36, "flow"), ("Jonas Weber", 46, 52, "flow"),
    ],
    "EG_DUAT": [
        ("Sinuhe", 72, 18, "passed"), ("Khufu", 44, 40, "passed"), ("Nefertari", 91, 4, "passed"), ("Imhotep", 95, 2, "passed"),
        ("Hatshepsut", 83, 12, "passed"), ("Akhenaten", 30, 65, "failed"), ("Ani the Scribe", 80, 6, "passed"), ("Tutu", 75, 8, "alive"),
        ("Merit-Neith", 68, 14, "alive"), ("Setne", 22, 58, "failed"), ("Bata", 57, 21, "passed"), ("Anpu", 61, 19, "passed"),
        ("Karim Mansour", 72, 18, "claimed"), ("Laila Hassan", 83, 12, "queue"), ("Omar Naguib", 61, 19, "queue"),
        ("Mona Fahmy", 44, 40, "flow"), ("Tarek Sabry", 30, 65, "flow"), ("Hoda Saleh", 57, 21, "flow"),
    ],
    "GR_HADES": [
        ("Orpheus", 74, 16, "passed"), ("Eurydice", 80, 5, "passed"), ("Sisyphus", 9, 93, "failed"), ("Tantalus", 6, 97, "failed"),
        ("Achilles", 66, 42, "passed"), ("Patroclus", 73, 11, "passed"), ("Odysseus", 69, 37, "passed"),
        # Twice, for the reason 屈原 is.
        ("Penelope", 94, 2, "served"), ("Penelope", 94, 2, "reborn"),
        ("Antigone", 88, 7, "alive"), ("Hector", 86, 10, "alive"), ("Ixion", 5, 88, "failed"), ("Alcestis", 92, 3, "passed"),
        ("Nikos Pappas", 74, 16, "queue"), ("Eleni Vlachou", 69, 37, "queue"), ("Stavros Kouris", 66, 42, "flow"), ("Katerina Doukas", 92, 3, "queue"),
        ("Yannis Petrou", 61, 33, "flow"),
    ],
}

BIOS = {
    "屈原": "楚三闾大夫,谏怀王不听,再放逐,自沉汨罗(《史记·屈原贾生列传》)。", "窦娥": "含冤负屈,六月飞雪。", "曹操": "挟天子以令诸侯。", "秦桧": "以莫须有之罪杀岳飞。",
    "Faust": "Sold his soul for knowledge and did not read the terms.", "Sisyphus": "Cheated death twice; pushes a stone uphill.",
    "Orpheus": "Looked back.", "Tantalus": "Served his son to the gods.", "Imhotep": "Architect of the Step Pyramid.",
    "Nefertari": "The one for whom the sun shines.", "Roland": "Blew the horn too late at Roncevaux.",
    "Francesca da Rimini": "Daughter of Guido da Polenta of Ravenna, killed with Paolo by her husband at Rimini; Dante meets her in the second circle (Inferno V).",
    "Percival": "Perceval the Welshman, the knight of the Grail in Chretien de Troyes's Conte du Graal.",
    "Penelope": "Queen of Ithaca, who kept the suitors off for twenty years (Odyssey).",
}

PLACES = {
    "CN_DIYU": ["汨罗", "楚州", "会稽", "钱塘", "长安", "洛阳", "金陵"], "EU_HEAVEN_HELL": ["Ravenna", "Rimini", "Carthage", "Wittenberg", "Camelot", "Ithaca"],
    "EG_DUAT": ["Memphis", "Thebes", "Abydos", "Saqqara", "Amarna"], "GR_HADES": ["Thrace", "Corinth", "Phthia", "Argos", "Thebes"],
}

#: Where the person really came from, ahead of the pool above. Keyed by name, read in `make_soul`.
ORIGIN = {"屈原": "秭归", "Francesca da Rimini": "Ravenna", "Percival": "Wales", "Nefertari": "Thebes", "Penelope": "Ithaca"}
#: Where they died, when that is not where they came from.
DIED_AT = {"屈原": "汨罗", "Francesca da Rimini": "Rimini"}

#: 判词,按各文明自己的说法(docs/01_*):埃及、欧洲没有转世。
NOTES = {
    "CN_DIYU": {"PASSED": "功过相抵后仍有余善,准入轮回。", "FAILED": "恶业深重,依律发落。"},
    "EU_HEAVEN_HELL": {"PASSED": "生前无大罪,准入天国。", "FAILED": "所犯之罪依《神曲》定圈,入地狱。", "PURGATORY": "其罪可涤,入炼狱逐层洗炼。"},
    "EG_DUAT": {"PASSED": "心不重于羽,入芦苇原。", "FAILED": "心重于羽,交阿米特吞噬。"},
    "GR_HADES": {"PASSED": "一生虔敬求真,送往至福岛。", "FAILED": "恶者下塔尔塔罗斯。"},
}

#: A sentence of its own. Docs/10 第三类: 殉节 counts among the deaths by one's own hand, whatever the cause.
NOTE_OF = {"屈原": "其志可悯,其功可录;唯自沉汨罗,列枉死之例,受罚后准入轮回。"}


def officer(username, display, role, tenant, password="demo-only-not-a-secret"):
    user, created = User.objects.get_or_create(username=username, defaults=dict(
        role=role, tenant=tenant, display_name=display, email=f"{username}@underworld.example"))
    if created:
        user.set_password(password)
        user.must_change_password = False
        user.save()
    elif (user.role, user.display_name) != (role, display):
        # A database seeded before the 2026-11-07 roles keeps the old name / role otherwise (get_or_create).
        user.role, user.display_name = role, display
        user.save(update_fields=["role", "display_name"])
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


#: (born, died), by the person. Anyone not here is a recent life (see `make_soul`).
LIVES = {
    "屈原": (-340, -278), "窦娥": (1283, 1303), "梁山伯": (349, 373), "祝英台": (352, 374), "杜丽娘": (1570, 1586), "柳梦梅": (1566, 1630),
    "白素贞": (1120, 1180), "法海": (813, 895), "曹操": (155, 220), "董卓": (138, 192), "秦桧": (1091, 1155), "陈世美": (1100, 1162),
    "潘金莲": (1090, 1118), "聂小倩": (1640, 1658), "宁采臣": (1630, 1702), "刘伶": (221, 300), "项羽": (-232, -202), "哪吒": (-1100, -1085),
    "Tristan": (490, 530), "Isolde": (495, 530), "Dido": (-840, -814), "Francesca da Rimini": (1255, 1285), "Paolo Malatesta": (1246, 1285),
    "Faust": (1480, 1540), "Ulysses": (-1240, -1170), "Orlando": (736, 778), "Roland": (736, 778),
    "Sinuhe": (-1990, -1920), "Khufu": (-2620, -2566), "Nefertari": (-1295, -1255), "Imhotep": (-2690, -2610), "Hatshepsut": (-1507, -1458),
    "Ani the Scribe": (-1300, -1240), "Bata": (-1250, -1205), "Anpu": (-1260, -1200),
    "Percival": (495, 545), "Akhenaten": (-1380, -1336), "Orpheus": (-1300, -1250), "Eurydice": (-1295, -1265), "Sisyphus": (-1400, -1320), "Tantalus": (-1420, -1340), "Achilles": (-1250, -1184),
    "Patroclus": (-1255, -1185), "Odysseus": (-1240, -1160), "Penelope": (-1235, -1165), "Ixion": (-1380, -1310), "Alcestis": (-1300, -1240),
}
DIED = {}
PLANNED = {}
#: soul pk -> its fate in SOULS, for `spread_time`.
FATE = {}
FINISHED = {"failed", "passed", "served", "reborn", "full", "purgatory"}
#: Not a finished fate, but the transfer below ends the life: it keeps its own century.
TRANSFERRED_LONG_AGO = {"Percival"}

#: The four the tour follows, written by hand: (category, deed, weight, year). Each side adds up to the SOULS row.
#: Sources: 《史记·屈原贾生列传》; Inferno V; Odyssey 2, 19, 23; docs/02_奥西里斯审判详解.md §3.2 for the heart's two pans,
#: and for Nefertari the Abu Simbel small temple and her letter to Puduhepa of Hatti. A demerit of hers is this demo's own reading.
DEEDS = {
    "屈原": {
        "MERIT": [("WISDOM", "任楚怀王左徒,明于治乱,娴于辞令", 30, -318), ("HONESTY", "谏怀王勿入秦,王不听", 30, -299), ("PIETY", "放逐中作《离骚》,不改其志", 26, -296)],
        "DEMERIT": [("OTHER", "自沉汨罗,列枉死之例", 12, -278)],
    },
    "Francesca da Rimini": {
        "MERIT": [("PIETY", "Married at Ravenna to seal her father's peace with the Malatesta", 35, 1275)],
        "DEMERIT": [("OTHER", "Adultery with Paolo Malatesta, her husband's brother (Inferno V)", 45, 1285)],
    },
    "Nefertari": {
        "MERIT": [("PIETY", "Honoured beside Hathor in the small temple at Abu Simbel", 40, -1265), ("HONESTY", "Wrote to Queen Puduhepa of Hatti to keep the peace of the treaty", 31, -1258), ("CHARITY", "Gave bread to the hungry", 20, -1270)],
        "DEMERIT": [("OTHER", "Raised her voice in the palace", 4, -1275)],
    },
    "Penelope": {
        "MERIT": [("HONESTY", "Kept faith with Odysseus through twenty years", 44, -1174), ("COMPASSION", "Received the stranger at her hearth and had him bathed (Odyssey 19)", 20, -1174), ("WISDOM", "Knew her husband by the test of the bed (Odyssey 23)", 30, -1174)],
        "DEMERIT": [("DECEPTION", "Unwove by night what she wove by day, to put off the suitors (Odyssey 2)", 2, -1180)],
    },
}
#: The same four's last days: `date` is the death's month and day, the rest are days after it, at each `mark` in `carry_out`.
#: Handed to the recorder (`write_lives`), which spreads their stamps by these; everyone else keeps the seed's own spacing.
PACE = {
    # 五月初五 by tradition. Forty-nine days through the courts (7 × 7), thirty years in the sentence.
    "屈原": {"date": (5, 5), "verdict": 49, "flow": 56, "served": 11013, "reborn": 11016},
    "Francesca da Rimini": {"date": (9, 8), "verdict": 1, "flow": 2, "served": 3},
    # Seventy days of embalming before she may set out (docs/01_埃及冥界整体架构.md, Herodotus II.86-88).
    "Nefertari": {"date": (3, 17), "verdict": 70, "flow": 72, "served": 75},
    # The thousand years of Er's myth (Republic 615a).
    "Penelope": {"date": (10, 2), "verdict": 3, "flow": 5, "served": 365250, "reborn": 365255},
}
#: soul pk -> [(when it happened, days after the death)], in the seed's clock until `spread_time` moves them.
MARKS = {}


def mark(soul_pk, name, stage):
    if name in PACE and stage in PACE[name]:
        MARKS.setdefault(soul_pk, []).append((timezone.now(), PACE[name][stage]))


def add_records(soul, kind, table, total, born, died):
    """Split a soul's score into a few entries. The scores on Soul are recalculated from these."""
    rows = table[soul.civilization]
    count = 2 if total < 40 else 3
    for j in range(count):
        weight = total // count + (total % count if j == 0 else 0)
        if weight <= 0:
            continue
        category, text = rows[(random.randint(0, 3) + j) % len(rows)]
        SoulRecord.objects.create(soul=soul, record_type=kind, category=category, description=text, weight=weight,
                                  event_year=born + (died - born) * (j + 1) // (count + 1), event_month=random.randint(1, 12), event_day=random.randint(1, 28))


def make_soul(tenant, name, merit, demerit, i, *, fate=""):
    # Only a finished life keeps its century: a case still open is open now, and so its soul died recently.
    historic = (fate in FINISHED or name in TRANSFERRED_LONG_AGO) and name in LIVES
    born, died = LIVES[name] if historic else (y := random.randint(1935, 1985), y + random.randint(38, 41))
    fated = {}
    if fate == "due":  # 阳寿已到,还没发牒:`/judgment/capture-due` 列的就是这些。
        fated = {"fated_death_year": 2025, "fated_death_month": random.randint(1, 12), "fated_death_day": random.randint(1, 28)}
    elif fate == "alive" and not historic:
        fated = {"fated_death_year": random.randint(2031, 2068), "fated_death_month": random.randint(1, 12), "fated_death_day": random.randint(1, 28)}
    if tenant.code == "GR_HADES":
        fated["origin_region"] = "ASIA" if name in ASIA else "EUROPE" if name in EUROPE else ""
        fated["ferry_passage"] = "UNBURIED" if name in UNBURIED else ""
    soul = Soul.objects.create(
        name=name, tenant=tenant, description=BIOS.get(name, ""),
        birth_year=born, birth_month=random.randint(1, 12), birth_day=random.randint(1, 28),
        origin_location=ORIGIN.get(name) or PLACES[tenant.code][i % len(PLACES[tenant.code])], **fated,
    )
    if name in DEEDS:
        for kind, rows in DEEDS[name].items():
            for category, text, weight, year in rows:
                SoulRecord.objects.create(soul=soul, record_type=kind, category=category, description=text, weight=weight,
                                          event_year=year, event_month=random.randint(1, 12), event_day=random.randint(1, 28))
    else:
        add_records(soul, "MERIT", MERITS, merit, born, died)
        add_records(soul, "DEMERIT", DEMERITS, demerit, born, died)
    soul.refresh_from_db()
    if historic:
        DIED[soul.pk] = died
    PLANNED[soul.pk] = (merit, demerit)
    return soul


#: Where a concluded soul is sent: Dante's circles and terraces, the Greek meadow's two roads.
PLACED = {
    "Francesca da Rimini": "EU_HELL_2ND", "Paolo Malatesta": "EU_HELL_2ND", "Faust": "EU_HELL_8TH", "Tristan": "EU_PURGATORY_T7_LUST",
    "Lancelot": "EU_PURGATORY_T7_LUST", "Dido": "EU_HELL_2ND", "Ulysses": "EU_HELL_8TH", "Sisyphus": "GR_TARTARUS", "Tantalus": "GR_TARTARUS", "Ixion": "GR_TARTARUS",
}
#: Which Greek judge: Rhadamanthus the souls of Asia, Aeacus those of Europe, Minos when they are in doubt (Gorgias 524a).
ASIA = {"Tantalus", "Eurydice", "Hector"}
EUROPE = {"Orpheus", "Sisyphus", "Achilles", "Patroclus", "Odysseus", "Penelope", "Ixion", "Antigone",
          "Alcestis", "Nikos Pappas", "Eleni Vlachou", "Stavros Kouris", "Katerina Doukas", "Yannis Petrou"}
#: 卡戎不渡未葬者:他在岸边等,队列里认领不了。
UNBURIED = {"Katerina Doukas"}


def hear_confessions(case, *, upto=42, false_every=0):
    """The 42 denials of the Hall of Two Truths."""
    for row in confessions.clauses(case)[:upto]:
        ordinal = row["ordinal"] if isinstance(row, dict) else row.ordinal
        confessions.record(case, ordinal, not (false_every and ordinal % false_every == 0), "" if not false_every or ordinal % false_every else "证物与其所言相悖")


#: Which gate of the 功過格 a deed's category is read under (statutes_chinese.GONGGUOGE_GATES). The demo's own reading.
GATE_OF = {"CHARITY": "F-JJ", "COMPASSION": "F-JJ", "PIETY": "F-FX", "HONESTY": "F-YS", "WISDOM": "F-YS",
           "CRUELTY": "G-BR", "MURDER": "G-BR", "GREED": "G-BY", "DECEPTION": "G-BY", "BLASPHEMY": "G-BS"}
#: The bolgia a damned soul is in: where the poem puts him (Ulysses, Inf. XXVI), or this demo's reading (Faust, a
#: magician, with the sorcerers of the fourth bolgia, Inf. XX).
BOLGIA = {"Ulysses": "EU-INF-C8-B08", "Faust": "EU-INF-C8-B04"}
#: Named in the soul's own canto: "Caina attende chi a vita ci spense" (Inf. V.107), the first zone of Cocytus, where
#: their killer will go. Francesca's one deed is OTHER, which reads as no sin, so without it she had one article.
NAMED_IN_CANTO = {"Francesca da Rimini": "EU-INF-C9-Z1", "Paolo Malatesta": "EU-INF-C9-Z1"}
#: Gorgias 523a-526d and Republic X: the two roads and the marks a life leaves on the soul for everyone; for the damned
#: the curable and the incurable, and the incurable who were kings (525e names Tantalus and Sisyphus); requital for the good.
#: A case still before the court: both parties judged dead and naked (523e), the court and its seats (524a), and the
#: scars the soul brings to it (524d), which are what the judge is about to read.
GREEK_GROUNDS = {Verdict.PASSED: ["GR-GRG-01", "GR-GRG-07", "GR-ER-05"],
                 Verdict.FAILED: ["GR-GRG-01", "GR-GRG-09", "GR-GRG-10", "GR-ER-04"],
                 None: ["GR-GRG-05", "GR-GRG-06", "GR-GRG-07"]}
#: A European deed's category read as the terrace that purges it (Purg. X-XXVII) and the circle that punishes it
#: (Inferno). Avarice is both T5 and the fourth circle (Inf. VII); cruelty is wrath's terrace and the first girone of
#: violence (Inf. XII); blasphemy the third girone (Inf. XIV) and, on the mountain, pride's terrace; a false oath the
#: falsifiers of words in the tenth bolgia (Inf. XXX). Envy for a false oath is this demo's own reading.
EU_SIN_OF = {"GREED": ("EU-DS-T5", "EU-INF-C4"), "CRUELTY": ("EU-DS-T3", "EU-INF-C7-R1"),
             "BLASPHEMY": ("EU-DS-T1", "EU-INF-C7-R3"), "DECEPTION": ("EU-DS-T2", "EU-INF-C8-B10")}


def grounds(case, soul, verdict):
    """The articles a verdict rests on, or (`verdict` None) a case still open: two to four. Europe has no Paradiso corpus
    (StatuteCorpus has only the terraces and the circles), so a soul admitted to Heaven cites the terraces that purged
    its sins on the way up, every one of the saved having climbed the mountain (the user, 2026-11-08); a soul in
    Purgatory its own terrace and those of its other sins; a damned soul the Inferno, the second circle first (Minos
    there assigns every circle, Inf. V.4-12), then its own and its sins'; an open case Minos's circle and the soul's sins
    on both sides, which is the question in front of the judge."""
    pick = random.Random(f"{soul.name}/{verdict}")
    statutes = Statute.all_objects.filter(tenant_id=case.tenant_id, is_deleted=False)

    def by_code(codes):
        found = {s.code: s for s in statutes.filter(code__in=codes)}
        return [found[c] for c in dict.fromkeys(codes) if c in found]

    if case.civilization == "CHINESE":
        # 功過相抵: the side that decided the case, up to three, and at least one article of the other side.
        passed = verdict == Verdict.PASSED or (verdict is None and soul.merit_score >= soul.demerit_score)

        def articles(records):
            out = []
            for record in records:
                gate = GATE_OF.get(record.category)
                rows = list(statutes.filter(corpus="GONGGUOGE", code__startswith=f"CN-GGG-{gate}-").order_by("ordinal")) if gate else []
                if rows:
                    out.append(pick.choice(rows))
            return list(dict.fromkeys(out))

        records = list(SoulRecord.objects.filter(soul=soul).order_by("-weight", "pk"))
        first = articles([r for r in records if (r.record_type == "MERIT") == passed])[:3]
        second = [a for a in articles([r for r in records if (r.record_type == "MERIT") != passed]) if a not in first]
        return (first + second[:max(1, 2 - len(first))])[:4]
    if case.civilization == "EGYPTIAN":
        heard = list(NegativeConfession.all_objects.filter(judgment=case, is_deleted=False).select_related("statute"))
        lied = [c.statute for c in heard if c.truthful is False]
        if verdict == Verdict.FAILED and lied:
            return lied[:pick.randint(2, 4)]
        # Not heard yet (the queue): the docket's own clauses, which the hearing will put to the soul.
        kept = [c.statute for c in heard if c.truthful] or list(statutes.filter(corpus="NEGATIVE_CONFESSION").order_by("ordinal"))
        return pick.sample(kept, min(len(kept), pick.randint(2, 3)))
    if case.civilization == "EUROPEAN":
        placed = PLACED.get(soul.name, "")
        sins = [EU_SIN_OF[r.category] for r in SoulRecord.objects.filter(soul=soul, record_type="DEMERIT").order_by("-weight", "pk")
                if r.category in EU_SIN_OF]
        terraces = [t for t, _ in sins]
        circles = [c for _, c in sins]
        if verdict == Verdict.PURGATORY:
            own = [f"EU-DS-{placed.split('_')[2]}"] if placed.startswith("EU_PURGATORY_") else []
            codes = own + terraces + ["EU-DS-T1"]
        elif verdict == Verdict.FAILED:
            circle = "".join(ch for ch in placed[len("EU_HELL_"):] if ch.isdigit()) if placed.startswith("EU_HELL_") else ""
            codes = ["EU-INF-C2", f"EU-INF-C{circle}" if circle else "", BOLGIA.get(soul.name, ""), NAMED_IN_CANTO.get(soul.name, "")] + circles
        elif verdict == Verdict.PASSED:
            # Pride first, where the climb begins (Purg. X), and the seventh last: its wall of fire stands between every soul
            # and the Earthly Paradise, Dante too (Purg. XXVII).
            codes = ["EU-DS-T1"] + terraces + ["EU-DS-T7"]
        else:
            codes = ["EU-INF-C2"] + [c for pair in sins for c in pair]
        return by_code([c for c in codes if c])[:4]
    if case.civilization == "GREEK":
        return by_code(GREEK_GROUNDS.get(verdict, []))
    return []


def cite_grounds(case, soul, verdict):
    for statute in grounds(case, soul, verdict):
        try:
            StatuteCitationService.cite(case, statute.pk)
        except CitationRefusedError as exc:
            print("  citation refused:", soul.name, statute.code, str(exc)[:120])


def carry_out(soul, tenant, fate, judges, stats):
    if fate in ("alive", "due"):
        return
    name = soul.name
    case = soul.die(location=DIED_AT.get(name, soul.origin_location))
    soul.refresh_from_db()
    if case is None:
        case = Judgment.all_objects.filter(soul=soul).first()
    if fate == "citygod":
        return
    sent_on(case)
    judge = judges[tenant.code]
    if fate == "queue":
        # Unclaimed, anyone may cite (`claims.assert_may_edit`): the grounds already on the docket when a judge claims it.
        cite_grounds(case, soul, None)
        return
    claims.claim(case.pk, judge)
    case.refresh_from_db()
    JudgmentComment.objects.create(judgment=case, author=judge, body=f"{soul.name}:卷宗已阅,证物齐备。", tenant=tenant)
    if fate == "claimed":
        if tenant.code == "EG_DUAT":
            hear_confessions(case, upto=26)
        cite_grounds(case, soul, None)
        return
    verdict = Verdict.FAILED if fate in ("failed", "full") or (fate in ("flow", "served") and tenant.code == "CN_DIYU") else Verdict.PASSED
    if fate == "purgatory":
        verdict = Verdict.PURGATORY
    if tenant.code == "EG_DUAT":  # The scale decides in the Hall of Two Truths; anything else is refused.
        verdict = Verdict.FAILED if soul.demerit_score > soul.merit_score else Verdict.PASSED
        hear_confessions(case, false_every=6 if verdict == Verdict.FAILED else 0)
    cite_grounds(case, soul, verdict)
    case.concluded_by = judge
    case.save(update_fields=["concluded_by"])
    placed = Realm.all_objects.filter(realm_code=PLACED.get(soul.name, "")).first()
    case.conclude(verdict, NOTE_OF.get(name) or NOTES[tenant.code].get(verdict, ""), **({"destination_realm_id": placed.pk} if placed else {}))
    # The API names the judge on the event (`conclude_judgment(by=...)`); the seed concludes in-process, which logs
    # "system" — so /events, which hides system events by default, showed no judge ever deciding anything.
    SoulEvent.all_objects.filter(soul_id=soul.pk, event_type="JUDGMENT_CONCLUDED", actor="system").update(actor=str(judge))
    mark(soul.pk, name, "verdict")
    if fate == "flow":
        walk(case, stop_before_last=True)
        return
    walk(case)
    mark(soul.pk, name, "flow")
    soul.refresh_from_db()
    plan = SentencePlan.all_objects.filter(soul=soul, origin_judgment_id=case.pk).first()
    if plan is not None and plan.nodes.exists():
        # "failed": the sentence is being served; the others have served it.
        (execute_only if fate in ("failed", "purgatory") else serve)(soul, plan, 1)
        soul.refresh_from_db()
    mark(soul.pk, name, "served")
    if fate in ("served", "reborn", "full"):
        if soul.home_civilization == "CHINESE":
            drink_soup(soul)
            soul.refresh_from_db()
    if fate in ("reborn", "full"):
        form = "HUMAN" if soul.home_civilization == "CHINESE" else "OTHER"
        ReincarnationService.complete_rebirth(soul=soul, disposition=None, new_identity=f"{soul.name}·来世", rebirth_form=form)
        mark(soul.pk, name, "reborn")
    stats[fate] = stats.get(fate, 0) + 1


def seed_souls(tenants, judges):
    stats = {}
    failures = []
    for code, rows in SOULS.items():
        tenant = tenants[code]
        for i, (name, merit, demerit, fate) in enumerate(rows):
            soul = make_soul(tenant, name, merit, demerit, i, fate=fate)
            FATE[soul.pk] = fate
            try:
                carry_out(soul, tenant, fate, judges, stats)
            except Exception as exc:  # A soul stuck part way is still a soul; say which and carry on.
                failures.append(f"{code}/{name}/{fate}: {type(exc).__name__}: {str(exc)[:160]}")
    print("souls:", Soul.all_objects.count(), stats)
    for line in failures:
        print("  stuck:", line)


def seed_dispatches(tenants):
    """Two souls sent across the civilizations: one proposed, one approved."""
    pairs = [("EG_DUAT", "CN_DIYU", "Tutu", "外邦亡魂,移交第五殿"), ("CN_DIYU", "GR_HADES", "牛郎", "两界会审,押赴岔路口的草地"),
             ("GR_HADES", "CN_DIYU", "Hector", "战死异乡,请地府收押"), ("EU_HEAVEN_HELL", "EG_DUAT", "Percival", "请两真之殿称心")]
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


#: 官员简介:「冥府」是希腊那一套的叫法(docs/01_希腊冥府整体架构.md),各文明写自己的。
BIO = {"CN_DIYU": "地府当值", "EU_HEAVEN_HELL": "天国当值"}


def seed_social(tenants):
    authors = {code: list(User.objects.filter(tenant=t).exclude(role="SOUL")) for code, t in tenants.items()}
    lines = {
        "CN_DIYU": ["今日当值第一殿,孽镜台前无人敢抬头。", "孟婆汤新换了配方,说是少放了黄连。", "奈何桥下水位上涨,诸位摆渡注意。",
                    "崔判官的朱笔又断了,这是本月第三支。", "第一殿排队已到午门外,请勿喧哗。"],
        "EU_HEAVEN_HELL": ["第九圈的冰今季很结实。", "炼狱各层刚刷过一遍,留神未干的灰浆。",
                           "米诺斯请大家别再数他的尾巴。", "林勃读书会周四照常,维吉尔又要带《埃涅阿斯纪》。"],
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
                Comment.objects.create(post=p, author=a, content="收到。" if p.tenant.code in ("CN_DIYU", "EU_HEAVEN_HELL") else "Noted.", tenant=p.tenant)
                Post.objects.filter(pk=p.pk).update(comment_count=Comment.objects.filter(post=p).count())
    for code, us in authors.items():
        for u in us:
            UserProfile.objects.get_or_create(user=u, defaults={"bio": BIO.get(code, "冥府当值")})
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
        suffix = "土地" if code == "CN_DIYU" else " Earth God"
        for name, regions in [(f"{PLACES[code][0]}{suffix}", PLACES[code][:2]), (f"{PLACES[code][2]}{suffix}", PLACES[code][2:4])]:
            TudiGod.objects.get_or_create(tenant=t, name=name, defaults={"regions": regions, "city_god": god})
        key = ExternalApiKey.objects.create(tenant=t, name=f"{code} 阳间户籍同步", system_type="GOVERNMENT",
                                            key_hash=f"demo-{code}", key_prefix="sl_demo_")
        WebhookConfig.objects.create(tenant=t, api_key=key, url=f"https://registry.underworld.example/{code.lower()}/hook",
                                     events=["DEATH_REGISTERED"], signing_secret="demo")
        for i, soul in enumerate(Soul.all_objects.filter(tenant=t, current_state="JUDGING")[:3]):
            DeathRegistrationRequest.objects.create(tenant=t, api_key=key, idempotency_key=f"demo-{code}-{i}", source_system="阳间户籍",
                                                    source_reference_id=f"R-{1000 + i}", source_payload={}, status="PROCESSED", soul=soul,
                                                    source_ip="192.0.2.1", processing_duration_ms=120 + i)


# The souls' own circle: what the soul app's feed shows. Only souls appear there, and only to their own civilization.
SOUL_POSTS = [
    ("曹操", "判官问我何以至此。对酒当歌,人生几何。他说这不算答辩。", [("项羽", "彼此彼此。")]),
    ("白素贞", "雷峰塔的潮气比这里重。在此报个平安。", [("法海", "贫僧也在。")]),
    ("法海", "有人说我多管闲事。此间判官也这么写。", []),
    ("项羽", "无颜见江东父老,倒在这里见着了。", [("曹操", "来喝一杯?")]),
    ("梁山伯", "转生形态那一栏我填了蝶。被退回来了。", [("祝英台", "下次一起填人道。")]),
    ("祝英台", "和他一起递的转生申请。表格上没有「同去」这一栏。", []),
    ("秦桧", "今日又有人跪我。不用了,真的。", []),
    ("Khufu", "They asked what I built. I said a pyramid. They asked what else.", [("Akhenaten", "Ask them about the sun.")]),
    ("Akhenaten", "One god was simpler. There are forty-two assessors here.", []),
    ("Bata", "My heart spent years in a cedar tree. It weighed fine.", [("Khufu", "Mine took longer.")]),
    ("Tristan", "The Second Circle is windy. Isolde would have hated it, and she is right beside me.", [("Lancelot", "Guinevere says the same.")]),
    ("Lancelot", "Still the best knight in this circle. Nobody here is impressed.", []),
    ("Sisyphus", "Slight progress today.", [("Tantalus", "It will not last.")]),
    ("Tantalus", "The water is right there.", []),
    ("Achilles", "The ferryman asked for my obol. I told him about my heel.", [("Patroclus", "He has heard about the heel.")]),
    ("Eurydice", "Do not look back, they said. He looked.", []),
]


def seed_soul_circle():
    made = 0
    for name, text, replies in SOUL_POSTS:
        author = accounts.current_account_of(Soul.all_objects.filter(name=name).first())
        if author is None:
            print("  no account for a post:", name)
            continue
        post = soul_circle.create_post(author.user, text, "TENANT")
        for replier, reply in replies:
            other = accounts.current_account_of(Soul.all_objects.filter(name=replier).first())
            if other is not None:
                soul_circle.create_comment(other.user, post.pk, reply)
                soul_circle.toggle_reaction(other.user, post.pk, "LIKE")
        made += 1
    print("soul posts:", made)


def seed_accounts(tenants):
    made = 0
    # The circle's authors have accounts even when their road has ended: their posts are the point of having them here.
    authors = {name for name, _, replies in SOUL_POSTS for name in [name, *(r for r, _ in replies)]}
    for soul in Soul.all_objects.filter(Q(current_state__in=["JUDGING", "DISPOSED", "REINCARNATING"]) | Q(name__in=authors)):
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


#: The soul each underworld shows in the demo's soul entrance (frontend/demo/DemoSoul.tsx), first one with an account
#: wins: 窦娥 waits to be reborn (地府 has a 转生 tab), Tristan is on the terraces, Nefertari in the Field of Reeds,
#: Orpheus waits by the meadow (希腊 has a 转生 tab too).
SOUL_VIEW = {"cn": ["窦娥", "梁山伯"], "eu": ["Tristan", "Lancelot"], "eg": ["Nefertari", "Bata"], "gr": ["Orpheus", "Eurydice"]}
SOUL_PASSWORD = "demo-only-not-a-secret"


def seed_soul_logins():
    """For the recorder: a known password on one soul account per underworld, and where to find it. The recorder
    signs in as each through the soul app's own `/soul-auth/login/` and records what `/me/` answers."""
    out = {}
    for civ, names in SOUL_VIEW.items():
        for name in names:
            soul = Soul.all_objects.filter(name=name).order_by("-create_time").first()
            account = accounts.current_account_of(soul) if soul else None
            if account is None:
                continue
            account.user.set_password(SOUL_PASSWORD)
            account.user.save(update_fields=["password"])
            account.must_change_password = False
            account.initial_password_expires_at = None
            account.save(update_fields=["must_change_password", "initial_password_expires_at"])
            out[civ] = {"name": name, "soul_code": soul.soul_code}
            break
        else:
            print("  no soul account for the soul entrance:", civ)
    path = os.environ.get("DEMO_SOUL_LOGINS")
    if path:
        Path(path).write_text(json.dumps(out, ensure_ascii=False))
    print("soul logins:", sorted(out))


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
    """One bench still sitting, one concluded, one still being convened (PROPOSED: its seats are not chosen yet, and
    the recorder asks who may sit). All begin in the Fifth Court and sit with the Greeks."""
    cn, gr = tenants["CN_DIYU"], tenants["GR_HADES"]
    sitting = make_soul(cn, "哪吒", 52, 48, 0)
    done = make_soul(cn, "项羽", 44, 61, 1, fate="failed")
    convening = make_soul(cn, "沉香", 61, 30, 2)
    try:
        case = sent_on(convening.die(location=convening.origin_location))
        Judgment.all_objects.filter(pk=case.pk).update(court="第五殿")
        cite_grounds(case, convening, None)
        cj = CrossTenantJudgmentService.create("沉香案·两界会审", "两界共审,先地府后希腊冥界", cn, None)
        cj.judgment = case
        cj.save(update_fields=["judgment"])
    except Exception as exc:
        print("  cross stuck: 沉香案·两界会审", type(exc).__name__, str(exc)[:200])
    for soul, conclude, title in ((sitting, False, "哪吒案·两界会审"), (done, True, "项羽案·两界会审")):
        try:
            case = sent_on(soul.die(location=soul.origin_location))
            Judgment.all_objects.filter(pk=case.pk).update(court="第五殿")
            # The Fifth Court's own grounds, written before the verdict as every other case's are (`cite_grounds`).
            cite_grounds(case, soul, Verdict.FAILED if conclude else None)
            cj = CrossTenantJudgmentService.create(title, "两界共审,先地府后希腊冥界", cn, None)
            cj.judgment = case
            cj.save(update_fields=["judgment"])
            seat = CrossTenantJudgmentService.add_participant(cj, gr, None, ParticipantRole.CO_JUDGE, node_order=2)
            # Tartarus: the Greek bench's stop is where the Greeks send the wicked (Gorgias 523b, 525c).
            CrossTenantJudgmentService.submit_sentence(seat, "GR_TARTARUS", 10, "", None)
            CrossTenantJudgmentService.activate(cj)
            if conclude:
                CrossTenantJudgmentService.conclude(cj, "PASS", None)
                case.conclude(Verdict.FAILED, NOTES["CN_DIYU"]["FAILED"])
                walk(case)
        except Exception as exc:
            print("  cross stuck:", title, type(exc).__name__, str(exc)[:200])


#: The court a case is heard in, by underworld (the spellings `courtLabel` knows, packages/core/src/domain/courts.ts), and
#: the demo judge who sits there (`judge` is the deity, an Actor; the claim is the demo account's). Diyu: every case
#: comes to King Qinguang's First Court, the good go on to the Tenth for rebirth, the guilty to the Second to Ninth.
TEN_COURTS = ["第一殿", "第二殿", "第三殿", "第四殿", "第五殿", "第六殿", "第七殿", "第八殿", "第九殿", "第十殿"]
COURT_OF = {"EU_HEAVEN_HELL": "天堂", "EG_DUAT": "两真之殿", "GR_HADES": "岔路口草地"}
JUDGE_OF = {"CN_DIYU": "崔府君", "EU_HEAVEN_HELL": "Christ", "EG_DUAT": "Thoth", "GR_HADES": "Minos"}


def court_for(case, i):
    if case.tenant.code != "CN_DIYU":
        return COURT_OF.get(case.tenant.code, "")
    if case.verdict is None:
        return TEN_COURTS[0]
    return TEN_COURTS[9] if case.verdict == Verdict.PASSED else TEN_COURTS[1 + i % 8]


def court_org(tenant, court):
    """The unit a case of this court belongs to (`default_owner_org`: the hall's unit named after the court). The ten
    courts and Heaven are `init_organizations` rows with no hall; each hall gets its own copy, under its root."""
    if not Organization.objects.filter(tenant=tenant, name__startswith=court).exists():
        entry = next((o for o in INITIAL_ORGANIZATIONS if o["name"].startswith(court)), None)
        if entry is not None:
            Organization.objects.create(name=entry["name"], name_en=ORGANIZATION_NAME_EN.get(entry["name"], ""),
                                        code=f"{entry['code']}_{tenant.code}"[:50], category=entry["category"],
                                        tenant=tenant, parent=tenant_root(tenant))
    return default_owner_org(tenant, None, court)


def seat_benches():
    """Court, judge and owning unit on every case: the queue's 殿 filter and the 殿 · 判官 column read them."""
    judges = {code: Actor.all_objects.filter(tenant__code=code, name=name, is_deleted=False).first() for code, name in JUDGE_OF.items()}
    for code, actor in judges.items():
        if actor is None:
            print("  no judge actor:", code, JUDGE_OF[code])
    seated = 0
    for i, case in enumerate(Judgment.all_objects.filter(tenant__isnull=False).select_related("tenant").order_by("created_at", "pk")):
        court = case.court or court_for(case, i)
        if not court:
            continue
        unit = court_org(case.tenant, court)
        Judgment.all_objects.filter(pk=case.pk).update(court=court, judge=judges.get(case.tenant.code), owner_org=unit)
        # The soul is filed where its first case is: the soul page's 「所属机构」 said
        # the hall's root (第五殿) under a header naming the court that judged him (屈原, 第二殿, 2026-11-08). A soul
        # living in another hall (an open transfer) keeps the unit the transfer gave it: only a soul still filed under its
        # hall's root, as it was created, moves.
        Soul.all_objects.filter(pk=case.soul_id, owner_org=tenant_root(case.tenant)).update(owner_org=unit)
        seated += 1
    print("benches:", seated)


def seed_deleted(admin):
    """回收站里的几条。"""
    for name, reason in (("无名氏甲", "重复录入"), ("Nameless of Thebes", "录入错误,灵魂并不存在"), ("张冠李", "姓名张冠李戴,已另建")):
        soul = Soul.objects.create(name=name, tenant=Tenant.objects.get(code="CN_DIYU"), origin_location="金陵", birth_year=1950, birth_month=3, birth_day=9)
        DIED[soul.pk] = 1990
        soul.delete_with_cascade(user=admin, reason=reason)


def seed_sentence_requests():
    """待原审判官决定的计划变更请求。服务层拒绝「灵魂就在这里」的提请,而种子要的是摆在那等人决定的状态,所以直接写行。"""
    reasons = {
        "CN_DIYU": ["外邦新出证人,请求重开此案。", "地府核定刑期有误,请原审复核。"],
        "EU_HEAVEN_HELL": ["新出证人,请求重审。", "赦罪令已下,请原审确认是否重开。"],
        "EG_DUAT": ["两真之殿发现判词与卷宗不符。", "请求重新称量。"],
        "GR_HADES": ["地府新出证人,请求重开此案。", "判官存疑,请米诺斯复核。"],
    }
    plans = list(SentencePlan.all_objects.filter(status="ACTIVE").select_related("soul")[:40])
    made = {}
    for plan in plans:
        code = plan.soul.tenant.code
        if made.get(code, 0) >= 2:
            continue
        other = "GR_HADES" if code != "GR_HADES" else "CN_DIYU"
        SentencePlanRequest.all_objects.create(plan=plan, from_tenant_code=other, kind="REOPEN", reason=reasons[code][made.get(code, 0) % 2], changes={})
        made[code] = made.get(code, 0) + 1
    print("sentence requests:", made)


def seed_history():
    """一年的普查与月度账本:图才有走势。今天这一天是真普查,往前按它缩放;每个状态的走法不同,线不会平。"""
    today = timezone.now().date()
    for t in Tenant.objects.all():
        now_row = census_tenant(t)
        for d in range(1, 400):
            grown = 0.35 + 0.65 * (1 - d / 400) ** 1.3
            wave = lambda phase: 1 + 0.16 * math.sin(d / 9 + phase) + 0.07 * math.sin(d / 2.7 + phase * 3)  # noqa: E731
            by_state = {k: max(0, round(n * (grown if k != "ALIVE" else 2 - grown) * wave(i))) for i, (k, n) in enumerate(now_row.by_state.items())}
            total = sum(by_state.values())
            by_realm = {k: max(0, round(n * grown * wave(i + 5))) for i, (k, n) in enumerate(now_row.by_realm.items())}
            SoulCensusSnapshot.objects.update_or_create(tenant=t, day=today - timedelta(days=d), defaults=dict(
                soul_count=total, by_state=by_state, by_civilization={t.civilization: total} if total else {}, by_realm=by_realm))
        base = BalanceSnapshot.objects.filter(tenant=t).order_by("-month").first()
        if base is None:
            continue
        month = base.month
        for m in range(1, 12):
            month = (month - timedelta(days=1)).replace(day=1)
            BalanceSnapshot.objects.update_or_create(tenant=t, month=month, defaults=dict(
                soul_count=max(1, round(base.soul_count * (1 - m / 16))), balance_total=round(base.balance_total * (1 - m / 13) + 9 * math.sin(m))))


def backdate_deaths():
    """`die()` 写的是今天。走完了的人换成他真正死的那一年;案子还开着的,死在开案那天(`spread_time` 之后调)。"""
    for soul in Soul.all_objects.exclude(current_state="ALIVE"):
        year = DIED.get(soul.pk)
        if year is None:
            case = Judgment.all_objects.filter(soul=soul).order_by("created_at").first()
            if case is None:
                continue
            day = case.created_at
            Soul.all_objects.filter(pk=soul.pk).update(death_year=day.year, death_month=day.month, death_day=day.day)
            continue
        month, day = PACE.get(soul.name, {}).get("date") or (random.randint(1, 12), random.randint(1, 28))
        Soul.all_objects.filter(pk=soul.pk).update(death_year=year, death_month=month, death_day=day)
    # 她在岸边等过:身份卡的「渡河」那一行(导览第二步)。在她过河之后才写,否则审判时认领不了。
    Soul.all_objects.filter(name__startswith="Penelope").update(ferry_passage="UNBURIED")
    # 功过按年衰减:千年前的善恶算下来全是 0,表上一片空。演示写回人物本来的分数。
    for pk, (merit, demerit) in PLANNED.items():
        Soul.all_objects.filter(pk=pk).update(merit_score=merit, demerit_score=demerit)


#: 灵魂离最近一件事过了多久(天):队列里的新,已转世的旧。
AGE_BY_STATE = {"ALIVE": (200, 1500), "JUDGING": (1, 16), "DISPOSED": (6, 120), "REINCARNATING": (20, 240), "TERMINATED": (60, 500)}
#: A case concluded with its approval still half walked was decided this week: /events opens on the last 7 days.
AGE_BY_FATE = {"flow": (0.3, 5)}
#: 种子跑一秒,历史上算两小时:一个灵魂经历的事前后拉开,先后不变。
STRETCH = 7200


def spread_time(started):
    """种子几十秒跑完,所有时间戳都挤在这几十秒里。把每个灵魂(或帖子)的一串事搬到它自己的过去,保持先后;
    不属于谁的行各自散开。只动落在种子运行窗口里的值:`until`、`expires_at` 这些未来的时间不碰。"""
    ended = timezone.now()
    owner = {
        "soul_id": {},
        "judgment_id": dict(Judgment.all_objects.values_list("pk", "soul_id")),
        "workflow_id": {w: s for w, s in ApprovalWorkflow.all_objects.values_list("pk", "soul_id")},
        "plan_id": dict(SentencePlan.all_objects.values_list("pk", "soul_id")),
        "account_id": dict(SoulAccount.objects.values_list("pk", "soul_id")),
        "post_id": {},
    }
    states = dict(Soul.all_objects.values_list("pk", "current_state"))
    rows = []
    for model in apps.get_models():
        fields = [f.name for f in model._meta.concrete_fields if isinstance(f, DateTimeField)]
        if not fields:
            continue
        for values in model._base_manager.values("pk", *fields, *[k for k in owner if k in {f.attname for f in model._meta.concrete_fields}]):
            stamps = {f: values[f] for f in fields if values[f] is not None and started <= values[f] <= ended}
            if not stamps:
                continue
            if model is Soul:
                group = ("soul", values["pk"])
            elif model is Post:
                group = ("post", values["pk"])
            else:
                group = next((("post" if k == "post_id" else "soul", owner[k].get(values[k], values[k])) for k in owner if values.get(k)), (model.__name__, values["pk"]))
            rows.append((model, values["pk"], stamps, group))
    span = {}
    for _, _, stamps, group in rows:
        low, high = span.get(group, (None, None))
        vals = list(stamps.values())
        span[group] = (min(vals + ([low] if low else [])), max(vals + ([high] if high else [])))
    ages = {}
    for group in span:
        if group[0] == "soul":
            low, high = AGE_BY_FATE.get(FATE.get(group[1])) or AGE_BY_STATE.get(states.get(group[1]), (5, 90))
        elif group[0] == "post":
            low, high = (1, 45)
        else:
            low, high = (1, 90)
        ages[group] = timedelta(days=random.uniform(low, high))
    for model, pk, stamps, group in rows:
        low, high = span[group]
        length = (high - low).total_seconds() * STRETCH
        start = ended - ages[group] - timedelta(seconds=length)
        model._base_manager.filter(pk=pk).update(**{f: start + timedelta(seconds=(t - low).total_seconds() * STRETCH) for f, t in stamps.items()})
    for pk, marks in MARKS.items():
        low, high = span[("soul", pk)]
        start = ended - ages[("soul", pk)] - timedelta(seconds=(high - low).total_seconds() * STRETCH)
        MARKS[pk] = [(start + timedelta(seconds=(t - low).total_seconds() * STRETCH), days) for t, days in marks]
    print("timestamps moved:", len(rows), "rows in", len(span), "groups")


def write_lives():
    """For the recorder. A database column cannot hold 1255 BCE, so the stamps of a finished life are moved there when
    recorded (`historize` in demo-record.mjs): each soul's first stamp lands on its death, and the rest keep their distance."""
    souls = {}
    for soul in Soul.all_objects.filter(pk__in=list(DIED)):
        # From DIED, not the row: rebirth clears the death on a soul that has gone round.
        souls[str(soul.pk)] = {"year": DIED[soul.pk], "month": soul.death_month or random.randint(1, 12), "day": soul.death_day or random.randint(1, 28), "first": soul.create_time.isoformat(),
                             "pace": [[t.isoformat(), days] for t, days in MARKS.get(soul.pk, [])]}
    owner = {}
    for model, field in ((Judgment, "soul_id"), (ApprovalWorkflow, "soul_id"), (SentencePlan, "soul_id"), (Disposition, "soul_id")):
        for pk, soul in model._base_manager.values_list("pk", field):
            if str(soul) in souls:
                owner[str(pk)] = str(soul)
    Path(os.environ["DEMO_LIVES"]).write_text(json.dumps({"souls": souls, "owner": owner}))


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
    for u in demo_users:
        hall = {"CN_DIYU": "第五殿", "EU_HEAVEN_HELL": "炼狱", "EG_DUAT": "两真之殿", "GR_HADES": "岔路口的草地"}.get(u.tenant.code if u.tenant else "", "本殿")
        texts = [("新案待认领", f"{hall}队列有新案"), ("审批待办", "有一件结案等你批"), ("调拨通知", f"有灵魂调入{hall}")]
        for i, (title, body) in enumerate(texts):
            try:
                UserNotification.objects.create(user=u, title=title, message=body, is_read=i == 0)
            except Exception as exc:
                print("  notification:", type(exc).__name__, str(exc)[:140])
                return


def main():
    started = timezone.now()
    # A ledger decays with time, and these lives are centuries old; left alone, every heart would weigh nothing.
    from apps.ledger import services as ledger_services
    for civ in list(ledger_services.CIVILIZATION_DECAY_RATE):
        ledger_services.CIVILIZATION_DECAY_RATE[civ] = 0.0
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
            # 朋友圈巡察(MODERATOR,2026-11-07 起只管朋友圈审核)不是神职,用普通官员的名字(用户 2026-11-07)。
            # 此前这里是「殿主」阎罗王;孟婆是第十殿醧忘台司汤之神,上面 OFFICERS 里是普通官员(docs/09、docs/02 §三)。
            officer("demo_moderator", "林清", "MODERATOR", tenants["CN_DIYU"]),
            officer("demo_judge_eu", "Christ", "JUDGE", tenants["EU_HEAVEN_HELL"]),
            officer("demo_judge_eg", "Thoth", "JUDGE", tenants["EG_DUAT"]),
            officer("demo_judge_gr", "Minos", "JUDGE", tenants["GR_HADES"])]
    judges.update(CN_DIYU=demo[1], EU_HEAVEN_HELL=demo[3], EG_DUAT=demo[4], GR_HADES=demo[5])
    seed_souls(tenants, judges)
    seed_queue_variety(tenants)
    seed_cross_judgments(tenants)
    seed_dispatches(tenants)
    seed_social(tenants)
    seed_death_sync(tenants)
    seed_accounts(tenants)
    seed_soul_circle()
    seed_soul_logins()
    seed_appeals()
    seed_audit(list(User.objects.exclude(role="SOUL")[:12]))
    seed_notifications(demo)
    seed_deleted(demo[0])
    seed_sentence_requests()
    seat_benches()
    spread_time(started)
    backdate_deaths()
    write_lives()
    call_command("snapshot_balances", stdout=StringIO())
    seed_history()
    print("realms:", Realm.all_objects.count(), "users:", User.objects.count(), "workflows:", ApprovalWorkflow.all_objects.count())


if __name__ == "__main__":
    main()
