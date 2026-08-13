"""
REST serializers for Reincarnation app.
"""
from rest_framework import serializers

from apps.reincarnation.models import SIX_PATHS, RebirthForm, Reincarnation


class RebirthRequestSerializer(serializers.Serializer):
    """The write payload of /complete/ and /reborn/.

    Those two actions are the only writes in this app that do not go through
    a ModelSerializer: they read `request.data.get(...)` and hand the raw
    strings to ReincarnationService.complete_rebirth, which calls
    Reincarnation.objects.create(). `create()` runs no validators and never
    checks `choices` — Django only enforces choices in `full_clean()`, which
    the ORM does not call — so any string at all used to reach the column.
    Driven, not inferred: POST /reincarnation/reborn/ with
    rebirth_form="PASTA_MONSTER" answered 201 and stored "PASTA_MONSTER".

    The CRUD route was never affected: ReincarnationSerializer is a
    ModelSerializer, so its rebirth_form is a ChoiceField built from the same
    model choices and already refused garbage. This restores that same
    boundary for the two actions that stepped around it, at the same layer
    the rest of the app validates at (cf. CommentCreateSerializer in
    apps/social/serializers.py) rather than as hand-written ifs in the view.

    Accepted values end up narrower than the model's: RebirthForm.OTHER
    stays a legal *stored* value so rows written before the six paths existed
    remain readable through the admin and the API filter, but nothing may
    newly write it — it is not a seventh path. Omitting the field entirely
    still falls back to whatever the existing record holds, which is what
    keeps a legacy OTHER row completable.

    OTHER is kept in the ChoiceField's own choices and refused one layer
    later, in validate_rebirth_form. Narrowing the choices to SIX_PATHS would
    have been shorter and would have made that method unreachable dead code —
    a guard that can never fire, which is the failure mode this codebase has
    been bitten by before. Here the two refusals are distinguishable and both
    are exercised: garbage gets ChoiceField's "not a valid choice", OTHER
    gets the sentence explaining why a value the database accepts is still
    not something an operator may write.
    """

    rebirth_form = serializers.ChoiceField(
        choices=RebirthForm.choices,
        required=False,
    )
    new_identity = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=Reincarnation._meta.get_field("new_identity").max_length,
    )
    notes = serializers.CharField(required=False, allow_blank=True)

    def validate_rebirth_form(self, value):
        """Refuses everything outside SIX_PATHS rather than naming OTHER, so
        a choice added to the model later for storage reasons is refused here
        by default instead of silently becoming writable."""
        if value not in SIX_PATHS:
            raise serializers.ValidationError(
                f"'{value}' is a stored-only value, not one of the six paths "
                f"(六道). Choose one of: {', '.join(form.value for form in SIX_PATHS)}."
            )
        return value


class ReincarnationSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)

    class Meta:
        model = Reincarnation
        fields = [
            "id", "soul", "soul_name", "disposition", "target_realm",
            "rebirth_form", "cycle_count", "previous_realm", "new_identity",
            "notes", "reincarnated_at",
        ]
