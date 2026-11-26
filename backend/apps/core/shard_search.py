"""`?search=` on a sharded deployment (the default search backend, config/settings.py REST_FRAMEWORK).

DRF's SearchFilter ORs `Q(<field>__icontains=term)` over `search_fields`. A field through a crossing key
(`soul__name` on a judgment, an event, a workflow, a dispatch, a sentence plan) is a join a shard refuses
(apps/core/shard_reads.py CrossShardJoin -> the list 500'd). Sharded, each such field is matched by ids instead
(`crossing_q`); not sharded, DRF's own filter runs unchanged.

`?ordering=` likewise: DRF accepts any serializer field when a view names no `ordering_fields`, so
`?ordering=soul__name` (appeals, city-god cases, wangsi, death registrations, the officer inbox) ordered through
a crossing key and 500'd. An order cannot be read by ids; sharded, such a term is dropped like any field DRF does
not know, and the view's default order stands.

The same default lists names that are no path at all -- `_raw_key` / `_signing_secret` (set on the instance once, on
create), the officer inbox's `unread` / `has_draft` / `archived`, `tenant__hall_names` (a property): `order_by` of one
raised FieldError and the list 500'd, single database and sharded alike. Every requested term is kept only if the
queryset can order by it (a field, a path, an annotation); a `_` name never, whatever the view lists."""
import operator
from functools import reduce

from django.conf import settings
from django.core.exceptions import EmptyResultSet, FieldError
from django.db import DEFAULT_DB_ALIAS
from rest_framework.filters import OrderingFilter, SearchFilter

from apps.core.shard_reads import crossing_q, orders_across


class ShardSearchFilter(SearchFilter):
    def filter_queryset(self, request, queryset, view):
        if not settings.SHARDED:
            return super().filter_queryset(request, queryset, view)
        fields, terms = self.get_search_fields(view, request), self.get_search_terms(request)
        if not fields or not terms:
            return queryset
        lookups = [self.construct_search(str(f), queryset) for f in fields]
        model = queryset.model
        matched = queryset.filter(reduce(operator.and_, (
            reduce(operator.or_, (crossing_q(model, lookup, term) for lookup in lookups)) for term in terms)))
        if self.must_call_distinct(queryset, fields):  # as DRF: a many-to-many on the path repeats the row
            from django.db.models import Exists, OuterRef

            return queryset.filter(Exists(matched.filter(pk=OuterRef("pk"))))
        return matched



class SearchFieldsMixin:
    """For a django-filter FilterSet with `search = CharFilter(method="filter_search")`: OR `<field>__icontains`
    over its `search_fields`, a crossing key read by ids (`crossing_q`; not sharded, or no crossing key on the path,
    the plain Q). Four FilterSets had their own copy (actors, realms: plain Q; dispatch, workflow: `crossing_q`)."""

    def filter_search(self, queryset, name, value):
        if not value:
            return queryset
        return queryset.filter(reduce(operator.or_, (crossing_q(queryset.model, f"{field}__icontains", value)
                                                     for field in self.search_fields)))


class ShardOrderingFilter(OrderingFilter):
    def get_valid_fields(self, queryset, view, context=None):
        fields = super().get_valid_fields(queryset, view, context or {})
        if not settings.SHARDED:
            return fields
        return [(name, label) for name, label in fields if not orders_across(queryset.model, name)]

    def remove_invalid_fields(self, queryset, fields, view, request):
        return [t for t in super().remove_invalid_fields(queryset, fields, view, request) if _orders(queryset, t)]


def _orders(queryset, term):
    """Whether `queryset.order_by(term)` compiles (resolving an order happens in the compiler, not in `order_by`)."""
    if term.lstrip("-").startswith("_"):
        return False
    try:
        # Compile on the queryset's pinned database, or `default`: only the field names are being checked, and
        # asking the router (`queryset.db`) for a fan-out read has no single answer (NoShardContext, sharded).
        queryset.order_by(term).query.get_compiler(queryset._db or DEFAULT_DB_ALIAS).as_sql()
    except EmptyResultSet:  # `.none()`: never compiled, so never refused
        return True
    except FieldError:
        return False
    return True
