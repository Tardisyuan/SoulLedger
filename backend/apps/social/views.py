"""
Views for the social domain.

Permission codenames: EXEMPT, deliberately, for all five viewsets below.

The whole module was written with `permission_codename` set to "post",
"comment", "reaction", "follow" and "profile", which made
CodenameViewSetMixin generate twenty-odd codenames — post.read,
comment.create, follow.toggle, profile.me and the rest. Not one of them
exists in DEFAULT_PERMISSIONS, and not one is granted by any role in
ROLE_PERMISSIONS. They were never seeded by a migration either. So every
one of them was a codename that could only ever answer "no" — switching
enforcement on would have closed the entire social module to all five
roles at once, ADMIN aside.

Setting them to None says that out loud instead of leaving a name that
looks governed and is not. Giving social a real permission family is a
product decision (who may post, who may follow whom, does a VIEWER get to
comment) plus a seeding migration plus grants to five roles — none of
which belongs in a codename-reconciliation pass. It is queued as
follow-up work.

Access is not unguarded in the meantime: every viewset here keeps its
TenantPermission plus an object-level owner check
(IsAuthorOrReadOnly / IsReactionOwnerOrReadOnly / IsFollowOwnerOrReadOnly /
IsProfileOwnerOrReadOnly), so authorship still governs writes.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin
from apps.social.models import Comment, Follow, Post, Reaction, UserProfile
from apps.social.permissions import (
    IsAuthorOrReadOnly,
    IsFollowOwnerOrReadOnly,
    IsProfileOwnerOrReadOnly,
    IsReactionOwnerOrReadOnly,
)
from apps.social.serializers import (
    CommentCreateSerializer,
    CommentListSerializer,
    CommentSerializer,
    FollowCreateSerializer,
    FollowSerializer,
    PostCreateSerializer,
    PostListSerializer,
    PostSerializer,
    ReactionCreateSerializer,
    ReactionSerializer,
    UserProfileSerializer,
    UserProfileUpdateSerializer,
)
from apps.social.services import CommentService, FollowService, PostService, ReactionService
from apps.social.visibility import visible_posts


class PostViewSet(CodenameViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Post CRUD + feed.

    list:       GET    /api/v1/social/posts/
    create:     POST   /api/v1/social/posts/
    retrieve:   GET    /api/v1/social/posts/{id}/
    update:     PUT    /api/v1/social/posts/{id}/
    partial:    PATCH  /api/v1/social/posts/{id}/
    destroy:    DELETE /api/v1/social/posts/{id}/
    feed:       GET    /api/v1/social/posts/feed/ — posts from followed users
    """
    permission_classes = [TenantPermission, IsAuthorOrReadOnly]
    # EXEMPT — see the module note at the top of this file. "post" generated
    # post.read/create/update/delete/feed, none of which exist or are held.
    permission_codename = None
    queryset = Post.objects.select_related("author").all()

    def get_serializer_class(self):
        if self.action == "list":
            return PostListSerializer
        if self.action == "create":
            return PostCreateSerializer
        return PostSerializer

    def get_queryset(self):
        # Fail-closed tenant scoping — see apps/core/tenant.py. Without the
        # `else qs.none()` this used to inline, a non-ADMIN caller with no
        # resolved request.tenant fell through to the unfiltered queryset —
        # every tenant's posts, not just their own.
        qs = scope_to_tenant(super().get_queryset(), self.request)
        # The visibility clause lived here and only here. See
        # apps/social/visibility.py for what that cost.
        return visible_posts(self.request, qs).order_by("-create_time")

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
        PostService.increment_post_count(self.request.user.pk)

    @action(detail=False, methods=["get"])
    def feed(self, request):
        """Return posts from users the current user follows."""
        tenant = getattr(request, "tenant", None)
        if not tenant:
            return Response([], status=status.HTTP_200_OK)
        following_ids = Follow.objects.filter(
            follower=request.user, tenant=tenant
        ).values_list("following_id", flat=True)
        qs = Post.objects.filter(
            author_id__in=following_ids,
            visibility__in=["PUBLIC", "FOLLOWERS"],
            tenant=tenant,
        ).select_related("author").order_by("-create_time")
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = PostListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = PostListSerializer(qs, many=True)
        return Response(serializer.data)


