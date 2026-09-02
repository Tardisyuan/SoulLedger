"""
DRF field for BC-aware historical dates (see apps.souls.dates).

Backs a single API field (e.g. "birth_date") onto three model columns
(``birth_year``/``birth_month``/``birth_day``) via ``source="*"``.
"""
from drf_spectacular.extensions import OpenApiSerializerFieldExtension
from rest_framework import serializers

from apps.souls.dates import parse_historical_date, to_representation


class HistoricalDateField(serializers.Field):
    """
    Read/write a possibly-BCE date stored as ``<prefix>_year/_month/_day``.

    Representation: ``{"year": int, "month": int|None, "day": int|None}``,
    or ``None`` if unset. A structured object (rather than a string) is
    used deliberately — ``month``/``day`` are frequently unknown for
    ancient records, and a signed year sorts and compares correctly as a
    plain JSON number without inventing a new string date format.

    Accepts on write, for backward compatibility with existing clients:
      - a plain "YYYY-MM-DD" string (always CE, as before)
      - a "-YYYY-MM-DD" string (signed, BCE-capable)
      - a structured {"year": ..., "month": ..., "day": ...} object
      - None
    """

    def __init__(self, prefix: str, **kwargs):
        self.prefix = prefix
        kwargs["source"] = "*"
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(**kwargs)

    def to_representation(self, instance):
        year = getattr(instance, f"{self.prefix}_year")
        month = getattr(instance, f"{self.prefix}_month")
        day = getattr(instance, f"{self.prefix}_day")
        return to_representation(year, month, day)

    def to_internal_value(self, data):
        try:
            year, month, day = parse_historical_date(data)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc
        return {
            f"{self.prefix}_year": year,
            f"{self.prefix}_month": month,
            f"{self.prefix}_day": day,
        }


class HistoricalDateFieldExtension(OpenApiSerializerFieldExtension):
    """Teach drf-spectacular what a `HistoricalDateField` is.

    WITHOUT THIS IT IS `string`. `serializers.Field` has no schema of its own,
    so the generator gives up and defaults — and a historical date is the one
    field in this API where "defaulting to string" is most obviously wrong: the
    whole reason the class exists, stated in its docstring above, is that a
    string date cannot express an unknown month, an unknown day, or a signed
    (BCE) year. A generated client typed `string` would have every soul's birth
    and death dates as opaque text, and `formatHistoricalDate` in
    `packages/core/src/domain/dates.ts` takes `{year, month, day}`.

    ONE SHAPE FOR BOTH DIRECTIONS, AND THAT IS A DECISION. Read and write are
    genuinely different here:

      response  {"year": int, "month": int|null, "day": int|null} | null
      request   the same object, OR "YYYY-MM-DD", OR "-YYYY-MM-DD", OR null

    `map_serializer_field` receives `direction`, so telling both truths is
    possible — but only if request and response get separate components, and
    `SPECTACULAR_SETTINGS` leaves `COMPONENT_SPLIT_REQUEST` at its default
    `False`. With one `Soul` component serving both, a direction-dependent
    schema does not produce two answers; it produces one, arbitrarily. Measured:
    with the split version of this method, `Soul.birth_date` came out as the
    request union `oneOf [object, string]` while `SoulList.birth_date` (a
    read-only serializer, never a request body) came out as the plain object. A
    client generated from that reads `HistoricalDate | string | null` off a
    response that can only ever contain the object.

    So this returns the **object** in both directions. That is exact on the read
    path, and on the write path it under-documents rather than over-documents:
    it says "send the object", which is true, and omits the two string forms,
    which `to_internal_value` accepts for clients that predate the object and
    which no newly generated client should be reaching for. Widening the read to
    admit a string it can never receive would be the worse trade — that is the
    same silent widening this whole pass exists to undo.

    Turning on `COMPONENT_SPLIT_REQUEST` is the lever if the string forms ever
    need documenting; it splits every component in the API, so it is a schema-
    wide decision and not one to make as a side effect of describing one field.
    """

    target_class = "apps.souls.fields.HistoricalDateField"

    def map_serializer_field(self, auto_schema, direction):
        # `direction` is deliberately unused — see the docstring.
        return {
            "type": "object",
            "nullable": True,
            "description": (
                "A possibly-BCE date. `year` is signed (negative = BCE); "
                "`month` and `day` are null when the source does not record "
                "them, which is common for ancient records. On write, "
                "`YYYY-MM-DD` and `-YYYY-MM-DD` strings are also accepted for "
                "backward compatibility; see "
                "`HistoricalDateField.to_internal_value`."
            ),
            "properties": {
                "year": {"type": "integer"},
                "month": {"type": "integer", "nullable": True},
                "day": {"type": "integer", "nullable": True},
            },
            "required": ["year", "month", "day"],
        }
