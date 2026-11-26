"""A soul account reads the shard of its soul's primary hall, not every leg (apps/core/shard_reads.py::
soul_read_context; the sharding plan (not in this repo) 阶段 4).

The world is test_sharded_reads_equal_single_db's (same seed variable, `SHARDED_READS_SEED=<n>` replays it): rows in
every civilization, a soul residing abroad and a soul back from residence with the rows its residence court wrote.
On top of it accounts for: per civilization a random soul of a random hall with no row abroad, a random soul the
filler pointed rows of another civilization at, a soul of the hall of no known civilization, and two pen pals of two
civilizations (a DIRECT conversation lives in the initiator's hall).

* every soul-facing GET route -- derived from the URLconf: the views behind SoulJWTAuthentication -- asked by every
  soul account, once with nothing cut over (the single database) and once with all four cut over: equal. A route
  with an id in its path is asked with ids the same soul's other answers carry, and one id of nothing.
* absence: no answer carries the id of another soul's private row (its judgments, records, dispositions, ...).
* counting: a soul with no rows abroad runs statements on exactly one shard -- its primary's -- on every route,
  ACROSS included (control too: the account, the hall). The soul in residence reads beyond it on ACROSS routes
  only.
"""
import io
import json
import random
import uuid

import pytest
from django.core.management import call_command
from django.db import connections
from django.test import override_settings

from apps.core.shard_reads import READS_SOUL_ROWS_ABROAD
from apps.core.sharding import alias_for_civilization
from apps.soul_accounts.authentication import SoulJWTAuthentication
from tests import endpoint_answers as shadow
from tests import test_sharded_reads_equal_single_db as world_of
from tests.test_shard_sync import CIVS, HAS_SHARDS, _sync, sharded
from tests.test_sharded_reads_equal_single_db import _chat_on, _seed_in_report, _small_pages  # noqa: F401 -- autouse

SEED = world_of.SEED
SOUL_ROUTES = {case: e for case, e in world_of.ENDPOINTS.items()
               if SoulJWTAuthentication in getattr(e[2], "authentication_classes", ())}

#: Soul GET routes that show the soul's rows in another civilization's shard: their views set
#: `reads_soul_rows_abroad` (the reason), and a soul with rows abroad reads every leg there (soul_read_context).
ACROSS = {case: getattr(e[2], READS_SOUL_ROWS_ABROAD) for case, e in SOUL_ROUTES.items()
          if getattr(e[2], READS_SOUL_ROWS_ABROAD, None)}
#: ACROSS routes the world gives no data: nothing to compare there, said here instead of skipped silently.
NO_DATA_HERE = {"me-chat-image": "the world sends no letter images", "me-wangsi": "no untimely judgment is made",
                "me-past-lives": "every account is its soul's first life", "me-rebirth-applications":
                "no soul applied in this life (`has_data` reads the empty `results`)"}

#: The id carried by every private row of a soul (absence check): rows keyed by the soul, read only by it and its
#: officers. Conversations are left out (a DIRECT one is the other soul's too), so are social rows (public).
PRIVATE = ("souls.SoulRecord", "judgment.Judgment", "judgment.JudgmentAppeal", "disposition.Disposition",
           "reincarnation.Reincarnation", "sentence_plan.SentencePlan", "dispatch.DispatchRecord",
           "soul_accounts.RebirthApplication")


# ---- the world --------------------------------------------------------------------------------------------

def _account_of(client):
    from apps.soul_accounts.authentication import SoulAccessToken
    from apps.soul_accounts.models import SoulAccount

    raw = client._credentials["HTTP_AUTHORIZATION"].split()[1]
    return SoulAccount.objects.get(user_id=SoulAccessToken(raw)["user_id"])


def _give_client(account):
    from tests.soul_account_support import soul_client

    return soul_client(account)


