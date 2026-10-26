"""?has_date_problem= is SQL, and answers exactly what the old Python walk did.

The oracle below IS the old implementation (walk every soul, run
check_soul_dates / check_record_date). A grid of birth/death/event triples
covers era crossings, unknown months/days, equal years, acknowledged warnings
and a reborn soul; the SQL filter must pick the same set, in one query.
"""
import itertools

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.reincarnation.services import ReincarnationService
from apps.souls.dates import ERROR, WARNING, check_record_date, check_soul_dates, date_warning_fingerprint
from apps.souls.filters import SoulFilter
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.souls.serializers import _this_lifes_records
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db

MD = [(None, None), (3, None), (3, 10), (6, 5)]


def _python_walk(souls):
    out = set()
    for soul in souls:
        birth = (soul.birth_year, soul.birth_month, soul.birth_day)
        death = (soul.death_year, soul.death_month, soul.death_day)
        if check_soul_dates(birth, death):
            out.add(soul.pk)
            continue
        for r in _this_lifes_records(soul):
            ev = (r.event_year, r.event_month, r.event_day)
            ps = check_record_date(ev, birth, death, ack_fingerprint=r.date_warning_ack_fingerprint or None)
            if any(p.severity == ERROR or (p.severity == WARNING and not p.acknowledged) for p in ps):
                out.add(soul.pk)
                break
    return out


def _record(soul, year, month=None, day=None, ack=""):
    return SoulRecord.objects.create(
        soul=soul, record_type="MERIT", civilization="CHINESE", description="d", weight=1,
        event_year=year, event_month=month, event_day=day, date_warning_ack_fingerprint=ack,
    )


@pytest.fixture
def grid():
    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]
    n = 0
    for by, (bm, bd), dy, (dm, dd) in itertools.product(
        [None, -500, 10, 1900], MD, [None, -3, 1900, 2000], MD
    ):
        if (by is None and (bm or bd)) or (dy is None and (dm or dd)):
            continue
        n += 1
        soul = Soul.objects.create(
            name=f"s{n}", tenant=tenant, birth_year=by, birth_month=bm, birth_day=bd,
            death_year=dy, death_month=dm, death_day=dd,
        )
        for ey, (em, ed) in itertools.islice(
            itertools.product([None, -400, 15, 1950, 2005], MD), n % 7, None, 9
        ):
            _record(soul, ey, em, ed)
    acked = Soul.objects.create(name="acked", tenant=tenant, birth_year=1900, death_year=1950)
    _record(acked, 1960, ack=date_warning_fingerprint((1960, None, None), (1950, None, None)))
    stale = Soul.objects.create(name="stale", tenant=tenant, birth_year=1900, death_year=1950)
    _record(stale, 1960, ack="1960-None-None|1940-None-None")
    reborn = Soul.objects.create(
        name="reborn", tenant=tenant, current_state=SoulState.REINCARNATING, death_year=2000
    )
    _record(reborn, 2000)
    ReincarnationService.complete_rebirth(soul=reborn, new_identity="Again")
    Soul.objects.filter(pk=reborn.pk).update(birth_year=2010)
    return acked, stale, reborn


def _ids(value):
    qs = SoulFilter({"has_date_problem": value}, queryset=Soul.objects.all()).qs
    return set(qs.values_list("pk", flat=True))


def test_sql_matches_the_python_walk(grid):
    acked, stale, reborn = grid
    souls = list(Soul.objects.prefetch_related("records", "reincarnations"))
    expected = _python_walk(souls)
    assert 0 < len(expected) < len(souls)
    assert _ids("true") == expected
    assert _ids("false") == {s.pk for s in souls} - expected
    assert acked.pk not in expected and stale.pk in expected and reborn.pk not in expected


def test_it_is_one_query_however_many_souls(grid):
    def count():
        with CaptureQueriesContext(connection) as ctx:
            list(SoulFilter({"has_date_problem": "true"}, queryset=Soul.objects.all()).qs.values_list("pk"))
        return len(ctx)

    tenant = Tenant.objects.get(code="CN_DIYU")
    before = count()
    for i in range(30):
        Soul.objects.create(name=f"x{i}", tenant=tenant, birth_year=1900, death_year=1800)
    assert count() == before == 1
