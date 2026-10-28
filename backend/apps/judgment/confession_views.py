"""42 条否定告白逐条记录的接口(2026-10-28)。规则见 `confessions.py`。

    GET /api/v1/judgment/<id>/negative-confessions/             42 行 + 合计(judgment.read)
    PUT /api/v1/judgment/<id>/negative-confessions/<ordinal>/   记一条:{"truthful": true|false|null, "note": ""}
                                                               (judgment.execute)

`JudgmentViewSet` 的动作(`NegativeConfessionActionsMixin`):案子经 `get_object()`,租户划界与评议同一条路。
"""
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.request_local import clear_current_user, set_current_request, set_current_user
from apps.judgment import confessions, weighing


def _locale(request) -> str:
    from apps.judgment.serializers import _locale_from

    return _locale_from({"request": request})


class NegativeConfessionRowSerializer(serializers.Serializer):
    ordinal = serializers.IntegerField(help_text="assessor_index, 1-42")
    statute_id = serializers.UUIDField()
    code = serializers.CharField(help_text="EG-NC-NN")
    assessor = serializers.CharField(help_text="The assessor before whom the denial is made (localized).")
    text = serializers.CharField(help_text="The denial (localized; read off the assessor row).")
    truthful = serializers.BooleanField(allow_null=True, help_text="true 如实 / false 不实 / null 未记")
    note = serializers.CharField(allow_blank=True)
    recorded_at = serializers.DateTimeField(allow_null=True)


class NegativeConfessionTallySerializer(serializers.Serializer):
    truthful = serializers.IntegerField()
    untruthful = serializers.IntegerField()
    unheard = serializers.IntegerField()
    total = serializers.IntegerField()


class NegativeConfessionListSerializer(serializers.Serializer):
    applies = serializers.BooleanField(help_text="False: this case is not weighed and hears no denials.")
    concluded = serializers.BooleanField()
    items = NegativeConfessionRowSerializer(many=True)
    tally = NegativeConfessionTallySerializer(allow_null=True)


class NegativeConfessionWriteSerializer(serializers.Serializer):
    truthful = serializers.BooleanField(allow_null=True)
    note = serializers.CharField(allow_blank=True, required=False, max_length=2000)


class NegativeConfessionErrorSerializer(serializers.Serializer):
    error = serializers.CharField()
    code = serializers.CharField(help_text="concluded (409) / not_weighed (400) / unknown_clause (404)")


def _listing(judgment, request) -> dict:
    applies = weighing.applies(judgment)
    rows = []
    if applies:
        locale = _locale(request)
        heard = confessions.heard(judgment)
        for statute in confessions.clauses(judgment):
            row = heard.get(statute.pk)
            rows.append({
                "ordinal": statute.ordinal, "statute_id": statute.pk, "code": statute.code,
                "assessor": statute.get_localized_title(locale), "text": statute.get_localized_text(locale),
                "truthful": row.truthful if row else None, "note": row.note if row else "",
                "recorded_at": row.update_time if row else None,
            })
    return {"applies": applies, "concluded": bool(judgment.is_final or judgment.verdict),
            "items": rows, "tally": confessions.tally(judgment)}


class NegativeConfessionActionsMixin:
    @extend_schema(responses={200: NegativeConfessionListSerializer})
    @action(detail=True, methods=["get"], url_path="negative-confessions", pagination_class=None)
    def negative_confessions(self, request, pk=None):
        """The 42 denials of this case, in assessor order, with what was heard. Bounded: the hall's 42 articles."""
        return Response(NegativeConfessionListSerializer(_listing(self.get_object(), request)).data)

    @extend_schema(
        request=NegativeConfessionWriteSerializer,
        responses={200: NegativeConfessionListSerializer, 400: NegativeConfessionErrorSerializer,
                   404: NegativeConfessionErrorSerializer, 409: NegativeConfessionErrorSerializer},
        parameters=[OpenApiParameter("ordinal", int, OpenApiParameter.PATH, description="assessor_index, 1-42")],
    )
    @action(detail=True, methods=["put"], url_path=r"negative-confessions/(?P<ordinal>\d+)")
    def record_negative_confession(self, request, pk=None, ordinal=None):
        """Record whether one denial is true. PUT: a state, repeating it is a no-op. Answers the whole listing."""
        judgment = self.get_object()
        serializer = NegativeConfessionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # A custom action is not `perform_*`: set the author for AuditUserFields, as `rule_evidence` does.
        set_current_user(request.user)
        set_current_request(request)
        try:
            confessions.record(judgment, int(ordinal), serializer.validated_data["truthful"],
                               serializer.validated_data.get("note", ""))
        except confessions.ConfessionRefusedError as exc:
            return Response({"error": str(exc), "code": exc.code}, status=exc.status)
        finally:
            clear_current_user()
        judgment.refresh_from_db()
        return Response(NegativeConfessionListSerializer(_listing(judgment, request)).data)
