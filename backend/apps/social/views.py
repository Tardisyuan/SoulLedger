"""
Views for the social domain.
"""
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import TenantPermission
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
    permission_codename = "post"
    queryset = Post.objects.select_related("author").all()

    def get_serializer_class(self):
        if self.action == "list":
            return PostListSerializer
        if self.action == "create":
            return PostCreateSerializer
        return PostSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            qs = qs.filter(tenant=tenant)
        # Filter by visibility
        user = self.request.user
        if user.is_authenticated:
            from django.db.models import Q
            following_ids = Follow.objects.filter(
                follower=user, tenant=tenant
            ).values_list("following_id", flat=True) if tenant else []
            qs = qs.filter(
                Q(visibility="PUBLIC")
                | Q(visibility="TENANT", tenant=tenant)
                | Q(author=user)
                | Q(visibility="FOLLOWERS", author_id__in=following_ids)
            )
        return qs.order_by("-create_time")

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
    permission_codename = "comment"
    queryset = Comment.objects.select_related("author", "post").all()

    def get_serializer_class(self):
        if self.action == "list":
            return CommentListSerializer
        if self.action == "create":
            return CommentCreateSerializer
        return CommentSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            qs = qs.filter(tenant=tenant)
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
    permission_codename = "reaction"
    queryset = Reaction.objects.select_related("user").all()
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return ReactionCreateSerializer
        return ReactionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            qs = qs.filter(tenant=tenant)
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
    permission_codename = "follow"
    queryset = Follow.objects.select_related("follower", "following").all()
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return FollowCreateSerializer
        return FollowSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            qs = qs.filter(tenant=tenant)
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
        try:
            following_user = User.objects.get(pk=following_id)
        except User.DoesNotExist:
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
    permission_codename = "profile"
    queryset = UserProfile.objects.select_related("user").all()
    http_method_names = ["get", "put", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return UserProfileUpdateSerializer
        return UserProfileSerializer

    def get_queryset(self):
        qs = super().get_queryset()
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
