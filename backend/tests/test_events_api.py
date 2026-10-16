"""
Tests for SoulEvent (Events) API endpoints.
"""
import pytest

from apps.events.models import EventType, SoulEvent
from apps.souls.models import Soul


@pytest.mark.django_db
class TestSoulEventAPI:
    """Test /api/v1/events/ endpoints."""

    def test_list_events_authenticated(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/events/ returns events."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        # Create a soul to generate events
        soul = Soul.objects.create(name="EventSoul", tenant=cn_tenant)
        SoulEvent.objects.create(
            soul=soul, tenant=cn_tenant,
            event_type=EventType.SOUL_CREATED,
            payload={"name": "EventSoul"},
        )

        response = api_client.get("/api/v1/events/")
        assert response.status_code == 200

    def test_list_events_unauthenticated(self, api_client):
        """GET /api/v1/events/ without auth returns 401."""
        response = api_client.get("/api/v1/events/")
        assert response.status_code == 401

    def test_events_select_related_soul(self, api_client, admin_user, cn_tenant):
        """Events endpoint uses select_related to avoid N+1."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")

        soul = Soul.objects.create(name="N1Test", tenant=cn_tenant)
        for i in range(3):
            SoulEvent.objects.create(
                soul=soul, tenant=cn_tenant,
                event_type=EventType.STATE_CHANGED,
                payload={"index": i},
            )

        response = api_client.get("/api/v1/events/")
        assert response.status_code == 200
        results = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        assert len(results) >= 3


@pytest.mark.django_db
def test_every_offered_ordering_field_is_a_real_column():
    """`?ordering=` with a whitelisted name that is not a column raised a FieldError (500)."""
    from apps.events.views import SoulEventViewSet

    columns = {f.name for f in SoulEvent._meta.get_fields()}
    assert set(SoulEventViewSet.ordering_fields) <= columns


@pytest.mark.django_db
def test_ordering_by_each_offered_field_answers(api_client, admin_user, cn_tenant):
    from rest_framework_simplejwt.tokens import RefreshToken

    from apps.events.views import SoulEventViewSet

    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    soul = Soul.objects.create(name="OrderSoul", tenant=cn_tenant)
    SoulEvent.objects.create(soul=soul, tenant=cn_tenant, event_type=EventType.SOUL_CREATED, payload={})
    for field in SoulEventViewSet.ordering_fields:
        for key in (field, f"-{field}"):
            assert api_client.get(f"/api/v1/events/?ordering={key}").status_code == 200, key


# ── /events 页(第三十七批 W-13):日期范围、灵魂搜索、系统事件、操作人 ──────────
#
# 查询都带 `event_type=STATE_CHANGED`:建灵魂时若有信号另记 SOUL_CREATED,
# 不让它混进下面按集合相等的断言。

def _auth(api_client, user):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")


def _event_at(soul, when, *, actor="system"):
    e = SoulEvent.objects.create(
        soul=soul, tenant=soul.tenant, event_type=EventType.STATE_CHANGED, payload={}, actor=actor,
    )
    # create_time 是 auto_now_add,只能事后改。
    SoulEvent.objects.filter(pk=e.pk).update(create_time=when)
    return e


def _ids(response):
    assert response.status_code == 200, response.data
    return {r["id"] for r in response.data["results"]}


LIST = "/api/v1/events/?event_type=STATE_CHANGED"


@pytest.mark.django_db
def test_date_range_is_inclusive_on_both_ends(api_client, viewer_user, cn_tenant):
    from datetime import datetime, timezone

    _auth(api_client, viewer_user)
    soul = Soul.objects.create(name="RangeSoul", tenant=cn_tenant)
    before = _event_at(soul, datetime(2026, 10, 9, 23, 59, tzinfo=timezone.utc))
    first = _event_at(soul, datetime(2026, 10, 10, 0, 0, tzinfo=timezone.utc))
    last = _event_at(soul, datetime(2026, 10, 12, 23, 59, tzinfo=timezone.utc))
    after = _event_at(soul, datetime(2026, 10, 13, 0, 1, tzinfo=timezone.utc))

    got = _ids(api_client.get(f"{LIST}&start_date=2026-10-10&end_date=2026-10-12"))
    assert got == {str(first.pk), str(last.pk)}
    assert not ({str(before.pk), str(after.pk)} & got)


@pytest.mark.django_db
@pytest.mark.parametrize("param", ["start_date", "end_date"])
def test_a_bad_date_is_a_400_not_a_500(api_client, viewer_user, param):
    _auth(api_client, viewer_user)
    response = api_client.get(f"/api/v1/events/?{param}=2026-13-40")
    assert response.status_code == 400
    assert param in response.data


@pytest.mark.django_db
def test_range_search_and_actors_do_not_cross_tenants(api_client, viewer_user, cn_tenant, eu_tenant):
    from django.utils import timezone

    _auth(api_client, viewer_user)
    now = timezone.now()
    mine = _event_at(Soul.objects.create(name="Shared Name", tenant=cn_tenant), now, actor="judge")
    theirs = _event_at(Soul.objects.create(name="Shared Name", tenant=eu_tenant), now, actor="eu-judge")
    today = now.date().isoformat()

    got = _ids(api_client.get(f"{LIST}&start_date={today}&end_date={today}&search=Shared"))
    assert str(mine.pk) in got
    assert str(theirs.pk) not in got

    actors = api_client.get("/api/v1/events/actors/")
    assert actors.status_code == 200
    assert actors.data == ["judge"]


@pytest.mark.django_db
def test_search_matches_name_and_whole_soul_code_only(api_client, viewer_user, cn_tenant):
    from django.utils import timezone

    _auth(api_client, viewer_user)
    now = timezone.now()
    by_name = _event_at(Soul.objects.create(name="周阿满", tenant=cn_tenant), now)
    coded = Soul.objects.create(name="王二", tenant=cn_tenant)
    Soul.objects.filter(pk=coded.pk).update(soul_code="QU33Q9FW5F")
    by_code = _event_at(coded, now)

    assert _ids(api_client.get(f"{LIST}&search=阿满")) == {str(by_name.pk)}
    assert _ids(api_client.get(f"{LIST}&search=qu33q9fw5f")) == {str(by_code.pk)}
    # 编号的片段不命中:它是登录名,不能按片段试出来。
    assert _ids(api_client.get(f"{LIST}&search=QU33")) == set()


@pytest.mark.django_db
def test_exclude_system_hides_system_and_blank_actors(api_client, viewer_user, cn_tenant):
    from django.utils import timezone

    _auth(api_client, viewer_user)
    soul = Soul.objects.create(name="SysSoul", tenant=cn_tenant)
    now = timezone.now()
    system = _event_at(soul, now, actor="system")
    blank = _event_at(soul, now, actor="")
    human = _event_at(soul, now, actor="cui")

    assert _ids(api_client.get(LIST)) == {str(system.pk), str(blank.pk), str(human.pk)}
    assert _ids(api_client.get(f"{LIST}&exclude_system=1")) == {str(human.pk)}
    assert api_client.get("/api/v1/events/actors/").data == ["cui"]
