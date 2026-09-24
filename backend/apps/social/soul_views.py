"""灵魂朋友圈接口:`/api/v1/me/social/`。

每个视图继承 `SoulAPIView`(apps/soul_accounts/me_views.py):只认灵魂令牌(官员令牌 403)、
只认本世未停用账号、首登改密前一律拒绝。`tests/test_soul_auth_boundary.py::
test_every_me_route_is_a_soul_api_view` 走真实 URLconf 钉住这一点 —— 所以这里不重复声明
认证类,继承就是那道分界。

所有查询都从 `request.user` 出发,URL 里不接受任何灵魂 id;**能看见什么由
`apps/social/soul_circle.py` 一处决定**,本模块只负责把它接成 HTTP。
"""
from django.db.models import Exists, OuterRef, Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.social import moderation as mod
from apps.social import soul_circle as circle
from apps.social.models import Follow, Post, ReportTargetType
from apps.social.soul_serializers import (
    SoulCommentCreateSerializer,
    SoulCommentSerializer,
    SoulFollowStateSerializer,
    SoulPostCreateSerializer,
    SoulPostSerializer,
    SoulProfileSerializer,
    SoulReactionRequestSerializer,
    SoulReactionStateSerializer,
    SoulRelationCardSerializer,
    SoulReportRequestSerializer,
    SoulReportResultSerializer,
    SoulSearchResultSerializer,
    SoulSocialErrorSerializer,
    SoulSocialStatusSerializer,
)
from apps.soul_accounts.me_views import SoulAPIView

SEARCH_LIMIT = 20


def _page(child, name):
    """DRF 分页信封的显式声明。

    这些视图是 APIView 而不是 ViewSet,`PageNumberPagination` 的信封不会被
    drf-spectacular 自动推出来 —— 不写一份,schema 就会说这个端点返回一个裸数组,
    而它返回的是 `{count, next, previous, results}`。schema 门禁要求 0 warning/0 error,
    但一个**说错了形状**的 schema 是绿的:`test_e2e_fixtures_match_the_serializers`
    正是为这种「契约与实现不一致而没有人报红」的形状存在的。
    """
    return type(
        name,
        (serializers.Serializer,),
        {
            "count": serializers.IntegerField(),
            "next": serializers.CharField(allow_null=True),
            "previous": serializers.CharField(allow_null=True),
            "results": child(many=True),
        },
    )


PaginatedSoulPosts = _page(SoulPostSerializer, "PaginatedSoulPosts")
PaginatedSoulComments = _page(SoulCommentSerializer, "PaginatedSoulComments")
PaginatedSoulCards = _page(SoulRelationCardSerializer, "PaginatedSoulCards")

ERRORS = {403: SoulSocialErrorSerializer, 404: SoulSocialErrorSerializer, 409: SoulSocialErrorSerializer}


def _error(exc: circle.SocialError):
    return Response({"detail": str(exc), "code": exc.code, **exc.extra}, status=exc.status)


class SoulSocialView(SoulAPIView):
    """本模块的公共外壳:把 `SocialError` 答成 `{detail, code}` + 它自己的状态码。

    DRF 的 `handle_exception` 只认 `APIException`,而服务层刻意不 import DRF ——
    聊天代理(feat/soul-chat)也要 import `soul_circle`。于是在边界上翻译一次。
    """

    def handle_exception(self, exc):
        if isinstance(exc, circle.SocialError):
            return _error(exc)
        return super().handle_exception(exc)

    def paginate(self, queryset, serializer_class):
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(queryset, self.request, view=self)
        data = serializer_class(page, many=True, context={"viewer": self.request.user}).data
        return paginator.get_paginated_response(data)


# ── 状态 ─────────────────────────────────────────────────────────────────


class MeSocialStatusView(SoulSocialView):
    """App 进朋友圈第一件事问这里:能不能写、禁言到什么时候、今天还能举报几次。"""

    @extend_schema(responses={200: SoulSocialStatusSerializer, **ERRORS})
    def get(self, request):
        mute = circle.active_mute(request.user)
        return Response(
            SoulSocialStatusSerializer(
                {
                    "user_id": request.user.pk,
                    "can_write": mute is None and circle.is_current_soul(request.user),
                    "muted_until": mute.until if mute else None,
                    "reports_remaining": mod.reports_remaining(request.user),
                }
            ).data
        )


# ── 动态流与帖子 ──────────────────────────────────────────────────────────


