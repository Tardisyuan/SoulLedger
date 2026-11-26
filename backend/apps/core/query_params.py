"""Query-parameter parsing shared by views (a bad value is the caller's 400, never a 500)."""
from django.utils.dateparse import parse_date
from rest_framework.exceptions import ValidationError


def parse_date_param(params, name):
    """`YYYY-MM-DD` 或空(None)。`?start_date=垃圾` 曾经直接进 `timestamp__date__gte`,Django 抛
    ValidationError,DRF 不认它 → 500。DRF 自己的 ValidationError 才是 400。"""
    raw = params.get(name)
    if not raw:
        return None
    # `parse_date` returns None for a malformed string but RAISES ValueError for a well-formed
    # impossible one (`2026-13-40`): both are the caller's mistake, both are a 400.
    try:
        value = parse_date(raw)
    except ValueError:
        value = None
    if value is None:
        raise ValidationError({name: f"'{raw}' is not a date (expected YYYY-MM-DD)."})
    return value
