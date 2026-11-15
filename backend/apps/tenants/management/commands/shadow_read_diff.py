"""The stage-3 exit check on a live database (docs/audit/2026-11-15-sharding/PLAN.md 阶段 3, "影子读差异为 0").

    manage.py shadow_read_diff --civ GREEK          # before adding GREEK to SHARD_READ_CIVS
    manage.py shadow_read_diff --all                # every civilization with a shard, at once
    manage.py shadow_read_diff --civ GREEK --endpoint soul --max-pages 2

Every GET endpoint of the URLconf (apps/core/shadow_reads.py) is asked by existing users -- for each hall in
scope one active user per hall role, the civilization's ADMIN, a SYSTEM_ADMIN and a soul account of the
civilization; a role nobody holds is skipped and named -- twice: with SHARD_READ_CIVS as configured, and with
the civilization(s) added (in this process only). The answers are compared as multisets; any difference is
printed and the command exits non-zero.

Read-only: tokens are minted and every request runs inside a transaction on every database that is rolled
back (tests/test_sharded_reads_equal_single_db.py holds that the row counts of every alias are unchanged).
A task a GET hands to Celery directly (not on commit) still reaches the broker; none is known to do so.
"""
import random

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings
from rest_framework.test import APIClient

from apps.core import shadow_reads as shadow
from apps.core.shard_reads import CONTROL_ALIAS, read_context
from apps.core.sharding import alias_for_civilization, shard_aliases


class Command(BaseCommand):
    help = "Compare every GET endpoint's answer before and after cutting a civilization's reads over; exit 1 on a difference."

    def add_arguments(self, parser):
        who = parser.add_mutually_exclusive_group(required=True)
        who.add_argument("--civ", help="the civilization to cut over, e.g. GREEK")
        who.add_argument("--all", dest="every", action="store_true", help="every civilization that has a shard")
        parser.add_argument("--endpoint", default="", help="only URL names containing this text")
        parser.add_argument("--max-pages", type=int, default=5, help="pages of a list to compare (default 5)")
        parser.add_argument("--ids", type=int, default=2, help="ids per detail route (default 2)")
        parser.add_argument("--seed", type=int, default=0)

    def handle(self, *args, civ=None, every=False, endpoint="", max_pages=5, ids=2, seed=0, **options):
        from apps.souls.models import Civilization

        civs = [c for c in Civilization.values if alias_for_civilization(c) in shard_aliases()] if every else [civ]
        unknown = [c for c in civs if c not in Civilization.values or alias_for_civilization(c) not in settings.DATABASES]
        if unknown or not civs:
            raise CommandError(f"no shard configured for {unknown or civs}")
        before = list(settings.SHARD_READ_CIVS)
        after = before + [c for c in civs if c not in before]
        with read_context(CONTROL_ALIAS):
            callers, missing = _callers(civs)
        self.stdout.write(f"cut over: {before} -> {after}; callers: {sorted(callers)}")
        if missing:
            self.stdout.write(f"no user holds: {', '.join(missing)} (skipped)")
        found = shadow.endpoints()
        cases = sorted(c for c in found if endpoint in c)
        extra = {"HTTP_HOST": _host(), "secure": not settings.DEBUG}
        rng = random.Random(seed)
        pairs = with_data = 0
        differences = []
        # Each request's own context: the management command's FANOUT default must not stand in for it.
        with read_context(None):
            for case in cases:
                for who, client in callers.items():
                    answer = None
                    lst = shadow.list_route_of(found, found[case][2])
                    if found[case][1] and lst:
                        with override_settings(SHARD_READ_CIVS=before):
                            answer = shadow.fetch(client, _rev(lst), max_pages, **extra)
                    for url in shadow.urls_for(found, case, answer, rng, ids):
                        with override_settings(SHARD_READ_CIVS=before):
                            base = shadow.drop(shadow.fetch(client, url, max_pages, **extra), shadow.WRITES_ON_READ.get(case, ()))
                        with override_settings(SHARD_READ_CIVS=after):
                            cut = shadow.drop(shadow.fetch(client, url, max_pages, **extra), shadow.WRITES_ON_READ.get(case, ()))
                        pairs += 1
                        if base != cut:
                            differences.append(f"{who} GET {url}: {shadow.diff(base, cut)}")
                            self.stdout.write(f"DIFFERS {differences[-1]}")
                        elif shadow.has_data(base):
                            with_data += 1
        self.stdout.write(f"compared {pairs} (caller, URL) pairs over {len(cases)} endpoints; {with_data} with data; "
                          f"{len(differences)} differ")
        if differences:
            raise CommandError(f"{len(differences)} answers change when {civs} are cut over")


def _rev(name):
    from django.urls import reverse

    return reverse(name)


def _host():
    hosts = [h for h in settings.ALLOWED_HOSTS if h and "*" not in h]
    return hosts[0].lstrip(".") if hosts else "localhost"


def _callers(civs):
    """{label: client} of existing, active users; and the roles in scope nobody holds."""
    from apps.authentication.models import User, UserRole
    from apps.core.tenant import civilization_halls
    from apps.soul_accounts.models import SoulAccount

    callers, missing = {}, []
    hall_roles = [r for r in UserRole.values if r not in (UserRole.SYSTEM_ADMIN, UserRole.SOUL)]
    with shadow.rolled_back():  # minting a refresh token writes an outstanding-token row
        for civ in civs:
            for hall in civilization_halls(civ).filter(deleted_at__isnull=True).order_by("code"):
                for role in hall_roles:
                    user = User.objects.filter(tenant=hall, role=role, is_active=True).order_by("pk").first()
                    _add(callers, missing, f"{role}@{hall.code}", user, hall)
            _add(callers, missing, f"ADMIN@{civ}", User.objects.filter(
                role=UserRole.ADMIN, tenant__isnull=True, civilization=civ, is_active=True).order_by("pk").first())
            account = SoulAccount.objects.filter(
                soul__tenant__in=civilization_halls(civ), retired_at__isnull=True, user__is_active=True,
            ).order_by("created_at").first()
            _add(callers, missing, f"soul@{civ}", account.user if account else None, soul_account=account)
        _add(callers, missing, "SYSTEM_ADMIN", User.objects.filter(
            role=UserRole.SYSTEM_ADMIN, tenant__isnull=True, is_active=True).order_by("pk").first())
    return callers, missing


def _add(callers, missing, label, user, hall=None, soul_account=None):
    if user is None:
        missing.append(label)
        return
    if soul_account is not None:
        from apps.soul_accounts.authentication import SoulAccessToken

        token = SoulAccessToken.for_user(user)
        token["soul_account_id"] = str(soul_account.pk)
        token["cycle"] = soul_account.cycle
    else:
        from rest_framework_simplejwt.tokens import AccessToken

        token = AccessToken.for_user(user)
        if hall is not None:
            token["tenant_code"] = hall.code
    token["sv"] = getattr(user, "session_version", 0)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    callers[label] = client
