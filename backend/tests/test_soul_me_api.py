"""`/api/v1/me/`:只返回本人、只返回白名单字段、前世按 cycle 查。

断言形状是「键集合**恰好**等于」,不是「包含」:包含式断言在白名单外的字段悄悄混进来时
仍然是绿的。另有逐项的不在场断言,针对设计文档点名不开放的东西。
"""
import json

import pytest

from apps.actors.models import Actor
from apps.disposition.models import Disposition
from apps.judgment.models import Judgment
from apps.realms.models import Realm
from apps.reincarnation.models import Reincarnation
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin
from apps.souls.models import SoulState
from apps.souls.record_models import SoulRecord
from tests.soul_account_support import dead_soul, ready_soul, rebirth_ready_soul, soul_client

pytestmark = pytest.mark.django_db

PROFILE_KEYS = {
    "soul_code", "name", "birth_name", "civilization", "tenant", "home_tenant", "home_civilization", "is_residing",
    "current_state", "birth_date", "death_date",
    "origin_location", "merit_score", "demerit_score", "account",
}
ACCOUNT_KEYS = {"cycle", "must_change_password", "initial_password_expires_at", "created_at"}
LIFE_KEYS = {"cycle", "records", "judgments", "dispositions", "rebirth_applications", "reincarnation"}
RECORD_KEYS = {"id", "record_type", "category", "description", "weight", "event_date", "is_milestone",
               "recorded_at"}
JUDGMENT_KEYS = {"id", "court", "judge", "judgment_method", "verdict", "is_final", "created_at", "concluded_at"}
JUDGE_KEYS = {"name", "name_zh", "title"}
DISPOSITION_KEYS = {"id", "judgment_id", "destination_realm", "memory_reset", "is_eternal", "sentence_years",
                    "term_start", "is_executed", "executed_at", "created_at"}
REALM_KEYS = {"realm_code", "name_local", "name_zh", "name_en"}
REINCARNATION_KEYS = {"cycle_count", "rebirth_form", "target_realm", "reincarnated_at"}

SECRETS = ["证据原件-机密", "判官内部备注", "供词原文", "处置内部备注", "转世后的新名字", "转世备注", "判官私记"]


def _life_rows(soul, suffix):
    SoulRecord.objects.create(soul=soul, record_type="MERIT", description=f"功{suffix}", weight=3,
                              evidence_json={"raw": "证据原件-机密"})
    SoulRecord.objects.create(soul=soul, record_type="JUDGMENT", description=f"审判证据记录{suffix}")
    judge = Actor.objects.create(name=f"秦广王{suffix}", name_zh="秦广王", civilization="CHINESE", role="JUDGE",
                                 title="第一殿", tenant=soul.tenant, description="判官私记")
    judgment = Judgment.objects.create(soul=soul, civilization="CHINESE", tenant=soul.tenant, judge=judge,
                                       court="第一殿", evidence_json={"raw": "证据原件-机密"},
                                       notes="判官内部备注", confession="供词原文", verdict="PASSED", is_final=True)
    realm = Realm.objects.create(realm_code=f"R{suffix}", civilization="CHINESE", name_local="人间",
                                 realm_type="HUMAN", tier=1)
    Disposition.objects.create(soul=soul, judgment=judgment, destination_realm=realm, notes="处置内部备注",
                               tenant=soul.tenant)


@pytest.fixture
def reborn_soul(cn_tenant):
    """第 0 世死、审、处置、转世;第 1 世又死、审。本世账号是 cycle 1。"""
    soul = dead_soul(cn_tenant, name="轮回者", state=SoulState.JUDGING)
    _life_rows(soul, "0")
    Reincarnation.objects.create(soul=soul, cycle_count=1, rebirth_form="HUMAN", target_realm="R0",
                                 new_identity="转世后的新名字", notes="转世备注", tenant=cn_tenant)
    _life_rows(soul, "1")
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.must_change_password = False
    account.save()
    return soul, account


def test_the_cycle_columns_are_stamped_per_life(reborn_soul):
    soul, account = reborn_soul
    assert account.cycle == 1
    assert sorted(Judgment.objects.filter(soul=soul).values_list("cycle", flat=True)) == [0, 1]
    assert sorted(Disposition.objects.filter(soul=soul).values_list("cycle", flat=True)) == [0, 1]


