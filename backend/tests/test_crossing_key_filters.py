"""A filter a caller can reach -- `?search=`, a filterset parameter, `?ordering=`, a data scope -- never joins
through a crossing key on a shard (apps/core/shard_reads.py `crossing_keys`, CrossShardJoin).

Sharded, a judgment's soul may be in another civilization's shard, so `soul__name` on a judgment is a join a shard
refuses: the list answered 500 (`GET /judgment/?search=`, 2026-11-21; queue-counts/ before it through `held_q`).
The equivalence tests build each world in one database and ask the same question in both forms, so a filter only a
caller's parameter turns on never ran there sharded. This walks every list viewset of a SHARD model and drives each
of its filter backends with each parameter it declares, on a hall's shard; and every data-scope path.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_crossing_key_filters.py
"""
# ruff: noqa: F811 -- `world` is a fixture imported from its module
import uuid
from types import SimpleNamespace

import django_filters as df

from tests.shard_support import sharded
from tests.test_control_locks_in_a_write_cut_hall import _admin, _client, _officer, world  # noqa: F401
from tests.test_sharded_writes import _in_hall


def _shard_viewsets():
    """{view class: model} for every routed view of a SHARD model whose reads go to a shard."""
    from apps.core.shard_reads import CONTROL_READS
    from apps.core.sharding import SHARD, placement

    return {cls: model for cls, model in _viewsets().items()
            if placement(model) == SHARD and model._meta.label not in CONTROL_READS}


def _viewsets():
    """{view class: model} for every routed view with a model."""
    from django.urls import URLPattern, URLResolver, get_resolver

    def walk(patterns):
        for p in patterns:
            if isinstance(p, URLResolver):
                yield from walk(p.url_patterns)
            elif isinstance(p, URLPattern):
                yield getattr(p.callback, "cls", None) or getattr(p.callback, "view_class", None)

    out = {}
    for cls in walk(get_resolver().url_patterns):
        qs = getattr(cls, "queryset", None)
        model = qs.model if qs is not None else getattr(getattr(getattr(cls, "serializer_class", None), "Meta", None),
                                                         "model", None)
        if model is not None:
            out[cls] = model
    return out


def _values(f):
    """Values each kind of django-filter accepts -- every choice of a choice filter (a method may join for one
    choice only: `side=participating`) -- or none (a model choice is validated against rows: `soul=<pk>` compares
    the column, it never joins)."""
    if isinstance(f, (df.ModelChoiceFilter, df.ModelMultipleChoiceFilter)):
        return []
    if isinstance(f, (df.ChoiceFilter, df.MultipleChoiceFilter)):
        choices = f.extra.get("choices") or ()
        return [str(c[0]) for c in (choices() if callable(choices) else choices)] or ["x"]
    if isinstance(f, df.BooleanFilter):
        return ["true", "false"]
    if isinstance(f, df.UUIDFilter):
        return [str(uuid.uuid4())]
    if isinstance(f, df.NumberFilter):
        return ["1"]
    if isinstance(f, df.DateTimeFilter):
        return ["2020-01-01T00:00:00Z"]
    if isinstance(f, df.DateFilter):
        return ["2020-01-01"]
    return ["x"]


def _savepoints():
    """A savepoint on every database: a failed statement (PostgreSQL) must not abort the next case's."""
    from contextlib import ExitStack

    from django.db import connections, transaction

    stack = ExitStack()
    for alias in connections:
        stack.enter_context(transaction.atomic(using=alias))
    return stack


def _view(cls, request):
    view = cls()
    view.request, view.args, view.kwargs, view.format_kwarg, view.action = request, (), {}, None, "list"
    return view


def _request(params, user, hall):
    from rest_framework.request import Request
    from rest_framework.test import APIRequestFactory

    raw = APIRequestFactory().get("/", params)
    raw.tenant = hall
    request = Request(raw)
    request.user = user
    return request


def _params(cls, model, user, hall):
    """Each parameter the view's backends read, one request each: search, each filter, each ordering field."""
    from django_filters.rest_framework import DjangoFilterBackend

    view = _view(cls, _request({}, user, hall))
    base = model._base_manager.all()
    out = [{"search": "x"}]
    filterset = DjangoFilterBackend().get_filterset_class(view, base)
    for name, f in (filterset.base_filters.items() if filterset else ()):
        out += [{name: value} for value in _values(f)]
    return out + [{"ordering": term} for term in _ordering_terms(view, base)]


#: Names no list may order by, whatever a serializer lists: none is a path, or it is a secret's.
NEVER_ORDERED = ["_raw_key", "-_signing_secret", "no_such_field", "unread", "has_draft", "archived",
                 "tenant__hall_names", "signing_secret", "key_hash"]


