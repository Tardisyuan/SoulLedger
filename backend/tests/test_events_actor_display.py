"""`GET /events/` gives each row a read-only actor display name and role (one lookup per page)."""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.events.models import EventType, SoulEvent
from apps.souls.models import Soul


@pytest.mark.django_db
def test_event_list_gives_the_actor_display_name_and_role(api_client, admin_user, cn_tenant):
    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    admin_user.display_name = "崔判官"
    admin_user.save()
    soul = Soul.objects.create(name="ActorSoul", tenant=cn_tenant)
    for actor in (str(admin_user), "system", "ghost (JUDGE)"):
        SoulEvent.objects.create(soul=soul, tenant=cn_tenant, event_type=EventType.SOUL_CREATED, payload={}, actor=actor)

    response = api_client.get("/api/v1/events/")
    assert response.status_code == 200
    by_actor = {r["actor"]: r for r in response.json()["results"]}
    assert by_actor[str(admin_user)]["actor_display_name"] == "崔判官"
    assert by_actor[str(admin_user)]["actor_role"] == admin_user.role
    assert by_actor["system"]["actor_display_name"] == "" and by_actor["system"]["actor_role"] == ""
    assert by_actor["ghost (JUDGE)"]["actor_display_name"] == ""
