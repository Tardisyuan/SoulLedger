"""Stage 3 core guard: cutting every civilization's reads over to its shard changes no answer
(docs/audit/2026-11-15-sharding/PLAN.md 阶段 3). The single database is the baseline.

One random world per module (seed printed, `SHARDED_READS_SEED=<n>` replays it): rows in halls of all four
civilizations, a hall of UNKNOWN civilization and no hall; every key that may cross civilizations pointed
across on some row; a soul residing abroad, a soul back from residence with the rows its residence wrote,
both with a soul account. It is synced to the shards and `reconcile_shards --all` must be clean (no row
missing, none dangling) -- the precondition for cutting a civilization over.

Then every URL pattern a GET reaches -- derived from the URLconf, one test case each so xdist spreads them --
is asked by every caller: each hall role in some hall, every hall's ADMIN, each civilization's ADMIN,
SYSTEM_ADMIN and two soul accounts. Once with `SHARD_READ_CIVS=[]` (the baseline), once with all four cut
over; status and body must be equal (every page; volatile keys dropped, lists compared as multisets -- the
order of a merge is held exactly by `test_fanout_slices_equal_the_single_database`). A case in which no
caller had data on either side is a skip, so the summary line says how many endpoints compared nothing.

The world is built once per module inside an outer transaction on every database and rolled back at the
end (Django's setUpTestData shape); each case runs in a savepoint inside it.

    cd backend && ... python -m pytest --ds=config.settings_sharded -m sharded tests/test_sharded_reads_equal_single_db.py
"""
import os
import random

import pytest
from django.apps import apps
from django.db import IntegrityError, connections, models, transaction
from django.test import override_settings
from django.urls import reverse
from rest_framework.pagination import PageNumberPagination

from apps.core import shadow_reads as shadow
from apps.core.shard_reads import FANOUT, crossing_keys, read_context
from apps.core.sharding import SHARD, NoShardContext, alias_for_civilization, placement, tenant_path
from tests.test_shard_sync import CIVS, HAS_SHARDS, sharded

SEED = int(os.environ.get("SHARDED_READS_SEED") or random.SystemRandom().randrange(10 ** 6))
PAGE_SIZE = 3


ENDPOINTS = shadow.endpoints()


# ---- the world --------------------------------------------------------------------------------------------

def _outer_atomics():
    atomics = []
    for alias in connections:
        a = transaction.atomic(using=alias)
        a._from_testcase = True  # not a transaction of the code: reads inside it are not "read your writes"
        a.__enter__()
        atomics.append((alias, a))
    return atomics


def _rollback(atomics):
    for alias, a in reversed(atomics):
        transaction.set_rollback(True, using=alias)
        a.__exit__(None, None, None)


def _rows_of(model, halls):
    return list(model._base_manager.filter(**{f"{tenant_path(model)}__in": halls}).values_list("pk", flat=True))


def _point_across(rng, f, halls_by_civ, why):
    """Point one row of one civilization at a row of another through crossing key `f`."""
    for civ in rng.sample(CIVS, len(CIVS)):
        rows = _rows_of(f.model, halls_by_civ[civ])
        targets = _rows_of(f.related_model, [h for c in CIVS if c != civ for h in halls_by_civ[c]])
        rng.shuffle(rows)
        why[f"{f.model._meta.label}.{f.name}"] = f"{civ}: {len(rows)} rows, {len(targets)} targets"
        for pk in rows[:10]:
            if not targets:
                break
            try:
                with transaction.atomic(using="default"):
                    f.model._base_manager.filter(pk=pk).update(**{f.attname: rng.choice(targets)})
                return True
            except IntegrityError as e:
                why[f"{f.model._meta.label}.{f.name}"] += f"; {e}"[:120]
                continue
    return False