def _ordering_terms(view, base):
    """Each term DRF's ordering would accept on the view (a serializer-only name too: it must be ignored, not
    500), and the names in NEVER_ORDERED."""
    from rest_framework.filters import OrderingFilter

    if not any(issubclass(b, OrderingFilter) for b in view.filter_backends):
        return []
    try:
        listed = [t for t, _ in OrderingFilter().get_valid_fields(base, view, {"request": view.request})]
    except Exception:  # noqa: BLE001 -- a view with no serializer for this action: the junk names still go
        listed = []
    return listed + NEVER_ORDERED


def _ordering_failures(user, hall, shard_only):
    """Drive every viewset's ordering backend with each `_ordering_terms`; ([failure], {view names that ran})."""
    from django.core.exceptions import ValidationError as DjangoValidationError
    from rest_framework.exceptions import APIException
    from rest_framework.filters import OrderingFilter

    from apps.core.shard_reads import read_context

    failed, ran = [], set()
    for cls, model in (_shard_viewsets() if shard_only else _viewsets()).items():
        view = _view(cls, _request({}, user, hall))
        for term in _ordering_terms(view, model._base_manager.all()):
            request = _request({"ordering": term}, user, hall)
            view = _view(cls, request)
            try:
                with _savepoints(), _in_hall(hall), read_context(hall):
                    try:
                        qs = view.get_queryset()
                    except Exception:  # noqa: BLE001 -- a queryset that needs a detail route: its model's rows
                        qs = model._base_manager.all()
                    for backend in view.filter_backends:
                        if issubclass(backend, OrderingFilter):
                            qs = backend().filter_queryset(request, qs, view)
                    list(qs[:1])
            except (APIException, DjangoValidationError):
                continue
            except Exception as e:  # noqa: BLE001 -- FieldError (a 500), CrossShardJoin, anything
                failed.append(f"{cls.__name__} ordering={term}: {type(e).__name__}: {e}")
            else:
                ran.add(cls.__name__)
    return failed, ran


@sharded
def test_no_list_parameter_of_a_shard_viewset_joins_through_a_crossing_key(world):
    """Mutation: give `JudgmentViewSet` back DRF's own SearchFilter (or `soul__name` back to WorkflowFilter's
    `soul_name`) -> CrossShardJoin, red."""
    from django.core.exceptions import ValidationError as DjangoValidationError
    from rest_framework.exceptions import APIException

    from apps.core.shard_reads import CrossShardJoin, read_context

    hall = world["GREEK"]
    user = _admin(hall, "xk_admin")
    crossed, failed, ran = [], [], set()
    for cls, model in _shard_viewsets().items():
        for params in _params(cls, model, user, hall):
            request = _request(params, user, hall)
            view = _view(cls, request)
            try:
                with _savepoints(), _in_hall(hall), read_context(hall):
                    try:
                        qs = view.get_queryset()
                    except Exception:  # noqa: BLE001 -- a view whose queryset needs a detail route: its model's rows
                        qs = model._base_manager.all()
                    for backend in view.filter_backends:
                        qs = backend().filter_queryset(request, qs, view)
                    list(qs[:1])
            except CrossShardJoin as e:
                crossed.append(f"{cls.__name__} {params}: {e}")
            except (APIException, DjangoValidationError):
                continue  # the value (or the caller) was refused before any query; nothing joined
            except Exception as e:  # noqa: BLE001
                failed.append(f"{cls.__name__} {params}: {type(e).__name__}: {e}")
            else:
                ran.add((cls.__name__, *params))
    assert crossed == []
    assert failed == []
    # Not vacuous: the parameters that went through a crossing key ran, and answered.
    assert {("JudgmentViewSet", "search"), ("DossierViewSet", "search"), ("SoulViewSet", "has_date_problem"),
            ("SoulEventViewSet", "search"), ("ApprovalWorkflowViewSet", "search"),
            ("ApprovalWorkflowViewSet", "soul_name"), ("ApprovalWorkflowViewSet", "civilization"),
            ("DispatchRecordViewSet", "search"), ("DispatchRecordViewSet", "soul_name"),
            ("SentencePlanViewSet", "search"), ("DeathRegistrationReadViewSet", "search"),
            ("CrossTenantJudgmentViewSet", "side"), ("AuditLogViewSet", "search"), ("AuditLogViewSet", "username"),
            ("OfficerInboxViewSet", "ordering")} <= ran


@sharded
def test_no_ordering_term_of_a_shard_viewset_is_a_500(world):
    """The ordering half on a hall's shard (single database: test_ordering_terms_never_500.py). Mutation:
    `ShardOrderingFilter.remove_invalid_fields` removed -> FieldError on the inbox's `unread`, red."""
    hall = world["GREEK"]
    failed, ran = _ordering_failures(_admin(hall, "xk_order_admin"), hall, shard_only=True)
    assert failed == []
    assert {"OfficerInboxViewSet", "JudgmentViewSet", "SoulEventViewSet"} <= ran


#: The rows that follow their soul's data scope (`DataScopeFilter.through_soul`): (model, path to the soul).
THROUGH_SOUL = [("sentence_plan.SentencePlan", "soul"), ("sentence_plan.SentencePlanRequest", "plan__soul"),
                ("chat.Conversation", "soul_a"), ("soul_accounts.RebirthApplication", "soul"),
                ("souls.Soul", "")]


