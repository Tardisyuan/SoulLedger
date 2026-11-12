"""手动开通按数据范围选灵魂,已有账号时不改联系方式(流程走查 2026-11-12 F-ACCT-01)。

此前 `provision` 只按殿选灵魂、无条件写联系邮箱:本机构官员可给别机构的灵魂开号(初始密码发到自己的邮箱),
或把它已有账号的登录邮箱换成自己的,再走邮箱重置接管;事务提交后 `get_queryset` 按范围找不到它,接口答 500。
"""
import pytest
from django.core import mail

from apps.perm.cache import invalidate_all_permissions
from apps.perm.models import Role, RolePermission
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, SoulAccount
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.data_scope_support import org, scope
from tests.perm_support import seeded_grants, seeded_permission
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db
URL = "/api/v1/soul-accounts/accounts/provision/"


@pytest.fixture
def w(cn_tenant):
    seeded_grants()
    clerk = Role.objects.get_or_create(name="ACCT01_CLERK", defaults={"display_name": "书吏"})[0]
    for codename in ("soul_account.read", "soul_account.manage"):
        RolePermission.objects.get_or_create(role=clerk, permission=seeded_permission(codename))
    invalidate_all_permissions()
    mine, theirs = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    officer = sp.officer("acct01", "JUDGE", cn_tenant, organization=mine, extra_roles=["ACCT01_CLERK"])
    scope("JUDGE", "ORG")
    mail.outbox.clear()

    def soul(name, owner):
        return Soul.objects.create(name=name, tenant=cn_tenant, owner_org=owner, current_state=SoulState.JUDGING)

    return officer_client(officer), soul, mine, theirs


def test_a_soul_outside_the_scope_cannot_be_provisioned(w):
    client, soul, _, theirs = w
    outside = soul("他司魂", theirs)
    response = client.post(URL, {"soul_id": str(outside.pk), "contact_email": "me@example.com"}, format="json")
    assert response.status_code == 404, response.data
    assert not SoulAccount.objects.filter(soul=outside).exists()
    assert Soul.objects.get(pk=outside.pk).contact_email == ""
    assert mail.outbox == []


def test_a_soul_outside_the_scope_with_an_account_keeps_its_login_email(w):
    client, soul, _, theirs = w
    outside = soul("他司魂", theirs)
    svc.apply_contacts(outside, "owner@example.com")
    svc.provision_account(outside, AccountOrigin.OFFICER)
    response = client.post(URL, {"soul_id": str(outside.pk), "contact_email": "me@example.com"}, format="json")
    assert response.status_code == 404, response.data
    assert svc.current_account_of(outside).user.email == "owner@example.com"


def test_an_existing_account_in_scope_is_returned_without_touching_its_contacts(w):
    client, soul, mine, _ = w
    inside = soul("本司魂", mine)
    svc.apply_contacts(inside, "owner@example.com")
    svc.provision_account(inside, AccountOrigin.OFFICER)
    response = client.post(URL, {"soul_id": str(inside.pk), "contact_email": "me@example.com"}, format="json")
    assert response.status_code == 200, response.data
    assert Soul.objects.get(pk=inside.pk).contact_email == "owner@example.com"
    assert svc.current_account_of(inside).user.email == "owner@example.com"


def test_a_new_account_in_scope_takes_the_contacts(w):
    client, soul, mine, _ = w
    inside = soul("本司魂", mine)
    response = client.post(URL, {"soul_id": str(inside.pk), "contact_email": "new@example.com"}, format="json")
    assert response.status_code == 201, response.data
    assert svc.current_account_of(inside).user.email == "new@example.com"
