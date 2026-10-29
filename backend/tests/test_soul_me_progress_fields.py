"""`/me/` 的到案进度字段(2026-10-29 用户决定;App 界面待 Design):勾魂牒、卡戎渡河、地狱前庭、四十二条否认、
枉死城超度。不适用时一律 null —— 每条既断言出现,也断言别的灵魂 / 别的状态下缺席。"""
import datetime
import io

import pytest
from django.core.management import call_command

from apps.dispatch.models import CaptureStatus, CaptureWarrant
from apps.judgment import confessions
from apps.judgment.models import GrievanceStatus, Judgment, JudgmentMethod
from apps.realms.models import Realm
from apps.realms.path import SoulPathService
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin
from apps.souls import acheron
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import ready_soul, soul_client

pytestmark = pytest.mark.django_db

ME = "/api/v1/me/"
FIELDS = ("capture_warrant", "greek_ferry", "european_vestibule", "negative_confession", "wangsi_delivered_at")


@pytest.fixture
def gr_tenant(db):
    return Tenant.objects.get_or_create(code="GR_HADES", defaults={"display_name": "Hades"})[0]


def _me(account):
    return soul_client(account).get(ME).data


def _account(soul):
    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.must_change_password = False
    account.initial_password_expires_at = None
    account.save()
    return account


def test_an_ordinary_soul_has_every_progress_field_null(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    data = _me(account)
    assert {name: data[name] for name in FIELDS} == dict.fromkeys(FIELDS)


def test_an_open_capture_warrant_shows_until_it_is_handed_over(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    warrant = CaptureWarrant.all_objects.create(tenant=cn_tenant, soul=account.soul)
    shown = _me(account)["capture_warrant"]
    assert shown["status"] == "ISSUED" and shown["issued_at"]
    CaptureWarrant.all_objects.filter(pk=warrant.pk).update(status=CaptureStatus.CAPTURED)
    assert _me(account)["capture_warrant"]["status"] == "CAPTURED"
    CaptureWarrant.all_objects.filter(pk=warrant.pk).update(status=CaptureStatus.HANDED_OVER)
    assert _me(account)["capture_warrant"] is None
    other, _ = ready_soul(cn_tenant, name="别人")
    CaptureWarrant.all_objects.create(tenant=cn_tenant, soul=other.soul)
    assert _me(account)["capture_warrant"] is None  # 别人的牒不出现在我这里


def test_an_unburied_greek_soul_sees_the_day_it_crosses(gr_tenant):
    account, _ = ready_soul(gr_tenant, ferry_passage="UNBURIED", death_year=1990, death_month=3, death_day=4)
    assert _me(account)["greek_ferry"] == {"ferry_passage": "UNBURIED", "crossed": False, "crosses_on": "2090-03-04"}
    fareless, _ = ready_soul(gr_tenant, name="无渡资", ferry_passage="NO_FARE", death_year=1990)
    assert _me(fareless)["greek_ferry"] == {"ferry_passage": "NO_FARE", "crossed": False, "crosses_on": None}
    ancient, _ = ready_soul(gr_tenant, name="古人", ferry_passage="UNBURIED", death_year=1800)
    assert _me(ancient)["greek_ferry"]["crossed"] is True
    buried, _ = ready_soul(gr_tenant, name="已葬", death_year=1990)
    assert _me(buried)["greek_ferry"] is None


@pytest.mark.parametrize(("year", "month", "day"), [(1990, 3, 4), (1992, 2, 29), (1990, None, None), (1990, 2, None),
                                                    (-50, 6, 1)])
def test_crosses_on_is_the_first_day_crossed_agrees_with(year, month, day):
    soul = Soul(ferry_passage="UNBURIED", death_year=year, death_month=month, death_day=day)
    on = acheron.crosses_on(soul)
    assert acheron.crossed(soul, on) and not acheron.crossed(soul, on - datetime.timedelta(days=1))


def test_a_soul_in_the_vestibule_sees_when_it_entered(eu_tenant):
    account, _ = ready_soul(eu_tenant)
    assert _me(account)["european_vestibule"] is None
    vestibule = Realm.objects.create(realm_code="EU_ANTINFERNO", civilization="EUROPEAN", name_local="前庭",
                                     realm_type="HELL", tenant=eu_tenant, is_eternal=True)
    acheron_realm = Realm.objects.create(realm_code="EU_ACHERON", civilization="EUROPEAN", name_local="渡口",
                                         realm_type="NEUTRAL", tenant=eu_tenant)
    SoulPathService.enter(account.soul, acheron_realm, tenant_id=eu_tenant.pk)
    assert _me(account)["european_vestibule"] is None
    SoulPathService.enter(account.soul, vestibule, tenant_id=eu_tenant.pk)
    assert _me(account)["european_vestibule"]["entered_at"]


def test_a_weighed_egyptian_case_shows_the_42_tally(admin_user):
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    tenant = Tenant.objects.get(code="EG_DUAT")
    soul = Soul.objects.create(name="Ani", tenant=tenant, current_state=SoulState.JUDGING)
    account = _account(soul)
    assert _me(account)["negative_confession"] is None
    case = Judgment.objects.create(soul=soul, tenant=tenant, civilization="EGYPTIAN", court="—",
                                   judgment_method=JudgmentMethod.HEART_WEIGHING)
    confessions.record(case, 7, False)
    confessions.record(case, 8, True)
    assert _me(account)["negative_confession"] == {"truthful": 1, "untruthful": 1, "unheard": 40, "total": 42}


def test_wangsi_delivered_at_is_the_latest_delivery_of_this_life(cn_tenant):
    account, _ = ready_soul(cn_tenant)
    when = datetime.datetime(2026, 10, 1, 8, tzinfo=datetime.UTC)
    Judgment.objects.create(soul=account.soul, civilization="CHINESE", tenant=cn_tenant, untimely=True,
                            grievance_status=GrievanceStatus.REJECTED, grievance_decided_at=when)
    assert _me(account)["wangsi_delivered_at"] is None  # 不属实不算超度
    Judgment.objects.create(soul=account.soul, civilization="CHINESE", tenant=cn_tenant, untimely=True,
                            grievance_status=GrievanceStatus.DELIVERED, grievance_decided_at=when)
    assert datetime.datetime.fromisoformat(_me(account)["wangsi_delivered_at"].replace("Z", "+00:00")) == when