def _fill_m2m(rng, models_with_rows):
    from apps.authentication.models import User

    for model in models_with_rows:
        for m2m in model._meta.many_to_many:
            for obj in model._base_manager.all()[:5]:
                target = m2m.related_model
                pool = list(target._base_manager.all()[:20]) if target is not User else list(
                    User.objects.filter(tenant__isnull=False)[:20])
                if pool:
                    getattr(obj, m2m.name).add(rng.choice(pool))


def _residence(rng, home, away, cache, counter, returned):
    """A soul of `home` dispatched to `away` (executed), the rows its residence wrote about it, and -- when
    `returned` -- the soul back home with those rows left in `away`. Its soul account is the caller."""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.souls.models import Soul
    from tests.soul_account_support import move_soul, ready_soul
    from tests.test_admin_is_civilization_scoped import _make

    account, client = ready_soul(home, name=f"mover-{home.code}")
    soul = account.soul
    _make(DispatchRecord, home, cache, counter, ("tenant",), {
        "status": DispatchStatus.EXECUTED, "soul": soul, "source_tenant": home, "target_tenant": away})
    move_soul(soul, away)
    for f in crossing_keys():
        if f.related_model is Soul and f.model is not DispatchRecord:
            try:
                with transaction.atomic(using="default"):
                    _make(f.model, away, {}, counter, tuple(tenant_path(f.model).split("__")), {f.name: soul})
            except Exception:  # noqa: BLE001 -- a model the filler cannot make with a soul fixed: skip it
                continue
    if returned:
        move_soul(Soul._base_manager.get(pk=soul.pk), home)
        DispatchRecord._base_manager.filter(soul=soul).update(status=DispatchStatus.RETURNED)
    return account, client


#: The moment the 115 souls tie on (shadow-diff-greek-1: two souls of two civilizations, one create_time).
TIED_AT = "2026-05-10T16:50:49.878146+00:00"
WORLD_MATRIX = "world.test"


def _what_115_had(rng, halls_by_civ, accounts):
    """Rows the first shadow_read_diff on 115 (GREEK, 2026-11-15) found differences in and this world had none of:
    (a) a chat identity and letters to an officer inbox -- from the soul in residence and, for the soul back home,
        to the hall it resided in -- plus a block and an assistant conversation (the paths through SoulAccount);
    (b) souls held in a realm (open path entries), so the occupancy's average stay is a duration;
    (c) rows of several civilizations tied on their list's first order key;
    (d) a workflow template in every civilization whose steps name a role (the role list's template count)."""
    from datetime import datetime, timedelta

    from django.utils import timezone

    from apps.chat.models import ChatBlock, ChatIdentity, Conversation, ConversationKind
    from apps.dispatch.models import DispatchRecord
    from apps.realms.models import Realm, SoulPathEntry
    from apps.soul_assist.models import SCREENS, AssistConversation
    from apps.souls.models import Soul
    from apps.workflow.models import WorkflowTemplate

    for i, account in enumerate(accounts):                                                                   # (a)
        local = f"world{i}"
        ChatIdentity.objects.create(account=account, soul_id=account.soul_id, localpart=local,
                                    matrix_user_id=f"@{local}:{WORLD_MATRIX}")
        rec = DispatchRecord._base_manager.get(soul_id=account.soul_id)
        for hall in (rec.source_tenant, rec.target_tenant):
            Conversation._base_manager.update_or_create(soul_a_id=account.soul_id, tenant=hall, defaults={
                "kind": ConversationKind.OFFICER_INBOX, "account_a": account, "soul_b": None, "account_b": None,
                "room_id": f"!inbox-{local}.{hall.code}:{WORLD_MATRIX}",
                "last_message_at": timezone.now() - timedelta(hours=i + 1)})
        AssistConversation.objects.create(account=account, screen=SCREENS[0])
    ChatBlock.objects.create(blocker=accounts[0], blocked=accounts[1])
    now = timezone.now()
    for halls in halls_by_civ.values():                                                                   # (b)
        for hall in halls:
            realm = Realm._base_manager.filter(tenant=hall).first()
            held = SoulPathEntry._base_manager.filter(left_at__isnull=True).values("soul_id")
            for n, soul in enumerate(Soul._base_manager.filter(tenant=hall, is_deleted=False).exclude(pk__in=held)[:2]):
                SoulPathEntry.objects.create(soul=soul, realm=realm, sequence=900 + n, tenant=hall,
                                             entered_at=now - timedelta(days=rng.randint(1, 40), hours=rng.randint(0, 23)))
    tied_at = datetime.fromisoformat(TIED_AT)
    for model in apps.get_models():                                                                       # (c)
        first = next((o for o in model._meta.ordering if isinstance(o, str)), None) if placement(model) == SHARD else None
        try:
            field = model._meta.get_field(first.lstrip("-")) if first else None
        except Exception:  # noqa: BLE001 -- an ordering through a relation
            field = None
        if not isinstance(field, models.DateField):  # DateTimeField included
            continue
        value = tied_at if isinstance(field, models.DateTimeField) else tied_at.date()
        for halls in halls_by_civ.values():
            pks = _rows_of(model, halls)[:2]
            try:
                with transaction.atomic(using="default"):
                    model._base_manager.filter(pk__in=pks).update(**{field.attname: value})
            except IntegrityError:
                continue
    for halls in halls_by_civ.values():                                                                   # (d)
        template = WorkflowTemplate.objects.filter(tenant__in=halls).first()
        WorkflowTemplate._base_manager.filter(pk=template.pk).update(nodes_json=[
            {"node_order": 1, "node_name": "trial", "approver_type": "ROLE", "approver_role": "JUDGE"}])


