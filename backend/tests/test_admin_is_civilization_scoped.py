"""A hall-less ADMIN sees its own civilization, and only it; SYSTEM_ADMIN sees everything (stage 1A, §7.5).

Differential, not enumerated: a random world (seed printed) of two civilizations with two or three halls each,
one hall of unknown civilization, and rows with no hall at all. Then every router-registered list endpoint whose
model reaches a hall (the viewset walk of `test_tenant_scoping_contract.py`) is asked as

  * each hall's own ADMIN (token bound to that hall),
  * each civilization's hall-less ADMIN,
  * SYSTEM_ADMIN,

and the answers are compared with each other — never with a number written here:

  civilization ADMIN of X  ==  union over X's halls of what that hall's ADMIN sees
  SYSTEM_ADMIN             ⊇  union over every hall, the unknown one included, plus the hall-less rows

Rows are identified by the `id` / `pk` / `code` a list row carries; an endpoint whose rows carry none of them is
skipped (and counted, so the test cannot quietly compare nothing).

Every compared model gets a row in every hall (`_make`, a type-driven filler; `OVERRIDES` / `EXTRA_ROWS` for what
it cannot guess). Until 2026-11-15 the world held souls, actors, audit rows and realms only, and 42 of the 51
comparisons were between two empty sets — the count said 51. What is asserted now is the number of endpoints with
rows in both civilizations, and the exact list of those without (`EMPTY_BY_DESIGN`).
"""
import random

import pytest
from django.urls import get_resolver, reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.actors.models import Actor, ActorRole
from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User, UserRole
from apps.core.tenant import civilization_halls
from apps.judgment.models import CORPUS_CIVILIZATION
from apps.realms.models import Realm, RealmType
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant
from tests.test_tenant_scoping_contract import _model_for, _tenant_path

pytestmark = pytest.mark.django_db

SEEDED = {"CHINESE": "CN_DIYU", "EGYPTIAN": "EG_DUAT"}


def _list_routes():
    """(name, viewset class) for every router `-list` route without URL kwargs."""
    found = []

    def walk(resolver, ns):
        for pattern in resolver.url_patterns:
            if hasattr(pattern, "url_patterns"):
                walk(pattern, f"{ns}{pattern.namespace}:" if pattern.namespace else ns)
                continue
            cls = getattr(pattern.callback, "cls", None)
            actions = getattr(pattern.callback, "actions", None) or {}
            if cls is None or actions.get("get") != "list" or pattern.pattern.regex.groups:
                continue
            if pattern.name and _tenant_path(_model_for(cls)):
                found.append((f"{ns}{pattern.name}", cls))

    walk(get_resolver(), "")
    return sorted(set(found), key=lambda r: r[0])


def _client(user, hall=None):
    token = RefreshToken.for_user(user)
    if hall is not None:
        token["tenant_code"] = hall.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    client.user, client.hall = user, hall  # for tests that call a view's object gate directly
    return client


def _ids(client, url):
    """The row identities a list answers, all pages; None when the rows carry no identity; empty on non-200."""
    out = set()
    while url:
        res = client.get(url)
        if res.status_code != 200:
            return out
        body = res.json()
        rows = body.get("results", []) if isinstance(body, dict) else body
        if not isinstance(rows, list):
            return out
        for row in rows:
            key = next((row[k] for k in ("id", "pk", "code") if isinstance(row, dict) and k in row), None)
            if key is None:
                return None
            out.add(str(key))
        url = body.get("next") if isinstance(body, dict) else None
    return out