def _give_account(soul):
    from apps.soul_accounts import services as svc
    from apps.soul_accounts.models import AccountOrigin
    from tests.soul_account_support import soul_client

    account, _ = svc.provision_account(soul, AccountOrigin.OFFICER)
    account.must_change_password = False
    account.initial_password_expires_at = None
    account.save()
    return account, soul_client(account)


def _abroad(soul):
    """Does a row naming `soul` (a crossing key) live in a hall of another civilization than the soul's?"""
    from apps.core.shard_reads import crossing_keys
    from apps.core.sharding import tenant_path
    from apps.souls.models import Soul
    from apps.tenants.models import Tenant

    mine = [h.pk for h in Tenant.objects.all() if h.civilization == soul.tenant.civilization]
    return any(f.model._base_manager.filter(**{f.name: soul}).exclude(**{f"{tenant_path(f.model)}__in": mine}).exists()
               for f in crossing_keys() if f.related_model is Soul)


def _souls(rng, w):
    """{name: (account, client)}: the two movers; per civilization a random soul of a random hall with no row abroad
    (one with judgments when there is one); a random soul of the filler with rows abroad (a crossing key pointed
    across); a soul of the hall of no known civilization; two pen pals of two civilizations in a DIRECT
    conversation (it lives in the initiator's hall)."""
    from apps.chat.models import Conversation, ConversationKind
    from apps.judgment.models import Judgment
    from apps.souls.models import Soul, SoulState
    from tests.soul_account_support import ready_soul

    out = {name: (_account_of(w["callers"][name]), w["callers"][name]) for name in ("soul abroad", "soul back home")}
    free = list(Soul._base_manager.filter(is_deleted=False, accounts__isnull=True, tenant__isnull=False)
                .exclude(current_state=SoulState.ALIVE)
                .select_related("tenant").order_by("pk"))
    for civ in CIVS:
        souls = [s for s in free if s.tenant.civilization == civ and not _abroad(s)]
        if not souls:  # every soul of `civ` is named by a row abroad (the crossing keys pointed at all of them): a new one
            hall = rng.choice([h for h in w["halls"] if h.civilization == civ])
            souls = [Soul.objects.create(name=f"s-{hall.code}-home", tenant=hall, current_state=SoulState.JUDGING)]
            print(f"soul of {civ}: none without a row abroad, made {souls[0].pk} in {hall.code}")
        judged = [s for s in souls if Judgment._base_manager.filter(soul=s).exists()]
        out[f"soul of {civ}"] = _give_account(rng.choice(judged or souls))
    crossed = [s for s in free if s.tenant.civilization in CIVS and _abroad(s)]
    if crossed:
        out["soul with rows abroad"] = _give_account(rng.choice(crossed))
    unknown = next(h for h in w["halls"] if h.civilization not in CIVS)
    out["soul of no known civilization"] = ready_soul(unknown, name="unknown-civ soul")
    c1, c2 = rng.sample(CIVS, 2)
    pals = sorted((ready_soul(rng.choice([h for h in w["halls"] if h.civilization == c]), name=f"pal-{c}")[0]
                   for c in (c1, c2)), key=lambda acc: str(acc.soul_id))
    a, b = pals
    Conversation.objects.create(kind=ConversationKind.DIRECT, soul_a_id=a.soul_id, soul_b_id=b.soul_id,
                                account_a=a, account_b=b, tenant=a.soul.tenant, initiator_id=a.soul_id,
                                room_id=f"!direct-{a.soul_id}:{world_of.WORLD_MATRIX}")
    for i, acc in enumerate(pals):
        out[f"pen pal {i}"] = (acc, _give_client(acc))
    return out


@pytest.fixture(scope="module")
def world(django_db_setup, django_db_blocker):
    if not HAS_SHARDS:
        pytest.skip("needs --ds=config.settings_sharded")
    print(f"SHARDED_READS_SEED={SEED}")
    with django_db_blocker.unblock():
        atomics = world_of._outer_atomics()
        try:
            rng = random.Random(SEED)
            w = world_of._build(rng)
            w["souls"] = _souls(rng, w)
            _sync()
            call_command("note_soul_whereabouts", stdout=io.StringIO())  # the pen pals' conversation, made above
            yield w
        finally:
            world_of._rollback(atomics)