class LettersMatrix:
    """Synapse as the world's chat sees it: each inbox room (`!inbox-<localpart>.<hall>`) holds one letter from the
    soul it names; every other call finds Synapse unreachable, the way 115's did (2026-11-15)."""

    service_user = f"@soulledger:{WORLD_MATRIX}"

    def recent_messages(self, room_id, limit=50):
        local = room_id[len("!inbox-"):].split(".")[0]
        return [{"event_id": f"$letter-{local}", "sender": f"@{local}:{WORLD_MATRIX}", "body": "a letter",
                 "timestamp": 1_763_000_000_000, "officer": None}]

    def __getattr__(self, name):
        from apps.chat.matrix import MatrixError

        def unreachable(*args, **kwargs):
            raise MatrixError("Synapse 无法访问:ConnectionError")
        return unreachable


def _build(rng):
    from apps.authentication.models import User, UserRole
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant
    from tests.test_admin_is_civilization_scoped import EXTRA_ROWS, _client, _list_routes, _make
    from tests.test_shard_sync import _reconcile, _sync
    from tests.test_tenant_scoping_contract import _model_for
    from tests.test_tenant_scoping_contract import _tenant_path as scoping_path

    halls_by_civ = {}
    for civ in CIVS:
        halls_by_civ[civ] = [Tenant.objects.create(code=f"{civ[:2]}_W{i}", display_name=f"{civ} {i}",
                                                   declared_civilization=civ) for i in range(rng.randint(1, 2))]
    unknown = Tenant.objects.create(code="UNKNOWN_W", display_name="unknown", declared_civilization="")
    halls = [h for hs in halls_by_civ.values() for h in hs] + [unknown]
    counter, unmade = [0], set()
    served = sorted({_model_for(cls) for _n, cls in _list_routes()} - {Tenant}, key=lambda m: m.__name__)
    for hall in halls:
        cache = {}
        for i in range(rng.randint(2, 4)):
            Soul.objects.create(name=f"s-{hall.code}-{i}", tenant=hall, current_state=SoulState.JUDGING,
                                merit_score=rng.randint(0, 50))
        for model in served:
            path = tuple(scoping_path(model).split("__"))
            for _ in range(rng.randint(1, 2)):
                try:
                    with transaction.atomic(using="default"):
                        _make(model, hall, cache, counter, path)
                except Exception as e:  # noqa: BLE001 -- one row per hall (a root organization), a beat schedule...
                    unmade.add(f"{model.__name__}: {type(e).__name__}")
            for values in EXTRA_ROWS.get(model.__name__, []):
                _make(model, hall, cache, counter, path, values)
    with_rows = [m for m in apps.get_models() if placement(m) == SHARD and m._base_manager.exists()]
    _fill_m2m(rng, with_rows)
    from apps.audit.models import AuditAction, AuditLog

    AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="hall-less")
    why = {}
    for f in crossing_keys():  # a row to point across in every hall, where the filler did not make one
        for hall in [h for hs in halls_by_civ.values() for h in hs]:
            if not _rows_of(f.model, [hall]):
                try:
                    with transaction.atomic(using="default"):
                        _make(f.model, hall, {}, counter, tuple(tenant_path(f.model).split("__")))
                except Exception:  # noqa: BLE001,S110 -- the filler cannot make this one: the next hall may
                    pass
    crossed = [f for f in crossing_keys() if _point_across(rng, f, halls_by_civ, why)]
    cache, known = {}, [h for hs in halls_by_civ.values() for h in hs]
    home, away, home2, away2 = _pairs(rng, halls_by_civ)
    movers = [_residence(rng, home, away, cache, counter, returned=False),
              _residence(rng, home2, away2, cache, counter, returned=True)]
    _what_115_had(rng, halls_by_civ, [account for account, _ in movers])

    def user(name, role, hall=None, **kw):
        u = User.objects.create_user(username=name, password="x", role=role, tenant=hall, **kw)
        return _client(u, hall)

    callers = {f"ADMIN@{h.code}": user(f"adm-{h.code}", UserRole.ADMIN, h) for h in halls}
    for i, role in enumerate([UserRole.JUDGE, UserRole.MODERATOR, UserRole.GUARDIAN, UserRole.VIEWER]):
        h = known[(i + rng.randrange(len(known))) % len(known)]
        callers[f"{role}@{h.code}"] = user(f"{role.lower()}-{h.code}", role, h)
    for civ in CIVS:
        callers[f"ADMIN@{civ}"] = user(f"civ-{civ}", UserRole.ADMIN, civilization=civ)
    callers["SYSTEM_ADMIN"] = user("sys", UserRole.SYSTEM_ADMIN)
    callers["soul abroad"], callers["soul back home"] = (client for _, client in movers)
    _sync()
    code, out = _reconcile("--all")
    assert code == 0 and "not copied" not in out and "dangling" not in out, f"SHARDED_READS_SEED={SEED}\n{out}"
    print(f"models the filler could not make in some hall: {sorted(unmade)}")
    return {"callers": callers, "crossed": crossed, "halls": halls, "why_not_crossed": why}


