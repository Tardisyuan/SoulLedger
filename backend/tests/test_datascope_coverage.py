"""
Tests for DataScope tenant isolation on remaining ViewSets.
Covers: Reincarnation, Realm, Actor, SoulEvent, WorkflowTemplate.

Every test here lists as a JUDGE, never as ADMIN. Until 2026-09-12 all five
were titled "CN user sees only CN rows" but authenticated as ``admin_user`` —
the one role that *bypasses* tenant scoping — and asserted ``len(results) >= 1``.
Deleting the scoping call in ``DataScopeViewSetMixin`` left all five green.
A list endpoint that leaks every tenant's rows still has ``>= 1`` of them, so the
assertion that matters is the negative one: the other tenant's id is *absent*.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.actors.models import Actor, ActorRole
from apps.events.models import EventType, SoulEvent
from apps.realms.models import Realm, RealmType
from apps.reincarnation.models import Reincarnation
from apps.souls.models import Civilization, Soul
from apps.workflow.models import WorkflowTemplate


def _auth(api_client, user):
    assert user.role != "ADMIN", "ADMIN bypasses scoping; this file must probe as a scoped role"
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


def _assert_only_mine(client, path, mine, theirs):
    response = client.get(path)
    assert response.status_code == 200, response.content
    data = response.data
    results = data.get("results", data) if isinstance(data, dict) else data
    ids = {str(row["id"]) for row in results}
    assert str(mine.id) in ids, f"{path}: own tenant's row missing"
    assert str(theirs.id) not in ids, f"{path}: other tenant's row leaked"


@pytest.mark.django_db
class TestReincarnationDataScope:
    """Test ReincarnationViewSet tenant isolation."""

    def test_cn_user_sees_only_cn_reincarnations(self, api_client, judge_user, cn_tenant, eu_tenant):
        cn_soul = Soul.objects.create(name="CN Soul", tenant=cn_tenant)
        eu_soul = Soul.objects.create(name="EU Soul", tenant=eu_tenant)
        mine = Reincarnation.objects.create(soul=cn_soul, tenant=cn_tenant, cycle_count=1, rebirth_form="HUMAN")
        theirs = Reincarnation.objects.create(soul=eu_soul, tenant=eu_tenant, cycle_count=1, rebirth_form="HUMAN")

        _assert_only_mine(_auth(api_client, judge_user), "/api/v1/reincarnation/", mine, theirs)


@pytest.mark.django_db
class TestRealmDataScope:
    """Test RealmViewSet tenant isolation."""

    def test_cn_user_sees_only_cn_realms(self, api_client, judge_user, cn_tenant, eu_tenant):
        mine = Realm.objects.create(
            realm_code="CN_REALM", civilization=Civilization.CHINESE,
            name_local="CN地域", name_en="CN Realm",
            realm_type=RealmType.HELL, tenant=cn_tenant,
        )
        theirs = Realm.objects.create(
            realm_code="EU_REALM", civilization=Civilization.EUROPEAN,
            name_local="EU Realm", name_en="EU Realm",
            realm_type=RealmType.HELL, tenant=eu_tenant,
        )

        _assert_only_mine(_auth(api_client, judge_user), "/api/v1/realms/", mine, theirs)


@pytest.mark.django_db
class TestActorDataScope:
    """Test ActorViewSet tenant isolation."""

    def test_cn_user_sees_only_cn_actors(self, api_client, judge_user, cn_tenant, eu_tenant):
        mine = Actor.objects.create(
            name="CN Actor", role=ActorRole.JUDGE,
            civilization=Civilization.CHINESE, tenant=cn_tenant,
        )
        theirs = Actor.objects.create(
            name="EU Actor", role=ActorRole.JUDGE,
            civilization=Civilization.EUROPEAN, tenant=eu_tenant,
        )

        _assert_only_mine(_auth(api_client, judge_user), "/api/v1/actors/", mine, theirs)


@pytest.mark.django_db
class TestSoulEventDataScope:
    """Test SoulEventViewSet tenant isolation."""

    def test_cn_user_sees_only_cn_events(self, api_client, judge_user, cn_tenant, eu_tenant):
        cn_soul = Soul.objects.create(name="CN Soul", tenant=cn_tenant)
        eu_soul = Soul.objects.create(name="EU Soul", tenant=eu_tenant)
        mine = SoulEvent.objects.create(soul=cn_soul, tenant=cn_tenant, event_type=EventType.SOUL_CREATED, payload={})
        theirs = SoulEvent.objects.create(soul=eu_soul, tenant=eu_tenant, event_type=EventType.SOUL_CREATED, payload={})

        _assert_only_mine(_auth(api_client, judge_user), "/api/v1/events/", mine, theirs)


@pytest.mark.django_db
class TestWorkflowTemplateDataScope:
    """Test WorkflowTemplateViewSet tenant isolation."""

    def test_cn_user_sees_only_cn_templates(self, api_client, judge_user, cn_tenant, eu_tenant):
        mine = WorkflowTemplate.objects.create(
            name="CN Template", civilization="CHINESE",
            case_type="ROUTINE", tenant=cn_tenant,
        )
        theirs = WorkflowTemplate.objects.create(
            name="EU Template", civilization="EUROPEAN",
            case_type="ROUTINE", tenant=eu_tenant,
        )

        _assert_only_mine(_auth(api_client, judge_user), "/api/v1/workflow/templates/", mine, theirs)
