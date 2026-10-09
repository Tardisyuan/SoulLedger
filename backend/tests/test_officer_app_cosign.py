"""加签 from the officer App: the current node's designated approver adds a hall colleague,
who must sign before the approver's own approval counts. Plus the push `target`."""
import pytest

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.officer_app import push
from apps.workflow.models import NodeStatus
from tests.soul_account_support import officer_client
from tests.soul_push_support import FakeSender, push_on  # noqa: F401
from tests.test_officer_app import TOKEN, _plain_workflow

pytestmark = pytest.mark.django_db


def _cosign_url(wf, kind="approval"):
    return f"/api/v1/officer-app/items/{kind}/{wf.pk}/cosigners/"


def _decide(client, wf, node, verdict="PASSED"):
    return client.post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                       {"node_id": str(node.pk), "verdict": verdict}, format="json")


@pytest.fixture
def colleague(cn_tenant):
    return User.objects.create_user(username="cosigner", password="x", role="ADMIN", tenant=cn_tenant,
                                    display_name="联署人")


def test_the_designated_approver_adds_a_colleague_and_it_is_audited_and_notified(
        cn_tenant, judge_user, colleague, push_on, monkeypatch, django_capture_on_commit_callbacks):  # noqa: F811
    sent = []
    monkeypatch.setattr(push.send_todo_push, "delay", lambda ids, target=None: sent.append((list(ids), target)))
    push.register_device(colleague, TOKEN, "IOS")
    wf, node = _plain_workflow(cn_tenant)
    with django_capture_on_commit_callbacks(execute=True):
        res = officer_client(judge_user).post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    assert res.status_code == 201, res.data
    node.refresh_from_db()
    assert [e["user_id"] for e in node.cosigners_json] == [colleague.pk]
    assert AuditLog.objects.filter(resource="workflow.cosign", resource_id=str(wf.pk), user=judge_user).count() == 1
    assert colleague.app_notifications.filter(related_id=str(wf.pk), notification_type="WORKFLOW_ASSIGNED").exists()
    assert sent == [([colleague.pk], {"kind": "approval", "id": str(wf.pk)})]


def test_the_approver_cannot_pass_until_the_cosigner_has_signed_and_a_refusal_is_never_held(
        cn_tenant, judge_user, colleague):
    wf, node = _plain_workflow(cn_tenant)
    mine = officer_client(judge_user)
    assert mine.post(_cosign_url(wf), {"user_id": colleague.pk}, format="json").status_code == 201
    held = _decide(mine, wf, node)
    assert held.status_code == 409 and held.data["code"] == "cosigners_pending"

    theirs = officer_client(colleague)
    # the cosigner sees it in their todo, and signing leaves the node pending
    assert theirs.get("/api/v1/officer-app/todo/").data["approvals"]["count"] == 1
    assert _decide(theirs, wf, node).status_code == 200
    node.refresh_from_db()
    assert node.status == NodeStatus.PENDING and node.cosigners_json[0]["signed_at"]

    assert _decide(mine, wf, node).status_code == 200
    node.refresh_from_db()
    assert node.status == NodeStatus.APPROVED


def test_a_cosigners_refusal_refuses_the_node(cn_tenant, judge_user, colleague):
    wf, node = _plain_workflow(cn_tenant)
    officer_client(judge_user).post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    assert _decide(officer_client(colleague), wf, node, "REJECTED").status_code == 200
    node.refresh_from_db()
    assert node.status == NodeStatus.REJECTED


def test_the_approver_may_refuse_while_signatures_are_owed(cn_tenant, judge_user, colleague):
    wf, node = _plain_workflow(cn_tenant)
    mine = officer_client(judge_user)
    mine.post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    assert _decide(mine, wf, node, "REJECTED").status_code == 200


def test_only_the_designated_approver_can_add(cn_tenant, judge_user, colleague):
    wf, node = _plain_workflow(cn_tenant)
    other = User.objects.create_user(username="other", password="x", role="ADMIN", tenant=cn_tenant)
    res = officer_client(other).post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    assert res.status_code == 403 and res.data["code"] == "not_allowed"
    # a cosigner cannot pass the pen on
    officer_client(judge_user).post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    again = officer_client(colleague).post(_cosign_url(wf), {"user_id": other.pk}, format="json")
    assert again.status_code == 403 and again.data["code"] == "not_allowed"


def test_a_decided_node_cannot_be_cosigned(cn_tenant, judge_user, colleague):
    wf, node = _plain_workflow(cn_tenant)
    assert _decide(officer_client(judge_user), wf, node).status_code == 200
    res = officer_client(judge_user).post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    assert res.status_code in (403, 404)


