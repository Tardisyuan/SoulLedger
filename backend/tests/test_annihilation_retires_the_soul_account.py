"""被阿米特吞噬(处置去处 EG_ANNIHILATION)执行时,这一世的灵魂账号永久注销,数据保留(用户 2026-10-20)。

吞噬是第二次死亡:没有下一世,没有申诉,受刑计划停在永久那一站,重开审判拒(`plan_held`)。
所以与转世同一套注销(`_retire_account`),唯一不同:登录邮箱保留 —— 转世清它是为了下一世的账号。
别的去处执行不注销;数据(账号行、事件)不删。
"""
import pytest

from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.events.models import SoulEvent
from apps.realms.models import Realm
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import DeviceLoginRevokeReason, SoulAccount, SoulDeviceLogin
from apps.soul_accounts.services import SoulAccountError
from apps.souls.models import SoulState
from apps.tenants.models import Tenant
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db


@pytest.fixture
def eg(db):
    tenant = Tenant.objects.create(code="EG_DUAT", display_name="Duat")
    common = {"civilization": "EGYPTIAN", "tenant": tenant, "name_local": "x", "name_zh": "x"}
    annihilation = Realm.objects.create(realm_code="EG_ANNIHILATION", name_en="Second Death", realm_type="HELL",
                                        tier=10, is_eternal=True, **common)
    aaru = Realm.objects.create(realm_code="EG_AARU", name_en="Field of Reeds", realm_type="BLISS", tier=1,
                                is_eternal=True, **common)
    return tenant, annihilation, aaru


def _executed(tenant, realm, name):
    account, _ = ready_soul(tenant, name=name, state=SoulState.DISPOSED, contact_email=f"{name}@example.test")
    account.user.email = f"{name}@example.test"
    account.user.save(update_fields=["email"])
    SoulDeviceLogin.objects.create(account=account, credential_hash=f"h-{name}")
    disposition = Disposition.objects.create(soul=account.soul, tenant=tenant, destination_realm=realm)
    assert DispositionService.execute(disposition)
    account.refresh_from_db()
    account.user.refresh_from_db()
    return account


def test_annihilation_retires_the_account_and_keeps_its_data(eg):
    tenant, annihilation, _ = eg
    account = _executed(tenant, annihilation, "ani")
    assert account.retired_at is not None
    assert account.user.is_active is False
    assert account.user.email == "ani@example.test"  # no next life needs it
    login = SoulDeviceLogin.objects.get(account=account)
    assert (login.revoked_at is not None, login.revoked_reason) == (True, DeviceLoginRevokeReason.ACCOUNT_ANNIHILATED)
    assert SoulAccount.objects.filter(pk=account.pk).exists()  # the row stays
    retired = SoulEvent.all_objects.get(soul_id=account.soul_id, event_type="SOUL_ACCOUNT_RETIRED")
    assert retired.payload["reason"] == "account_annihilated"


def test_another_destination_does_not_retire_the_account(eg):
    tenant, _, aaru = eg
    account = _executed(tenant, aaru, "aaru")
    assert account.retired_at is None and account.user.is_active is True
    assert not SoulEvent.all_objects.filter(soul_id=account.soul_id, event_type="SOUL_ACCOUNT_RETIRED").exists()


def test_the_right_password_is_told_the_account_is_gone_and_a_wrong_one_learns_nothing(eg):
    """第四十九批:密码对 → `account_devoured`;密码错 → 照旧「编号或密码错误」,不泄露这个灵魂的结局。"""
    tenant, annihilation, _ = eg
    account = _executed(tenant, annihilation, "pw")
    account.user.set_password("right-pass-123")
    account.user.save(update_fields=["password"])
    assert account.retired_reason == DeviceLoginRevokeReason.ACCOUNT_ANNIHILATED
    code = account.soul.soul_code
    with pytest.raises(SoulAccountError) as right:
        svc.authenticate(code, "right-pass-123")
    assert (right.value.code, right.value.status) == ("account_devoured", 401)
    with pytest.raises(SoulAccountError) as wrong:
        svc.authenticate(code, "wrong-pass-123")
    assert wrong.value.code == "invalid_credentials"
