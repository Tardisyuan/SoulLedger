"""数据范围 B5:实时推送、按码群发通知、用户列表按范围过滤(local-gates/rbac-2026-10-29/datascope-design.md「执行点」)。

殿组(`rt_tenant_*`)的业务帧带 `_scope` 标签(`apps/events/realtime.py::scope_tag`);consumer 连接时与每次权限刷新时
按 `data_scope.org_ids` 算好每项业务的机构集合,帧来时只查这张表。每条断言两边:范围内照收,范围外不收。
"""
from unittest import mock

import pytest
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.events.realtime import ChannelNaming, scope_tag
from apps.judgment.models import CityGod, Judgment
from apps.perm.models import RoleDataScope
from apps.souls.models import Soul, SoulState
from tests import sentence_plan_support as sp
from tests.data_scope_support import org, scope
from tests.soul_account_support import officer_client


def _token(user):
    refresh = RefreshToken.for_user(user)
    refresh["tenant_code"] = user.tenant.code
    return str(refresh.access_token)


async def _connect(user):
    from config.asgi import application

    token = await database_sync_to_async(_token)(user)
    comm = WebsocketCommunicator(application, f"/ws/notifications/?token={token}")
    connected, _ = await comm.connect()
    assert connected
    assert (await comm.receive_json_from(timeout=10))["type"] == "connected"
    return comm


@database_sync_to_async
def _publish(soul):
    """殿组广播的业务事件(`soul` 域不上 WebSocket;今天进殿组的业务事件是 deathsync / workflow 这几个域)。"""
    from apps.events.event_bus import event_bus

    event_bus.publish("WORKFLOW_CREATED", {"soul_id": str(soul.pk), "probe": soul.name}, "workflow",
                      tenant_code=soul.tenant.code)


@database_sync_to_async
def _world(tenant):
    mine, theirs = org(tenant, "本司"), org(tenant, "他司")
    judge = sp.officer("b5_judge", "JUDGE", tenant, organization=mine)
    scope("JUDGE", "ORG")
    souls = {
        "mine": Soul.objects.create(name="本司魂", tenant=tenant, owner_org=mine),
        "theirs": Soul.objects.create(name="他司魂", tenant=tenant, owner_org=theirs),
        "created": Soul.objects.create(name="自建魂", tenant=tenant, owner_org=theirs, create_user=judge),
    }
    return judge, (mine, theirs), souls


async def _next_probe(comm):
    """下一条带 probe 的帧(跳过权限刷新的回帧)。"""
    while True:
        frame = await comm.receive_json_from(timeout=5)
        if "probe" in frame:
            return frame


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_an_out_of_scope_soul_event_is_dropped_and_an_in_scope_one_arrives(cn_tenant):
    judge, _units, souls = await _world(cn_tenant)
    comm = await _connect(judge)
    try:
        await _publish(souls["theirs"])  # 范围外:丢
        await _publish(souls["mine"])  # 范围内:到
        frame = await _next_probe(comm)
        assert frame["probe"] == "本司魂", f"范围外的帧送到了:{frame}"
        assert "_scope" not in frame, "标签不该发给客户端"
        await _publish(souls["created"])  # 别的机构、但本人创建:到
        assert (await _next_probe(comm))["probe"] == "自建魂"
        assert await comm.receive_nothing(timeout=0.5)
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_an_untagged_tenant_frame_still_arrives(cn_tenant):
    """注册表外的事件(调度器、自定义)没有标签,照常放行。"""
    judge, _units, _souls = await _world(cn_tenant)
    comm = await _connect(judge)
    try:
        await get_channel_layer().group_send(
            ChannelNaming.tenant_group(cn_tenant.code), {"type": "realtime_event", "data": {"probe": "plain"}})
        assert (await _next_probe(comm))["probe"] == "plain"
        # 不认识的 resource 同样放行;认识的、范围外的不放
        await get_channel_layer().group_send(ChannelNaming.tenant_group(cn_tenant.code), {
            "type": "realtime_event",
            "data": {"probe": "soul-out", "_scope": {"resource": "soul", "owner_org_id": -1, "owner_user_ids": []}}})
        await get_channel_layer().group_send(ChannelNaming.tenant_group(cn_tenant.code), {
            "type": "realtime_event",
            "data": {"probe": "other", "_scope": {"resource": "not_registered", "owner_org_id": -1}}})
        assert (await _next_probe(comm))["probe"] == "other"
    finally:
        await comm.disconnect()


