"""
Tests for DataScopeViewSetMixin integration with SoulViewSet, JudgmentViewSet, DispositionViewSet.

Tests exercise the full DRF request pipeline: PermissionMiddleware → TenantMiddleware
→ ViewSet.get_queryset() → DataScopeViewSetMixin → DataScopeFilter.
"""
import pytest
from django.test import RequestFactory
from rest_framework.test import force_authenticate

from apps.disposition.models import Disposition
from apps.judgment.models import Judgment, JudgmentMethod, Verdict
from apps.perm.models import Role
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.data_scope_support import org, scope


@pytest.fixture
def cn_tenant(db):
    return Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "Chinese Diyu"}
    )[0]


@pytest.fixture
def eu_tenant(db):
    return Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Heaven/Hell"}
    )[0]


@pytest.fixture
def admin_user(cn_tenant, django_user_model):
    return django_user_model.objects.create_user(
        username="admin_ds", password="pass123", role="ADMIN", tenant=cn_tenant
    )


@pytest.fixture
def judge_user(cn_tenant, django_user_model):
    return django_user_model.objects.create_user(
        username="judge_ds", password="pass123", role="JUDGE", tenant=cn_tenant
    )


@pytest.fixture
def judge_role(db):
    return Role.objects.get_or_create(name="JUDGE")[0]


@pytest.fixture
def orgs(cn_tenant, judge_user):
    """Judge sits in A; the three souls are owned by A, B and C."""
    made = {k: org(cn_tenant, f"司{k}") for k in "ABC"}
    judge_user.organization = made["A"]
    judge_user.save(update_fields=["organization"])
    return made


@pytest.fixture
def cn_souls(cn_tenant, orgs):
    alive = Soul.objects.create(name="Living Soul", tenant=cn_tenant, current_state=SoulState.ALIVE, owner_org=orgs["A"])
    judging = Soul.objects.create(name="Judging Soul", tenant=cn_tenant, current_state=SoulState.JUDGING, owner_org=orgs["B"])
    disposed = Soul.objects.create(name="Disposed Soul", tenant=cn_tenant, current_state=SoulState.DISPOSED, owner_org=orgs["C"])
    return {"alive": alive, "judging": judging, "disposed": disposed}


@pytest.fixture
def eu_souls(eu_tenant):
    return Soul.objects.create(name="EU Soul", tenant=eu_tenant, current_state=SoulState.ALIVE)


def _make_authenticated_request(client, method, url, user, tenant, **kwargs):
    """Make an authenticated request with tenant injected into the request object."""
    factory = RequestFactory()
    request = getattr(factory, method)(url, **kwargs)
    force_authenticate(request, user=user)
    request.tenant = tenant
    return request


# ---------------------------------------------------------------------------
# SoulViewSet + DataScopeViewSetMixin
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestSoulViewSetDataScope:

    @pytest.fixture
    def soul_view(self):
        from apps.souls.views import SoulViewSet
        return SoulViewSet

    @pytest.fixture
    def auth_request(self, admin_user, cn_tenant):
        return _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/souls/", admin_user, cn_tenant
        )

    def test_admin_sees_all_souls(self, soul_view, auth_request, cn_souls):
        view = soul_view.as_view({"get": "list"})
        response = view(auth_request)
        response.render()
        assert response.status_code == 200
        assert response.data["count"] == 3

    def test_judge_no_scope_sees_all(self, soul_view, judge_user, cn_tenant, cn_souls):
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/souls/", judge_user, cn_tenant
        )
        view = soul_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        assert response.data["count"] == 3

    def test_judge_with_org_scope_sees_filtered(self, soul_view, judge_user, cn_tenant, cn_souls, judge_role):
        scope("JUDGE", "ORG")
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/souls/", judge_user, cn_tenant
        )
        view = soul_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        assert response.data["count"] == 1
        assert response.data["results"][0]["name"] == "Living Soul"

    def test_judge_with_define_scope(self, soul_view, judge_user, cn_tenant, cn_souls, orgs, judge_role):
        scope("JUDGE", "DEFINE", orgs=[orgs["A"], orgs["B"]])
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/souls/", judge_user, cn_tenant
        )
        view = soul_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        assert {r["name"] for r in response.data["results"]} == {"Living Soul", "Judging Soul"}

    def test_judge_cannot_see_other_tenants(self, soul_view, judge_user, cn_tenant, cn_souls, eu_souls):
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/souls/", judge_user, cn_tenant
        )
        view = soul_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        names = [s["name"] for s in response.data["results"]]
        assert "EU Soul" not in names


