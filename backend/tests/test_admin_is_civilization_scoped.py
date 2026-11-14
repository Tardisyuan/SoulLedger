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
"""
import random

import pytest
from django.urls import get_resolver, reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.actors.models import Actor, ActorRole
from apps.audit.models import AuditAction, AuditLog
from apps.authentication.models import User, UserRole
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
    compared, skipped, mismatches = 0, [], []
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
            if mine != union:
                mismatches.append(f"{url} as {civ} ADMIN: extra {sorted(mine - union)[:5]}, "
                                  f"missing {sorted(union - mine)[:5]}")
            if mine & by_hall[world["unknown"].pk]:
                mismatches.append(f"{url} as {civ} ADMIN: sees the unknown-civilization hall's rows")
        compared += 1
    print(f"compared {compared} list endpoints; skipped (rows carry no id): {skipped}")
    assert not mismatches, f"seed={world['seed']}\n" + "\n".join(mismatches)
    assert compared >= 20, (compared, skipped)


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