#: Field values the generic filler below cannot guess, by model: a row the hall's own ADMIN cannot list would make
#: that endpoint's comparison empty again (a dispatch DRAFT is its proposer's alone, `hide_others_drafts`).
OVERRIDES = {
    # A proposal has a soul and a target (approve / reject read both): another hall of the same civilization, so
    # the row stays inside one civilization's union (none for the unknown hall, which no approve here reaches).
    "DispatchRecord": {"status": "PROPOSED", "soul": "Soul", "target_tenant": lambda hall: civilization_halls(
        hall.known_civilization).exclude(pk=hall.pk).order_by("code").first()},
    "Conversation": {"kind": "OFFICER_INBOX"},
    "Reaction": {"post": "Post"},
    "Statute": {"corpus": lambda hall: next(k for k, v in CORPUS_CIVILIZATION.items()
                                            if v == (hall.known_civilization or "CHINESE"))},  # the soul inbox lists letters to a hall, not soul-to-soul rooms
}

#: More rows of a model, each with these values, where one row cannot be on every list that serves the model:
#: moderation queues list PENDING, the handled list HIDDEN, the circle PUBLISHED; the city-god list a case at it.
EXTRA_ROWS = {
    "Post": [{"moderation_status": "PENDING"}, {"moderation_status": "HIDDEN"}],
    "Comment": [{"moderation_status": "PENDING"}, {"moderation_status": "HIDDEN"}],
    "Judgment": [{"city_god_status": "PENDING", "city_god": "CityGod"}],
}

#: Compared endpoints that stay empty for every caller here, and why. Exact: an endpoint that gains rows, or one
#: that loses them, fails `test_…_sees_exactly…` until this list says so — the comparison count alone said 51 while
#: 42 of those compared two empty sets.
EMPTY_BY_DESIGN = {
    "notification-list": "a caller's own notifications only: no administrator lists another user's",
    "death-register-list": "authenticated by an external system's API key, not an officer token (401 to all here)",
    "webhook-list": "the same: the death-sync API key's own webhooks",
}


def _make(model, hall, cache, counter, tenant_path=(), values=None):
    """One saved row of ``model`` in ``hall``: required fields filled by type, FKs made recursively in the same hall,
    and every FK on ``tenant_path`` (``("workflow", "tenant")``…) filled even when nullable."""
    from django.db import models as m
    from django.utils import timezone

    from apps.tenants.models import Tenant

    civ = hall.known_civilization or "CHINESE"
    kw = {**OVERRIDES.get(model.__name__, {}), **(values or {})}
    for name, value in kw.items():
        f = model._meta.get_field(name)
        if callable(value):
            kw[name] = value(hall)
        elif f.is_relation and isinstance(value, str):  # a model name: that model's row in this hall
            if (f.related_model, hall.pk) not in cache:
                cache[(f.related_model, hall.pk)] = _make(f.related_model, hall, cache, counter)
            kw[name] = cache[(f.related_model, hall.pk)]
    for f in model._meta.concrete_fields:
        if f.primary_key or f.name in kw or getattr(f, "auto_now", False) or getattr(f, "auto_now_add", False):
            continue
        on_path = bool(tenant_path) and f.name == tenant_path[0]
        if f.is_relation and f.related_model is Tenant and (not f.null or f.name == "tenant"):
            kw[f.name] = hall
            continue
        if not on_path and (f.null or f.has_default() or (f.blank and isinstance(f, (m.CharField, m.TextField)))):
            continue
        counter[0] += 1
        n = counter[0]
        if f.is_relation:
            rel = f.related_model
            if rel is Tenant:
                kw[f.name] = hall
            elif f.one_to_one or rel.__name__ == "User" or (rel, hall.pk) not in cache:
                # A fresh user per field: two user FKs on one row (follower / following) must differ.
                row = _make(rel, hall, cache, counter, tenant_path[1:] if on_path else ())
                if not f.one_to_one:
                    cache[(rel, hall.pk)] = row
                kw[f.name] = row
            else:
                kw[f.name] = cache[(rel, hall.pk)]
        elif f.choices:
            kw[f.name] = civ if f.name.endswith("civilization") else f.choices[0][0]
        elif isinstance(f, m.JSONField):
            kw[f.name] = {}
        elif isinstance(f, m.UUIDField):
            import uuid

            kw[f.name] = uuid.uuid4()
        elif isinstance(f, m.URLField):
            kw[f.name] = f"https://example.invalid/{n}"
        elif isinstance(f, (m.CharField, m.TextField)):
            kw[f.name] = f"r{n}"[: f.max_length or 64]
        elif isinstance(f, m.BooleanField):
            kw[f.name] = False
        elif isinstance(f, (m.IntegerField, m.DecimalField, m.FloatField)):
            kw[f.name] = 1  # rounds, cycles, orders: the smallest legal value
        elif isinstance(f, m.DateTimeField):
            kw[f.name] = timezone.now() + timezone.timedelta(days=1)
        elif isinstance(f, m.DateField):
            kw[f.name] = timezone.localdate()
        else:
            raise AssertionError(f"{model.__name__}.{f.name}: no filler for {type(f).__name__}")
    if model.__name__ == "User":
        kw.pop("password", None)
        return model.objects.create_user(password="x", **kw)
    return model._base_manager.create(**kw)


