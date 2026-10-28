"""
REST serializers for Reincarnation app.
"""
from rest_framework import serializers

from apps.core.tenant_fields import tenant_scoped
from apps.reincarnation.models import SIX_PATHS, RebirthForm, Reincarnation
from apps.souls.models import Soul


class RebirthRequestSerializer(serializers.Serializer):
    """The write payload of /reborn/ (and of /complete/ until 2026-10-27).

    Those actions were the only writes in this app that do not go through
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
    newly write it — it is not a seventh path. (`/complete/`, which fell back
    to an existing record's form, was removed 2026-10-27: it wrote a second
    record. `/reborn/` is the one action left; omitted, it is HUMAN for a soul
    of Diyu and OTHER for a Greek one — see `rebirth_form_for`.)

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
    #: 人道生在哪一洲(docs/07 §人道「四大部洲」);只有地府转人道可以给,别的 400 `rebirth_continent_not_applicable`。
    rebirth_continent = serializers.ChoiceField(choices=Soul.Continent.choices, required=False, allow_blank=True)
    #: 选的道与灵魂已批准申请里的意愿不同时必填(400 `rebirth_form_reason_required`);记进转世事件(2026-10-29)。
    rebirth_form_reason = serializers.CharField(required=False, allow_blank=True, max_length=500)

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


class RebirthQuotaUsageSerializer(serializers.Serializer):
    """One row of `GET /reincarnation/quota/`: this month's count for a path against its limit (null = unlimited)."""

    rebirth_form = serializers.CharField()
    limit = serializers.IntegerField(allow_null=True)
    used = serializers.IntegerField()


class ReincarnationSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    # 转生登记簿(第四十批 W-c)的「灵魂」列写名字 + 编号。编号是灵魂的标识(没开过号的为空),不是账号数据。
    soul_code = serializers.CharField(source="soul.soul_code", read_only=True, allow_null=True)

    validate_soul = tenant_scoped("soul")
    validate_disposition = tenant_scoped("disposition")

    class Meta:
        model = Reincarnation
        fields = [
            "id", "soul", "soul_name", "soul_code", "disposition", "target_realm",
            "rebirth_form", "rebirth_continent", "cycle_count", "previous_realm", "new_identity",
            "notes", "reincarnated_at",
        ]


class DrinkSoupSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()


class DrinkSoupResultSerializer(serializers.Serializer):
    soul_id = serializers.UUIDField()
    soup_taken_at = serializers.DateTimeField()