def _pairs(rng, halls_by_civ):
    a, b, c, d = rng.sample(CIVS, 4)
    return (rng.choice(halls_by_civ[a]), rng.choice(halls_by_civ[b]), rng.choice(halls_by_civ[c]),
            rng.choice(halls_by_civ[d]))


@pytest.fixture(scope="module")
def world(django_db_setup, django_db_blocker):
    if not HAS_SHARDS:
        pytest.skip("needs --ds=config.settings_sharded")
    print(f"SHARDED_READS_SEED={SEED}")
    with django_db_blocker.unblock():
        atomics = _outer_atomics()
        try:
            yield _build(random.Random(SEED))
        finally:
            _rollback(atomics)


@pytest.fixture(autouse=True)
def _small_pages(monkeypatch):
    """Every list has several pages, so a merge that slices before merging shows."""
    monkeypatch.setattr(PageNumberPagination, "page_size", PAGE_SIZE)


@pytest.fixture(autouse=True)
def _chat_on(settings):
    """Chat configured, its Synapse the world's (LettersMatrix): the inbox reads its rows before it asks Synapse."""
    settings.MATRIX_ENABLED = True
    settings.MATRIX_CLIENT = f"{__name__}.LettersMatrix"
    settings.MATRIX_SERVER_NAME = WORLD_MATRIX