@pytest.fixture
def world():
    seed = random.randrange(2**32)
    print(f"\ncivilization-scope world seed={seed}")
    rng = random.Random(seed)
    halls = {}
    for civ, seeded in SEEDED.items():
        first, _ = Tenant.objects.get_or_create(code=seeded, defaults={"display_name": seeded})
        halls[civ] = [first] + [
            Tenant.objects.create(code=f"{civ[:2]}_X{i}", display_name=f"{civ} {i}", declared_civilization=civ)
            for i in range(rng.randint(1, 2))
        ]
    unknown = Tenant.objects.create(code="UNKNOWN_HALL", display_name="unknown", declared_civilization="")
    every_hall = [h for hs in halls.values() for h in hs] + [unknown]

    for hall in every_hall:
        civ = hall.known_civilization or "CHINESE"
        for i in range(rng.randint(1, 3)):
            Soul.objects.create(name=f"s-{hall.code}-{i}", tenant=hall, current_state=SoulState.ALIVE,
                                merit_score=rng.randint(0, 50))
            Actor.objects.create(name=f"a-{hall.code}-{i}", role=ActorRole.JUDGE, civilization=civ, tenant=hall)
            AuditLog.objects.create(tenant=hall, action=AuditAction.READ, resource="soul", resource_id=f"{hall.code}{i}")
        if rng.random() < 0.7:
            Realm.objects.create(realm_code=f"R_{hall.code}", civilization=civ, name_local=hall.code,
                                 realm_type=RealmType.HELL, tenant=hall)
    models = {_model_for(cls) for _name, cls in _list_routes()} - {Tenant}
    counter = [0]
    for hall in every_hall:
        cache = {}
        for model in sorted(models, key=lambda mm: mm.__name__):
            path = tuple(_tenant_path(model).split("__"))
            # Already there: a hall's organization is made with the hall, a post with a reaction made before it.
            if not model._base_manager.filter(**{_tenant_path(model): hall}).exists():
                _make(model, hall, cache, counter, path)
            for values in EXTRA_ROWS.get(model.__name__, []):
                _make(model, hall, cache, counter, path, values)
    hall_less_log = AuditLog.objects.create(tenant=None, action=AuditAction.READ, resource="soul", resource_id="none")

    def admin(name, **kw):
        return User.objects.create_user(username=name, password="x", **kw)

    return {
        "seed": seed,
        "halls": halls,
        "unknown": unknown,
        "hall_admin": {h.pk: _client(admin(f"adm-{h.code}", role=UserRole.ADMIN, tenant=h), h) for h in every_hall},
        "civ_admin": {civ: _client(admin(f"civ-{civ}", role=UserRole.ADMIN, tenant=None, civilization=civ))
                      for civ in halls},
        "system": _client(admin("sys-admin", role=UserRole.SYSTEM_ADMIN, tenant=None)),
        "hall_less": {"audit": str(hall_less_log.pk)},
    }


