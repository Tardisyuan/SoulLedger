"""A disposition cannot be marked executed by PATCH; a comment cannot be moved.

Two write boundaries measured on 2026-08-29.

`DispositionSerializer` had no `read_only_fields` at all. A MODERATOR could
`PATCH {"is_executed": true, "executed_at": ...}` and get a 200. The row then
reads EXECUTED while the soul was never routed -- not SETTLED, not
REINCARNATING, still DISPOSED. The real `POST .../execute/` afterwards returns
400 "Already executed", so the soul is stuck in DISPOSED with no way out.
`apps/reincarnation/views.py` had already written this exact shape down for
ReincarnationSerializer and characterized it; Disposition's copy of it was
never recorded.

`CommentSerializer` left `post` and `parent` writable on update.
`CommentCreateSerializer.validate()` spends thirty lines explaining that these
are unscoped PrimaryKeyRelatedFields which can produce a comment whose
`tenant` column and `post` FK disagree -- and that guard was installed on the
create path only. PATCH produced exactly the row the docstring describes.
`parent` could also point at the comment's own id.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.disposition.models import Disposition
from apps.social.models import Comment, Post
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def scene(db):
    a = Tenant.objects.get_or_create(code="EF_A", defaults={"display_name": "EF A"})[0]
    b = Tenant.objects.get_or_create(code="EF_B", defaults={"display_name": "EF B"})[0]
    mod = User.objects.create_user(
        username="ef_mod", password="x", role="MODERATOR", tenant=a
    )
    soul = Soul.objects.create(
        name="EFSoul", current_state=SoulState.DISPOSED, tenant=a,
        death_year=1900, death_month=1, death_day=1,
    )
    other_soul = Soul.objects.create(
        name="EFOther", current_state=SoulState.DISPOSED, tenant=b
    )
    disp = Disposition.objects.create(soul=soul, tenant=a)
    return {
        "a": a, "b": b, "mod": mod, "soul": soul, "other_soul": other_soul,
        "disp": disp, "client": _jwt_client(mod, a),
    }


@pytest.mark.django_db
def test_a_disposition_cannot_be_marked_executed_by_patch(scene):
    resp = scene["client"].patch(
        f"/api/v1/disposition/{scene['disp'].pk}/",
        {"is_executed": True, "executed_at": "2026-01-01T00:00:00Z"},
        format="json",
    )
    scene["disp"].refresh_from_db()
    assert scene["disp"].is_executed is False, (
        f"the disposition reads executed (response was {resp.status_code}) while "
        f"the soul was never routed -- and the real execute action will now "
        f"refuse with 'Already executed', stranding the soul in DISPOSED"
    )
    assert scene["disp"].executed_at is None
    scene["soul"].refresh_from_db()
    assert scene["soul"].current_state == SoulState.DISPOSED


@pytest.mark.django_db
def test_a_disposition_cannot_be_repointed_at_another_tenants_soul(scene):
    """Re-pointing is a supported operation -- across tenants it is not.

    `test_repointing_a_disposition_at_another_soul_is_checked` in
    apps/disposition/test_term_start.py exists because a mis-filed sentence
    gets corrected. What was never checked is the tenant of the new soul.
    """
    resp = scene["client"].patch(
        f"/api/v1/disposition/{scene['disp'].pk}/",
        {"soul": str(scene["other_soul"].pk)},
        format="json",
    )
    assert resp.status_code == 400, (
        f"a disposition was re-pointed at another tenant's soul "
        f"({resp.status_code})"
    )
    scene["disp"].refresh_from_db()
    assert scene["disp"].soul_id == scene["soul"].pk


@pytest.mark.django_db
def test_a_disposition_can_still_be_annotated(scene):
    """Positive control -- the lock must not close the endpoint."""
    resp = scene["client"].patch(
        f"/api/v1/disposition/{scene['disp'].pk}/",
        {"notes": "reviewed"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    scene["disp"].refresh_from_db()
    assert scene["disp"].notes == "reviewed"


@pytest.mark.django_db
def test_a_comment_cannot_be_moved_to_another_tenants_post(scene):
    author = User.objects.create_user(
        username="ef_author", password="x", role="VIEWER", tenant=scene["a"]
    )
    post_a = Post.objects.create(author=author, content="A's post", tenant=scene["a"])
    post_b = Post.objects.create(
        author=scene["mod"], content="B's post", tenant=scene["b"]
    )
    comment = Comment.objects.create(
        post=post_a, author=author, content="hi", tenant=scene["a"]
    )
    client = _jwt_client(author, scene["a"])

    resp = client.patch(
        f"/api/v1/social/comments/{comment.pk}/",
        {"post": str(post_b.pk)},
        format="json",
    )
    comment.refresh_from_db()
    assert comment.post_id == post_a.pk, (
        f"the comment moved to another tenant's post (response {resp.status_code}); "
        f"its tenant column still says {comment.tenant_id}, which is the "
        f"contradiction CommentCreateSerializer.validate() was written to prevent"
    )

    resp = client.patch(
        f"/api/v1/social/comments/{comment.pk}/",
        {"parent": str(comment.pk)},
        format="json",
    )
    comment.refresh_from_db()
    assert comment.parent_id is None, (
        "a comment became its own parent; any tree walk over this recurses forever"
    )


@pytest.mark.django_db
def test_a_comment_can_still_be_edited(scene):
    """Positive control."""
    author = User.objects.create_user(
        username="ef_author2", password="x", role="VIEWER", tenant=scene["a"]
    )
    post = Post.objects.create(author=author, content="p", tenant=scene["a"])
    comment = Comment.objects.create(
        post=post, author=author, content="before", tenant=scene["a"]
    )
    client = _jwt_client(author, scene["a"])
    resp = client.patch(
        f"/api/v1/social/comments/{comment.pk}/", {"content": "after"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    comment.refresh_from_db()
    assert comment.content == "after"