class MeSocialFeedView(SoulSocialView):
    """本文明 + 关注。四档可见性已经把「关注」算进去了(FOLLOWERS 档只对关注者可见),
    所以动态流就是 `visible_posts_for_soul` 本身,按时间倒序。

    `?author=<user_id>` 是同一个查询加一个作者过滤 —— 个人主页的帖子列表用它,
    不另开一条可见性路径。`?following=true` 同理,只留自己和此刻关注着的人的帖子
    (App「关注」子页)。
    """

    @extend_schema(
        parameters=[
            OpenApiParameter("author", int, description="只看这个灵魂的帖子(user_id)。"),
            OpenApiParameter("following", bool, description="true:只看自己和我关注的人的帖子。"),
        ],
        responses={200: PaginatedSoulPosts, **ERRORS},
    )
    def get(self, request):
        qs = circle.visible_posts_for_soul(request.user)
        author = request.query_params.get("author")
        if author:
            qs = qs.filter(author_id=author)
        if request.query_params.get("following") == "true":
            followed = Follow.objects.filter(follower=request.user, tenant=circle.civilization_of(request.user))
            qs = qs.filter(Q(author=request.user) | Q(author_id__in=followed.values("following_id")))
        return self.paginate(circle.annotate_posts_for(request.user, qs).order_by("-create_time"), SoulPostSerializer)

    @extend_schema(request=SoulPostCreateSerializer, responses={201: SoulPostSerializer, **ERRORS})
    def post(self, request):
        body = SoulPostCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        post = circle.create_post(request.user, **body.validated_data)
        return Response(self._one(post), status=201)

    def _one(self, post):
        row = circle.annotate_posts_for(self.request.user, Post.objects.filter(pk=post.pk)).first()
        return SoulPostSerializer(row, context={"viewer": self.request.user}).data


class MeSocialPostView(SoulSocialView):
    @extend_schema(operation_id="v1_me_social_post_detail", responses={200: SoulPostSerializer, **ERRORS})
    def get(self, request, post_id):
        row = circle.annotate_posts_for(
            request.user, circle.visible_posts_for_soul(request.user).filter(pk=post_id)
        ).first()
        if row is None:
            raise circle.SocialError("对象不存在。", "not_found", 404)
        return Response(SoulPostSerializer(row, context={"viewer": request.user}).data)

    @extend_schema(operation_id="v1_me_social_post_delete", responses={204: None, **ERRORS})
    def delete(self, request, post_id):
        circle.delete_own_post(request.user, post_id)
        return Response(status=204)


class MeSocialCommentsView(SoulSocialView):
    @extend_schema(responses={200: PaginatedSoulComments, **ERRORS})
    def get(self, request, post_id):
        if not circle.visible_posts_for_soul(request.user).filter(pk=post_id).exists():
            raise circle.SocialError("对象不存在。", "not_found", 404)
        qs = circle.visible_comments_for_soul(request.user).filter(post_id=post_id)
        return self.paginate(qs.select_related("author").order_by("create_time"), SoulCommentSerializer)

    @extend_schema(request=SoulCommentCreateSerializer, responses={201: SoulCommentSerializer, **ERRORS})
    def post(self, request, post_id):
        body = SoulCommentCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        comment = circle.create_comment(
            request.user, post_id, body.validated_data["content"], body.validated_data.get("parent")
        )
        return Response(SoulCommentSerializer(comment, context={"viewer": request.user}).data, status=201)


class MeSocialCommentView(SoulSocialView):
    @extend_schema(operation_id="v1_me_social_comment_delete", responses={204: None, **ERRORS})
    def delete(self, request, comment_id):
        circle.delete_own_comment(request.user, comment_id)
        return Response(status=204)


class MeSocialReactionView(SoulSocialView):
    @extend_schema(request=SoulReactionRequestSerializer, responses={200: SoulReactionStateSerializer, **ERRORS})
    def post(self, request, post_id):
        body = SoulReactionRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        state = circle.toggle_reaction(request.user, post_id, body.validated_data["reaction_type"])
        return Response(SoulReactionStateSerializer(state).data)


# ── 人 ───────────────────────────────────────────────────────────────────