async def _server_refresh(comm, user):
    await get_channel_layer().group_send(ChannelNaming.user_group(user.pk),
                                         {"type": "permission_refresh", "targeted": True})
    assert (await comm.receive_json_from(timeout=5))["type"] == "permission.refreshed"


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_a_scope_change_takes_effect_on_refresh(cn_tenant):
    judge, _units, souls = await _world(cn_tenant)
    comm = await _connect(judge)
    try:
        await database_sync_to_async(lambda: RoleDataScope.objects.filter(role__name="JUDGE").update(scope="ALL"))()
        await _server_refresh(comm, judge)
        await _publish(souls["theirs"])
        assert (await _next_probe(comm))["probe"] == "他司魂", "改成「全部」并刷新后仍按旧范围丢弃"

        await database_sync_to_async(lambda: RoleDataScope.objects.filter(role__name="JUDGE").update(scope="ORG"))()
        await comm.send_json_to({"type": "permission.refresh"})  # 客户端发的刷新同样重算
        assert (await comm.receive_json_from(timeout=5))["type"] == "permission.refreshed"
        await _publish(souls["theirs"])
        await _publish(souls["mine"])
        assert (await _next_probe(comm))["probe"] == "本司魂"
    finally:
        await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_moving_to_another_unit_takes_effect_on_refresh(cn_tenant):
    judge, (_mine, theirs), souls = await _world(cn_tenant)
    comm = await _connect(judge)
    try:
        await database_sync_to_async(lambda: User.objects.filter(pk=judge.pk).update(organization=theirs))()
        await _server_refresh(comm, judge)
        await _publish(souls["mine"])  # 原机构的:现在范围外
        await _publish(souls["theirs"])
        assert (await _next_probe(comm))["probe"] == "他司魂"
    finally:
        await comm.disconnect()


@pytest.mark.django_db
def test_a_judgment_tag_carries_its_unit_and_every_assigned_person(cn_tenant):
    mine = org(cn_tenant, "本司")
    a, b, c = (sp.officer(f"b5_{n}", "JUDGE", cn_tenant) for n in "abc")
    god = CityGod.objects.create(tenant=cn_tenant, name="酆都城隍", is_default=True)
    god.officers.set([b, c])
    soul = Soul.objects.create(name="张三", tenant=cn_tenant, current_state=SoulState.JUDGING, owner_org=mine)
    judgment = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn_tenant,
                                       evidence_json={}, owner_org=mine, city_god=god, claimed_by=a)
    tag = scope_tag({"soul_id": str(soul.pk), "judgment_id": str(judgment.pk)})
    assert tag == {"resource": "judgment", "owner_org_id": mine.pk, "owner_user_ids": sorted([a.pk, b.pk, c.pk])}
    assert scope_tag({"soul_id": str(soul.pk)}) == {"resource": "soul", "owner_org_id": mine.pk, "owner_user_ids": []}
    assert scope_tag({"soul_id": "not-a-uuid"}) is None
    assert scope_tag({"job_id": 1}) is None


def test_the_consumer_rule_matches_visible_q():
    """帧判定:不限 / 机构在集合里 / 本人或指派 → 收;否则不收。"""
    from apps.notifications.consumers import NotificationConsumer

    consumer = NotificationConsumer()
    consumer.user = mock.Mock(id=7)
    consumer.data_scope = {"soul": {1, 2}, "judgment": None}
    assert consumer._in_data_scope({"resource": "soul", "owner_org_id": 2, "owner_user_ids": []})
    assert not consumer._in_data_scope({"resource": "soul", "owner_org_id": 3, "owner_user_ids": [8]})
    assert consumer._in_data_scope({"resource": "soul", "owner_org_id": 3, "owner_user_ids": [7]})
    assert consumer._in_data_scope({"resource": "judgment", "owner_org_id": 3, "owner_user_ids": []})
    consumer.data_scope = {"soul": frozenset()}  # 停用账号:全丢
    assert not consumer._in_data_scope({"resource": "soul", "owner_org_id": None, "owner_user_ids": []})


# ── 用户列表 ─────────────────────────────────────────────────────────────


def _grant(role_name, *codenames):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})
    for codename in codenames:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": codename.split(".")[0]})
        RolePermission.objects.get_or_create(role=role, permission=permission)


@pytest.fixture
def people(cn_tenant):
    mine, theirs = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    _grant("JUDGE", "user.manage", "judgment.assign")
    lead = sp.officer("b5_lead", "JUDGE", cn_tenant, organization=mine)
    scope("JUDGE", "ORG")
    peer = sp.officer("b5_peer", "VIEWER", cn_tenant, organization=mine)
    other = sp.officer("b5_other", "VIEWER", cn_tenant, organization=theirs)
    return lead, peer, other


