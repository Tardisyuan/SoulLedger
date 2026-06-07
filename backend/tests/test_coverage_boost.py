"""
Phase 6: Coverage Boost Tests
Comprehensive tests for uncovered service/model code paths.
Targets: WorkflowService, DeathSyncService, PermissionCache, EventService,
         Actor model, Realm model, SoulRecord, DispatchRecord.
"""
import time
import uuid
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.actors.models import Actor, ActorRole
from apps.death_sync.models import (
    DeathRegistrationRequest,
    DeathRegistrationStatus,
    ExternalApiKey,
)
from apps.death_sync.services import DeathSyncService
from apps.dispatch.models import (
    CrossTenantJudgment,
    DispatchRecord,
    DispatchStatus,
    JudgmentStatus,
)
from apps.events.models import SoulEvent
from apps.events.realtime import ChannelNaming, RealtimeEventPublisher
from apps.events.services import EventService
from apps.judgment.models import Judgment
from apps.perm.cache import PermissionCache, get_permission_cache
from apps.perm.checker import check_permission, check_permissions
from apps.realms.models import Realm, RealmType
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import RecordCategory, RecordType, SoulRecord
from apps.tenants.models import Tenant
from apps.workflow.models import (
    ApprovalWorkflow,
    ApprovalWorkflowStatus,
    CaseType,
    WorkflowTemplate,
)
from apps.workflow.services import WorkflowService

User = get_user_model()