class MeSocialSearchView(SoulSocialView):
    """本文明内按显示名或灵魂编号找人。

    编号是**精确**匹配而不是模糊:它是登录名,模糊匹配等于把本文明的登录名表按前缀
    交出去。结果里也不回显编号(`SoulCardSerializer` 的字段白名单)—— 知道编号的人
    才找得到那个人,而找到了也拿不到更多。
    """

    @extend_schema(
        parameters=[OpenApiParameter("q", str, required=True, description="显示名(包含)或灵魂编号(精确)。")],
        responses={200: SoulSearchResultSerializer(many=True), **ERRORS},
    )
    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response([])
        tenant = circle.civilization_of(request.user)
        rows = (
            circle.souls_in(tenant)
            .exclude(pk=request.user.pk)
            .filter(Q(display_name__icontains=q) | Q(soul_account__soul__soul_code__iexact=q.upper()))
            .select_related("soul_account")[:SEARCH_LIMIT]
        )
        following = set(
            Follow.objects.filter(follower=request.user, tenant=tenant, following__in=rows).values_list(
                "following_id", flat=True
            )
        )
        for row in rows:
            row.is_following = row.pk in following
        return Response(SoulSearchResultSerializer(rows, many=True).data)


class MeSocialProfileView(SoulSocialView):
    """一个灵魂的主页。跨文明、官员、不存在 —— 同一个 404。"""

    @extend_schema(operation_id="v1_me_social_profile", responses={200: SoulProfileSerializer, **ERRORS})
    def get(self, request, user_id):
        tenant = circle.civilization_of(request.user)
        target = circle.souls_in(tenant, include_retired=True).filter(pk=user_id).select_related("soul_account").first()
        if target is None:
            raise circle.SocialError("对象不存在。", "not_found", 404)
        target.is_self = target.pk == request.user.pk
        target.is_following = circle.is_following(request.user, target)
        target.is_followed_by = circle.is_following(target, request.user)
        target.is_mutual = target.is_following and target.is_followed_by
        target.followers_count = Follow.objects.filter(following=target, tenant=tenant).count()
        target.following_count = Follow.objects.filter(follower=target, tenant=tenant).count()
        # 查看者**看得见的**帖子数,不是作者的总帖数:后者会把待审、被隐藏、
        # 以及 PRIVATE 的存在数出来。
        target.post_count = circle.visible_posts_for_soul(request.user).filter(author=target).count()
        return Response(SoulProfileSerializer(target).data)


class MeSocialFollowView(SoulSocialView):
    @extend_schema(operation_id="v1_me_social_follow", request=None, responses={200: SoulFollowStateSerializer, **ERRORS})
    def post(self, request, user_id):
        circle.follow(request.user, user_id)
        return Response(SoulFollowStateSerializer({"following": True}).data)

    @extend_schema(operation_id="v1_me_social_unfollow", request=None, responses={200: SoulFollowStateSerializer, **ERRORS})
    def delete(self, request, user_id):
        circle.unfollow(request.user, user_id)
        return Response(SoulFollowStateSerializer({"following": False}).data)


class MeSocialFollowingView(SoulSocialView):
    """我关注的人。只列此刻同文明的:换了文明,旧文明的关注边不再算数
    (`is_following` 同一条规则)。"""

    relation = "following"

    @extend_schema(operation_id="v1_me_social_following", responses={200: PaginatedSoulCards, **ERRORS})
    def get(self, request):
        tenant = circle.civilization_of(request.user)
        ids = Follow.objects.filter(
            **{"follower" if self.relation == "following" else "following": request.user}, tenant=tenant
        ).values_list(f"{self.relation}_id", flat=True)
        edges = Follow.objects.filter(tenant=tenant)
        rows = circle.souls_in(tenant, include_retired=True).filter(pk__in=ids).annotate(
            is_following=Exists(edges.filter(follower=request.user, following=OuterRef("pk"))),
            is_followed_by=Exists(edges.filter(follower=OuterRef("pk"), following=request.user)),
        )
        return self.paginate(rows.select_related("soul_account").order_by("display_name", "pk"), SoulRelationCardSerializer)


class MeSocialFollowersView(MeSocialFollowingView):
    relation = "follower"

    @extend_schema(operation_id="v1_me_social_followers", responses={200: PaginatedSoulCards, **ERRORS})
    def get(self, request):
        return super().get(request)


# ── 举报 ─────────────────────────────────────────────────────────────────


class MeSocialReportView(SoulSocialView):
    @extend_schema(request=SoulReportRequestSerializer, responses={201: SoulReportResultSerializer, **ERRORS})
    def post(self, request):
        body = SoulReportRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        _, counted = mod.submit_report(
            request.user,
            ReportTargetType(body.validated_data["target_type"]),
            body.validated_data["target_id"],
            body.validated_data["reason"],
            body.validated_data.get("detail", ""),
        )
        return Response(
            SoulReportResultSerializer(
                {"counted": counted, "reports_remaining": mod.reports_remaining(request.user)}
            ).data,
            status=201,
        )