def test_profile_is_exactly_the_whitelist(reborn_soul, cn_tenant):
    soul, account = reborn_soul
    soul.contact_email = "hidden@example.com"
    soul.description = "官员写的描述"
    soul.save()
    data = soul_client(account).get("/api/v1/me/").data
    assert set(data) == PROFILE_KEYS
    assert set(data["account"]) == ACCOUNT_KEYS
    assert set(data["tenant"]) == {"code", "display_name", "hall_names"}
    assert data["soul_code"] == soul.soul_code and data["account"]["cycle"] == 1
    raw = json.dumps(data, ensure_ascii=False, default=str)
    for absent in ("hidden@example.com", "官员写的描述", "contact", "description", "baptism"):
        assert absent not in raw


def test_current_life_shows_only_this_life_and_only_whitelisted_fields(reborn_soul):
    soul, account = reborn_soul
    data = soul_client(account).get("/api/v1/me/life/").data
    assert set(data) == LIFE_KEYS and data["cycle"] == 1
    assert [r["description"] for r in data["records"]] == ["功1"], "只有本世;JUDGMENT 类记录不是功过"
    assert set(data["records"][0]) == RECORD_KEYS
    assert len(data["judgments"]) == 1 and set(data["judgments"][0]) == JUDGMENT_KEYS
    assert set(data["judgments"][0]["judge"]) == JUDGE_KEYS
    assert data["judgments"][0]["court"] == "第一殿"
    assert len(data["dispositions"]) == 1 and set(data["dispositions"][0]) == DISPOSITION_KEYS
    assert set(data["dispositions"][0]["destination_realm"]) == REALM_KEYS
    assert data["reincarnation"] is None
    raw = json.dumps(data, ensure_ascii=False, default=str)
    for secret in SECRETS + ["evidence_json", "confession", "notes", "new_identity", "功0"]:
        assert secret not in raw, secret


def test_past_lives_are_read_only_by_cycle_and_hide_new_identity(reborn_soul):
    soul, account = reborn_soul
    data = soul_client(account).get("/api/v1/me/past-lives/").data
    assert [life["cycle"] for life in data] == [0]
    life = data[0]
    assert set(life) == LIFE_KEYS
    assert [r["description"] for r in life["records"]] == ["功0"]
    assert set(life["reincarnation"]) == REINCARNATION_KEYS and life["reincarnation"]["cycle_count"] == 1
    raw = json.dumps(data, ensure_ascii=False, default=str)
    for secret in SECRETS + ["evidence_json", "new_identity", "功1"]:
        assert secret not in raw, secret


def test_a_soul_never_sees_another_soul(reborn_soul, cn_tenant):
    soul, account = reborn_soul
    other_account, other_client = rebirth_ready_soul(cn_tenant, name="旁人")
    SoulRecord.objects.create(soul=other_account.soul, record_type="MERIT", description="旁人的功")
    for url in ("/api/v1/me/", "/api/v1/me/life/", "/api/v1/me/past-lives/"):
        raw = json.dumps(soul_client(account).get(url).data, ensure_ascii=False, default=str)
        assert "旁人" not in raw
        mine = json.dumps(other_client.get(url).data, ensure_ascii=False, default=str)
        assert "轮回者" not in mine and "功0" not in mine and "功1" not in mine
    # URL 里塞别人的 id 没有用:/me 不接受灵魂 id,申请详情按本人过滤。
    from apps.soul_accounts.rebirth import submit

    application = submit(other_account, "HUMAN")
    assert soul_client(account).get(f"/api/v1/me/rebirth-applications/{application.pk}/").status_code == 404


def test_a_soul_in_another_tenant_is_equally_invisible(reborn_soul, eu_tenant):
    soul, account = reborn_soul
    eu_account, eu_client = ready_soul(eu_tenant, name="Beatrice")
    assert "轮回者" not in json.dumps(eu_client.get("/api/v1/me/life/").data, ensure_ascii=False, default=str)
    assert eu_client.get("/api/v1/me/").data["tenant"]["code"] == "EU_HEAVEN_HELL"