@pytest.fixture(autouse=True)
def _seed_in_report(request):
    """The seed in every failing test's report, not only in the first test's captured setup output."""
    request.node.add_report_section("setup", "seed", f"SHARDED_READS_SEED={SEED}")


# ---- comparing (apps/core/shadow_reads.py) -------------------------------------------------------------------

def _fetch(client, url):
    return shadow.fetch(client, url, trace=bool(os.environ.get("SHARDED_READS_TRACE")))


def _urls(case, world):
    lst = shadow.list_route_of(ENDPOINTS, ENDPOINTS[case][2])
    answer = None
    if ENDPOINTS[case][1] and lst:
        with override_settings(SHARD_READ_CIVS=[]):
            answer = _fetch(world["callers"]["SYSTEM_ADMIN"], reverse(lst))
    return shadow.urls_for(ENDPOINTS, case, answer, random.Random(f"{SEED}:{case}"))


#: Endpoints that must compare data: the five differences the first shadow_read_diff on 115 found (and the rows
#: through SoulAccount beside them). A world that loses their rows fails here instead of skipping.
MUST_HAVE_DATA = {"perm:list-roles", "realm-occupancy", "soul-export", "soul-inbox-messages", "me-chat-blocks",
                  "me-assist-conversations"}


@sharded
@pytest.mark.parametrize("case", sorted(ENDPOINTS))
def test_cut_over_reads_answer_like_the_single_database(world, case):
    urls = _urls(case, world)
    if not urls:
        pytest.skip(f"{case}: needs URL kwargs ({ENDPOINTS[case][1]}) no list here gives")
    mismatches, with_data = [], 0
    for who, client in world["callers"].items():
        for url in urls:
            with override_settings(SHARD_READ_CIVS=[]):
                base = shadow.drop(_fetch(client, url), shadow.WRITES_ON_READ.get(case, ()))
            with override_settings(SHARD_READ_CIVS=list(CIVS)):
                cut = shadow.drop(_fetch(client, url), shadow.WRITES_ON_READ.get(case, ()))
            if base != cut:
                mismatches.append(f"{who} GET {url}: {shadow.diff(base, cut)}")
            elif shadow.has_data(base):
                with_data += 1
    assert not mismatches, f"SHARDED_READS_SEED={SEED}\n" + "\n".join(mismatches[:6])
    assert with_data or case not in MUST_HAVE_DATA, f"{case}: the world lost the rows it is here for"
    if not with_data:
        pytest.skip(f"{case}: no caller had data here (both sides equal)")


# ---- the merge itself, row order included -------------------------------------------------------------------

@sharded
def test_fanout_slices_equal_the_single_database(world):
    """Every SHARD model with rows, in its own order with the pk as the last key: random slices read across every
    shard (FANOUT) equal the same slices of the single database, order included."""
    rng = random.Random(f"{SEED}:slices")
    checked = 0
    for model in apps.get_models():
        if placement(model) != SHARD or not model._base_manager.exists():
            continue
        ordering = [o for o in (model._meta.ordering or []) if isinstance(o, str)] + ["pk"]
        n = model._base_manager.count()
        for _ in range(3):
            low = rng.randrange(n)
            high = low + rng.randint(1, PAGE_SIZE)
            with override_settings(SHARD_READ_CIVS=[]):
                base = list(model._base_manager.order_by(*ordering).values_list("pk", flat=True)[low:high])
                total = model._base_manager.count()
            with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context(FANOUT):
                cut = [o.pk for o in model._base_manager.order_by(*ordering)[low:high]]
                merged_total = model._base_manager.count()
            assert cut == base, (model._meta.label, ordering, low, high, f"SHARDED_READS_SEED={SEED}")
            assert merged_total == total, model._meta.label
        checked += 1
    assert checked >= 40, checked


