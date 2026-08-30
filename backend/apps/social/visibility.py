"""One statement of "which posts may this request see".

`PostViewSet.get_queryset` had it, and nothing else did. `CommentViewSet` and
`ReactionViewSet` scoped to the tenant and stopped there, so with a post's UUID
any member of the same tenant could read every comment on a PRIVATE post,
enumerate who had reacted to it, and post comments and reactions onto it --
incrementing the author's counters in the process.

Measured 2026-08-29 (Bob and Alice in one tenant, not following each other,
neither an ADMIN, against Alice's PRIVATE post):

    Bob retrieve the post          -> 404, and it is absent from his list
    GET /comments/?post=<private>  -> 200, n=1, contents=['SECRET REPLY']
    GET /reactions/?post=<private> -> 200, n=1, reactors=[1]
    Bob POST a comment on it       -> 201
    Bob POST a reaction on it      -> 201
    Alice's post now reads comment=1 reaction=1

`PRIVATE` and `FOLLOWERS` therefore did not exist below the post itself. The
rule was written once and applied once; this module is that rule with one
home, so the next model hanging off Post inherits it instead of reimplementing
it.
"""
from django.db.models import Q

from apps.social.models import Follow, Post


def visible_posts(request, queryset=None):
    """Posts this request may see, as a queryset.

    Mirrors `PostViewSet.get_queryset`'s visibility clause exactly, and is the
    single definition of it -- that method now calls here too, so the two
    cannot drift.

    Fails closed: an unauthenticated request sees nothing rather than
    everything, which is the shape `scope_to_tenant` already fixed once in
    this app for the tenant dimension.
    """
    qs = Post.objects.all() if queryset is None else queryset
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return qs.none()

    tenant = getattr(request, "tenant", None) or getattr(user, "tenant", None)
    following_ids = (
        Follow.objects.filter(follower=user, tenant=tenant).values_list(
            "following_id", flat=True
        )
        if tenant
        else []
    )
    return qs.filter(
        Q(visibility="PUBLIC")
        | Q(visibility="TENANT", tenant=tenant)
        | Q(author=user)
        | Q(visibility="FOLLOWERS", author_id__in=following_ids)
    )


def may_see_post(request, post):
    """Whether one already-fetched post is visible to this request.

    For write paths, which hold the object rather than a queryset. Expressed
    through `visible_posts` rather than restating the clause: a second copy of
    a rule is how the first one came to be the only one that was maintained.
    """
    if post is None:
        return False
    return visible_posts(request, Post.objects.filter(pk=post.pk)).exists()
