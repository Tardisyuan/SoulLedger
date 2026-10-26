"""European purgatory is passage: served (or a 炼狱复核 approved) → heaven (user decision 2026-10-27).

docs/01_欧洲天堂地狱整体架构.md §1.2, docs/03_七宗罪与地狱惩罚.md §5.1; docs-others E-1.
"""
import datetime

import pytest
from django.utils import timezone

from apps.disposition.expiry import expire_for_tenant
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.realms.models import Realm, SoulPathEntry
from apps.realms.path import SoulPathService
from apps.souls.models import Soul, SoulState
from apps.workflow.models import ApprovalWorkflowStatus
from apps.workflow.services import WorkflowService
from tests import sentence_plan_support as sp

pytestmark = pytest.mark.django_db

TODAY = datetime.date(2030, 1, 1)


def _realm(tenant, code, civilization, realm_type):
    return Realm.all_objects.create(realm_code=code, civilization=civilization, name_local=code,
                                    realm_type=realm_type, tenant=tenant)


def _served(tenant, _civilization, realm):
    soul = Soul.objects.create(name=f"{realm.realm_code}魂", tenant=tenant)  # civilization from the hall
    Soul.objects.filter(pk=soul.pk).update(current_state=SoulState.SETTLED)
    disposition = Disposition.objects.create(
        soul=soul, tenant=tenant, destination_realm=realm, is_executed=True, executed_at=timezone.now(),
        sentence_years=10, term_start_year=2000, term_start_month=1, term_start_day=1)
    SoulPathService.enter(soul, realm, tenant_id=tenant.pk)
    return soul, disposition


def _where(soul):
    return SoulPathEntry.all_objects.get(soul_id=soul.pk, left_at__isnull=True).realm.realm_code


@pytest.fixture
def eu():
    tenant = sp.tenant("EU_HEAVEN_HELL")
    return tenant, _realm(tenant, "EU_PURGATORY", "EUROPEAN", "PURGATORY"), _realm(tenant, "EU_HEAVEN", "EUROPEAN", "BLISS")


def test_a_served_purgatory_term_goes_up_to_heaven(eu):
    tenant, purgatory, _heaven = eu
    soul, _ = _served(tenant, "EUROPEAN", purgatory)
    assert expire_for_tenant(tenant, TODAY)["expired"] == 1
    assert _where(soul) == "EU_HEAVEN"
    event = SoulEvent.objects.get(soul=soul, event_type="PURGATORY_ASCENDED")
    assert event.payload["via"] == "TERM_SERVED" and event.payload["from_realm"] == "EU_PURGATORY"


def test_a_served_hell_term_or_a_chinese_holding_cell_stays_put(eu):
    tenant, _purgatory, _heaven = eu
    hell = _realm(tenant, "EU_HELL_C9", "EUROPEAN", "HELL")
    damned, _ = _served(tenant, "EUROPEAN", hell)
    cn = sp.tenant("CN_DIYU")
    held, _ = _served(cn, "CHINESE", _realm(cn, "DY_00_PURGATORY", "CHINESE", "PURGATORY"))
    expire_for_tenant(tenant, TODAY)
    expire_for_tenant(cn, TODAY)
    assert (_where(damned), _where(held)) == ("EU_HELL_C9", "DY_00_PURGATORY")
    assert not SoulEvent.objects.filter(event_type="PURGATORY_ASCENDED").exists()


def test_an_approved_purgatory_review_counts_as_served(eu):
    tenant, purgatory, _heaven = eu
    soul, disposition = _served(tenant, "EUROPEAN", purgatory)
    from apps.judgment.models import Judgment
    judgment = Judgment.objects.create(soul=soul, civilization="EUROPEAN", court="—", verdict="PURGATORY",
                                       is_final=True, tenant=tenant)
    wf = WorkflowService.create_from_judgment(judgment, case_type="PURGATORY_REVIEW")
    for node in list(wf.nodes.order_by("node_order")):
        assert wf.complete_node(node.pk, "PASSED")
        wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.COMPLETED
    assert _where(soul) == "EU_HEAVEN"
    assert SoulEvent.objects.get(soul=soul, event_type="PURGATORY_ASCENDED").payload["via"] == "PURGATORY_REVIEW"
    disposition.refresh_from_db()
    assert disposition.expired_at is not None  # the sweep will not fire on it again


def test_a_rejected_purgatory_review_leaves_the_soul_in_purgatory(eu):
    tenant, purgatory, _heaven = eu
    soul, _ = _served(tenant, "EUROPEAN", purgatory)
    from apps.judgment.models import Judgment
    judgment = Judgment.objects.create(soul=soul, civilization="EUROPEAN", court="—", verdict="PURGATORY",
                                       is_final=True, tenant=tenant)
    wf = WorkflowService.create_from_judgment(judgment, case_type="PURGATORY_REVIEW")
    assert wf.complete_node(wf.current_node.pk, "FAILED")
    wf.refresh_from_db()
    assert wf.status == ApprovalWorkflowStatus.REJECTED
    assert _where(soul) == "EU_PURGATORY"
