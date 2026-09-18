"""官员审核后台:`/api/v1/social-moderation/`。

**一个码名,`social.moderate`。** 这个后台做的是一件事 —— 看举报队列、处置内容、
维护敏感词、管禁言。按 CRUD 拆成 read/create/update/delete 四个码名会造出三个
没有任何人打算单独授予的开关(`apps/perm/models.py` 的 `dashboard` 族就是那样长出来的:
授给了五个角色,而两侧都没有消费者)。所以这里覆盖 `get_required_permissions`,
每个动作都答同一个码名 —— `apps/perm/test_codename_coverage.py` 认这条路径
(它对自写的实现直接实例化求值)。

**租户隔离照常走 `scope_to_tenant`**(`tests/test_tenant_scoping_contract.py` 对每个
router 注册的 viewset 逐条断言)。这里额外一条:官员只审**灵魂的**内容 ——
`author__role="SOUL"`。官员自己在 `/api/v1/social/` 的帖子不进这个后台,
两个圈子在这里也不相交。

**暂居不放宽。** 这几张表挂在 `tenant` 上而不是灵魂上,所以不进
`RESIDENCE_READABLE`:朋友圈按「当前所在文明」算,暂居的灵魂在暂居地发帖、
由暂居地的官员审 —— 原属租户的官员看不到,也不该看到。
"""
from django.db.models import Count, Q
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.social import moderation as mod
from apps.social.models import (
    Comment,
    ModerationStatus,
    Post,
    Report,
    ReportResolution,
    ReportStatus,
    SensitiveWord,
    SocialMute,
)
from apps.social.moderation_serializers import (
    ModeratedCommentSerializer,
    ModeratedPostSerializer,
    ModerationActionSerializer,
    ModerationErrorSerializer,
    MuteCreateSerializer,
    ReportSerializer,
    ResolveReportSerializer,
    SensitiveWordSerializer,
    SocialMuteSerializer,
)
from apps.social.soul_circle import SocialError

MODERATE = "social.moderate"
ERRORS = {400: ModerationErrorSerializer, 403: ModerationErrorSerializer, 409: ModerationErrorSerializer}


class ModerationViewSet(CodenameViewSetMixin, viewsets.GenericViewSet):
    """本后台每个 viewset 的公共外壳:一个码名、租户隔离、`SocialError` → HTTP。"""

    permission_codename = "social"
    # 声明码名不等于执行码名:默认的 `IsAuthenticated` 不读它。漏了这一行时
    # JUDGE 打开举报队列得到 200(tests/test_social_moderation.py 实测),
    # tests/test_declared_codenames_are_enforced.py 同时报了这五个 viewset。
    permission_classes = [TenantPermission, CodenamePermission]

    def get_required_permissions(self):
        return [MODERATE]

    def get_queryset(self):
        return scope_to_tenant(super().get_queryset(), self.request)

    #: 列表页的默认过滤(待办)。**只作用于 list** —— DRF 的 `get_object()` 也走
    #: `filter_queryset()`,所以把「默认只看待办」写进 queryset 会让详情动作对一条
    #: 已处理的行答 404 而不是 409。实测过:处置一条 PUBLISHED 的帖子得到的是
    #: 「No Post matches the given query」,读起来像内容不存在,而它就在那里。
    default_list_filter: dict = {}

    def filter_queryset(self, queryset):
        qs = super().filter_queryset(queryset)
        if self.action == "list":
            for field, value in self.default_list_filter.items():
                if field not in self.request.query_params:
                    qs = qs.filter(**{field: value})
        return qs

    def handle_exception(self, exc):
        if isinstance(exc, SocialError):
            return Response({"detail": str(exc), "code": exc.code, **exc.extra}, status=exc.status)
        return super().handle_exception(exc)

    @property
    def tenant(self):
        return getattr(self.request, "tenant", None)