# ---------------------------------------------------------------------------
# JudgmentViewSet + DataScopeViewSetMixin
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestJudgmentViewSetDataScope:

    @pytest.fixture
    def judgment_view(self):
        from apps.judgment.views import JudgmentViewSet
        return JudgmentViewSet

    @pytest.fixture
    def judgments(self, cn_souls, cn_tenant):
        j1 = Judgment.objects.create(
            soul=cn_souls["alive"], tenant=cn_tenant,
            judgment_method=JudgmentMethod.STANDARD, civilization="CHINA"
        )
        j2 = Judgment.objects.create(
            soul=cn_souls["judging"], tenant=cn_tenant,
            judgment_method=JudgmentMethod.STANDARD, civilization="CHINA",
            verdict=Verdict.PASSED, is_final=True
        )
        # j1 is owned by the judge's org, j2 by another.
        Judgment.objects.filter(pk=j1.pk).update(owner_org=cn_souls["alive"].owner_org)
        Judgment.objects.filter(pk=j2.pk).update(owner_org=cn_souls["judging"].owner_org)
        return {"pending": j1, "concluded": j2}

    def test_admin_sees_all_judgments(self, judgment_view, admin_user, cn_tenant, judgments):
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/judgments/", admin_user, cn_tenant
        )
        view = judgment_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        assert response.data["count"] == 2

    def test_judge_with_org_scope(self, judgment_view, judge_user, cn_tenant, judgments, judge_role):
        scope("JUDGE", "ORG")
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/judgments/", judge_user, cn_tenant
        )
        view = judgment_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        assert response.data["count"] == 1
        assert response.data["results"][0]["id"] == str(judgments["pending"].pk)


# ---------------------------------------------------------------------------
# DispositionViewSet + DataScopeViewSetMixin
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestDispositionViewSetDataScope:

    @pytest.fixture
    def disposition_view(self):
        from apps.disposition.views import DispositionViewSet
        return DispositionViewSet

    @pytest.fixture
    def dispositions(self, cn_souls, cn_tenant):
        from apps.realms.models import Realm, RealmType
        realm = Realm.objects.create(
            realm_code="TEST_REALM", name_local="Test Realm",
            civilization="CHINA", realm_type=RealmType.BLISS, tenant=cn_tenant
        )
        # A disposition's scope follows its judgment's owner org.
        def case(soul):
            j = Judgment.objects.create(soul=soul, tenant=cn_tenant, judgment_method=JudgmentMethod.STANDARD,
                                        civilization="CHINA")
            Judgment.objects.filter(pk=j.pk).update(owner_org=soul.owner_org)
            return j
        d1 = Disposition.objects.create(
            soul=cn_souls["alive"], tenant=cn_tenant, judgment=case(cn_souls["alive"]),
            destination_realm=realm, is_executed=False
        )
        d2 = Disposition.objects.create(
            soul=cn_souls["judging"], tenant=cn_tenant, judgment=case(cn_souls["judging"]),
            destination_realm=realm, is_executed=True
        )
        return {"pending": d1, "executed": d2}

    def test_admin_sees_all_dispositions(self, disposition_view, admin_user, cn_tenant, dispositions):
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/disposition/", admin_user, cn_tenant
        )
        view = disposition_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        assert response.data["count"] == 2

    def test_judge_with_org_scope(self, disposition_view, judge_user, cn_tenant, dispositions, judge_role):
        scope("JUDGE", "ORG")
        request = _make_authenticated_request(
            RequestFactory(), "get", "/api/v1/disposition/", judge_user, cn_tenant
        )
        view = disposition_view.as_view({"get": "list"})
        response = view(request)
        response.render()
        assert response.status_code == 200
        assert response.data["count"] == 1
        assert response.data["results"][0]["id"] == str(dispositions["pending"].pk)
