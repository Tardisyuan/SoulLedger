"""`POST auth/impersonate/` 与 `POST auth/impersonate/end/`。机制与规则见 `impersonation.py`。

**「系统管理员」= `role == "ADMIN"`**:这个代码库里 ADMIN 是唯一跨殿的角色(`apps/core/tenant.py`),
也只有它能进用户管理。所以:ADMIN 能代看任何非 ADMIN 的在职官员(跨殿也行,与用户管理看得到的范围一致);
不能代看另一位 ADMIN,不能代看自己,不能代看灵魂账号。
"""
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication import impersonation
from apps.authentication.impersonation_models import Impersonation
from apps.authentication.models import User
from apps.core.permissions import IsAdminPermission


class ImpersonateStartSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    reason = serializers.CharField(max_length=200, trim_whitespace=True)


class ImpersonationTargetSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    role = serializers.CharField()
    tenant_code = serializers.CharField(allow_null=True)
    hall = serializers.DictField(child=serializers.CharField(), allow_null=True)


class ImpersonateStartResponseSerializer(serializers.Serializer):
    access = serializers.CharField()
    impersonation_id = serializers.IntegerField()
    started_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    reason = serializers.CharField()
    target = ImpersonationTargetSerializer()


class ImpersonateEndResponseSerializer(serializers.Serializer):
    ended = serializers.BooleanField()
    minutes = serializers.IntegerField()
    pages = serializers.IntegerField()


def _fail(code, detail):
    return Response({"detail": detail, "code": code}, status=status.HTTP_400_BAD_REQUEST)


class ImpersonateStartView(APIView):
    permission_classes = [IsAuthenticated, IsAdminPermission]

    @extend_schema(
        request=ImpersonateStartSerializer,
        responses={201: ImpersonateStartResponseSerializer, 400: None, 404: None},
    )
    def post(self, request):
        """签发一张只读、最长 30 分钟、无刷新令牌的 access 令牌;被看的人收到通知,开始记一条审计。"""
        data = ImpersonateStartSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        target = User.objects.select_related("tenant").filter(pk=data.validated_data["user_id"]).first()
        if target is None:
            raise NotFound()
        if target.pk == request.user.pk:
            return _fail("impersonate_self", "不能代看自己。")
        if target.role == "ADMIN":
            return _fail("impersonate_admin", "不能代看另一位系统管理员。")
        if target.role == "SOUL" or not target.is_active:
            return _fail("impersonate_unavailable", "这个账号现在不能被代看。")

        access, record = impersonation.start(request.user, target, data.validated_data["reason"], request)
        name = target.display_name or target.username
        return Response(
            {
                "access": access,
                "impersonation_id": record.pk,
                "started_at": record.started_at,
                "expires_at": record.expires_at,
                "reason": record.reason,
                "target": {
                    "id": target.pk, "name": name, "role": target.role,
                    "tenant_code": target.tenant.code if target.tenant_id else None,
                    "hall": target.tenant.hall_names if target.tenant_id else None,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class ImpersonateEndView(APIView):
    """用代看令牌调:结束那一次。用管理员自己的令牌调:结束他名下还开着的(令牌已过期时走这条)。
    这是代看令牌唯一能 POST 的地方。"""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses=ImpersonateEndResponseSerializer)
    def post(self, request):
        record = getattr(request, "impersonation", None)
        if record is not None:
            records = [record]
        else:
            records = list(Impersonation.objects.select_related("actor", "target").filter(actor=request.user, ended_at__isnull=True))
        ended = False
        for item in records:
            how = "expired" if item.expires_at <= timezone.now() else "manual"
            ended = impersonation.end(item, how, request=request) or ended
        last = records[-1] if records else None
        if last is not None:
            last.refresh_from_db()
        minutes = round((last.ended_at - last.started_at).total_seconds() / 60) if last and last.ended_at else 0
        return Response({"ended": ended, "minutes": minutes, "pages": len(last.pages) if last else 0})
