"""`?search=` on a sharded deployment (the default search backend, config/settings.py REST_FRAMEWORK).

DRF's SearchFilter ORs `Q(<field>__icontains=term)` over `search_fields`. A field through a crossing key
(`soul__name` on a judgment, an event, a workflow, a dispatch, a sentence plan) is a join a shard refuses
(apps/core/shard_reads.py CrossShardJoin -> the list 500'd). Sharded, each such field is matched by ids instead
(`crossing_q`); not sharded, DRF's own filter runs unchanged."""
import operator
from functools import reduce

from django.conf import settings
from rest_framework.filters import SearchFilter

from apps.core.shard_reads import crossing_q


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