@sharded
def test_a_data_scope_reads_through_a_crossing_key_by_ids(world, monkeypatch):
    """An officer whose role has a data scope (ORG: his organization): every registered model's scope, and every
    row that follows its soul's, is answered on the hall's shard. Mutation: `visible_q` back to
    `Q(**{f"{org_path}__in": ids})` -> CrossShardJoin on reincarnations, events, workflows, red."""
    from django.apps import apps

    from apps.core.shard_reads import CONTROL_READS, read_context
    from apps.core.sharding import SHARD, placement
    from apps.org.ownership import tenant_root
    from apps.perm import data_scope
    from apps.perm.filters import DataScopeFilter

    hall = world["GREEK"]
    with _in_hall(hall):
        root = tenant_root(hall)
    officer = _officer(hall, "xk_scoped", organization=root)
    monkeypatch.setattr(data_scope, "org_ids", lambda user, resource, cache=None: {root.pk})
    request = SimpleNamespace(user=officer, tenant=hall)
    cases = [(label, None) for label in data_scope.REGISTRY] + THROUGH_SOUL
    crossed, ran = [], []
    for label, soul_path in cases:
        model = apps.get_model(label)
        if placement(model) != SHARD or label in CONTROL_READS:
            continue
        try:
            with _savepoints(), _in_hall(hall), read_context(hall):
                qs = model._base_manager.all()
                qs = (DataScopeFilter(officer, model).apply(qs) if soul_path is None
                      else DataScopeFilter.through_soul(request, qs, soul_path))
                list(qs[:1])
        except Exception as e:  # noqa: BLE001 -- CrossShardJoin, or anything else the scope broke
            crossed.append(f"{label} {soul_path!r}: {type(e).__name__}: {e}")
        else:
            ran.append(label)
    assert crossed == []
    assert {"reincarnation.Reincarnation", "events.SoulEvent", "workflow.ApprovalWorkflow", "workflow.ApprovalNode",
            "sentence_plan.SentencePlan", "chat.Conversation"} <= set(ran)


@sharded
def test_judgment_search_on_a_shard_finds_the_soul_by_name_and_not_the_other(world):
    """`GET /judgment/?search=` and `queue-counts/?search=`: 500 (CrossShardJoin through Judgment.soul) before the
    search read the souls by id."""
    from django.utils import timezone

    from apps.judgment.models import Judgment
    from apps.souls.models import Soul

    hall = world["GREEK"]
    admin = _admin(hall, "xk_search_admin")
    year = timezone.localdate().year - 5
    with _in_hall(hall):
        cases = {}
        for name in ("Achilleus", "Hektor"):
            soul = Soul.objects.create(name=name, tenant=hall, death_year=year)
            cases[name] = Judgment.objects.create(soul=soul, civilization="GREEK", court="Minos", tenant=hall,
                                                  evidence_json={})
    client = _client(admin)
    listed = client.get("/api/v1/judgment/", {"search": "achill"})
    assert listed.status_code == 200, listed.content[:300]
    ids = {row["id"] for row in listed.data["results"]}
    assert str(cases["Achilleus"].pk) in ids
    assert str(cases["Hektor"].pk) not in ids
    counts = client.get("/api/v1/judgment/queue-counts/", {"search": "hektor"})
    assert counts.status_code == 200, counts.content[:300]
    assert counts.data["unclaimed"] == 1


@sharded
def test_has_date_problem_on_a_shard_flags_the_soul_whose_record_predates_its_birth(world):
    """`GET /souls/?has_date_problem=`: the record half was a correlated subquery through SoulRecord.soul, which a
    shard refuses (CrossShardJoin -> 500). It reads the souls' records by id now, judged as the list judges them.
    Mutation: `record_problem` back to `Exists(records)` -> CrossShardJoin, red."""
    from apps.core.shard_reads import read_context
    from apps.souls.date_problem_sql import filter_has_date_problem
    from apps.souls.models import Soul
    from apps.souls.record_models import SoulRecord

    hall = world["GREEK"]
    with _in_hall(hall):
        bad = Soul.objects.create(name="early deed", tenant=hall, birth_year=100, death_year=150)
        good = Soul.objects.create(name="in its life", tenant=hall, birth_year=100, death_year=150)
        for soul, year in ((bad, 50), (good, 120)):
            SoulRecord.objects.create(soul=soul, tenant=hall, record_type="MERIT", civilization="GREEK",
                                      event_year=year)
    with _in_hall(hall), read_context(hall):
        mine = Soul.objects.filter(pk__in=[bad.pk, good.pk])
        assert set(filter_has_date_problem(mine, True).values_list("pk", flat=True)) == {bad.pk}
        assert set(filter_has_date_problem(mine, False).values_list("pk", flat=True)) == {good.pk}
