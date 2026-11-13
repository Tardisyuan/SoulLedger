"""公共底座的接口:人对一份 AI 产出的处置(`POST /api/v1/assist/ai-drafts/<id>/decide/`)。

只有产出它的那个人能处置(别人的、别殿的一律 404,与不存在同一个答复)。处置不写业务:
采纳的内容由页面照原来的写接口提交,这里只记采纳状态与改动比例(`drafts.py`)。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from apps.soul_assist import drafts
from apps.soul_assist.models import AIDraft
from apps.soul_assist.serializers import AssistErrorSerializer
from apps.soul_assist.views import OfficerAssistBaseView


class DraftDecisionSerializer(serializers.Serializer):
    adopted = serializers.BooleanField()
    #: 人最后提交的文本(采纳时);只用来算改动比例,不存。
    final_text = serializers.CharField(required=False, allow_blank=True, max_length=20000, default="")


class DraftDecisionResultSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    status = serializers.ChoiceField(choices=[s for s, _ in AIDraft.STATUSES])
    edit_ratio = serializers.FloatField(allow_null=True)


class AIDraftDecideView(OfficerAssistBaseView):
    @extend_schema(operation_id="assist_ai_draft_decide", request=DraftDecisionSerializer,
                   responses={200: DraftDecisionResultSerializer, 404: AssistErrorSerializer,
                              409: AssistErrorSerializer})
    def post(self, request, pk):
        body = DraftDecisionSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        draft = AIDraft.objects.filter(pk=pk, created_by=request.user).first()
        if draft is None:
            return Response({"detail": "Not found.", "code": "not_found"}, status=404)
        if not drafts.decide(draft, request, adopted=body.validated_data["adopted"],
                             final_text=body.validated_data["final_text"]):
            return Response({"detail": "Already decided.", "code": "already_decided"}, status=409)
        return Response({"id": draft.pk, "status": draft.status, "edit_ratio": draft.edit_ratio})