def test_a_civilization_admin_sees_exactly_its_halls_and_system_admin_sees_everything(world):
    compared, skipped, mismatches, empty = 0, [], [], set()
    for name, _cls in _list_routes():
        url = reverse(name)
        by_hall = {pk: _ids(c, url) for pk, c in world["hall_admin"].items()}
        if any(v is None for v in by_hall.values()):
            skipped.append(name)
            continue
        everything = _ids(world["system"], url)
        all_halls = set().union(*by_hall.values())
        if not everything >= all_halls:
            mismatches.append(f"{url}: SYSTEM_ADMIN misses {sorted(all_halls - everything)[:5]}")
        for civ, halls in world["halls"].items():
            mine = _ids(world["civ_admin"][civ], url)
            union = set().union(*(by_hall[h.pk] for h in halls))
            if not union:
                empty.add(name)  # this civilization's comparison would be two empty sets
            if mine != union:
                mismatches.append(f"{url} as {civ} ADMIN: extra {sorted(mine - union)[:5]}, "
                                  f"missing {sorted(union - mine)[:5]}")
            if mine & by_hall[world["unknown"].pk]:
                mismatches.append(f"{url} as {civ} ADMIN: sees the unknown-civilization hall's rows")
        compared += 1
    with_data = compared - len(empty)
    print(f"compared {compared} list endpoints, {with_data} with rows in both civilizations; "
          f"empty: {sorted(empty)}; skipped (rows carry no id): {skipped}")
    assert not mismatches, f"seed={world['seed']}\n" + "\n".join(mismatches)
    assert empty == set(EMPTY_BY_DESIGN), (
        f"seed={world['seed']}: endpoints with no rows for some civilization, not listed in EMPTY_BY_DESIGN: "
        f"{sorted(empty - set(EMPTY_BY_DESIGN))}; listed but now have rows: {sorted(set(EMPTY_BY_DESIGN) - empty)}")
    assert with_data >= 40, (with_data, sorted(empty))


def test_rows_of_no_hall_are_system_admins_only(world):
    """An audit row with no hall: SYSTEM_ADMIN reads it, no civilization ADMIN does. (A soul with no hall is an
    orphan the soul list leaves out for everyone, `exclude_orphaned`, so it cannot carry this assertion.)"""
    url = reverse("audit:audit-log-list")
    row = world["hall_less"]["audit"]
    assert row in _ids(world["system"], url), f"seed={world['seed']}"
    for civ, client in world["civ_admin"].items():
        assert row not in _ids(client, url), (civ, f"seed={world['seed']}")


def test_a_civilization_admin_without_a_civilization_sees_nothing():
    """Fail closed: a hall-less ADMIN whose civilization is blank (or not a member) reaches no hall."""
    hall, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})
    Soul.objects.create(name="someone", tenant=hall, current_state=SoulState.ALIVE)
    blank = _client(User.objects.create_user(username="civ-blank", password="x", role=UserRole.ADMIN, tenant=None))
    rows = blank.get(reverse("soul-list")).json()
    assert rows["count"] == 0


def test_a_civilization_admin_enters_only_its_own_civilizations_halls():
    """Hall view (`POST /tenants/{code}/view/`): a civilization ADMIN may enter a hall of its civilization; another
    civilization's hall, and a hall of unknown civilization, does not exist for it (404). SYSTEM_ADMIN enters any."""
    cn, _ = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})
    eg, _ = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "EG"})
    unknown = Tenant.objects.create(code="UNKNOWN_HALL", display_name="unknown")
    civ = _client(User.objects.create_user(username="civ-cn", password="x", role=UserRole.ADMIN, tenant=None,
                                           civilization="CHINESE"))
    system = _client(User.objects.create_user(username="sys-v", password="x", role=UserRole.SYSTEM_ADMIN, tenant=None))
    assert civ.post(f"/api/v1/tenants/{cn.code}/view/").status_code == 201
    assert civ.post(f"/api/v1/tenants/{eg.code}/view/").status_code == 404
    assert civ.post(f"/api/v1/tenants/{unknown.code}/view/").status_code == 404
    assert system.post(f"/api/v1/tenants/{eg.code}/view/").status_code == 201