# ---- asking -----------------------------------------------------------------------------------------------

def _ask(client, url, civs):
    with override_settings(SHARDED=bool(civs)):
        return shadow.fetch(client, url)


def _ids_in(value, out):
    if isinstance(value, dict):
        for k, v in value.items():
            if (k == "id" or k.endswith("_id")) and isinstance(v, (str, int)) and not isinstance(v, bool):
                out.add(v)
            _ids_in(v, out)
    elif isinstance(value, list):
        for v in value:
            _ids_in(v, out)
    return out


def _urls(client, rng):
    """Every soul GET route: the plain ones, then those with one id in the path, asked with ids the plain answers
    of the same soul carry (and one id of nothing) -- up to three each."""
    from django.urls import reverse

    plain = {case: reverse(name) for case, (name, kwargs, _cls, _a) in SOUL_ROUTES.items() if not kwargs}
    ids = set()
    for url in plain.values():
        ids |= _ids_in(_ask(client, url, [])[1], set())
    urls = dict(plain)
    for case, (name, kwargs, _cls, _a) in SOUL_ROUTES.items():
        if len(kwargs) != 1:
            continue
        for i, value in enumerate(rng.sample(sorted(map(str, ids)), min(3, len(ids))) + [str(uuid.uuid4())]):
            try:
                urls[f"{case}#{i}"] = reverse(name, kwargs={kwargs[0]: value})
            except Exception:  # noqa: BLE001,S112 -- an id of another type (an int route, a uuid id)
                continue
    return urls


def _private_ids_of_others(account):
    """Ids of the PRIVATE rows of every other soul, less those the soul's own private rows point to (the random
    world joins an appeal of this soul to a judgment of another one; the soul sees that judgment's id by design)."""
    from django.apps import apps

    others, pointed_to = set(), set()
    for label in PRIVATE:
        model = apps.get_model(label)
        keys = [f.attname for f in model._meta.concrete_fields if f.is_relation]
        for row in model._base_manager.filter(soul_id=account.soul_id).values_list(*keys):
            pointed_to.update(str(v) for v in row if v is not None)
        others.update(str(pk) for pk in model._base_manager.exclude(soul_id=account.soul_id)
                      .values_list("pk", flat=True) if isinstance(pk, uuid.UUID))
    return others - pointed_to


@sharded
def test_every_soul_route_reads_like_the_single_database(world):
    assert len(SOUL_ROUTES) >= 30, sorted(SOUL_ROUTES)
    rng = random.Random(f"{SEED}:soul-routes")
    mismatches, leaks, with_data, asked = [], [], set(), 0
    for who, (account, client) in world["souls"].items():
        others = _private_ids_of_others(account)
        for case, url in _urls(client, rng).items():
            base = _ask(client, url, [])
            cut = _ask(client, url, CIVS)
            asked += 1
            if base != cut:
                mismatches.append(f"{who} GET {url}: {shadow.diff(base, cut)}")
            text = json.dumps(cut, default=str)
            leaked = sorted(i for i in others if i in text)
            if leaked:
                leaks.append(f"{who} GET {url}: rows of another soul {leaked[:3]}")
            if shadow.has_data(base):
                with_data.add(case.split("#")[0])
    assert not mismatches, f"SHARDED_READS_SEED={SEED}\n" + "\n".join(mismatches[:20])
    assert not leaks, f"SHARDED_READS_SEED={SEED}\n" + "\n".join(leaks[:8])
    # Not vacuous: the routes that cross civilizations answered rows, and most routes answered something.
    assert set(ACROSS) <= set(SOUL_ROUTES), sorted(set(ACROSS) - set(SOUL_ROUTES))
    missing = set(ACROSS) - set(NO_DATA_HERE) - with_data
    assert not missing, (sorted(missing), f"SHARDED_READS_SEED={SEED}")
    # 13 of 30 had data on 2026-11-17 (the rest answer settings, empty lists, or ids of nothing).
    assert len(with_data) >= len(SOUL_ROUTES) // 3, (asked, sorted(with_data))


