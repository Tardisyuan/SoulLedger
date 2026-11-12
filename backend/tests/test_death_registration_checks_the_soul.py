"""死亡登记(外部同步与土地公)对灵魂的核对,流程走查 2026-11-12 F-DEATH 一节。"""
import datetime

import pytest

from apps.death_sync.models import DeathRegistrationStatus, ExternalApiKey
from apps.death_sync.services import DeathSyncService
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


@pytest.fixture
def tenant(db):
    from tests.city_god_support import default_city_god

    tenant = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]
    default_city_god(tenant)
    return tenant


@pytest.fixture
def api_key(tenant):
    _raw, key_hash, key_prefix = ExternalApiKey.generate_key()
    return ExternalApiKey.objects.create(
        tenant=tenant, name="feed", system_type="HOSPITAL", key_hash=key_hash, key_prefix=key_prefix)


def _register(tenant, api_key, lookup, key, death_date=datetime.date(2026, 6, 1), **extra):
    return DeathSyncService.register_death(
        tenant, api_key, {"soul_lookup": lookup, "death_date": death_date, **extra}, key)


class TestDatesAreChecked:
    """F-DEATH-05: `/souls/{id}/die/` refused a death before birth or a 150-year life; death sync wrote it."""

    def test_a_death_before_birth_is_a_validation_error_and_nothing_dies(self, tenant, api_key):
        soul = Soul.objects.create(name="Backwards", tenant=tenant, birth_year=2019)
        record = _register(tenant, api_key, {"soul_id": str(soul.id)}, "dates-1", datetime.date(1990, 1, 1))
        assert (record.status, record.error_code) == (DeathRegistrationStatus.FAILED, "VALIDATION_ERROR")
        assert "before birth" in record.error_message
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE
        assert soul.death_year is None

    def test_an_implausible_lifespan_is_a_validation_error(self, tenant, api_key):
        soul = Soul.objects.create(name="Methuselah", tenant=tenant, birth_year=1487)
        record = _register(tenant, api_key, {"soul_id": str(soul.id)}, "dates-2")
        assert record.error_code == "VALIDATION_ERROR"
        soul.refresh_from_db()
        assert soul.current_state == SoulState.ALIVE


class TestNameLookupFindsTheLivingSoul:
    """F-DEATH-03: a name lookup took `.first()` (the newest) whatever its state."""

    def test_the_living_namesake_dies_not_the_newer_dead_one(self, tenant, api_key):
        living = Soul.objects.create(name="Zhang San", tenant=tenant)
        dead = Soul.objects.create(name="Zhang San", tenant=tenant, current_state=SoulState.JUDGING)
        record = _register(tenant, api_key, {"name": "Zhang San"}, "name-1")
        assert record.status == DeathRegistrationStatus.PROCESSED
        assert record.soul_id == living.pk
        living.refresh_from_db()
        assert living.current_state == SoulState.JUDGING
        assert dead.pk != living.pk

    def test_two_living_namesakes_are_refused_and_neither_dies(self, tenant, api_key):
        first = Soul.objects.create(name="Li Si", tenant=tenant)
        second = Soul.objects.create(name="Li Si", tenant=tenant)
        record = _register(tenant, api_key, {"name": "Li Si"}, "name-2")
        assert (record.status, record.error_code) == (DeathRegistrationStatus.FAILED, "SOUL_AMBIGUOUS")
        for soul in (first, second):
            soul.refresh_from_db()
            assert soul.current_state == SoulState.ALIVE

    def test_only_a_dead_namesake_still_answers_not_alive(self, tenant, api_key):
        Soul.objects.create(name="Wang Wu", tenant=tenant, current_state=SoulState.JUDGING)
        assert _register(tenant, api_key, {"name": "Wang Wu"}, "name-3").error_code == "SOUL_NOT_ALIVE"


class TestThePlaceOfDeathIsNotTheBirthplace:
    """F-DEATH-06: `die()` wrote the place of death over `origin_location`, and the city god was then matched by it."""

    def test_the_birthplace_stays_and_picks_the_city_god(self, tenant, api_key):
        from apps.judgment.models import CityGod

        hangzhou = CityGod.objects.create(tenant=tenant, name="杭州府城隍", regions=["杭州"])
        CityGod.objects.create(tenant=tenant, name="顺天府城隍", regions=["北京"])
        soul = Soul.objects.create(name="客死", tenant=tenant, origin_location="杭州")
        record = _register(tenant, api_key, {"soul_id": str(soul.id)}, "place-1", death_location="北京协和医院")
        assert record.status == DeathRegistrationStatus.PROCESSED
        soul.refresh_from_db()
        assert (soul.origin_location, soul.death_location) == ("杭州", "北京协和医院")
        assert record.judgment.city_god == hangzhou

    def test_a_place_wider_than_the_column_is_refused_at_the_door(self):
        from apps.death_sync.serializers import DeathRegistrationCreateSerializer

        body = {"soul_lookup": {"name": "x"}, "death_date": "2026-06-01"}
        assert DeathRegistrationCreateSerializer(data={**body, "death_location": "地" * 255}).is_valid()
        assert not DeathRegistrationCreateSerializer(data={**body, "death_location": "地" * 256}).is_valid()
