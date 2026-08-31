"""归档一条处置,必须真的把它从列表里拿掉,并且让它不再可执行。

`apps/core/archive.py::ArchivableMixin` 的 docstring 说「归档的记录会从正常列表中
移除」。**对 Soul 成立,对 Disposition 不成立**:`TenantManager` 只过滤
`is_deleted`,而 disposition 的 queryset 什么都不过滤。2026-08-29 实测:

    d.archive(reason="test") 之后 Disposition.objects.filter(pk=d.pk).count() = 1
    DispositionService.execute(d) 之后 soul.current_state = REINCARNATING

也就是说 `archive()` 改了一个没人读的标志。**一句写在 mixin docstring 里的行为
承诺,是一次没被执行的断言** —— 本范围内 `is_archived` 只在一个地方被读过。
"""
import pytest
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant


@pytest.fixture
def archived(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    user = User.objects.create_user(
        username="op", password="x", role=UserRole.ADMIN, tenant=tenant
    )
    soul = Soul.objects.create(name="待处置", tenant=tenant)
    soul.current_state = SoulState.DISPOSED
    soul.save(update_fields=["current_state"])
    live = Disposition.objects.create(soul=soul, tenant=tenant)
    gone = Disposition.objects.create(soul=soul, tenant=tenant)
    gone.archive(reason="test")
    client = APIClient()
    client.force_authenticate(user=user)
    return client, soul, live, gone


@pytest.mark.django_db
def test_the_archived_one_is_off_the_list(archived):
    client, _, live, gone = archived
    body = client.get("/api/v1/disposition/").json()
    ids = {row["id"] for row in body["results"]}
    assert str(gone.id) not in ids and gone.id not in ids, (
        f"归档的处置还在列表里:{ids}"
    )
    assert str(live.id) in ids or live.id in ids, (
        f"**断存在。** 没归档的那条也不见了 —— 过滤过头了:{ids}"
    )


@pytest.mark.django_db
def test_it_can_still_be_asked_for(archived):
    """归档是可逆的,行也要留着可读 —— 这是它与删除的全部区别。"""
    client, _, _, gone = archived
    body = client.get("/api/v1/disposition/?show_archived=1").json()
    ids = {str(row["id"]) for row in body["results"]}
    assert str(gone.id) in ids, ids


@pytest.mark.django_db
def test_an_archived_disposition_cannot_be_executed(archived):
    _, soul, _, gone = archived
    assert DispositionService.execute(gone) is False, (
        "归档的处置被执行了 —— 一条已经从列表上拿掉的处置把灵魂送去了轮回"
    )
    gone.refresh_from_db()
    soul.refresh_from_db()
    assert gone.is_executed is False
    assert soul.current_state == SoulState.DISPOSED


@pytest.mark.django_db
def test_a_live_disposition_still_executes(archived):
    """**断存在。** 只断「归档的执行不了」的测试,在 execute 一律返回 False 时全绿。"""
    _, soul, live, _ = archived
    assert DispositionService.execute(live) is True
    soul.refresh_from_db()
    assert soul.current_state == SoulState.REINCARNATING