@sharded
def test_each_shard_leg_holds_rows(world):
    """Not vacuous: after the sync every shard, and control, answer rows of the models the endpoints serve."""
    from apps.souls.models import Soul

    for civ in CIVS:
        assert Soul._base_manager.using(alias_for_civilization(civ)).exists(), civ
    with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context(FANOUT):
        from apps.audit.models import AuditLog

        assert AuditLog._base_manager.filter(tenant__isnull=True).exists(), "the control leg lost hall-less rows"
    missed = sorted(set(map(str, crossing_keys())) - set(map(str, world["crossed"])))
    assert len(world["crossed"]) >= len(crossing_keys()) - 3, [(m, world["why_not_crossed"].get(m)) for m in missed]


@sharded
def test_the_world_has_what_115_had(world):
    """`_what_115_had` left its rows, in every civilization where it says so."""
    from apps.chat.models import ChatIdentity, Conversation, ConversationKind
    from apps.perm.matrix import role_template_references
    from apps.realms.models import SoulPathEntry
    from apps.souls.models import Soul

    def civs(model, **kw):
        return {h.civilization for h in world["halls"] if model._base_manager.filter(**{tenant_path(model): h}, **kw)}

    assert ChatIdentity._base_manager.count() == 2
    assert len(civs(Conversation, kind=ConversationKind.OFFICER_INBOX)) >= 3  # residence halls and a home hall
    assert civs(SoulPathEntry, left_at__isnull=True, realm__isnull=False) >= set(CIVS)
    assert civs(Soul, create_time=TIED_AT) >= set(CIVS)
    with override_settings(SHARD_READ_CIVS=[]):
        named = {ref["template_id"] for ref in role_template_references().get("JUDGE", [])}
    assert len(named) >= len(CIVS), named