def test_candidates_must_be_active_officers_of_the_same_hall_without_duplicates(cn_tenant, eu_tenant, judge_user,
                                                                               colleague):
    wf, node = _plain_workflow(cn_tenant)
    client = officer_client(judge_user)
    stranger = User.objects.create_user(username="stranger", password="x", role="ADMIN", tenant=eu_tenant)
    soul = User.objects.create_user(username="ghost", password="x", role="SOUL", tenant=cn_tenant)
    gone = User.objects.create_user(username="gone", password="x", role="ADMIN", tenant=cn_tenant, is_active=False)
    for bad in (stranger.pk, soul.pk, gone.pk, judge_user.pk, 99999999):
        res = client.post(_cosign_url(wf), {"user_id": bad}, format="json")
        assert res.status_code == 400 and res.data["code"] == "not_eligible", (bad, res.data)
    # a same-role colleague could already decide alone: adding them is a duplicate
    mate = User.objects.create_user(username="mate", password="x", role="JUDGE", tenant=cn_tenant)
    assert client.post(_cosign_url(wf), {"user_id": mate.pk}, format="json").data["code"] == "duplicate"
    assert client.post(_cosign_url(wf), {"user_id": colleague.pk}, format="json").status_code == 201
    assert client.post(_cosign_url(wf), {"user_id": colleague.pk}, format="json").data["code"] == "duplicate"


def test_an_item_outside_the_hall_is_a_404(cn_tenant, eu_tenant, colleague):
    wf, _ = _plain_workflow(eu_tenant)
    eu_judge = User.objects.create_user(username="eu_j", password="x", role="JUDGE", tenant=eu_tenant)
    cn_judge = User.objects.create_user(username="cn_j", password="x", role="JUDGE", tenant=cn_tenant)
    res = officer_client(cn_judge).post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    assert res.status_code == 404
    assert eu_judge  # the hall's own judge is the one who could


def test_item_detail_names_the_verdicts_the_node_accepts(cn_tenant, judge_user):
    wf, node = _plain_workflow(cn_tenant)
    client = officer_client(judge_user)
    assert client.get(f"/api/v1/officer-app/items/approval/{wf.pk}/").data["required_verdicts"] == []
    node.required_verdicts = ["CONFIRMED", "FAILED"]
    node.save(update_fields=["required_verdicts"])
    assert client.get(f"/api/v1/officer-app/items/approval/{wf.pk}/").data["required_verdicts"] == ["CONFIRMED", "FAILED"]


def test_the_push_payload_carries_the_item_it_is_about(cn_tenant, judge_user, push_on):  # noqa: F811
    wf, _ = _plain_workflow(cn_tenant)
    push.register_device(judge_user, TOKEN, "IOS")
    assert push.send_to_user(judge_user, sender=FakeSender(), target={"kind": "approval", "id": wf.pk}) == 1
    (message,) = FakeSender.batches[-1]
    assert message["data"] == {"category": "officer_todo", "target": {"kind": "approval", "id": str(wf.pk)}}


def test_signer_candidates_leave_out_officers_who_cannot_approve(cn_tenant, judge_user, colleague):
    """书吏 and any other role without `workflow.approve` would only ever end in `not_eligible`."""
    User.objects.create_user(username="clerk", password="x", role="VIEWER", tenant=cn_tenant, display_name="书吏")
    rows = officer_client(judge_user).get("/api/v1/officer-app/signer-candidates/").data
    assert [r["id"] for r in rows] == [colleague.pk]


def test_item_detail_lists_cosigners_and_says_who_the_approver_is_waiting_on(cn_tenant, judge_user, colleague):
    wf, node = _plain_workflow(cn_tenant)
    mine, theirs = officer_client(judge_user), officer_client(colleague)
    url = f"/api/v1/officer-app/items/approval/{wf.pk}/"
    quiet = mine.get(url).data
    assert quiet["cosigners"] == [] and quiet["waiting_on_cosigner"] is None

    mine.post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    waiting = mine.get(url).data
    assert waiting["actionable"] is True
    assert waiting["cosigners"] == [{"user_id": colleague.pk, "name": "联署人", "signed": False}]
    assert waiting["waiting_on_cosigner"] == {"id": colleague.pk, "name": "联署人"}
    # the co-signer themself is not blocked: their approve is the signature
    assert theirs.get(url).data["waiting_on_cosigner"] is None

    assert _decide(theirs, wf, node).status_code == 200
    done = mine.get(url).data
    assert done["cosigners"][0]["signed"] is True and done["waiting_on_cosigner"] is None


def test_the_desks_workflow_detail_carries_the_same_cosign_facts(cn_tenant, judge_user, colleague):
    wf, node = _plain_workflow(cn_tenant)
    mine, theirs = officer_client(judge_user), officer_client(colleague)
    url = f"/api/v1/workflows/{wf.pk}/"
    assert mine.get(url).data["current_node_detail"]["cosigners"] == []
    mine.post(_cosign_url(wf), {"user_id": colleague.pk}, format="json")
    seen = mine.get(url).data["current_node_detail"]
    assert seen["cosigners"] == [{"user_id": colleague.pk, "name": "联署人", "signed": False}]
    assert seen["waiting_on_cosigner"] == {"id": colleague.pk, "name": "联署人"}
    assert theirs.get(url).data["current_node_detail"]["waiting_on_cosigner"] is None
