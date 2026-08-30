"""`PRIVATE` and `FOLLOWERS` must mean something below the post itself.

`PostViewSet.get_queryset` filtered by visibility. `CommentViewSet` and
`ReactionViewSet` scoped to the tenant and stopped, so with a post's UUID any
member of the same tenant could read every comment on a PRIVATE post,
enumerate who had reacted, and write comments and reactions onto it --
moving the author's counters in the process.

Measured 2026-08-29 (Bob and Alice in one tenant, not following each other,
neither an ADMIN, against Alice's PRIVATE post):

    Bob retrieve the post          -> 404, and it is absent from his list
    GET /comments/?post=<private>  -> 200, n=1, contents=['SECRET REPLY']
    GET /reactions/?post=<private> -> 200, n=1, reactors=[1]
    Bob POST a comment on it       -> 201
    Bob POST a reaction on it      -> 201
    Alice's post now reads comment=1 reaction=1

The write path had a guard, and it reasoned entirely about tenants -- thirty
lines of it, correct about what it discussed. Same tenant is not the same as
visible, and within one tenant the guard had nothing to say.

Both visibility values are exercised, and the FOLLOWERS case is checked from
both sides of the follow: a rule that admitted everyone in the tenant and a
rule that admitted nobody would each satisfy a one-sided test.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.social.models import Comment, Follow, Post, Reaction, ReactionType
from apps.tenants.models import Tenant

User = get_user_model()


def _client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def scene(db):
    tenant = Tenant.objects.get_or_create(
        code="VIS_T", defaults={"display_name": "Visibility"}
    )[0]
    alice = User.objects.create_user(
        username="vis_alice", password="x", role="VIEWER", tenant=tenant
    )
    bob = User.objects.create_user(
        username="vis_bob", password="x", role="VIEWER", tenant=tenant
    )
    fan = User.objects.create_user(
        username="vis_fan", password="x", role="VIEWER", tenant=tenant
    )
    # `fan` follows alice; bob does not.
    Follow.objects.create(follower=fan, following=alice, tenant=tenant)

    private = Post.objects.create(
        author=alice, content="private", visibility="PRIVATE", tenant=tenant
    )
    followers = Post.objects.create(
        author=alice, content="followers", visibility="FOLLOWERS", tenant=tenant
    )
    public = Post.objects.create(
        author=alice, content="public", visibility="PUBLIC", tenant=tenant
    )
    for post in (private, followers, public):
        Comment.objects.create(
            post=post, author=alice, content=f"SECRET on {post.visibility}",
            tenant=tenant,
        )
        Reaction.objects.create(
            post=post, user=alice, reaction_type=ReactionType.LIKE, tenant=tenant
        )
    return {
        "tenant": tenant, "alice": alice, "bob": bob, "fan": fan,
        "private": private, "followers": followers, "public": public,
    }


@pytest.mark.parametrize("visibility", ["private", "followers"])
def test_a_stranger_cannot_read_the_comments(scene, visibility):
    post = scene[visibility]
    resp = _client(scene["bob"], scene["tenant"]).get(
        f"/api/v1/social/comments/?post={post.pk}"
    )
    assert resp.status_code == 200
    results = resp.data.get("results", resp.data)
    assert results == [] or len(results) == 0, (
        f"a {post.visibility} post's comments were readable by a tenant member "
        f"who cannot see the post: {results}"
    )


@pytest.mark.parametrize("visibility", ["private", "followers"])
def test_a_stranger_cannot_enumerate_the_reactions(scene, visibility):
    post = scene[visibility]
    resp = _client(scene["bob"], scene["tenant"]).get(
        f"/api/v1/social/reactions/?post={post.pk}"
    )
    assert resp.status_code == 200
    results = resp.data.get("results", resp.data)
    assert len(results) == 0, f"reactors on a {post.visibility} post were listed"


@pytest.mark.parametrize("visibility", ["private", "followers"])
def test_a_stranger_cannot_comment_on_it(scene, visibility):
    post = scene[visibility]
    before = Comment.objects.filter(post=post).count()
    resp = _client(scene["bob"], scene["tenant"]).post(
        "/api/v1/social/comments/",
        {"post": str(post.pk), "content": "injected"},
        format="json",
    )
    assert resp.status_code == 400, (
        f"a comment was injected onto a {post.visibility} post "
        f"({resp.status_code}), and it moves the author's counter"
    )
    assert Comment.objects.filter(post=post).count() == before


@pytest.mark.parametrize("visibility", ["private", "followers"])
def test_a_stranger_cannot_react_to_it(scene, visibility):
    post = scene[visibility]
    resp = _client(scene["bob"], scene["tenant"]).post(
        "/api/v1/social/reactions/",
        {"post": str(post.pk), "reaction_type": ReactionType.LIKE},
        format="json",
    )
    assert resp.status_code == 400, resp.status_code
    assert not Reaction.objects.filter(post=post, user=scene["bob"]).exists()


# -- the other side: a rule that admits nobody is not a fix ------------------

def test_the_author_still_sees_their_own_private_thread(scene):
    client = _client(scene["alice"], scene["tenant"])
    resp = client.get(f"/api/v1/social/comments/?post={scene['private'].pk}")
    results = resp.data.get("results", resp.data)
    assert len(results) == 1, f"the author lost their own comments: {results}"


def test_a_follower_sees_a_followers_post_thread(scene):
    """The half a tenant-only rule and a deny-all rule both get wrong."""
    client = _client(scene["fan"], scene["tenant"])
    resp = client.get(f"/api/v1/social/comments/?post={scene['followers'].pk}")
    results = resp.data.get("results", resp.data)
    assert len(results) == 1, (
        f"a follower could not read a FOLLOWERS post's comments: {results}"
    )


def test_anyone_in_the_tenant_still_sees_a_public_thread(scene):
    client = _client(scene["bob"], scene["tenant"])
    resp = client.get(f"/api/v1/social/comments/?post={scene['public'].pk}")
    results = resp.data.get("results", resp.data)
    assert len(results) == 1, f"a PUBLIC post's comments were hidden: {results}"


def test_anyone_in_the_tenant_can_still_comment_on_a_public_post(scene):
    resp = _client(scene["bob"], scene["tenant"]).post(
        "/api/v1/social/comments/",
        {"post": str(scene["public"].pk), "content": "hello"},
        format="json",
    )
    assert resp.status_code == 201, resp.data
