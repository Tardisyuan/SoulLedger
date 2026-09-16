"""官员侧:`/api/v1/soul-accounts/`。

权限码:`soul_account.read`(列表、账号链、待交付列表)、`soul_account.manage`(开通、
重置、查看一次明文、标记交付、重试发送);转生申请的「是否跨文明」用 `workflow.approve`
并要求调用者正是初审节点指定的审批人。租户隔离全部经 `scope_to_tenant(field="soul__tenant")`。
"""
from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.soul_accounts import rebirth
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, InitialCredential, RebirthApplication, SoulAccount
from apps.soul_accounts.serializers import (
    CrossCivilizationDecisionSerializer,
    InitialCredentialSerializer,
    OfficerRebirthApplicationSerializer,
    ProvisionRequestSerializer,
    ResetRequestSerializer,
    RevealedCredentialSerializer,
    SoulAccountSerializer,
    SoulErrorSerializer,
)


def _error(exc):
    return Response({"detail": str(exc), "code": exc.code}, status=exc.status)


def _apply_contacts(soul, data):
    updates = [f for f in ("contact_email", "contact_phone") if f in data]
    for field in updates:
        setattr(soul, field, data[field])
    if updates:
        soul.save(update_fields=updates)  # 审计 diff 里值被 PII_FIELD_NAMES 遮蔽


class SoulAccountViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """账号链:`GET /soul-accounts/accounts/?soul=<uuid>` 按 cycle 升序给出该灵魂各世账号。"""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "soul_account"
    extra_permissions = {
        "list": ["soul_account.read"],
        "retrieve": ["soul_account.read"],
        "provision": ["soul_account.manage"],
        "reset_credential": ["soul_account.manage"],
    }
    serializer_class = SoulAccountSerializer
    queryset = SoulAccount.objects.all()
    filterset_fields = ["soul", "cycle"]

    def get_queryset(self):
        qs = SoulAccount.objects.select_related("soul", "user").order_by("soul", "cycle")
        return scope_to_tenant(qs, self.request, field="soul__tenant")

    @extend_schema(request=ProvisionRequestSerializer,
                   responses={201: SoulAccountSerializer, 200: SoulAccountSerializer, 404: SoulErrorSerializer,
                              409: SoulErrorSerializer})
    @action(detail=False, methods=["post"])
    def provision(self, request):
        """手动开通。本世已有账号时幂等返回 200,不重发密码;要新密码用 reset_credential。"""
        from apps.souls.models import Soul

        body = ProvisionRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        soul = scope_to_tenant(Soul.objects.all(), request).filter(pk=body.validated_data["soul_id"]).first()
        if soul is None:
            return Response({"detail": "灵魂不存在。", "code": "not_found"}, status=404)
        try:
            with transaction.atomic():
                _apply_contacts(soul, body.validated_data)
                account, created = svc.provision_account(
                    soul, AccountOrigin.OFFICER, actor=request.user, request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        account = self.get_queryset().get(pk=account.pk)
        return Response(SoulAccountSerializer(account).data, status=201 if created else 200)

    @extend_schema(request=ResetRequestSerializer,
                   responses={200: InitialCredentialSerializer, 409: SoulErrorSerializer})
    @action(detail=True, methods=["post"], url_path="reset-credential")
    def reset_credential(self, request, pk=None):
        account = self.get_object()
        body = ResetRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                _apply_contacts(account.soul, body.validated_data)
                credential = svc.reset_credential(account, actor=request.user, request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        credential.refresh_from_db()
        return Response(InitialCredentialSerializer(credential).data)


class InitialCredentialViewSet(CodenameViewSetMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                               viewsets.GenericViewSet):
    """待交付:`GET /soul-accounts/credentials/?status=PENDING`。"""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "soul_account"
    extra_permissions = {
        "list": ["soul_account.read"],
        "retrieve": ["soul_account.read"],
        "reveal": ["soul_account.manage"],
        "mark_delivered": ["soul_account.manage"],
        "retry": ["soul_account.manage"],
    }
    serializer_class = InitialCredentialSerializer
    queryset = InitialCredential.objects.all()
    filterset_fields = ["status", "soul", "account"]

    def get_queryset(self):
        svc.expire_due_credentials()
        qs = InitialCredential.objects.select_related("soul", "account", "revealed_by", "delivered_by")
        return scope_to_tenant(qs, self.request, field="soul__tenant")

    @extend_schema(request=None, responses={200: RevealedCredentialSerializer, 409: SoulErrorSerializer,
                                            410: SoulErrorSerializer})
    @action(detail=True, methods=["post"])
    def reveal(self, request, pk=None):
        credential = self.get_object()
        try:
            credential, password = svc.reveal_credential(credential.pk, actor=request.user, request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        response = Response({"soul_code": credential.soul.soul_code, "password": password,
                             "expires_at": credential.expires_at})
        response["Cache-Control"] = "no-store"
        return response

    @extend_schema(request=None, responses={200: InitialCredentialSerializer, 409: SoulErrorSerializer})
    @action(detail=True, methods=["post"], url_path="mark-delivered")
    def mark_delivered(self, request, pk=None):
        credential = self.get_object()
        try:
            credential = svc.mark_delivered(credential.pk, actor=request.user, request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response(InitialCredentialSerializer(credential).data)

    @extend_schema(request=None, responses={200: InitialCredentialSerializer, 409: SoulErrorSerializer})
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        credential = self.get_object()
        try:
            credential = svc.retry_credential(credential.pk, actor=request.user, request=request)
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response(InitialCredentialSerializer(credential).data)


class OfficerRebirthApplicationViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "workflow"
    extra_permissions = {
        "list": ["workflow.read"],
        "retrieve": ["workflow.read"],
        "cross_civilization": ["workflow.approve"],
    }
    serializer_class = OfficerRebirthApplicationSerializer
    queryset = RebirthApplication.objects.all()
    filterset_fields = ["status", "soul"]

    def get_queryset(self):
        qs = RebirthApplication.objects.select_related("soul")
        return scope_to_tenant(qs, self.request, field="soul__tenant")

    @extend_schema(request=CrossCivilizationDecisionSerializer,
                   responses={200: OfficerRebirthApplicationSerializer, 403: SoulErrorSerializer,
                              409: SoulErrorSerializer})
    @action(detail=True, methods=["post"], url_path="cross-civilization")
    def cross_civilization(self, request, pk=None):
        application = self.get_object()
        body = CrossCivilizationDecisionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            application = rebirth.decide_cross_civilization(
                application.pk, request.user, body.validated_data["cross_civilization"])
        except svc.SoulAccountError as exc:
            return _error(exc)
        return Response(OfficerRebirthApplicationSerializer(application).data, status=status.HTTP_200_OK)