class CommentViewSet(CodenameViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Comment CRUD.

    list:       GET    /api/v1/social/comments/
    create:     POST   /api/v1/social/comments/
    retrieve:   GET    /api/v1/social/comments/{id}/
    destroy:    DELETE /api/v1/social/comments/{id}/
    """
    permission_classes = [TenantPermission, IsAuthorOrReadOnly]
    # EXEMPT — see the module note at the top of this file.
    permission_codename = None
    queryset = Comment.objects.select_related("author", "post").all()

    def get_serializer_class(self):
        if self.action == "list":
            return CommentListSerializer
        if self.action == "create":
            return CommentCreateSerializer
        return CommentSerializer

    def get_queryset(self):
        # Fail-closed tenant scoping (apps/core/tenant.py) — a non-ADMIN
        # caller with no resolved request.tenant must get qs.none(), not
        # every tenant's comments.
        qs = scope_to_tenant(super().get_queryset(), self.request)
        # Comments inherit their post's visibility. Without this, a PRIVATE
        # post's whole comment thread was readable by any member of the tenant
        # holding its UUID -- measured, `GET /comments/?post=<private>` came
        # back 200 with the contents.
        qs = qs.filter(post__in=visible_posts(self.request))
        # Allow filtering by post
        post_id = self.request.query_params.get("post")
        if post_id:
            qs = qs.filter(post_id=post_id)
        return qs.order_by("create_time")

    def perform_create(self, serializer):
        post = serializer.validated_data["post"]
        parent = serializer.validated_data.get("parent")
        content = serializer.validated_data["content"]
        tenant = getattr(self.request, "tenant", None)
        CommentService.create_comment(
            author=self.request.user,
            post=post,
            content=content,
            parent=parent,
            tenant=tenant,
        )

    def perform_destroy(self, instance):
        CommentService.delete_comment(instance)


class ReactionViewSet(CodenameViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Reaction CRUD with toggle behavior.

    list:       GET    /api/v1/social/reactions/
    create:     POST   /api/v1/social/reactions/
    destroy:    DELETE /api/v1/social/reactions/{id}/
    """
    permission_classes = [TenantPermission, IsReactionOwnerOrReadOnly]
    # EXEMPT — see the module note at the top of this file.
    permission_codename = None
    queryset = Reaction.objects.select_related("user").all()
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return ReactionCreateSerializer
        return ReactionSerializer

    def get_queryset(self):
        # Fail-closed tenant scoping (apps/core/tenant.py) — a non-ADMIN
        # caller with no resolved request.tenant must get qs.none(), not
        # every tenant's reactions.
        qs = scope_to_tenant(super().get_queryset(), self.request)
        # Same as comments: a reaction is visible only where its post is.
        # `Q(post__isnull=True)` keeps reactions on comments, whose own
        # visibility is filtered by the comment clause below it.
        from django.db.models import Q

        visible = visible_posts(self.request)
        qs = qs.filter(
            Q(post__in=visible) | Q(post__isnull=True, comment__post__in=visible)
        )
        # Allow filtering by post or comment
        post_id = self.request.query_params.get("post")
        comment_id = self.request.query_params.get("comment")
        if post_id:
            qs = qs.filter(post_id=post_id)
        if comment_id:
            qs = qs.filter(comment_id=comment_id)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        tenant = getattr(request, "tenant", None)
        reaction, created = ReactionService.add_reaction(
            user=request.user,
            reaction_type=data["reaction_type"],
            post=data.get("post"),
            comment=data.get("comment"),
            tenant=tenant,
        )
        return Response(
            ReactionSerializer(reaction).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FollowViewSet(CodenameViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Follow/unfollow relationships.

    list:       GET    /api/v1/social/follows/
    create:     POST   /api/v1/social/follows/
    destroy:    DELETE /api/v1/social/follows/{id}/
    following:  GET    /api/v1/social/follows/following/ — users I follow
    followers:  GET    /api/v1/social/follows/followers/ — users who follow me
    toggle:     POST   /api/v1/social/follows/toggle/ — toggle follow
    """
    permission_classes = [TenantPermission, IsFollowOwnerOrReadOnly]
    # EXEMPT — see the module note at the top of this file.
    permission_codename = None

    def perform_destroy(self, instance):
        """Route DELETE through the service, the way `toggle` already does.

        Without this, DELETE fell through to ModelViewSet's default, which
        calls `instance.delete()` — the model's *soft* delete — and touched no
        counters. `toggle` calls `FollowService.unfollow`, which uses a
        queryset `.delete()` (a hard delete, since SoftDeleteQuerySet does not
        override it) and decrements both profiles. One meaning, two paths,
        opposite behaviour: measured 2026-08-29, `POST` then `DELETE` left
        `followers_count` at 1 with zero rows, and the next `POST` raised
        IntegrityError against the soft-deleted row.

        The constraint is now scoped to live rows so re-following would work
        either way; this exists so the counters stay true.
        """
        FollowService.unfollow(
            follower=instance.follower,
            following=instance.following,
            tenant=instance.tenant,
        )
    queryset = Follow.objects.select_related("follower", "following").all()
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return FollowCreateSerializer
        return FollowSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        # Follow is tenant-scoped, not deliberately cross-tenant the way
        # DispatchRecord/CrossTenantJudgment are: Follow.tenant is stamped
        # from the acting user's own request.tenant on save() (see
        # apps/social/models.py Follow.save()), FollowCreateSerializer never
        # accepts a tenant, and nothing in FollowService or the serializers
        # validates or expects `follower`/`following` to live in different
        # tenants — there is no cross-tenant-follow product feature, unlike
        # dispatch's inherently cross-tenant transfers. So this gets the same
        # single-tenant idiom as Post/Comment/Reaction/UserProfile, not
        # dispatch's OR-across-two-tenants shape.
        #
        # Fail-closed tenant scoping (apps/core/tenant.py) — a non-ADMIN
        # caller with no resolved request.tenant must get qs.none(), not
        # every tenant's follow graph.
        qs = scope_to_tenant(qs, self.request)
        # Allow filtering by user
        user_id = self.request.query_params.get("user")
        if user_id:
            from django.db.models import Q
            qs = qs.filter(
                Q(follower_id=user_id) | Q(following_id=user_id)
            )
        return qs

    def perform_create(self, serializer):
        following = serializer.validated_data["following"]
        tenant = getattr(self.request, "tenant", None)
        FollowService.follow(self.request.user, following, tenant)

    @action(detail=False, methods=["get"])
    def following(self, request):
        """List users the current user follows."""
        tenant = getattr(request, "tenant", None)
        qs = Follow.objects.filter(
            follower=request.user, tenant=tenant
        ).select_related("following")
        serializer = FollowSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"])
    def followers(self, request):
        """List users following the current user."""
        tenant = getattr(request, "tenant", None)
        qs = Follow.objects.filter(
            following=request.user, tenant=tenant
        ).select_related("follower")
        serializer = FollowSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["post"])
    def toggle(self, request):
        """Toggle follow/unfollow for a target user."""
        following_id = request.data.get("following")
        if not following_id:
            return Response(
                {"detail": "'following' field is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.authentication.models import User
        # Scoped, not `User.objects.get(pk=...)`. Unscoped, this action was
        # two bugs at once: a caller in tenant A could follow a user in
        # tenant B (Follow.save() would stamp the row with A's tenant, so the
        # edge pointed out of its own tenant), and the 404-vs-200 split made
        # it a working existence oracle for user IDs in every other tenant —
        # probe an ID, a 200 means that user exists somewhere. Out-of-tenant
        # IDs must be indistinguishable from IDs that do not exist, so this
        # falls through to the same 404 rather than a 403.
        #
        # admin_bypass=False: this is a write, and the write-side stance in
        # this app (FollowCreateSerializer.validate_following, and the note in
        # CommentCreateSerializer.validate) is that no role — ADMIN included —
        # creates content referencing another tenant's objects. An ADMIN with
        # a bypass here could mint the same tenant-inconsistent Follow row
        # that POST /follows/ now rejects.
        following_user = scope_to_tenant(
            User.objects.all(), request, admin_bypass=False
        ).filter(pk=following_id).first()
        if following_user is None:
            return Response(
                {"detail": "User not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        tenant = getattr(request, "tenant", None)
        is_following = FollowService.is_following(
            request.user.pk, following_id, tenant
        )
        if is_following:
            FollowService.unfollow(request.user, following_user, tenant)
            return Response({"following": False})
        else:
            FollowService.follow(request.user, following_user, tenant)
            return Response({"following": True})


class UserProfileViewSet(CodenameViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    User profile management.

    list:       GET    /api/v1/social/profiles/
    retrieve:   GET    /api/v1/social/profiles/{id}/
    update:     PUT    /api/v1/social/profiles/{id}/
    partial:    PATCH  /api/v1/social/profiles/{id}/
    me:         GET    /api/v1/social/profiles/me/ — current user's profile
    """
    permission_classes = [TenantPermission, IsProfileOwnerOrReadOnly]
    # EXEMPT — see the module note at the top of this file.
    permission_codename = None
    queryset = UserProfile.objects.select_related("user").all()
    http_method_names = ["get", "put", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return UserProfileUpdateSerializer
        return UserProfileSerializer

    def get_queryset(self):
        # UserProfile has no direct tenant FK, only via user__tenant — hence
        # the explicit `field`. Without this, GET /profiles/ let any
        # authenticated user enumerate every tenant's profiles.
        qs = scope_to_tenant(
            super().get_queryset(), self.request, field="user__tenant"
        )
        # Allow filtering by user
        user_id = self.request.query_params.get("user")
        if user_id:
            qs = qs.filter(user_id=user_id)
        return qs

    @action(detail=False, methods=["get"])
    def me(self, request):
        """Return or create the current user's profile."""
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile)
        return Response(serializer.data)
