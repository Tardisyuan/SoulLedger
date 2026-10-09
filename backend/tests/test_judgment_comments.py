"""评议: list + create on a judgment, by officers who can read it; tenant-scoped, audited, length-capped."""
import pytest

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.judgment.models import Judgment, JudgmentComment
from tests.soul_account_support import dead_soul, officer_client

pytestmark = pytest.mark.django_db


def _case(tenant):
    soul = dead_soul(tenant, name="评议灵魂")
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant)


def _url(judgment):
    return f"/api/v1/judgment/{judgment.pk}/comments/"


def test_an_officer_who_can_read_the_judgment_writes_and_lists_comments(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    first = client.post(_url(case), {"body": "  证据链完整  "}, format="json")
    assert first.status_code == 201, first.data
    assert first.data["body"] == "证据链完整" and first.data["author"] == judge_user.pk
    client.post(_url(case), {"body": "同意"}, format="json")
    rows = client.get(_url(case)).data
    assert [r["body"] for r in rows] == ["证据链完整", "同意"]
    comment = JudgmentComment.objects.first()
    assert comment.tenant_id == cn_tenant.id
    assert AuditLog.objects.filter(resource="judgment.comment", resource_id=str(case.pk), user=judge_user).count() == 2


def test_the_body_is_required_and_capped(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    assert client.post(_url(case), {"body": "   "}, format="json").status_code == 400
    assert client.post(_url(case), {}, format="json").status_code == 400
    assert client.post(_url(case), {"body": "x" * (JudgmentComment.MAX_LENGTH + 1)}, format="json").status_code == 400
    assert client.post(_url(case), {"body": "x" * JudgmentComment.MAX_LENGTH}, format="json").status_code == 201
    assert JudgmentComment.objects.count() == 1


def test_another_halls_case_is_not_found_and_leaves_nothing(cn_tenant, eu_tenant, judge_user):
    foreign = _case(eu_tenant)
    client = officer_client(judge_user)
    assert client.get(_url(foreign)).status_code == 404
    assert client.post(_url(foreign), {"body": "hi"}, format="json").status_code == 404
    assert JudgmentComment.objects.count() == 0


def test_someone_who_cannot_read_judgments_cannot_comment(cn_tenant):
    case = _case(cn_tenant)
    viewer = User.objects.create_user(username="v", password="x", role="VIEWER", tenant=cn_tenant)
    client = officer_client(viewer)
    assert client.get(_url(case)).status_code == 403
    assert client.post(_url(case), {"body": "hi"}, format="json").status_code == 403