_TRANSACTION_SQL = ("SAVEPOINT", "RELEASE", "ROLLBACK", "BEGIN", "COMMIT")


def _shards_touched(client, url):
    """The shard aliases a GET ran statements on (the rolled-back transaction of shadow.fetch left out), counted on
    the connections themselves: an execute wrapper on every alias."""
    from contextlib import ExitStack

    touched = set()

    def record(alias):
        def wrapper(execute, sql, params, many, context):
            if not sql.lstrip().upper().startswith(_TRANSACTION_SQL):
                touched.add(alias)
            return execute(sql, params, many, context)
        return wrapper

    with ExitStack() as stack:
        for alias in connections:
            stack.enter_context(connections[alias].execute_wrapper(record(alias)))
        _ask(client, url, CIVS)
    return touched & {alias_for_civilization(c) for c in CIVS}


@sharded
def test_a_soul_request_touches_its_primary_shard_and_no_other(world):
    """A soul whose rows are all in its own civilization (no residence, no letters abroad): every soul GET route,
    ACROSS too, runs its statements on control and on one shard, its primary hall's. The soul in residence reads
    beyond its primary on an ACROSS route and only there: the other half of soul_read_context.

    Control is where the design needs it: the account, the hall, and what `soul_directory` keeps of the soul -- its
    open move (SOUL_MOVING) and the shards holding rows that name it (SOUL_ROWS_IN). Until 2026-11-21 every request
    also asked each other shard's outbox for a move in flight (`_primary_soul` through `legs` -> `_not_arriving`, 3
    statements) and, on an ACROSS route, each other shard for rows naming the soul (`_rows_abroad`, 3 more).
    Mutations: `_primary_soul` with `legs(Soul)` (hiding arriving souls by every outbox) -> every route reads every
    shard; `_rows_abroad` asking the shards again -> every ACROSS route does."""
    rng = random.Random(f"{SEED}:counting")
    wrong = []
    for civ in CIVS:
        account, client = world["souls"][f"soul of {civ}"]
        primary = alias_for_civilization(account.soul.tenant.civilization)
        for url in _urls(client, rng).values():
            on_shards = _shards_touched(client, url)
            if on_shards != {primary}:
                wrong.append(f"{civ} soul GET {url}: shards {sorted(on_shards)}, want [{primary}]")
    assert not wrong, f"SHARDED_READS_SEED={SEED}\n" + "\n".join(wrong[:10])
    account, abroad = world["souls"]["soul abroad"]
    primary = alias_for_civilization(account.soul.tenant.civilization)
    assert len(_shards_touched(abroad, "/api/v1/me/life/")) > 1, "the soul in residence read one shard only"
    assert _shards_touched(abroad, "/api/v1/me/sessions/") == {primary}, "a route that shows no row abroad fanned out"


@sharded
def test_a_soul_of_no_known_civilization_or_no_hall_reads_every_leg(world):
    """Nothing says which shard holds such a soul's rows: today's FANOUT, not control and not a guess."""
    from apps.authentication.models import User
    from apps.core.shard_reads import FANOUT, soul_read_context
    from apps.souls.models import Soul

    account, _client = world["souls"]["soul of no known civilization"]
    with override_settings(SHARDED=True):
        assert soul_read_context(User.objects.get(pk=account.user_id)) == FANOUT
        account, _client = world["souls"]["soul of GREEK"]
        assert soul_read_context(User.objects.get(pk=account.user_id)) == "civ_greek"
        Soul._base_manager.using("civ_greek").filter(pk=account.soul_id).update(tenant=None)  # its primary row
        assert soul_read_context(User.objects.get(pk=account.user_id)) == FANOUT
