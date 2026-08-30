"""A soft-deleted row must not keep its unique key occupied.

`SoftDeleteMixin.delete()` marks a row deleted and leaves it in the table.
Every filtered manager then stops seeing it — while the database still
enforces uniqueness against it. Re-creating the same key fails a check against
something no read path can show you.

The user-visible worst case, measured 2026-08-29 through the full DRF stack:

    like   -> 201
    unlike -> 200
    like   -> 500          (and switching reaction type afterwards: 500)
    alive_rows=0  all_rows=1

Permanent, on the highest-traffic interaction in the product, and the
reaction counter had already been decremented — so the count and the
unrecoverable state were stuck together. There is no 400 in front of it
because DRF generates a uniqueness validator for `unique_together` and *not*
for `Meta.constraints`.

WHY THIS FILE ENUMERATES INSTEAD OF LISTING. The audit named four models. A
sweep of every soft-deletable model found **ten** unique constraints, of which
**nine** lacked the condition — only `DispatchRecord.unique_active_dispatch`
had it. The meta-test below is the enumeration, so the answer stays correct as
models are added; the behavioural tests underneath it are the ones that show
what the defect actually felt like.

`Statute.unique_statute_tenant_code` had already bitten once: migration 0018
had to stop using `row.delete()` because the soft-deleted row kept the code
and the rename then hit a UNIQUE failure.
"""
import pytest
from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.db.models import UniqueConstraint
from rest_framework.test import APIClient

from apps.social.models import Follow, Post, Reaction, ReactionType, UserProfile
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


def test_every_unique_constraint_on_a_soft_deletable_model_is_scoped_to_live_rows():
    """The meta-test. Enumerates rather than lists, so it stays true.

    A model that gains `is_deleted` and a unique key later is the case a
    hand-written list cannot cover — and this repository's own record is that
    hand-written subject lists are where guards go blind.
    """
    unscoped = []
    checked = 0
    for model in django_apps.get_models():
        if not hasattr(model, "is_deleted"):
            continue
        for constraint in model._meta.constraints:
            if not isinstance(constraint, UniqueConstraint):
                continue
            checked += 1
            condition = str(constraint.condition) if constraint.condition else ""
            if "is_deleted" not in condition:
                unscoped.append(f"{model._meta.label}.{constraint.name}")
        for together in model._meta.unique_together or ():
            checked += 1
            unscoped.append(f"{model._meta.label}.unique_together{together}")

    assert checked > 0, (
        "no unique constraints found on any soft-deletable model — the sweep "
        "found nothing, which means it is measuring nothing"
    )
    assert unscoped == [], (
        f"{len(unscoped)} unique key(s) on soft-deletable models are enforced "
        f"against rows no filtered queryset can see: {unscoped}. "
        f"`unique_together` cannot carry a condition at all; convert it to a "
        f"UniqueConstraint with condition=Q(is_deleted=False)."
    )


@pytest.fixture
def social(db):
    tenant = Tenant.objects.get_or_create(
        code="SD_T", defaults={"display_name": "SoftDel"}
    )[0]
    author = User.objects.create_user(
        username="sd_author", password="x", role="VIEWER", tenant=tenant
    )
    reader = User.objects.create_user(
        username="sd_reader", password="x", role="VIEWER", tenant=tenant
    )
    UserProfile.objects.get_or_create(user=author)
    UserProfile.objects.get_or_create(user=reader)
    post = Post.objects.create(author=author, content="p", tenant=tenant)
    return {
        "tenant": tenant, "author": author, "reader": reader, "post": post,
        "client": _jwt_client(reader, tenant),
    }


@pytest.mark.django_db
def test_a_reaction_can_be_taken_back_and_given_again(social):
    """The 500 that made the highest-traffic interaction one-shot."""
    url = "/api/v1/social/reactions/"
    body = {"post": str(social["post"].pk), "reaction_type": ReactionType.LIKE}

    first = social["client"].post(url, body, format="json")
    assert first.status_code in (200, 201), first.data

    # Take it back through the same route the UI uses.
    Reaction.objects.filter(user=social["reader"], post=social["post"]).first().delete()

    again = social["client"].post(url, body, format="json")
    assert again.status_code in (200, 201), (
        f"re-reacting after taking a reaction back returned "
        f"{again.status_code}. The soft-deleted row still holds the key, and "
        f"there is no validator in front of Meta.constraints to turn it into "
        f"a 400 — this was a 500, permanently, per post."
    )

    switched = social["client"].post(
        url,
        {"post": str(social["post"].pk), "reaction_type": ReactionType.LOVE},
        format="json",
    )
    assert switched.status_code in (200, 201), (
        f"switching reaction type after a take-back returned "
        f"{switched.status_code}"
    )


@pytest.mark.django_db
def test_a_follow_can_be_deleted_and_remade_and_the_counters_stay_true(social):
    """Two halves: the key must be freed, and the counter must come back down.

    `POST /follows/toggle/` was always fine because `FollowService.unfollow`
    uses a queryset `.delete()`, which bypasses the model's soft delete
    entirely. `DELETE /follows/{id}/` went through the model. One meaning, two
    paths, opposite behaviour — and testing only the working one is how this
    stayed hidden.
    """
    url = "/api/v1/social/follows/"
    body = {"following": social["author"].pk}

    for round_no in range(3):
        created = social["client"].post(url, body, format="json")
        assert created.status_code == 201, (
            f"round {round_no}: follow POST returned {created.status_code} — "
            f"the previous DELETE left the key occupied"
        )
        # `FollowCreateSerializer` does not echo `id`; read the live row.
        row = Follow.objects.get(
            follower=social["reader"], following=social["author"]
        )
        deleted = social["client"].delete(f"{url}{row.pk}/")
        assert deleted.status_code == 204, deleted.status_code

        profile = UserProfile.objects.get(user=social["author"])
        assert profile.followers_count == 0, (
            f"round {round_no}: followers_count is {profile.followers_count} "
            f"with {Follow.objects.filter(following=social['author']).count()} "
            f"live rows — DELETE did not decrement, so the number only ever "
            f"goes up"
        )
