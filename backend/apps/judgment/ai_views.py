"""审判台上的两个 AI 接入点(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分 1、2)。

    POST /api/v1/judgment/<id>/statute-suggestions/   建议援引(ai_statutes.py)
    POST /api/v1/judgment/<id>/verdict-draft/          判词草稿(ai_verdict.py),{"verdict": "FAILED"}

`JudgmentViewSet` 的动作(`JudgmentAIActionsMixin`):案子经 `get_object()`(殿级隔离 + 行级数据范围),
码名 `judgment.execute`(与引用、写草稿同一个)。两者都只产出建议,不写业务:引用照旧 `POST citations/`,
判词照旧 `PATCH draft/`。只有能编辑这件案子的人能用(`claims.assert_may_edit`),已结案的答 409。
"""
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.problems import ProblemSerializer, problem
from apps.judgment import ai_statutes, ai_verdict, claims
from apps.judgment.models import Verdict
from apps.soul_assist.views import OfficerAssistThrottle


def _lang(request):
    from apps.core.locale import locale_from_request

    return "zh-Hans" if locale_from_request(request).lower().startswith("zh") else "en"


class StatuteSuggestionSerializer(serializers.Serializer):
    statute = serializers.UUIDField(help_text="POST citations/ {statute} when the judge ticks it")
    code = serializers.CharField()
    title = serializers.CharField()
    text = serializers.CharField(help_text="The article itself, so the judge reads it before citing")
    why = serializers.CharField(allow_blank=True, help_text="The model's reason; empty for keyword matches")
    source = serializers.ChoiceField(choices=["model", "keyword"])


class StatuteSuggestionsResponseSerializer(serializers.Serializer):
    suggestions = StatuteSuggestionSerializer(many=True)
    dropped = serializers.ListField(child=serializers.CharField(),
                                    help_text="Codes the model gave that it never saw, or already cited")
    draft_id = serializers.IntegerField(allow_null=True, help_text="AIDraft; null when nothing came from a model")
    model = serializers.CharField(allow_blank=True)
    fallback = serializers.BooleanField(help_text="True: the model was not used; keyword matches only")


class VerdictDraftRequestSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=Verdict.choices, help_text="The verdict the judge has chosen")


class VerdictDraftChecksSerializer(serializers.Serializer):
    unknown_codes = serializers.ListField(child=serializers.CharField())
    contrary_verdict_words = serializers.ListField(child=serializers.CharField())
    names_soul = serializers.BooleanField()


class VerdictDraftResponseSerializer(serializers.Serializer):
    text = serializers.CharField(allow_blank=True)
    draft_id = serializers.IntegerField(allow_null=True)
    model = serializers.CharField(allow_blank=True)
    fallback = serializers.BooleanField(help_text="True: a template, not a model")
    checks = VerdictDraftChecksSerializer()


class JudgmentAIErrorSerializer(ProblemSerializer):
    pass

def _open_case(view, request, what):
    judgment = view.get_object()
    claims.assert_may_edit(judgment, request, what)
    if judgment.is_final or judgment.verdict is not None:
        return judgment, problem(status.HTTP_409_CONFLICT, "concluded", "This judgment has been concluded.")
    return judgment, None


class JudgmentAIActionsMixin:
    @extend_schema(request=None, responses={200: StatuteSuggestionsResponseSerializer, 409: JudgmentAIErrorSerializer})
    @action(detail=True, methods=["post"], url_path="statute-suggestions", throttle_classes=[OfficerAssistThrottle])
    def statute_suggestions(self, request, pk=None):
        import json

        from apps.soul_assist import drafts

        judgment, refused = _open_case(self, request, "statute_suggestions")
        if refused:
            return refused
        lang = _lang(request)
        done, rows, dropped = ai_statutes.propose(judgment, request, lang=lang)
        model_rows = [r for r in rows if r[2] == "model"]
        draft = None
        if done is not None:
            draft = drafts.record("statute_suggest", request, done, system=ai_statutes.SYSTEM,
                                  input_text=str(judgment.pk),
                                  output=json.dumps([s.code for s, _, _ in model_rows], ensure_ascii=False),
                                  target_type="judgment", target_id=judgment.pk)
        return Response({
            "suggestions": [{"statute": s.pk, "code": s.code, "title": ai_statutes.localized_title(s, lang),
                             "text": ai_statutes.localized_text(s, lang), "why": why, "source": source}
                            for s, why, source in rows],
            "dropped": dropped, "draft_id": draft.pk if draft else None,
            "model": done.model if done else "", "fallback": done is None or not model_rows and bool(rows),
        })

    @extend_schema(request=VerdictDraftRequestSerializer,
                   responses={200: VerdictDraftResponseSerializer, 409: JudgmentAIErrorSerializer})
    @action(detail=True, methods=["post"], url_path="verdict-draft", throttle_classes=[OfficerAssistThrottle])
    def verdict_draft(self, request, pk=None):
        from apps.soul_assist import drafts

        body = VerdictDraftRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        judgment, refused = _open_case(self, request, "verdict_draft")
        if refused:
            return refused
        verdict = body.validated_data["verdict"]
        done, text, checks = ai_verdict.propose(judgment, request, verdict, lang=_lang(request))
        draft = None
        if done is not None:
            draft = drafts.record("verdict_draft", request, done, system=ai_verdict.SYSTEM,
                                  input_text=f"{judgment.pk}:{verdict}", output=text,
                                  target_type="judgment", target_id=judgment.pk)
        return Response({"text": text, "draft_id": draft.pk if draft else None, "model": done.model if done else "",
                         "fallback": done is None, "checks": checks})
