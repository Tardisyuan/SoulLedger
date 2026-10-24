"""转世月配额(2026-10-24 用户决定):殿管理员按道设每月上限，满了的灵魂留在 REINCARNATING 里候位。"""
import pytest

from apps.reincarnation.services import RebirthQuotaFull, ReincarnationService, quota_usage
from apps.souls.models import Soul, SoulState

pytestmark = pytest.mark.django_db


def _waiting(tenant, name):
    return Soul.objects.create(name=name, tenant=tenant, current_state=SoulState.REINCARNATING)


def test_a_full_path_refuses_and_the_soul_keeps_waiting(cn_tenant):
    cn_tenant.settings = {**(cn_tenant.settings or {}), "rebirth_monthly_quota": {"HUMAN": 1}}
    cn_tenant.save(update_fields=["settings"])
    ReincarnationService.complete_rebirth(_waiting(cn_tenant, "甲"), rebirth_form="HUMAN")
    second = _waiting(cn_tenant, "乙")
    with pytest.raises(RebirthQuotaFull) as refused:
        ReincarnationService.complete_rebirth(second, rebirth_form="HUMAN")
    assert refused.value.detail["code"] == "rebirth_quota_full"
    second.refresh_from_db()
    assert second.current_state == SoulState.REINCARNATING
    # Another path has no limit; the usage reads back per path.
    ReincarnationService.complete_rebirth(second, rebirth_form="ANIMAL")
    usage = quota_usage(cn_tenant)
    assert usage["HUMAN"] == {"limit": 1, "used": 1} and usage["ANIMAL"] == {"limit": None, "used": 1}


def test_the_admin_sets_and_clears_a_limit_through_the_hall_settings(cn_tenant, admin_user):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(admin_user)
    url = f"/api/v1/tenants/{cn_tenant.code}/settings/"
    assert client.patch(url, {"rebirth_monthly_quota": {"HUMAN": 5, "DIVINE": 0}}, format="json").status_code == 200
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings["rebirth_monthly_quota"] == {"HUMAN": 5, "DIVINE": 0}
    assert client.patch(url, {"rebirth_monthly_quota": {"HUMAN": None}}, format="json").status_code == 200
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings["rebirth_monthly_quota"] == {"DIVINE": 0}
    assert client.patch(url, {"rebirth_monthly_quota": {"DRAGON": 1}}, format="json").status_code == 400