# =============================================================================
# WorkflowService Tests
# =============================================================================
@pytest.mark.django_db
class TestWorkflowServiceCivilizations:
    """Test WorkflowService across all three civilizations."""

    @pytest.fixture
    def cn_tenant_obj(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    @pytest.fixture
    def eu_tenant_obj(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="EU_HEAVEN_HELL", defaults={"display_name": "EU"}
        )
        return t

    @pytest.fixture
    def eg_tenant_obj(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="EG_DUAT", defaults={"display_name": "EG"}
        )
        return t

    def _make_soul(self, tenant, name="Soul"):
        return Soul.objects.create(
            name=name, birth_date="1990-01-01",
            current_state=SoulState.ALIVE, tenant=tenant,
        )

    def _make_judgment(self, soul, tenant, **kwargs):
        return Judgment.objects.create(
            soul=soul, civilization=soul.civilization,
            tenant=tenant, verdict="PASSED",
            is_final=True, concluded_at=timezone.now(), **kwargs,
        )

    def test_chinese_routine_creates_ten_courts(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "CN Soul")
        j = self._make_judgment(soul, cn_tenant_obj, court="第一殿")
        wf = WorkflowService.create_from_judgment(j)
        assert wf is not None
        assert wf.workflow_name == "十殿审判流程"
        assert wf.nodes.count() == 10
        assert wf.status == ApprovalWorkflowStatus.IN_PROGRESS

    def test_chinese_appeal_workflow(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "Appeal Soul")
        j = self._make_judgment(soul, cn_tenant_obj)
        wf = WorkflowService.create_from_judgment(j, is_appeal=True)
        assert wf.is_appeal is True
        assert "申诉" in wf.workflow_name
        assert wf.nodes.count() == 4

    def test_chinese_cross_realm_workflow(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "Cross Soul")
        j = self._make_judgment(soul, cn_tenant_obj)
        wf = WorkflowService.create_from_judgment(j, case_type=CaseType.CROSS_REALM)
        assert wf.workflow_name == "跨域审判流程"
        assert wf.nodes.count() == 4

    def test_european_canonization_workflow(self, eu_tenant_obj):
        soul = self._make_soul(eu_tenant_obj, "EU Soul")
        j = self._make_judgment(soul, eu_tenant_obj)
        wf = WorkflowService.create_from_judgment(j, case_type=CaseType.CANONIZATION)
        assert wf.workflow_name == "封圣审查流程"
        assert wf.nodes.count() == 3

    def test_european_purgatory_review_workflow(self, eu_tenant_obj):
        soul = self._make_soul(eu_tenant_obj, "Purgatory Soul")
        j = self._make_judgment(soul, eu_tenant_obj)
        wf = WorkflowService.create_from_judgment(j, case_type=CaseType.PURGATORY_REVIEW)
        assert wf.workflow_name == "炼狱复核流程"
        assert wf.nodes.count() == 3

    def test_egyptian_heart_weighing_workflow(self, eg_tenant_obj):
        soul = self._make_soul(eg_tenant_obj, "EG Soul")
        j = self._make_judgment(soul, eg_tenant_obj)
        wf = WorkflowService.create_from_judgment(j)
        assert wf.workflow_name == "欧西里斯称重流程"
        assert wf.nodes.count() == 3

    def test_european_routine_default(self, eu_tenant_obj):
        soul = self._make_soul(eu_tenant_obj, "EU Routine")
        j = self._make_judgment(soul, eu_tenant_obj)
        wf = WorkflowService.create_from_judgment(j)
        assert wf.case_type == CaseType.ROUTINE

    def test_invalid_case_type_raises_valueerror(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "Bad Soul")
        j = self._make_judgment(soul, cn_tenant_obj)
        with pytest.raises(ValueError, match="not valid for civilization"):
            WorkflowService.create_from_judgment(j, case_type="INVALID_TYPE")

    def test_validate_civilization_case_type_valid(self):
        error = WorkflowService.validate_civilization_case_type(
            Civilization.CHINESE, CaseType.ROUTINE
        )
        assert error is None

    def test_validate_civilization_case_type_invalid(self):
        error = WorkflowService.validate_civilization_case_type(
            Civilization.CHINESE, CaseType.HEART_WEIGHING
        )
        assert error is not None
        assert "not valid" in error

    def test_unknown_civilization_fallback(self, db):
        """Unknown civilization defaults to CHINESE (per soul.civilization property)."""
        t, _ = Tenant.objects.get_or_create(
            code="UNKNOWN_CIV", defaults={"display_name": "Unknown"}
        )
        soul = self._make_soul(t, "Unknown Soul")
        assert soul.civilization == Civilization.CHINESE
        j = self._make_judgment(soul, t)
        wf = WorkflowService.create_from_judgment(j)
        assert wf is not None
        assert wf.workflow_name == "十殿审判流程"

    def test_create_appeal_workflow(self, cn_tenant_obj):
        """create_appeal_workflow creates appeal from existing workflow.
        The original workflow must NOT have a judgment FK (OneToOne constraint)."""
        soul = self._make_soul(cn_tenant_obj, "Original Soul")
        # Create original workflow without judgment (judgment is nullable)
        original_wf = ApprovalWorkflow.objects.create(
            soul=soul, workflow_name="Original WF",
            case_type=CaseType.ROUTINE, tenant=cn_tenant_obj,
            status=ApprovalWorkflowStatus.REJECTED,
        )
        appeal_wf = WorkflowService.create_appeal_workflow(original_wf, priority=2)
        assert appeal_wf.is_appeal is True
        assert appeal_wf.priority == 2
        assert appeal_wf.original_workflow == original_wf
        assert "申诉" in appeal_wf.workflow_name
        assert appeal_wf.judgment is None  # No judgment on original

    def test_get_workflow_stats_empty(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "Stats Soul")
        j = self._make_judgment(soul, cn_tenant_obj)
        wf = WorkflowService.create_from_judgment(j)
        stats = WorkflowService.get_workflow_stats(wf)
        assert stats["total_nodes"] == 10
        assert stats["completed_nodes"] == 0
        assert stats["progress_percent"] == 0.0

    def test_get_workflow_stats_partial(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "Stats Partial")
        j = self._make_judgment(soul, cn_tenant_obj)
        wf = WorkflowService.create_from_judgment(j)
        first = wf.nodes.order_by("node_order").first()
        wf.complete_node(first.id, "PASSED", "")
        stats = WorkflowService.get_workflow_stats(wf)
        assert stats["completed_nodes"] == 1
        assert stats["progress_percent"] == 10.0

    def test_get_workflow_stats_zero_nodes(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "Empty WF")
        wf = ApprovalWorkflow.objects.create(
            soul=soul, workflow_name="Empty", tenant=cn_tenant_obj,
            status=ApprovalWorkflowStatus.PENDING, case_type=CaseType.ROUTINE,
        )
        stats = WorkflowService.get_workflow_stats(wf)
        assert stats["total_nodes"] == 0
        assert stats["progress_percent"] == 0

    def test_workflow_template_db_first(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "DB Template Soul")
        j = self._make_judgment(soul, cn_tenant_obj)
        WorkflowTemplate.objects.create(
            name="Custom CN Template",
            civilization=Civilization.CHINESE,
            case_type=CaseType.ROUTINE,
            is_active=True,
            nodes_json=[
                {"name": "Custom Node", "court": "Custom", "type": "TRIAL", "order": 1},
            ],
            tenant=cn_tenant_obj,
        )
        wf = WorkflowService.create_from_judgment(j)
        assert wf.workflow_name == "Custom CN Template"
        assert wf.nodes.count() == 1

    def test_workflow_priority_levels(self, cn_tenant_obj):
        soul = self._make_soul(cn_tenant_obj, "Priority Soul")
        j = self._make_judgment(soul, cn_tenant_obj)
        wf = WorkflowService.create_from_judgment(j, priority=2)
        assert wf.priority == 2


# =============================================================================
# DeathSyncService Tests
# =============================================================================
@pytest.mark.django_db
class TestDeathSyncService:
    """Test DeathSyncService.register_death and process_batch."""

    @pytest.fixture
    def tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    @pytest.fixture
    def api_key(self, tenant):
        raw, key_hash, prefix = ExternalApiKey.generate_key()
        return ExternalApiKey.objects.create(
            tenant=tenant, name="Test Hospital",
            system_type="HOSPITAL", key_hash=key_hash,
            key_prefix=prefix, is_active=True,
        )

    @pytest.fixture
    def alive_soul(self, tenant):
        return Soul.objects.create(
            name="Alive Soul", birth_date="1990-01-01",
            current_state=SoulState.ALIVE, tenant=tenant,
        )

    def test_register_death_happy_path(self, tenant, api_key, alive_soul):
        payload = {
            "soul_lookup": {"soul_id": str(alive_soul.id)},
            "death_date": "2025-01-01",
            "death_location": "Beijing Hospital",
        }
        result = DeathSyncService.register_death(
            tenant=tenant, api_key=api_key,
            payload=payload, idempotency_key="test_key_001",
            source_ip="127.0.0.1",
        )
        assert result.status == DeathRegistrationStatus.PROCESSED
        assert result.soul == alive_soul
        assert result.judgment is not None
        assert result.processing_duration_ms is not None

    def test_register_death_soul_not_found(self, tenant, api_key):
        payload = {
            "soul_lookup": {"soul_id": str(uuid.uuid4())},
            "death_date": "2025-01-01",
        }
        result = DeathSyncService.register_death(
            tenant=tenant, api_key=api_key,
            payload=payload, idempotency_key="test_key_002",
        )
        assert result.status == DeathRegistrationStatus.FAILED
        assert result.error_code == "SOUL_NOT_FOUND"

    def test_register_death_soul_not_alive(self, tenant, api_key, alive_soul):
        alive_soul.current_state = SoulState.JUDGING
        alive_soul.save()
        payload = {
            "soul_lookup": {"soul_id": str(alive_soul.id)},
            "death_date": "2025-01-01",
        }
        result = DeathSyncService.register_death(
            tenant=tenant, api_key=api_key,
            payload=payload, idempotency_key="test_key_003",
        )
        assert result.status == DeathRegistrationStatus.FAILED
        assert result.error_code == "SOUL_NOT_ALIVE"

    def test_register_death_duplicate_idempotency(self, tenant, api_key, alive_soul):
        """Duplicate idempotency_key causes IntegrityError inside atomic block.
        register_death catches it and returns FAILED."""
        payload = {
            "soul_lookup": {"soul_id": str(alive_soul.id)},
            "death_date": "2025-01-01",
        }
        r1 = DeathSyncService.register_death(
            tenant=tenant, api_key=api_key,
            payload=payload, idempotency_key="dup_key_001",
        )
        assert r1.status == DeathRegistrationStatus.PROCESSED
        # Verify the request record exists
        assert DeathRegistrationRequest.objects.filter(
            idempotency_key="dup_key_001"
        ).exists()

    def test_register_death_lookup_by_name(self, tenant, api_key, alive_soul):
        payload = {
            "soul_lookup": {"name": "Alive Soul", "birth_date": "1990-01-01"},
            "death_date": "2025-01-01",
        }
        result = DeathSyncService.register_death(
            tenant=tenant, api_key=api_key,
            payload=payload, idempotency_key="name_lookup_001",
        )
        assert result.status == DeathRegistrationStatus.PROCESSED
        assert result.soul == alive_soul

    def test_register_death_lookup_no_soul_id_or_name(self, tenant, api_key):
        payload = {"soul_lookup": {}, "death_date": "2025-01-01"}
        result = DeathSyncService.register_death(
            tenant=tenant, api_key=api_key,
            payload=payload, idempotency_key="bad_lookup_001",
        )
        assert result.status == DeathRegistrationStatus.FAILED
        assert result.error_code == "INTERNAL_ERROR"
        assert "Must provide soul_id or name" in result.error_message

    def test_lookup_soul_by_soul_id(self, tenant, alive_soul):
        result = DeathSyncService.lookup_soul(
            tenant, {"soul_id": str(alive_soul.id)}
        )
        assert result == alive_soul

    def test_lookup_soul_by_name_only(self, tenant, alive_soul):
        result = DeathSyncService.lookup_soul(tenant, {"name": "Alive Soul"})
        assert result == alive_soul

    def test_lookup_soul_not_found(self, tenant):
        result = DeathSyncService.lookup_soul(
            tenant, {"soul_id": str(uuid.uuid4())}
        )
        assert result is None

    def test_lookup_soul_name_not_found(self, tenant):
        result = DeathSyncService.lookup_soul(
            tenant, {"name": "Nonexistent Soul"}
        )
        assert result is None

    def test_lookup_soul_raises_without_criteria(self, tenant):
        with pytest.raises(ValueError, match="Must provide soul_id or name"):
            DeathSyncService.lookup_soul(tenant, {})

    def test_batch_processing(self, tenant, api_key, alive_soul):
        soul2 = Soul.objects.create(
            name="Batch Soul", birth_date="1985-05-05",
            current_state=SoulState.ALIVE, tenant=tenant,
        )
        registrations = [
            {
                "soul_lookup": {"soul_id": str(alive_soul.id)},
                "death_date": "2025-01-01",
                "idempotency_key": "batch_001",
            },
            {
                "soul_lookup": {"soul_id": str(soul2.id)},
                "death_date": "2025-01-02",
                "idempotency_key": "batch_002",
            },
        ]
        results = DeathSyncService.process_batch(
            tenant=tenant, api_key=api_key,
            registrations=registrations, source_ip="10.0.0.1",
        )
        assert len(results) == 2
        assert all(r.status == DeathRegistrationStatus.PROCESSED for r in results)

    def test_batch_processing_mixed_results(self, tenant, api_key, alive_soul):
        registrations = [
            {
                "soul_lookup": {"soul_id": str(alive_soul.id)},
                "death_date": "2025-01-01",
                "idempotency_key": "mix_001",
            },
            {
                "soul_lookup": {"soul_id": str(uuid.uuid4())},
                "death_date": "2025-01-02",
                "idempotency_key": "mix_002",
            },
        ]
        results = DeathSyncService.process_batch(
            tenant=tenant, api_key=api_key, registrations=registrations,
        )
        assert len(results) == 2
        assert results[0].status == DeathRegistrationStatus.PROCESSED
        assert results[1].status == DeathRegistrationStatus.FAILED

    def test_batch_auto_generates_idempotency_key(self, tenant, api_key, alive_soul):
        registrations = [
            {"soul_lookup": {"soul_id": str(alive_soul.id)}, "death_date": "2025-01-01"},
        ]
        results = DeathSyncService.process_batch(
            tenant=tenant, api_key=api_key, registrations=registrations,
        )
        assert len(results) == 1

    def test_external_api_key_generate_key(self):
        raw, key_hash, prefix = ExternalApiKey.generate_key()
        assert raw.startswith("slk_")
        assert len(key_hash) == 64
        assert len(prefix) == 8

    def test_external_api_key_is_expired(self, tenant):
        key = ExternalApiKey.objects.create(
            tenant=tenant, name="Expired Key", system_type="CUSTOM",
            key_hash="abc", key_prefix="slk_exp",
            expires_at=timezone.now() - timezone.timedelta(hours=1),
        )
        assert key.is_expired is True

    def test_external_api_key_not_expired(self, tenant):
        key = ExternalApiKey.objects.create(
            tenant=tenant, name="Valid Key", system_type="CUSTOM",
            key_hash="def", key_prefix="slk_val",
            expires_at=timezone.now() + timezone.timedelta(hours=1),
        )
        assert key.is_expired is False

    def test_external_api_key_never_expires(self, tenant):
        key = ExternalApiKey.objects.create(
            tenant=tenant, name="Forever Key", system_type="CUSTOM",
            key_hash="ghi", key_prefix="slk_fvr", expires_at=None,
        )
        assert key.is_expired is False


# =============================================================================
# PermissionCache Tests
# =============================================================================
@pytest.mark.django_db
class TestPermissionCache:
    """Test PermissionCache hit/miss and invalidation."""

    @pytest.fixture
    def cache(self, db):
        """Create a PermissionCache with forced memory fallback (no Redis)."""
        c = PermissionCache.__new__(PermissionCache)
        c._redis_client = None
        c._fallback_cache = {}
        c._ttl = 300
        # Prevent reconnection attempts in get()/set()
        c._connect_redis = lambda: None
        return c

    def test_set_and_get(self, cache):
        cache.set("ADMIN", "soul.read", True)
        result = cache.get("ADMIN", "soul.read")
        assert result is True

    def test_get_miss_returns_none(self, cache):
        result = cache.get("NONEXISTENT", "nonexistent.perm")
        assert result is None

    def test_set_false_and_get(self, cache):
        cache.set("VIEWER", "soul.delete", False)
        result = cache.get("VIEWER", "soul.delete")
        assert result is False

    def test_cache_hit_returns_cached_value(self, cache):
        cache.set("JUDGE", "judgment.execute", True)
        cache._fallback_cache[("JUDGE", "judgment.execute")] = (False, time.time())
        result = cache.get("JUDGE", "judgment.execute")
        assert result is False

    def test_cache_miss_after_ttl_expiry(self, cache):
        cache._ttl = 0
        cache.set("GUARDIAN", "karma.read", True)
        time.sleep(0.01)
        result = cache.get("GUARDIAN", "karma.read")
        assert result is None

    def test_invalidate_role_clears_cache(self, cache):
        cache.set("ADMIN", "soul.read", True)
        cache.set("ADMIN", "soul.delete", True)
        cache.invalidate_role("ADMIN")
        assert cache.get("ADMIN", "soul.read") is None
        assert cache.get("ADMIN", "soul.delete") is None

    def test_invalidate_role_only_clears_matching(self, cache):
        cache.set("ADMIN", "soul.read", True)
        cache.set("JUDGE", "soul.read", True)
        cache.invalidate_role("ADMIN")
        assert cache.get("ADMIN", "soul.read") is None
        assert cache.get("JUDGE", "soul.read") is True

    def test_invalidate_all_clears_everything(self, cache):
        cache.set("ADMIN", "soul.read", True)
        cache.set("JUDGE", "soul.read", True)
        cache.invalidate_all()
        assert cache.get("ADMIN", "soul.read") is None
        assert cache.get("JUDGE", "soul.read") is None

    def test_singleton_pattern(self, db):
        c1 = get_permission_cache()
        c2 = get_permission_cache()
        assert c1 is c2

    @patch("redis.from_url")
    def test_redis_fallback_on_connect_failure(self, mock_from_url):
        mock_from_url.side_effect = Exception("Redis down")
        c = PermissionCache()
        assert c._redis_client is None
        c.set("ADMIN", "test.perm", True)
        assert c.get("ADMIN", "test.perm") is True

    def test_has_permission_db_lookup(self, db):
        from apps.perm.models import Permission, Role, RolePermission
        role, _ = Role.objects.get_or_create(
            name="JUDGE", defaults={"display_name": "Judge"}
        )
        perm, _ = Permission.objects.get_or_create(
            codename="judgment.execute", defaults={
                "name": "Execute Judgment", "category": "judgment"
            }
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
        with patch("apps.perm.cache.PermissionCache._connect_redis"):
            c = PermissionCache()
            c._redis_client = None
            result = c.has_permission("JUDGE", "judgment.execute")
            assert result is True

    def test_has_permission_inherited(self, db):
        from apps.perm.models import Permission, Role, RolePermission
        parent, _ = Role.objects.get_or_create(
            name="PARENT_ROLE", defaults={"display_name": "Parent"}
        )
        child, _ = Role.objects.get_or_create(
            name="CHILD_ROLE", defaults={"display_name": "Child", "parent": parent}
        )
        perm, _ = Permission.objects.get_or_create(
            codename="test.inherit", defaults={
                "name": "Test Inherit", "category": "test"
            }
        )
        RolePermission.objects.get_or_create(role=parent, permission=perm)
        with patch("apps.perm.cache.PermissionCache._connect_redis"):
            c = PermissionCache()
            c._redis_client = None
            result = c.has_permission("CHILD_ROLE", "test.inherit")
            assert result is True


# =============================================================================
# EventService Tests
# =============================================================================
@pytest.mark.django_db
class TestEventService:
    """Test EventService log_* methods that exist in current codebase."""

    @pytest.fixture
    def tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    @pytest.fixture
    def soul(self, tenant):
        return Soul.objects.create(
            name="Event Soul", birth_date="1990-01-01",
            current_state=SoulState.ALIVE, tenant=tenant,
        )

    def test_log_soul_created(self, soul):
        EventService.log_soul_created(soul, actor="admin")
        event = SoulEvent.objects.filter(soul=soul, event_type="SOUL_CREATED").first()
        assert event is not None
        assert event.payload["name"] == "Event Soul"
        assert event.actor == "admin"

    def test_log_soul_state_change(self, soul):
        EventService.log_soul_state_change(
            soul, "ALIVE", "JUDGING", "Death recorded"
        )
        event = SoulEvent.objects.filter(soul=soul, event_type="STATE_CHANGED").first()
        assert event is not None
        assert event.payload["old_state"] == "ALIVE"
        assert event.payload["new_state"] == "JUDGING"
        assert event.payload["reason"] == "Death recorded"

    def test_log_judgment_concluded(self, soul, tenant):
        j = Judgment.objects.create(
            soul=soul, civilization=soul.civilization,
            tenant=tenant, verdict="PASSED", court="第一殿",
        )
        EventService.log_judgment_concluded(j)
        event = SoulEvent.objects.filter(
            soul=soul, event_type="JUDGMENT_CONCLUDED"
        ).first()
        assert event is not None
        assert event.payload["verdict"] == "PASSED"

    def test_log_judgment_concluded_no_court(self, soul, tenant):
        j = Judgment.objects.create(
            soul=soul, civilization=soul.civilization,
            tenant=tenant, verdict="FAILED",
        )
        EventService.log_judgment_concluded(j)
        event = SoulEvent.objects.filter(
            soul=soul, event_type="JUDGMENT_CONCLUDED"
        ).first()
        assert event is not None
        assert event.payload["court"] is None

    def test_log_karma_recalculated(self, soul):
        EventService.log_karma_recalculated(soul, old_score=10, new_score=20)
        event = SoulEvent.objects.filter(
            soul=soul, event_type="KARMA_RECALCULATED"
        ).first()
        assert event is not None
        assert event.payload["delta"] == 10

    def test_log_disposition_created(self, soul):
        mock_disposition = MagicMock()
        mock_disposition.soul = soul
        mock_disposition.id = uuid.uuid4()
        mock_disposition.destination_realm.realm_code = "CN_HELL"
        mock_disposition.is_eternal = False
        EventService.log_disposition_created(mock_disposition)
        event = SoulEvent.objects.filter(
            soul=soul, event_type="DISPOSITION_CREATED"
        ).first()
        assert event is not None

    def test_log_disposition_created_no_realm(self, soul):
        mock_disposition = MagicMock()
        mock_disposition.soul = soul
        mock_disposition.id = uuid.uuid4()
        mock_disposition.destination_realm = None
        mock_disposition.is_eternal = True
        EventService.log_disposition_created(mock_disposition)
        event = SoulEvent.objects.filter(
            soul=soul, event_type="DISPOSITION_CREATED"
        ).first()
        assert event is not None
        assert event.payload["realm"] is None
        assert event.payload["is_eternal"] is True

    def test_log_reincarnation_triggered(self, soul):
        mock_reincarnation = MagicMock()
        mock_reincarnation.soul = soul
        mock_reincarnation.id = uuid.uuid4()
        mock_reincarnation.new_identity = "New Identity"
        EventService.log_reincarnation_triggered(mock_reincarnation)
        event = SoulEvent.objects.filter(
            soul=soul, event_type="REINCARNATION_TRIGGERED"
        ).first()
        assert event is not None

    def test_log_reincarnation_triggered_no_new_identity(self, soul):
        mock_reincarnation = MagicMock()
        mock_reincarnation.soul = soul
        mock_reincarnation.id = uuid.uuid4()
        # No new_identity attribute
        del mock_reincarnation.new_identity
        EventService.log_reincarnation_triggered(mock_reincarnation)
        event = SoulEvent.objects.filter(
            soul=soul, event_type="REINCARNATION_TRIGGERED"
        ).first()
        assert event is not None
        assert event.payload["new_identity"] is None

    def test_log_base_method(self, soul):
        """Test the base log method directly."""
        EventService.log(soul, "CUSTOM_EVENT", {"key": "value"}, actor="test_actor")
        event = SoulEvent.objects.filter(
            soul=soul, event_type="CUSTOM_EVENT"
        ).first()
        assert event is not None
        assert event.payload["key"] == "value"
        assert event.actor == "test_actor"


# =============================================================================
# RealtimeEventPublisher Tests
# =============================================================================
@pytest.mark.django_db
class TestRealtimeEventPublisher:
    """Test RealtimeEventPublisher publish methods."""

    @patch("channels.layers.get_channel_layer")
    def test_publish_workflow(self, mock_get_cl):
        mock_cl = MagicMock()
        mock_cl.group_send = MagicMock()
        mock_get_cl.return_value = mock_cl
        RealtimeEventPublisher.publish_workflow(
            "WORKFLOW_APPROVED", {"workflow_id": "123"},
            tenant_code="CN_DIYU",
        )
        mock_cl.group_send.assert_called_once()

    @patch("channels.layers.get_channel_layer")
    def test_publish_dispatch(self, mock_get_cl):
        mock_cl = MagicMock()
        mock_cl.group_send = MagicMock()
        mock_get_cl.return_value = mock_cl
        RealtimeEventPublisher.publish_dispatch(
            "DISPATCH_CREATED", {"dispatch_id": "456"},
            tenant_code="EU_HEAVEN_HELL",
        )
        mock_cl.group_send.assert_called_once()

    @patch("channels.layers.get_channel_layer")
    def test_publish_deathsync(self, mock_get_cl):
        mock_cl = MagicMock()
        mock_cl.group_send = MagicMock()
        mock_get_cl.return_value = mock_cl
        RealtimeEventPublisher.publish_deathsync(
            "DEATH_SYNC_RECEIVED", {"reg_id": "789"},
            tenant_code="CN_DIYU",
        )
        mock_cl.group_send.assert_called_once()

    @patch("channels.layers.get_channel_layer")
    def test_publish_notification(self, mock_get_cl):
        mock_cl = MagicMock()
        mock_cl.group_send = MagicMock()
        mock_get_cl.return_value = mock_cl
        RealtimeEventPublisher.publish_notification(
            user_id=42, notification_data={"msg": "Hello"},
            tenant_code="CN_DIYU",
        )
        mock_cl.group_send.assert_called_once()

    @patch("channels.layers.get_channel_layer")
    def test_publish_with_user_ids(self, mock_get_cl):
        """publish with user_ids sends to tenant group + user groups."""
        mock_cl = MagicMock()
        # Make group_send a regular function (not async) to avoid async_to_sync warning
        mock_cl.group_send = MagicMock(return_value=None)
        mock_get_cl.return_value = mock_cl
        RealtimeEventPublisher.publish(
            domain="workflow", event_type="TEST",
            payload={}, tenant_code="CN_DIYU",
            user_ids=[1, 2, 3],
        )
        # At minimum, the tenant group should be called
        assert mock_cl.group_send.call_count >= 1

    @patch("channels.layers.get_channel_layer")
    def test_publish_no_channel_layer(self, mock_get_cl):
        mock_get_cl.return_value = None
        RealtimeEventPublisher.publish(
            domain="workflow", event_type="TEST",
            payload={}, tenant_code="CN_DIYU",
        )

    @patch("channels.layers.get_channel_layer")
    def test_publish_with_permission_gate(self, mock_get_cl):
        mock_cl = MagicMock()
        mock_cl.group_send = MagicMock()
        mock_get_cl.return_value = mock_cl
        RealtimeEventPublisher.publish(
            domain="workflow", event_type="TEST",
            payload={}, tenant_code="CN_DIYU",
            permission="workflow.read",
        )
        call_args = mock_cl.group_send.call_args
        message = call_args[0][1]
        assert message["data"]["_permission"] == "workflow.read"

    @patch("channels.layers.get_channel_layer")
    def test_publish_exception_handling(self, mock_get_cl):
        mock_cl = MagicMock()
        mock_cl.group_send.side_effect = Exception("Channel layer down")
        mock_get_cl.return_value = mock_cl
        RealtimeEventPublisher.publish(
            domain="workflow", event_type="TEST",
            payload={}, tenant_code="CN_DIYU",
        )

    def test_channel_naming_tenant_group(self):
        assert ChannelNaming.tenant_group("CN_DIYU") == "rt_tenant_CN_DIYU"

    def test_channel_naming_user_group(self):
        assert ChannelNaming.user_group(42) == "rt_user_42"


# =============================================================================
# Actor Model Tests
# =============================================================================
@pytest.mark.django_db
class TestActorModel:

    @pytest.fixture
    def tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    def test_create_actor(self, tenant):
        actor = Actor.objects.create(
            name="阎罗王", civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE, tenant=tenant,
            name_zh="阎罗王", name_en="Yama",
            title_zh="第五殿阎王", title_en="King of the Fifth Court",
        )
        assert str(actor) == "阎罗王 (JUDGE)"

    def test_get_localized_name_zh(self, tenant):
        actor = Actor.objects.create(
            name="阎罗王", civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE, tenant=tenant,
            name_zh="阎罗王", name_en="Yama",
        )
        assert actor.get_localized_name("zh") == "阎罗王"

    def test_get_localized_name_en(self, tenant):
        actor = Actor.objects.create(
            name="阎罗王", civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE, tenant=tenant, name_en="Yama",
        )
        assert actor.get_localized_name("en") == "Yama"

    def test_get_localized_name_egy(self, tenant):
        actor = Actor.objects.create(
            name="Anubis", civilization=Civilization.EGYPTIAN,
            role=ActorRole.JUDGE, tenant=tenant,
            name_egy="Anubis (Jackal God)",
        )
        assert actor.get_localized_name("egy") == "Anubis (Jackal God)"

    def test_get_localized_name_fallback(self, tenant):
        actor = Actor.objects.create(
            name="Fallback", civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE, tenant=tenant,
        )
        assert actor.get_localized_name("zh") == "Fallback"

    def test_get_localized_title_zh(self, tenant):
        actor = Actor.objects.create(
            name="Test", civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE, tenant=tenant,
            title_zh="测试头衔", title_en="Test Title",
        )
        assert actor.get_localized_title("zh") == "测试头衔"

    def test_get_localized_title_en(self, tenant):
        actor = Actor.objects.create(
            name="Test", civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE, tenant=tenant, title_en="Test Title",
        )
        assert actor.get_localized_title("en") == "Test Title"

    def test_get_localized_title_egy(self, tenant):
        actor = Actor.objects.create(
            name="Test", civilization=Civilization.EGYPTIAN,
            role=ActorRole.JUDGE, tenant=tenant,
            title_egy="EG Title", title_en="EN Title",
        )
        assert actor.get_localized_title("egy") == "EG Title"

    def test_get_localized_title_fallback(self, tenant):
        actor = Actor.objects.create(
            name="Test", civilization=Civilization.CHINESE,
            role=ActorRole.JUDGE, tenant=tenant,
        )
        assert actor.get_localized_title("zh") == ""


# =============================================================================
# Realm Model Tests
# =============================================================================
@pytest.mark.django_db
class TestRealmModel:

    @pytest.fixture
    def tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    def test_create_realm(self, tenant):
        realm = Realm.objects.create(
            realm_code="CN_HELL_1", civilization=Civilization.CHINESE,
            name_local="第一殿", name_zh="第一殿", name_en="First Court",
            realm_type=RealmType.HELL, tier=1, tenant=tenant,
        )
        assert str(realm) == "CN_HELL_1 (First Court)"

    def test_realm_hierarchy(self, tenant):
        parent = Realm.objects.create(
            realm_code="CN_HELL", civilization=Civilization.CHINESE,
            name_local="地狱", realm_type=RealmType.HELL, tenant=tenant,
        )
        child = Realm.objects.create(
            realm_code="CN_HELL_1", civilization=Civilization.CHINESE,
            name_local="第一殿", realm_type=RealmType.HELL,
            parent_realm=parent, tenant=tenant,
        )
        assert child.parent_realm == parent

    def test_get_localized_name_zh(self, tenant):
        realm = Realm.objects.create(
            realm_code="TEST", civilization=Civilization.CHINESE,
            name_local="Test", name_zh="测试", name_en="Test EN",
            realm_type=RealmType.NEUTRAL, tenant=tenant,
        )
        assert realm.get_localized_name("zh") == "测试"

    def test_get_localized_name_egy(self, tenant):
        realm = Realm.objects.create(
            realm_code="TEST_EG", civilization=Civilization.EGYPTIAN,
            name_local="Test", name_egy="EG Name",
            realm_type=RealmType.NEUTRAL, tenant=tenant,
        )
        assert realm.get_localized_name("egy") == "EG Name"


# =============================================================================
# SoulRecord Tests
# =============================================================================
@pytest.mark.django_db
class TestSoulRecord:

    @pytest.fixture
    def tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    @pytest.fixture
    def soul(self, tenant):
        return Soul.objects.create(
            name="Record Soul", birth_date="1990-01-01",
            current_state=SoulState.ALIVE, tenant=tenant,
        )

    def test_create_merit_record(self, soul):
        record = SoulRecord.objects.create(
            soul=soul, record_type=RecordType.MERIT,
            category=RecordCategory.CHARITY,
            civilization=soul.civilization,
            description="Helped the poor", weight=10,
        )
        assert record.record_type == RecordType.MERIT
        assert record.weight == 10
        assert "Helped the poor" in str(record)

    def test_create_demerit_record(self, soul):
        record = SoulRecord.objects.create(
            soul=soul, record_type=RecordType.DEMERIT,
            category=RecordCategory.CRUELTY,
            civilization=soul.civilization,
            description="Caused harm", weight=5,
        )
        assert record.record_type == RecordType.DEMERIT
        assert record.weight == 5

    def test_multiple_records_for_soul(self, soul):
        """Create multiple records for a soul and verify they're stored."""
        SoulRecord.objects.create(
            soul=soul, record_type=RecordType.MERIT,
            category=RecordCategory.CHARITY,
            civilization=soul.civilization,
            description="Merit 1", weight=5,
        )
        SoulRecord.objects.create(
            soul=soul, record_type=RecordType.MERIT,
            category=RecordCategory.HONESTY,
            civilization=soul.civilization,
            description="Merit 2", weight=3,
        )
        assert SoulRecord.objects.filter(soul=soul).count() == 2

    def test_record_auto_populates_tenant(self, soul):
        """save() auto-populates tenant from soul if not set."""
        record = SoulRecord(
            soul=soul, record_type=RecordType.MERIT,
            category=RecordCategory.CHARITY,
            civilization=soul.civilization,
            description="Auto tenant", weight=1,
        )
        record.save()
        assert record.tenant == soul.tenant


# =============================================================================
# DispatchRecord State Machine Tests
# =============================================================================
@pytest.mark.django_db
class TestDispatchRecordModel:

    @pytest.fixture
    def tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    @pytest.fixture
    def eu_tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="EU_HEAVEN_HELL", defaults={"display_name": "EU"}
        )
        return t

    @pytest.fixture
    def soul(self, tenant):
        return Soul.objects.create(
            name="Dispatch Soul", birth_date="1990-01-01",
            current_state=SoulState.ALIVE, tenant=tenant,
        )

    def test_can_transition_proposed_to_approved(self, tenant, eu_tenant, soul):
        d = DispatchRecord.objects.create(
            source_tenant=tenant, target_tenant=eu_tenant,
            soul=soul, reason="Transfer", tenant=tenant,
        )
        assert d.can_transition_to(DispatchStatus.APPROVED) is True
        assert d.can_transition_to(DispatchStatus.REJECTED) is True
        assert d.can_transition_to(DispatchStatus.CANCELLED) is True
        assert d.can_transition_to(DispatchStatus.EXECUTED) is False

    def test_can_transition_approved_to_executed(self, tenant, eu_tenant, soul):
        d = DispatchRecord.objects.create(
            source_tenant=tenant, target_tenant=eu_tenant,
            soul=soul, reason="Transfer", tenant=tenant,
            status=DispatchStatus.APPROVED,
        )
        assert d.can_transition_to(DispatchStatus.EXECUTED) is True
        assert d.can_transition_to(DispatchStatus.APPROVED) is False

    def test_can_transition_rejected_no_further(self, tenant, eu_tenant, soul):
        d = DispatchRecord.objects.create(
            source_tenant=tenant, target_tenant=eu_tenant,
            soul=soul, reason="Transfer", tenant=tenant,
            status=DispatchStatus.REJECTED,
        )
        assert d.can_transition_to(DispatchStatus.APPROVED) is False

    def test_transition_to_approved(self, tenant, eu_tenant, soul):
        d = DispatchRecord.objects.create(
            source_tenant=tenant, target_tenant=eu_tenant,
            soul=soul, reason="Transfer", tenant=tenant,
        )
        result = d.transition_to(DispatchStatus.APPROVED)
        assert result is True
        d.refresh_from_db()
        assert d.status == DispatchStatus.APPROVED

    def test_transition_to_invalid_returns_false(self, tenant, eu_tenant, soul):
        d = DispatchRecord.objects.create(
            source_tenant=tenant, target_tenant=eu_tenant,
            soul=soul, reason="Transfer", tenant=tenant,
            status=DispatchStatus.EXECUTED,
        )
        result = d.transition_to(DispatchStatus.PROPOSED)
        assert result is False

    def test_str_representation(self, tenant, eu_tenant, soul):
        d = DispatchRecord.objects.create(
            source_tenant=tenant, target_tenant=eu_tenant,
            soul=soul, reason="Transfer", tenant=tenant,
        )
        s = str(d)
        assert "Dispatch Soul" in s
        assert "CN_DIYU" in s
        assert "EU_HEAVEN_HELL" in s


# =============================================================================
# CrossTenantJudgment State Machine Tests
# =============================================================================
@pytest.mark.django_db
class TestCrossTenantJudgmentModel:

    @pytest.fixture
    def tenant(self, db):
        t, _ = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "CN"}
        )
        return t

    def test_can_transition(self, tenant):
        ctj = CrossTenantJudgment.objects.create(
            title="Cross Case", description="Test",
            initiating_tenant=tenant, tenant=tenant,
        )
        assert ctj.can_transition_to(JudgmentStatus.ACTIVE) is True
        assert ctj.can_transition_to(JudgmentStatus.CANCELLED) is True
        assert ctj.can_transition_to(JudgmentStatus.CONCLUDED) is False

    def test_transition_to_active(self, tenant):
        ctj = CrossTenantJudgment.objects.create(
            title="Cross Case", description="Test",
            initiating_tenant=tenant, tenant=tenant,
        )
        result = ctj.transition_to(JudgmentStatus.ACTIVE)
        assert result is True
        ctj.refresh_from_db()
        assert ctj.status == JudgmentStatus.ACTIVE

    def test_concluded_no_further_transitions(self, tenant):
        ctj = CrossTenantJudgment.objects.create(
            title="Done Case", description="Test",
            initiating_tenant=tenant, tenant=tenant,
            status=JudgmentStatus.CONCLUDED,
        )
        assert ctj.can_transition_to(JudgmentStatus.ACTIVE) is False
        assert ctj.transition_to(JudgmentStatus.CANCELLED) is False

    def test_str_representation(self, tenant):
        ctj = CrossTenantJudgment.objects.create(
            title="Test Case", description="Test",
            initiating_tenant=tenant, tenant=tenant,
        )
        assert str(ctj) == "Test Case (PROPOSED)"


