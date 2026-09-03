"""
REST serializers for Judgment app.
"""
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.judgment.models import Judgment, JudgmentCitation, Statute
from apps.ledger.serializers import LedgerSummarySerializer
from apps.realms.serializers import RealmLocalizedSerializer
from apps.reincarnation.serializers import ReincarnationSerializer
from apps.souls.serializers import SoulSerializer


def _locale_from(context) -> str:
    """The caller's locale, read the same way RealmLocalizedSerializer reads it.

    Statutes are multilingual reference data and the three bundles are not
    interchangeable: the Chinese articles have no English body, the Egyptian
    ones have no Chinese body at all. Resolving server-side keeps that
    fallback chain in one place (`Statute.get_localized_*`) instead of
    re-deriving it in the client."""
    request = context.get("request")
    if request is None:
        return "en"
    lang = request.META.get("HTTP_ACCEPT_LANGUAGE", "en")
    return lang.split(",")[0].strip() or "en"


class StatuteSerializer(serializers.ModelSerializer):
    """One citable article.

    `display_text` is where a *derived* article becomes readable: for the
    Egyptian 42 the body lives on `Actor.powers_json["negative_confession"]`
    and this is the field that reads it. `text_en` on those rows is empty and
    stays empty — see Statute's docstring on why there is no second copy.
    """
    display_title = serializers.SerializerMethodField()
    display_text = serializers.SerializerMethodField()
    is_derived = serializers.SerializerMethodField()
    citation_count = serializers.SerializerMethodField()

    class Meta:
        model = Statute
        fields = [
            "id", "code", "civilization", "corpus", "ordinal", "polarity",
            "title_zh", "title_en", "title_egy",
            "text_zh", "text_en", "text_egy",
            "display_title", "display_text", "is_derived", "citation_count",
            "source", "source_notes", "payload_json",
        ]

    def get_citation_count(self, obj) -> int | None:
        """How many times this tenant has cited the article — or ``None``.

        A method field rather than ``IntegerField`` because the annotation is
        only present on one of this serializer's two paths.
        ``StatuteViewSet.get_queryset`` adds it; the nested use at
        ``JudgmentCitationSerializer.statute`` reaches the row through the FK,
        where no annotation exists and a declared ``IntegerField`` would raise
        ``AttributeError`` on every citation read.

        ``None``, not ``0``. "Nobody has cited this" and "this response does
        not carry the count" are different facts, and collapsing them puts a
        confident zero next to an article that may be the most-cited one in the
        corpus. The frontend renders the absent case through ``MissingValue``
        for the same reason.
        """
        return getattr(obj, "citation_count", None)

    def get_display_title(self, obj) -> str:
        return obj.get_localized_title(_locale_from(self.context))

    def get_display_text(self, obj) -> str:
        return obj.get_localized_text(_locale_from(self.context))

    def get_is_derived(self, obj) -> bool:
        return obj.source_actor_id is not None


class JudgmentCitationSerializer(serializers.ModelSerializer):
    """A ground, with the article inlined.

    Nested rather than a bare statute id: the point of the feature is that a
    reader can see WHY a verdict was given without a second round trip, and a
    list of UUIDs is not a reason.
    """
    statute = StatuteSerializer(read_only=True)

    class Meta:
        model = JudgmentCitation
        fields = ["id", "statute", "note", "created_at"]


class JudgmentSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    judge_name = serializers.CharField(source="judge.name", read_only=True)
    citations = JudgmentCitationSerializer(many=True, read_only=True)

    class Meta:
        model = Judgment
        fields = [
            "id", "soul", "soul_name", "civilization", "judge", "judge_name",
            "court", "evidence_json", "confession", "verdict", "notes",
            "citations",
            "is_final", "created_at", "concluded_at",
        ]


class JudgmentCitationWriteSerializer(serializers.Serializer):
    """Input for `POST /judgment/{id}/citations/`.

    Validates shape only. Whether the article exists, belongs to this tenant
    and belongs to this cosmology is `StatuteCitationService.resolve`'s
    business — it is the same question the `conclude` payload asks, and a
    check written here would cover exactly one of the two callers.
    """
    statute = serializers.UUIDField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class JudgmentConcludeSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=["PASSED", "FAILED", "PURGATORY", "RETRY"])
    # allow_blank, because a verdict with no note is the ordinary case and
    # Judgment.notes is blank=True. Without it, DRF's CharField rejected an
    # explicit "" while accepting an omitted key — and both clients send the
    # key: app/judgment/[id]/page.tsx posts `notes` from a controlled textarea
    # that starts empty, and the triage queue does the same. So every verdict
    # filed without typing a note came back 400 "This field may not be blank",
    # from an endpoint whose own default for the field is "".
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    create_workflow = serializers.BooleanField(default=False)
    # The grounds, filed with the verdict. Optional — a judgment concluded
    # without citing anything is still a judgment, and requiring articles here
    # would break every existing caller and every existing test. What it must
    # not be is a place to attach reasoning AFTER the fact; see
    # StatuteCitationService.assert_amendable.
    statute_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )


class JudgmentQueueCursorSerializer(serializers.Serializer):
    """The envelope `GET /api/v1/judgment/next/` returns.

    Schema-only, never instantiated. This is the response a judgment client
    hits most, and until this class existed it was documented as a bare
    `Judgment` — drf-spectacular's fallback to the viewset serializer, which is
    silent and was wrong. A generated client typed against that would have
    reached for `verdict` on an object whose top level is a cursor.

    Every field below is nullable or empty when the queue is exhausted: the
    view builds the payload with `judgment`/`soul`/`ledger` at `None` and the
    two lists empty, then fills them only once it has a case (see
    `JudgmentViewSet.next_pending`). `position` is additionally null when
    `remaining` is 0, because "the Nth of M" has no N when there is nothing
    left to rule on.

    The cross-app imports here are the same ones `views.py` already makes to
    build this payload; they are not a new dependency, and keeping the shape
    beside the other judgment serializers is what makes it possible to check
    that it still matches.
    """

    total = serializers.IntegerField()
    remaining = serializers.IntegerField()
    skipped = serializers.IntegerField()
    position = serializers.IntegerField(allow_null=True)
    judgment = JudgmentSerializer(allow_null=True)
    soul = SoulSerializer(allow_null=True)
    ledger = LedgerSummarySerializer(allow_null=True)
    prior_cycles = ReincarnationSerializer(many=True)
    realm_options = RealmLocalizedSerializer(many=True)
