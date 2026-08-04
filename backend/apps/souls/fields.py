"""
DRF field for BC-aware historical dates (see apps.souls.dates).

Backs a single API field (e.g. "birth_date") onto three model columns
(``birth_year``/``birth_month``/``birth_day``) via ``source="*"``.
"""
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