class ReportViewSet(ModerationViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    """举报队列。默认只看 OPEN —— 后台一打开要的是待办,不是全部历史。"""

    queryset = Report.objects.select_related("target_user", "post", "comment").prefetch_related("entries__reporter")
    serializer_class = ReportSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["status", "target_type"]
    default_list_filter = {"status": ReportStatus.OPEN}
    extra_permissions = {"resolve": [MODERATE]}

    @extend_schema(request=ResolveReportSerializer, responses={200: ReportSerializer, **ERRORS})
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        body = ResolveReportSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        row = mod.resolve_report(
            self.get_object(),
            ReportResolution(body.validated_data["resolution"]),
            actor=request.user,
            request=request,
            note=body.validated_data.get("note", ""),
            mute_days=body.validated_data.get("mute_days"),
        )
        return Response(ReportSerializer(row).data)


class ModeratedContentViewSet(ModerationViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    """待审 / 已隐藏内容的队列,加四个处置动作。帖子与评论各继承一次 —— 差别只有模型。

    默认 `?moderation_status=PENDING`:队列的默认视图是「等着我看的」。
    """

    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["moderation_status"]
    extra_permissions = {a.lower(): [MODERATE] for a in mod.CONTENT_ACTIONS}

    default_list_filter = {"moderation_status": ModerationStatus.PENDING}

    def get_queryset(self):
        qs = super().get_queryset().filter(author__role="SOUL").select_related("author")
        return qs.annotate(
            open_report_count=Count("reports", filter=Q(reports__status=ReportStatus.OPEN), distinct=True)
        ).order_by("-create_time")

    def _act(self, request, verb):
        body = ModerationActionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        row = mod.moderate_content(
            self.get_object(), verb, actor=request.user, request=request, reason=body.validated_data.get("reason", "")
        )
        return Response(self.get_serializer(row).data)

    @extend_schema(request=ModerationActionSerializer, responses={200: None, **ERRORS})
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._act(request, "APPROVE")

    @extend_schema(request=ModerationActionSerializer, responses={200: None, **ERRORS})
    @action(detail=True, methods=["post"])
    def hide(self, request, pk=None):
        return self._act(request, "HIDE")

    @extend_schema(request=ModerationActionSerializer, responses={200: None, **ERRORS})
    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        return self._act(request, "RESTORE")

    @extend_schema(
        request=ModerationActionSerializer,
        responses={204: OpenApiResponse(description="已删除"), **ERRORS},
    )
    @action(detail=True, methods=["post"])
    def delete(self, request, pk=None):
        body = ModerationActionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        mod.moderate_content(
            self.get_object(), "DELETE", actor=request.user, request=request,
            reason=body.validated_data.get("reason", ""),
        )
        return Response(status=204)


class ModeratedPostViewSet(ModeratedContentViewSet):
    queryset = Post.objects.all()
    serializer_class = ModeratedPostSerializer

    @extend_schema(responses={200: ModeratedPostSerializer(many=True)})
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


class ModeratedCommentViewSet(ModeratedContentViewSet):
    queryset = Comment.objects.all()
    serializer_class = ModeratedCommentSerializer

    @extend_schema(responses={200: ModeratedCommentSerializer(many=True)})
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


class SensitiveWordViewSet(
    ModerationViewSet, mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin
):
    """本文明的敏感词表。创建与删除都经 `moderation.py` —— 那里写审计。"""

    queryset = SensitiveWord.objects.select_related("created_by")
    serializer_class = SensitiveWordSerializer

    @extend_schema(request=SensitiveWordSerializer, responses={201: SensitiveWordSerializer, **ERRORS})
    def create(self, request, *args, **kwargs):
        body = SensitiveWordSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        row = mod.add_sensitive_word(
            self.tenant, body.validated_data["word"], actor=request.user, request=request
        )
        return Response(SensitiveWordSerializer(row).data, status=201)

    def perform_destroy(self, instance):
        mod.remove_sensitive_word(instance, actor=self.request.user, request=self.request)


class SocialMuteViewSet(ModerationViewSet, mixins.ListModelMixin, mixins.CreateModelMixin):
    """禁言列表与新建禁言;解除是 `POST {id}/lift/`,不是 DELETE —— 行不删,留着是禁言历史。"""

    queryset = SocialMute.objects.select_related("user")
    serializer_class = SocialMuteSerializer
    extra_permissions = {"lift": [MODERATE]}

    def get_queryset(self):
        return super().get_queryset().order_by("-created_at")

    @extend_schema(request=MuteCreateSerializer, responses={201: SocialMuteSerializer, **ERRORS})
    def create(self, request, *args, **kwargs):
        from apps.social.soul_circle import souls_in

        body = MuteCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        # 只能禁言**此刻在本文明**的灵魂账号。跨文明、官员、不存在 —— 同一个 404。
        target = souls_in(self.tenant, include_retired=True).filter(pk=body.validated_data["user_id"]).first()
        if target is None:
            raise SocialError("对象不存在。", "not_found", 404)
        row = mod.mute_user(
            target, self.tenant, body.validated_data["days"], actor=request.user, request=request,
            reason=body.validated_data.get("reason", ""),
        )
        return Response(SocialMuteSerializer(row).data, status=201)

    @extend_schema(request=None, responses={200: SocialMuteSerializer, **ERRORS})
    @action(detail=True, methods=["post"])
    def lift(self, request, pk=None):
        row = mod.lift_mute(self.get_object(), actor=request.user, request=request)
        return Response(SocialMuteSerializer(row).data)