@pytest.mark.django_db
def test_the_user_list_and_detail_follow_the_data_scope(people):
    lead, peer, other = people
    client = officer_client(lead)
    listed = {row["username"] for row in client.get("/api/v1/users/", {"page_size": 100}).data["results"]}
    assert {"b5_lead", "b5_peer"} <= listed
    assert "b5_other" not in listed
    assert client.get(f"/api/v1/users/{other.pk}/").status_code == 404
    assert client.get(f"/api/v1/users/{peer.pk}/").status_code == 200
    assert client.post(f"/api/v1/users/{other.pk}/deactivate/", {}, format="json").status_code == 404
    other.refresh_from_db()
    assert other.is_active


@pytest.mark.django_db
def test_without_a_scope_row_the_user_list_is_the_whole_hall(people):
    lead, _peer, _other = people
    RoleDataScope.objects.filter(role__name="JUDGE").delete()
    listed = {row["username"] for row in officer_client(lead).get("/api/v1/users/", {"page_size": 100}).data["results"]}
    assert {"b5_lead", "b5_peer", "b5_other"} <= listed


@pytest.mark.django_db
def test_handover_candidates_and_source_follow_the_data_scope(people):
    lead, peer, other = people
    client = officer_client(lead)
    ids = {row["id"] for row in client.get("/api/v1/judgment/handover/officers/").data}
    assert peer.pk in ids and other.pk not in ids
    preview = "/api/v1/judgment/handover/preview/"
    assert client.post(preview, {"from": other.pk}, format="json").status_code == 404
    assert client.post(preview, {"from": peer.pk}, format="json").status_code == 200


@pytest.mark.django_db
def test_changing_a_users_unit_pushes_a_refresh(cn_tenant):
    admin = User.objects.create_user(username="b5_admin", password="x", role="ADMIN", tenant=cn_tenant)
    mine, theirs = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    target = sp.officer("b5_target", "VIEWER", cn_tenant, organization=mine)
    with mock.patch("apps.authentication.views.push_permission_refresh") as push:
        resp = officer_client(admin).patch(f"/api/v1/users/{target.pk}/", {"position": "x"}, format="json")
        assert resp.status_code == 200, resp.data
        push.assert_not_called()
        resp = officer_client(admin).patch(f"/api/v1/users/{target.pk}/", {"organization": theirs.pk}, format="json")
        assert resp.status_code == 200, resp.data
        push.assert_called_once_with(target.pk)


# ── 按码 / 按角色群发的通知 ────────────────────────────────────────────


@pytest.mark.django_db
def test_password_help_skips_a_moderator_who_cannot_see_the_account(cn_tenant):
    from apps.authentication.tasks import notify_password_help
    from apps.notifications.models import UserNotification

    mine, theirs = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    scope("MODERATOR", "ORG")
    inside = sp.officer("b5_mod_in", "MODERATOR", cn_tenant, organization=mine)
    outside = sp.officer("b5_mod_out", "MODERATOR", cn_tenant, organization=theirs)
    sp.officer("b5_asker", "VIEWER", cn_tenant, organization=mine)
    notify_password_help("b5_asker")
    assert UserNotification.objects.filter(user=inside, notification_type="PASSWORD_HELP_REQUESTED").exists()
    assert not UserNotification.objects.filter(user=outside).exists()


@pytest.mark.django_db
def test_a_timeout_failure_skips_a_moderator_who_cannot_see_the_workflow(cn_tenant, monkeypatch):
    from apps.workflow import timeouts
    from tests.test_workflow_timeout_and_reject_to import _node, _workflow

    told = []
    monkeypatch.setattr("apps.events.services.EventService.notify_user",
                        staticmethod(lambda **kw: told.append(kw["user"].username)))
    mine, theirs = org(cn_tenant, "本司"), org(cn_tenant, "他司")
    scope("MODERATOR", "ORG")
    sp.officer("b5_wf_in", "MODERATOR", cn_tenant, organization=mine)
    sp.officer("b5_wf_out", "MODERATOR", cn_tenant, organization=theirs)
    flow = _workflow(cn_tenant, [_node(1), _node(2)])
    Soul.objects.filter(pk=flow.soul_id).update(owner_org=mine)
    timeouts._tell_admins(flow.pk, flow.current_node_id)
    assert "b5_wf_in" in told
    assert "b5_wf_out" not in told