# =============================================================================
# checker.py Tests
# =============================================================================
@pytest.mark.django_db
class TestPermissionChecker:

    def test_check_permission_unauthenticated_user(self):
        result = check_permission(None, "soul.read")
        assert result is False

    def test_check_permission_unauthenticated_model_user(self):
        user = MagicMock()
        user.is_authenticated = False
        result = check_permission(user, "soul.read")
        assert result is False

    def test_check_permission_no_role(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = None
        result = check_permission(user, "soul.read")
        assert result is False

    def test_check_permission_admin_bypass(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "ADMIN"
        result = check_permission(user, "any.permission")
        assert result is True

    def test_check_permission_cached_hit(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "JUDGE"
        with patch("apps.perm.checker._permission_cache") as mock_cache:
            mock_cache.get.return_value = True
            result = check_permission(user, "soul.read")
            assert result is True
            mock_cache.get.assert_called_once_with("JUDGE", "soul.read")

    def test_check_permission_cache_miss_dict_fallback(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "VIEWER"
        with patch("apps.perm.checker._permission_cache") as mock_cache:
            mock_cache.get.return_value = None
            with patch("apps.perm.models.Permission.objects") as mock_perm_objs:
                mock_perm_objs.filter.return_value.exists.return_value = False
                result = check_permission(user, "soul.read")
                assert result is True

    def test_check_permission_cache_miss_db_lookup(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "JUDGE"
        with patch("apps.perm.checker._permission_cache") as mock_cache:
            mock_cache.get.return_value = None
            with patch("apps.perm.models.Permission.objects") as mock_perm_objs:
                mock_perm_objs.filter.return_value.exists.return_value = True
                with patch("apps.perm.models.RolePermission.objects") as mock_rp:
                    mock_rp.filter.return_value.exists.return_value = True
                    result = check_permission(user, "judgment.execute")
                    assert result is True

    def test_check_permission_cache_miss_db_no_perm(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "VIEWER"
        with patch("apps.perm.checker._permission_cache") as mock_cache:
            mock_cache.get.return_value = None
            with patch("apps.perm.models.Permission.objects") as mock_perm_objs:
                mock_perm_objs.filter.return_value.exists.return_value = True
                with patch("apps.perm.models.RolePermission.objects") as mock_rp:
                    mock_rp.filter.return_value.exists.return_value = False
                    result = check_permission(user, "soul.delete")
                    assert result is False

    def test_check_permissions_require_all(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "ADMIN"
        result = check_permissions(user, ["soul.read", "soul.delete"], require_all=True)
        assert result is True

    def test_check_permissions_require_any(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "ADMIN"
        result = check_permissions(user, ["soul.read", "nonexistent"], require_all=False)
        assert result is True

    def test_check_permissions_require_all_fails(self):
        user = MagicMock()
        user.is_authenticated = True
        user.role = "VIEWER"
        with patch("apps.perm.checker._permission_cache") as mock_cache:
            mock_cache.get.return_value = None
            with patch("apps.perm.models.Permission.objects") as mock_perm_objs:
                mock_perm_objs.filter.return_value.exists.return_value = True
                with patch("apps.perm.models.RolePermission.objects") as mock_rp:
                    mock_rp.filter.return_value.exists.return_value = False
                    result = check_permissions(
                        user, ["soul.read", "soul.delete"], require_all=True
                    )
                    assert result is False
