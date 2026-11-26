"""Pages and exports in a total order: the list's own order with the primary key as the last key.

An order with ties (souls by `-create_time`, stations by `order`) leaves the order of the tied rows to the
database, and PostgreSQL does not keep it between two queries: page 2 may repeat a row of page 1 and skip
another, and an export lists tied rows in whatever order the plan gives. Once reads are cut over to the
shards (apps/core/shard_reads.py) the merge puts tied rows in leg order, so the same question answered by one
database and by the shards differed on 115 (the Greek shadow diff (not in this repo), the soul
export). With the pk last, both answer one order (tests/test_sharded_reads_equal_single_db.py compares every
page and every export line).
"""
from django.db.models.query import ModelIterable, QuerySet
from rest_framework.pagination import PageNumberPagination


def total_order(qs):
    """`qs` in its own order with the pk as the last key. A values() queryset is left alone: its order keys
    join the GROUP BY / DISTINCT, so a pk there would split its rows."""
    if not isinstance(qs, QuerySet) or qs._iterable_class is not ModelIterable or qs.query.combinator or \
            qs.query.is_sliced:
        return qs
    q = qs.query
    keys = list(q.order_by) or list(q.extra_order_by) or (list(qs.model._meta.ordering) if q.default_ordering else [])
    pk = qs.model._meta.pk
    if any(isinstance(k, str) and k.lstrip("-") in ("pk", pk.name, pk.attname) for k in keys):
        return qs
    return qs.order_by(*keys, "pk")


class TotalOrderPagination(PageNumberPagination):
    """The project's default pagination (settings REST_FRAMEWORK)."""

    def paginate_queryset(self, queryset, request, view=None):
        return super().paginate_queryset(total_order(queryset), request, view)