@sharded
def test_fanout_aggregates_of_every_type_equal_the_single_database(world):
    """aggregate() and values().annotate() read across every shard answer what the single database answers, for
    every aggregate over every column type a SHARD model with rows has: Count, Sum, Min, Max and Avg over integers,
    floats, durations, dates and times (Avg / Sum where the database has them). Avg over a Decimal is refused."""
    import math
    from datetime import timedelta

    from django.db.models import Avg, Count, ExpressionWrapper, F, Max, Min, Sum, Value
    from django.utils import timezone

    def same(a, b):
        if isinstance(a, float) and isinstance(b, float):
            return math.isclose(a, b, rel_tol=1e-9)
        if isinstance(a, timedelta) and isinstance(b, timedelta):
            return abs(a - b) <= timedelta(microseconds=1)
        return a == b

    from apps.core.shard_reads import CONTROL_READS, _unreachable

    now = timezone.now()
    checked, decimals = set(), []
    for model in apps.get_models():
        if placement(model) != SHARD or not model._base_manager.exists() or model._meta.label in CONTROL_READS:
            continue
        for f in model._meta.concrete_fields:
            if f.is_relation or f.primary_key:
                continue
            if isinstance(f, models.DateTimeField):
                exprs = {"min": Min(f.name), "max": Max(f.name), "n": Count(f.name),
                         "avg_age": Avg(ExpressionWrapper(Value(now) - F(f.name), output_field=models.DurationField())),
                         "sum_age": Sum(ExpressionWrapper(Value(now) - F(f.name), output_field=models.DurationField()))}
            elif isinstance(f, (models.DateField, models.TimeField)):
                exprs = {"min": Min(f.name), "max": Max(f.name), "n": Count(f.name)}
            elif isinstance(f, (models.IntegerField, models.FloatField, models.DurationField)):
                exprs = {"min": Min(f.name), "max": Max(f.name), "sum": Sum(f.name), "avg": Avg(f.name)}
            elif isinstance(f, models.DecimalField):
                exprs = {"min": Min(f.name), "max": Max(f.name), "sum": Sum(f.name)}
                if model._base_manager.filter(**{f"{f.name}__isnull": False}).exists():
                    decimals.append((model, f.name))
            else:
                continue
            group = tenant_path(model)
            reads = [("aggregate", lambda qs, e=exprs: [qs.aggregate(**e)])]
            if group.split("__")[0] not in _unreachable(model):  # grouped by a hall a shard can join to
                reads.append(("grouped", lambda qs, e=exprs, g=group: sorted(
                    qs.values(g).annotate(**e).order_by(), key=lambda r: str(r[g]))))
            for label, read in reads:
                with override_settings(SHARD_READ_CIVS=[]):
                    base = read(model._base_manager.all())
                with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context(FANOUT):
                    cut = read(model._base_manager.all())
                assert len(base) == len(cut), (model._meta.label, f.name, label)
                for b, c in zip(base, cut, strict=True):
                    bad = {k: (b[k], c[k]) for k in b if not same(b[k], c[k])}
                    assert not bad, (model._meta.label, f.name, label, bad, f"SHARDED_READS_SEED={SEED}")
            checked.add(type(f).__name__)
    assert {"DateTimeField", "DateField", "IntegerField", "DurationField"} <= checked, checked
    for model, name in decimals[:1]:  # no SHARD model has a decimal column with values today
        with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context(FANOUT), pytest.raises(NotImplementedError):
            model._base_manager.aggregate(a=Avg(name))
    from decimal import Decimal

    from apps.core.shard_reads import _average
    with pytest.raises(NotImplementedError):
        _average("a", Decimal("3"), 2, None)


# ---- fail closed ------------------------------------------------------------------------------------------

@sharded
def test_a_read_with_no_context_is_refused_once_a_civilization_is_cut_over(world):
    """No instance hint, no request, no hall contextvar, no explicit context: every SHARD model's read raises
    NoShardContext once any civilization is cut over -- never a quiet answer from control -- and reads as
    before while none is."""
    from apps.core.request_local import get_current_request
    from apps.core.shard_reads import _context, _in_celery_task, current_context
    from apps.tenants.managers import get_current_tenant

    assert get_current_request() is None and get_current_tenant() is None
    assert current_context() is None, (_context.get(), _in_celery_task())
    from apps.core.shard_reads import CONTROL_READS

    shard_models = [m for m in apps.get_models() if placement(m) == SHARD and m._meta.label not in CONTROL_READS]
    for civ in CIVS:
        with override_settings(SHARD_READ_CIVS=[civ]):
            for model in shard_models:
                for read in (lambda m: list(m._base_manager.all()[:1]), lambda m: m._base_manager.count(),
                             lambda m: m._base_manager.exists()):
                    with pytest.raises(NoShardContext):
                        read(model)
    with override_settings(SHARD_READ_CIVS=[]):
        for model in shard_models:
            model._base_manager.count()


#: Services a per-hall Celery job runs (apps/scheduler/registry.py, TENANT jobs): the job sets the hall's
#: tenant contextvar first; called without it, the service must refuse, not read control.
HALL_JOB_SERVICES = (("apps.disposition.expiry", "expire_for_tenant"), ("apps.workflow.segments", "remind_due"))


