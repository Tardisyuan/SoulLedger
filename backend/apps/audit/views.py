"""
Audit views
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import AuditLog
from .serializers import AuditLogSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_audit_logs(request):
    """
    GET /api/v1/audit/
    获取审计日志列表（仅 ADMIN）
    """
    if request.user.role != "ADMIN":
        return Response(
            {"error": "Only ADMIN can view audit logs"},
            status=status.HTTP_403_FORBIDDEN
        )

    resource = request.query_params.get("resource")
    action = request.query_params.get("action")
    user_id = request.query_params.get("user_id")

    logs = AuditLog.objects.all()
    if resource:
        logs = logs.filter(resource=resource)
    if action:
        logs = logs.filter(action=action)
    if user_id:
        logs = logs.filter(user_id=user_id)

    logs = logs[:100]  # 限制返回100条
    serializer = AuditLogSerializer(logs, many=True)
    return Response(serializer.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_audit_log(request):
    """
    POST /api/v1/audit/
    创建审计日志（内部调用）
    """
    serializer = AuditLogSerializer(data=request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
