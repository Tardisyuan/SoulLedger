"""Follow lists and judgment comments answer a bare array; it is capped, not unbounded.

Mutation: drop either `[:CAP]` slice and the response grows past the cap -> red.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.judgment import views as judgment_views
from apps.social import views as social_views
from apps.social.models import Follow

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(api_client, admin_user, cn_tenant):
    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


def test_following_and_followers_stop_at_the_cap(admin_client, admin_user, cn_tenant, monkeypatch):
    monkeypatch.setattr(social_views, "FOLLOW_LIST_CAP", 3)
    for i in range(6):
        other = User.objects.create_user(username=f"f{i}", password="x", tenant=cn_tenant)
        Follow.objects.create(follower=admin_user, following=other, tenant=admin_user.tenant)
        Follow.objects.create(follower=other, following=admin_user, tenant=admin_user.tenant)
    for action in ("following", "followers"):
        response = admin_client.get(f"/api/v1/social/follows/{action}/")
        assert response.status_code == 200, response.content
        assert len(response.data) == 3


def test_judgment_comments_stop_at_the_cap(cn_tenant, judge_user, monkeypatch):
    from apps.judgment.models import Judgment, JudgmentComment
    from tests.soul_account_support import dead_soul, officer_client

    monkeypatch.setattr(judgment_views, "COMMENTS_CAP", 3)
    soul = dead_soul(cn_tenant, name="评议灵魂")
    case = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=cn_tenant)
    for i in range(6):
        JudgmentComment.objects.create(judgment=case, author=judge_user, tenant=cn_tenant, body=f"c{i}")
    rows = officer_client(judge_user).get(f"/api/v1/judgment/{case.pk}/comments/").data
    assert [r["body"] for r in rows] == ["c0", "c1", "c2"]