@sharded
@pytest.mark.parametrize("service", HALL_JOB_SERVICES, ids=lambda s: s[1])
def test_a_hall_job_service_refuses_without_its_hall_and_reads_its_shard_with_it(world, service):
    import importlib

    from apps.tenants.managers import clear_current_tenant, set_current_tenant
    from apps.tenants.models import Tenant

    fn = getattr(importlib.import_module(service[0]), service[1], None)
    assert fn is not None, f"{service} is gone; name another per-hall job's service"
    hall = Tenant.objects.filter(declared_civilization="GREEK").first()
    with override_settings(SHARD_READ_CIVS=["GREEK"]):
        with pytest.raises(NoShardContext):
            fn(hall)
        set_current_tenant(hall)
        try:
            fn(hall)
        finally:
            clear_current_tenant()


@sharded
def test_a_transaction_on_control_reads_its_own_writes(world):
    """Writes still go to control (stage 3): inside a transaction of the code, a read sees the row it just wrote,
    which no shard has yet."""
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant

    hall = Tenant.objects.filter(declared_civilization="GREEK").first()
    with override_settings(SHARD_READ_CIVS=list(CIVS)), read_context("GREEK"):
        with transaction.atomic():
            soul = Soul.objects.create(name="fresh", tenant=hall, current_state=SoulState.JUDGING)
            assert Soul.objects.filter(pk=soul.pk).exists()
        assert not Soul.objects.filter(pk=soul.pk).exists(), "a cut-over read outside the transaction is the shard's"


@sharded
def test_a_write_request_reads_control_and_a_read_request_its_shard(world):
    """A POST reads where it writes (control), so it sees a row written a moment ago that no shard has yet; a GET
    of the same hall reads the hall's shard."""
    from django.test import RequestFactory

    from apps.core.request_local import set_current_request
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant

    hall = Tenant.objects.filter(declared_civilization="EGYPTIAN").first()
    soul = Soul.objects.create(name="unsynced", tenant=hall, current_state=SoulState.JUDGING)
    with override_settings(SHARD_READ_CIVS=list(CIVS)):
        for method, seen in (("post", True), ("get", False)):
            request = getattr(RequestFactory(), method)("/")
            request.tenant = hall
            set_current_request(request)
            try:
                assert Soul.objects.filter(pk=soul.pk).exists() is seen, method
            finally:
                set_current_request(None)


# ---- the 115 exit check: manage.py shadow_read_diff -------------------------------------------------------

def _row_counts():
    from django.db import router

    return {(alias, m._meta.label): m._base_manager.using(alias).order_by().count()
            for alias in connections for m in apps.get_models(include_auto_created=True)
            if m._meta.managed and not m._meta.proxy and router.allow_migrate_model(alias, m)}


def _shadow(*args):
    import io

    from django.core.management import call_command
    from django.core.management.base import CommandError

    out = io.StringIO()
    try:
        call_command("shadow_read_diff", *args, stdout=out)
        return 0, out.getvalue()
    except CommandError as e:
        return 1, f"{out.getvalue()}\n{e}"


@sharded
def test_shadow_read_diff_is_clean_on_a_synced_world_and_writes_nothing(world):
    """The command over the synced world: no difference, data compared, and not one row more or less on any
    database afterwards (every request and the token minting are rolled back)."""
    before = _row_counts()
    code, out = _shadow("--all", "--endpoint", "soul", "--max-pages", "2")
    assert code == 0, out
    assert " 0 differ" in out and " 0 with data" not in out, out
    assert _row_counts() == before


@sharded
def test_shadow_read_diff_reports_a_row_no_shard_has_yet(world):
    """A soul written to control and not synced: cutting its civilization over changes the hall ADMIN's list,
    and the command says so and exits non-zero."""
    from apps.souls.models import Soul, SoulState
    from apps.tenants.models import Tenant

    hall = Tenant.objects.filter(declared_civilization="GREEK").order_by("code").first()
    Soul._base_manager.using("default").create(name="unsynced-shadow", tenant=hall, current_state=SoulState.JUDGING)
    code, out = _shadow("--civ", "GREEK", "--endpoint", "soul-list", "--max-pages", "50")
    assert code == 1, out
    assert "DIFFERS" in out and "unsynced-shadow" in out, out
