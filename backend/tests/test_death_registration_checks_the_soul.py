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
