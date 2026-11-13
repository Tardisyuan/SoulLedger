"""2026-11-13: officer posts / comments go through the same moderation as souls' (word list ->
PENDING / HIDDEN, same queue `/social-moderation/`), and an author cannot approve their own."""
import pytest
from django.contrib.auth import get_user_model

from apps.social.models import Comment, ModerationStatus, Post, SensitiveWord, SensitiveWordAction
from apps.tenants.models import Tenant

from .test_officer_edit_screening import BASE, _client

User = get_user_model()
MOD = "/api/v1/social-moderation"
pytestmark = pytest.mark.django_db


@pytest.fixture
def hall():
    t = Tenant.objects.get_or_create(code="OPM_T", defaults={"display_name": "OPM"})[0]
    o = Tenant.objects.get_or_create(code="OPM_O", defaults={"display_name": "OPM other"})[0]
    SensitiveWord.objects.create(tenant=t, word="badword", action=SensitiveWordAction.REVIEW)

    def mk(name, tenant, role="ADMIN"):
        return User.objects.create_user(username=name, password="x", role=role, tenant=tenant)

    return {
        "t": t, "o": o, "author": mk("opm_author", t), "peer": mk("opm_peer", t),
        "mod": mk("opm_mod", t, "MODERATOR"), "other_mod": mk("opm_other_mod", o, "MODERATOR"),
    }


def _pending_post(h):
    r = _client(h["author"], h["t"]).post(f"{BASE}/posts/", {"content": "a badword"}, format="json")
    assert r.status_code == 201 and r.data["screening"] == "pending_review"
    return Post.objects.get(author=h["author"])


def test_pending_to_author_only_then_approval_publishes(hall):
    post = _pending_post(hall)
    assert post.moderation_status == ModerationStatus.PENDING
    t = hall["t"]
    assert _client(hall["author"], t).get(f"{BASE}/posts/{post.pk}/").data["moderation_status"] == "PENDING"
    assert _client(hall["peer"], t).get(f"{BASE}/posts/{post.pk}/").status_code == 404
    mc = _client(hall["mod"], t)
    queue = mc.get(f"{MOD}/posts/")
    assert [r["id"] for r in queue.data["results"]] == [str(post.pk)]
    assert mc.post(f"{MOD}/posts/{post.pk}/approve/", {}, format="json").status_code == 200
    post.refresh_from_db()
    assert post.moderation_status == ModerationStatus.PUBLISHED
    assert _client(hall["peer"], t).get(f"{BASE}/posts/{post.pk}/").status_code == 200


def test_other_tenant_moderator_cannot_see_or_approve(hall):
    post = _pending_post(hall)
    oc = _client(hall["other_mod"], hall["o"])
    assert oc.get(f"{MOD}/posts/").data["results"] == []
    assert oc.post(f"{MOD}/posts/{post.pk}/approve/", {}, format="json").status_code == 404


def test_author_cannot_approve_or_restore_their_own(hall):
    t = hall["t"]
    mod_user = hall["mod"]
    r = _client(mod_user, t).post(f"{BASE}/posts/", {"content": "a badword"}, format="json")
    mine = Post.objects.get(author=mod_user)
    assert r.status_code == 201 and mine.moderation_status == ModerationStatus.PENDING
    res = _client(mod_user, t).post(f"{MOD}/posts/{mine.pk}/approve/", {}, format="json")
    assert (res.status_code, res.data.get("code")) == (403, "self_moderation")
    Post.objects.filter(pk=mine.pk).update(moderation_status=ModerationStatus.HIDDEN)
    assert _client(mod_user, t).post(f"{MOD}/posts/{mine.pk}/restore/", {}, format="json").status_code == 403
    mine.refresh_from_db()
    assert mine.moderation_status == ModerationStatus.HIDDEN


def test_officer_comment_pending_hidden_from_others_until_approved(hall):
    t = hall["t"]
    post = Post.objects.create(author=hall["author"], content="p", tenant=t)
    r = _client(hall["peer"], t).post(f"{BASE}/comments/", {"post": str(post.pk), "content": "badword"}, format="json")
    assert r.status_code == 201
    c = Comment.objects.get()
    assert c.moderation_status == ModerationStatus.PENDING
    assert _client(hall["author"], t).get(f"{BASE}/comments/", {"post": str(post.pk)}).data["results"] == []
    assert _client(hall["mod"], t).post(f"{MOD}/comments/{c.pk}/approve/", {}, format="json").status_code == 200
    assert len(_client(hall["author"], t).get(f"{BASE}/comments/", {"post": str(post.pk)}).data["results"]) == 1
