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
from django.db import models
from django.db.models import Case, Count, F, Q, Value, When
from django.db.models.functions import Substr
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.social import moderation as mod
from apps.social.models import (
    DELETED_BY_OFFICER,
    Comment,
    ModerationStatus,
    Post,
    Report,
    ReportResolution,
    ReportStatus,
    ReportTargetType,
    SensitiveWord,
    SocialMute,
)
from apps.social.moderation_serializers import (
    EXCERPT,
    HandledContentSerializer,
    ModeratedCommentSerializer,
    ModeratedPostSerializer,
    ModerationActionSerializer,
    ModerationErrorSerializer,
    MuteCreateSerializer,
    ReportSerializer,
    ResolveReportSerializer,
    SensitiveWordBatchDeleteResultSerializer,
    SensitiveWordBatchDeleteSerializer,
    SensitiveWordBatchUpdateResultSerializer,
    SensitiveWordBatchUpdateSerializer,
    SensitiveWordCopyResultSerializer,
    SensitiveWordCopySerializer,
    SensitiveWordCreateSerializer,
    SensitiveWordSerializer,
    SensitiveWordUpdateSerializer,
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
        # 重读一遍:锁住的那一行没有列表的注解(举报数、表态数)。
        return Response(self.get_serializer(self.get_queryset().get(pk=row.pk)).data)

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

    def get_queryset(self):
        from apps.social.soul_circle import reaction_kind_counts

        return super().get_queryset().annotate(**reaction_kind_counts())

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
    """本文明的敏感词表。创建、修改、删除都经 `moderation.py` —— 那里写审计。
    列表带 `hits_30d`(近 30 天命中次数,按天分桶求和,见 models.SensitiveWordDailyHit)。
    修改只有 PATCH(`partial_update`):没有 PUT,每次都必须给类别,其余字段不给就不动。"""

    queryset = SensitiveWord.objects.select_related("created_by")
    serializer_class = SensitiveWordSerializer
    extra_permissions = {
        "batch_delete": [MODERATE], "batch_update": [MODERATE], "partial_update": [MODERATE], "copy_from": [MODERATE],
    }

    def get_queryset(self):
        qs = super().get_queryset()
        # 聚合查询不带 Meta.ordering(Django 3.1 起),显式按词排,否则分页顺序不定。
        return mod.with_recent_hits(qs).order_by("word") if self.action == "list" else qs

    @extend_schema(request=SensitiveWordCreateSerializer, responses={201: SensitiveWordSerializer, **ERRORS})
    def create(self, request, *args, **kwargs):
        body = SensitiveWordCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        row = mod.add_sensitive_word(
            self.tenant, body.validated_data["word"], actor=request.user, request=request,
            category=body.validated_data["category"], action=body.validated_data["action"],
        )
        return Response(SensitiveWordSerializer(row).data, status=201)

    @extend_schema(request=SensitiveWordUpdateSerializer, responses={200: SensitiveWordSerializer, **ERRORS})
    def partial_update(self, request, *args, **kwargs):
        body = SensitiveWordUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        row = mod.update_sensitive_word(self.get_object(), actor=request.user, request=request, **body.validated_data)
        return Response(SensitiveWordSerializer(mod.with_recent_hits(self.get_queryset()).get(pk=row.pk)).data)

    def perform_destroy(self, instance):
        mod.remove_sensitive_word(instance, actor=self.request.user, request=self.request)

    @extend_schema(
        request=SensitiveWordBatchUpdateSerializer,
        responses={200: SensitiveWordBatchUpdateResultSerializer, 404: ModerationErrorSerializer, **ERRORS},
    )
    @action(detail=False, methods=["post"], url_path="batch-update")
    def batch_update(self, request):
        """批量改「命中后」动作。码名、租户范围、全有或全无、上限 200 —— 都与 batch-delete 相同。"""
        body = SensitiveWordBatchUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        updated = mod.update_sensitive_words(
            self.get_queryset(), body.validated_data["ids"], actor=request.user, request=request,
            action=body.validated_data["action"],
        )
        return Response({"updated": updated})

    @extend_schema(
        request=SensitiveWordBatchDeleteSerializer,
        responses={200: SensitiveWordBatchDeleteResultSerializer, 404: ModerationErrorSerializer, **ERRORS},
    )
    @action(detail=False, methods=["post"], url_path="batch-delete")
    def batch_delete(self, request):
        """同单条删除一样的码名与租户范围;全有或全无,一次最多 200 条。任何一个 id 不在本文明
        词表里 → 404,`missing` 列出它们,一条都不删。"""
        body = SensitiveWordBatchDeleteSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        deleted = mod.remove_sensitive_words(
            self.get_queryset(), body.validated_data["ids"], actor=request.user, request=request
        )
        return Response({"deleted": deleted})


    @extend_schema(
        request=SensitiveWordCopySerializer,
        responses={200: SensitiveWordCopyResultSerializer, 404: ModerationErrorSerializer, **ERRORS},
    )
    @action(detail=False, methods=["post"], url_path="copy-from")
    def copy_from(self, request):
        """从另一个文明复制整张词表到当前文明。**只有 ADMIN**(其余一律 403,码名之外再判一次):
        这是读别的文明词表的唯一入口,而 `social.moderate` 是按文明授的 —— 持码名的 MODERATOR
        不该借它看见别处的词。回包只有计数,不含词本身。"""
        from apps.core.tenant import is_tenant_exempt
        from apps.tenants.models import Tenant

        if not is_tenant_exempt(request.user):
            raise SocialError("只有管理员可以跨文明复制词表。", "admin_only", 403)
        body = SensitiveWordCopySerializer(data=request.data)
        body.is_valid(raise_exception=True)
        if self.tenant is None:
            raise SocialError("没有当前文明。", "no_tenant", 400)
        source = Tenant.objects.filter(code=body.validated_data["source_tenant"]).first()
        if source is None:
            raise SocialError("对象不存在。", "not_found", 404)
        copied, skipped = mod.copy_sensitive_words(source, self.tenant, actor=request.user, request=request)
        return Response({"copied": copied, "skipped": skipped})


class SocialMuteViewSet(ModerationViewSet, mixins.ListModelMixin, mixins.CreateModelMixin):
    """禁言列表与新建禁言;解除是 `POST {id}/lift/`,不是 DELETE —— 行不删,留着是禁言历史。"""

    queryset = SocialMute.objects.select_related("user", "created_by", "lifted_by")
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
        """解除。通知走既有的事件总线:`SOCIAL_UNMUTED` 定向发给被禁言的账号(WebSocket)。"""
        row = mod.lift_mute(self.get_object(), actor=request.user, request=request)
        return Response(SocialMuteSerializer(row).data)


class HandledContentViewSet(ModerationViewSet, mixins.ListModelMixin):
    """「已处理」:被隐藏或被官员删除的灵魂帖子与评论,一张表,按处理时间倒序。

    * 隐藏:`moderation_status=HIDDEN` 且未删除。处理人 / 时间 / 理由读 `moderated_*`
      (0007 之前隐藏的行这三项为空)。恢复可见是既有的 `POST {posts|comments}/{id}/restore/`。
    * 删除:软删除且删除人不是作者本人 —— 作者删自己的东西不是审核处理。读 `deleted_*`。
      删除的行不在这里恢复:帖子与评论不在回收站的登记表里,本分支不另开恢复路径。

    两个模型各自过 `scope_to_tenant`,再 UNION 成一个查询 —— 分页与计数在数据库里做。
    """

    queryset = Post.all_objects.all()
    serializer_class = HandledContentSerializer
    #: 过滤参数 → 允许的取值。
    TYPES = {ReportTargetType.POST: Post, ReportTargetType.COMMENT: Comment}
    HANDLINGS = ("HIDDEN", "DELETED")

    def _part(self, base, model, kind, handling):
        qs = base.filter(author__role="SOUL")
        hidden = Q(is_deleted=False, moderation_status=ModerationStatus.HIDDEN)
        deleted = Q(is_deleted=True) & DELETED_BY_OFFICER
        qs = qs.filter({"HIDDEN": hidden, "DELETED": deleted}.get(handling, hidden | deleted))

        def pick(if_deleted, if_hidden, field):
            return Case(When(is_deleted=True, then=F(if_deleted)), default=F(if_hidden), output_field=field)

        return qs.annotate(
            row_type=Value(kind, output_field=models.CharField()),
            row_id=F("id"),
            post_ref=F("id") if model is Post else F("post_id"),
            author_ref=F("author_id"),
            author_name=F("author__display_name"),
            excerpt=Substr("content", 1, EXCERPT),
            handling=Case(
                When(is_deleted=True, then=Value("DELETED")), default=Value("HIDDEN"),
                output_field=models.CharField(),
            ),
            handled_reason=pick("delete_reason", "moderation_reason", models.CharField()),
            handled_by_ref=pick("deleted_by_id", "moderated_by_id", models.IntegerField()),
            handled_by_name=pick("deleted_by__display_name", "moderated_by__display_name", models.CharField()),
            handled_at=pick("deleted_at", "moderated_at", models.DateTimeField()),
        ).order_by().values(*self.COLUMNS)  # 各部分不能带 Meta.ordering:UNION 的子查询不许 ORDER BY

    COLUMNS = (
        "row_type", "row_id", "post_ref", "author_ref", "author_name", "excerpt",
        "handling", "handled_reason", "handled_by_ref", "handled_by_name", "handled_at",
    )

    def get_queryset(self):
        params = self.request.query_params
        kind, handling = params.get("type"), params.get("handling")
        # `all_objects`:删除的行也要。每个模型各自过一次租户隔离。
        parts = [
            self._part(scope_to_tenant(model.all_objects.all(), self.request), model, k, handling)
            for k, model in self.TYPES.items()
            if kind in (None, "", k)
        ]
        if not parts or (handling not in (None, "") and handling not in self.HANDLINGS):
            return self._part(Post.all_objects.none(), Post, ReportTargetType.POST, None)
        qs = parts[0].union(*parts[1:], all=True) if len(parts) > 1 else parts[0]
        return qs.order_by(F("handled_at").desc(nulls_last=True), "-row_id")

    @extend_schema(
        parameters=[
            OpenApiParameter("type", str, enum=[k.value for k in TYPES], description="只看帖子或只看评论"),
            OpenApiParameter("handling", str, enum=list(HANDLINGS), description="只看隐藏或只看删除"),
        ],
        responses={200: HandledContentSerializer(many=True)},
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)
