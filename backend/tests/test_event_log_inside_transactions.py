"""A `SoulEvent` row is part of the business record: if it cannot be written, the business write rolls back and
the caller gets the REAL error (the failed insert), not a later `TransactionManagementError`.

History: `8e3f33f7` proved that `EventService.notify_user` inside a business transaction was defective; this file
began as the same experiment for `EventService.log*` and found 17 of 51 (path, context) cells silently losing the
business write while the function reported success (xfail(strict) in `dddee9e9`). The decision (user, 2026-10-10)
was fail-loud, and these cells now pin it.

Mechanism that made it silent: `AuditHandler` swallowed the exception and the registry swallowed it again, but
`Model.save_base` had already flagged the transaction `needs_rollback`, so the nearest enclosing `atomic()` rolled
back silently. Fix: `DomainEventHandler.propagate_errors` (True only for `AuditHandler`); the registry runs such
handlers first and re-raises their exception; and every call site now writes the event INSIDE the transaction of
the write it describes (so "autocommit" callers roll back too).

Each path is observed in three contexts, because the answer used to depend on who held the transaction:
    bare            the service called with no transaction open (autocommit), as a view does.
    wrapped         called inside a caller's `with transaction.atomic():`.
    wrapped_probe   same, and the caller then runs one more query.
The module is `transaction=True` so "bare" really is autocommit.

Every cell below must be LOUD_FAIL: the original injected `OperationalError` reaches the caller, the business
write is not in the database, and no event row exists. Not in the grid, with their own tests: `expire_for_tenant` and the ledger recalculation task (batch loops: one
row's failure is logged, counted in the result and does not stop the batch) and `die()` account provisioning
(kept by design: the death stands, the officers are told after commit).
"""
import datetime
from dataclasses import dataclass

import pytest
from django.db import OperationalError, connection, transaction
from django.utils import timezone

from apps.disposition.expiry import expire_for_tenant
from apps.disposition.models import Disposition
from apps.events.models import SoulEvent
from apps.judgment.models import Judgment, JudgmentKind
from apps.reincarnation.services import ReincarnationService
from apps.soul_accounts.models import SoulAccount
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from tests import sentence_plan_support as plan
from tests.soul_account_support import rebirth_ready_soul
from tests.test_dispatch_notifications_after_commit import _conclude_with_workflow

pytestmark = pytest.mark.django_db(transaction=True)

SAFE, SILENT_LOSS, LOUD_FAIL = "SAFE", "SILENT_LOSS", "LOUD_FAIL"
BARE, WRAPPED, PROBE = "bare", "wrapped", "wrapped_probe"
CONTEXTS = (BARE, WRAPPED, PROBE)


def _cn():
    """地府殿,带一位兜底城隍:没有城隍收案就不许开案(用户 2026-10-29)。"""
    from tests.city_god_support import default_city_god

    tenant = plan.tenant("CN_DIYU")
    default_city_god(tenant)
    return tenant


# ── the injection ──────────────────────────────────────────────────────────────────────────────────────────


def _fail_event_inserts(event_type, hits):
    """Make the INSERT of a `SoulEvent` of this type fail, the way a real DB error would (OperationalError)."""
    table = SoulEvent._meta.db_table

    def wrapper(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT INTO") and f'"{table}"' in sql and event_type in (params or ()):
            hits.append(event_type)
            raise OperationalError("injected: soulevent insert failed")
        return execute(sql, params, many, context)

    return connection.execute_wrapper(wrapper)


@dataclass
class Seen:
    hits: int            # how many times the injected INSERT was attempted
    returned: object     # what the service returned (None if it raised)
    error: Exception | None
    persisted: bool      # the business write, read back outside any transaction
    event_rows: int      # SoulEvent rows of the injected type that exist afterwards

    @property
    def cause_is_the_failed_insert(self):
        return isinstance(self.error, OperationalError) and "injected" in str(self.error)

    @property
    def outcome(self):
        if self.error is not None:
            return LOUD_FAIL
        return SAFE if self.persisted else SILENT_LOSS


def observe(path, context) -> Seen:
    run, persisted, event_type = path()
    hits, result, error = [], None, None
    before = SoulEvent.all_objects.filter(event_type=event_type).count()
    with _fail_event_inserts(event_type, hits):
        try:
            if context == BARE:
                result = run()
            else:
                with transaction.atomic():
                    result = run()
                    if context == PROBE:
                        SoulEvent.all_objects.count()  # the caller's next query
        except Exception as exc:  # noqa: BLE001 -- what the caller sees is the point
            error = exc
    return Seen(len(hits), result, error, bool(persisted()),
                SoulEvent.all_objects.filter(event_type=event_type).count() - before)


# ── the paths ──────────────────────────────────────────────────────────────────────────────────────────────
# Each returns (run, persisted, event_type). `persisted` reads the BUSINESS write the event describes.


def _conclude_original(event_type):
    def path():
        soul, case = plan.open_case(_cn())
        # FAILED:地府判无罪不建处置(2026-10-29),DISPOSITION_CREATED 那一格要一份。
        return (lambda: Judgment.all_objects.get(pk=case.pk).conclude("FAILED", ""),
                lambda: Judgment.all_objects.get(pk=case.pk).is_final, event_type)
    return path


def _conclude_amendment():
    """judgment/services.py:271 -- the one `log_judgment_concluded` that sits lexically inside the atomic."""
    soul, p = plan.planned(_cn())
    amend = Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=_cn(),
                                    kind=JudgmentKind.AMENDMENT, amends_plan_id=p.pk)
    return (lambda: Judgment.all_objects.get(pk=amend.pk).conclude("PASSED", ""),
            lambda: Judgment.all_objects.get(pk=amend.pk).is_final, "JUDGMENT_CONCLUDED")


def _transition_standalone():
    soul, _ = plan.open_case(_cn())
    return (lambda: Soul.all_objects.get(pk=soul.pk).transition_to(SoulState.DISPOSED, "x"),
            lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.DISPOSED, "STATE_CHANGED")


def _die(event_type):
    def path():
        soul = Soul.objects.create(name="亡魂", tenant=_cn())
        if event_type == "SOUL_ACCOUNT_CREATED":  # the write that event describes is the account, not the state
            written = lambda: SoulAccount.objects.filter(soul=soul).exists()  # noqa: E731
        else:
            written = lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.JUDGING  # noqa: E731
        return (lambda: Soul.all_objects.get(pk=soul.pk).die(), written, event_type)
    return path


def _die_early():
    """埃及早夭(docs/01 §4.2):死亡登记当场结案送芦苇原,结案的事件与死亡同一笔。"""
    soul = Soul.objects.create(name="Early", tenant=plan.tenant("EG_DUAT"), duat_passage="EARLY_DEATH")
    return (lambda: Soul.all_objects.get(pk=soul.pk).die(),
            lambda: Judgment.all_objects.filter(soul=soul, verdict="PASSED").exists(), "JUDGMENT_CONCLUDED")


def _city_god(action):
    """城隍初审(apps/judgment/city_gods.py):收案(在 die 里)、解送、退回,各自的事件与它描述的那一笔同进退。"""
    from apps.judgment import city_gods
    from apps.judgment.models import CityGod

    def path():
        tenant = _cn()
        god = CityGod.objects.get_or_create(tenant=tenant, name="杭州府城隍", defaults={"regions": ["杭州"]})[0]
        soul = Soul.objects.create(name="城隍案", tenant=tenant, origin_location="杭州")
        if action == "received":
            return (lambda: Soul.all_objects.get(pk=soul.pk).die(),
                    lambda: Judgment.all_objects.filter(soul=soul, city_god=god).exists(), "CITY_GOD_RECEIVED")
        case = soul.die()
        lead = plan.officer(f"lead_{soul.pk.hex[:8]}", "MODERATOR", tenant)
        if action == "sent_on":
            return (lambda: city_gods.send_on(case.pk, lead, "解送"),
                    lambda: Judgment.all_objects.get(pk=case.pk).city_god_status == "SENT_ON", "CITY_GOD_SENT_ON")
        return (lambda: city_gods.return_case(case.pk, lead, "补正"),
                lambda: Judgment.all_objects.get(pk=case.pk).city_god_status == "RETURNED", "CITY_GOD_RETURNED")
    return path


def _expiry():
    tenant = _cn()
    soul = Soul.objects.create(name="期满", tenant=tenant, birth_year=1900, death_year=1950)
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    row = Disposition.objects.create(soul=soul, tenant=tenant, is_executed=True, executed_at=timezone.now(),
                                     sentence_years=10, term_start_year=2000, term_start_month=6,
                                     term_start_day=15)
    return (lambda: expire_for_tenant(tenant, today=datetime.date(2010, 6, 15)),
            lambda: Disposition.all_objects.get(pk=row.pk).expired_at is not None, "DISPOSITION_EXPIRED")


def _karma():
    soul = Soul.objects.create(name="功过", tenant=_cn())
    return (lambda: SoulRecord.objects.create(soul=soul, record_type="MERIT", civilization="CHINESE",
                                              description="善举", weight=10, event_year=2000),
            lambda: SoulRecord.all_objects.filter(soul=soul).exists(), "KARMA_RECALCULATED")


def _soul_created():
    return (lambda: Soul.objects.create(name="新魂", tenant=_cn()),
            lambda: Soul.all_objects.filter(name="新魂").exists(), "SOUL_CREATED")


def _correct_settlement():
    soul = Soul.objects.create(name="误结", tenant=_cn(), current_state=SoulState.SETTLED)
    return (lambda: Soul.all_objects.get(pk=soul.pk).correct_settlement(reason="录入错误"),
            lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.DISPOSED, "SETTLEMENT_CORRECTED")


def _reincarnation_trigger():
    soul, case = plan.open_case(_cn(), state=SoulState.DISPOSED)
    disposition = Disposition.objects.create(soul=soul, tenant=_cn())
    return (lambda: ReincarnationService.execute(Disposition.all_objects.get(pk=disposition.pk)),
            lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.REINCARNATING,
            "REINCARNATION_TRIGGERED")


def _rebirth(event_type):
    def path():
        account, _client = rebirth_ready_soul(_cn())
        soul = account.soul  # REINCARNATING, with a live account for this life
        return (lambda: ReincarnationService.complete_rebirth(Soul.all_objects.get(pk=soul.pk), new_identity="来生"),
                lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.ALIVE, event_type)
    return path


def _rebirth_submit():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication

    account, _client = rebirth_ready_soul(_cn())
    return (lambda: rebirth.submit(SoulAccount.objects.get(pk=account.pk), "HUMAN", "愿为人"),
            lambda: RebirthApplication.objects.filter(soul=account.soul).exists(), "REBIRTH_APPLICATION_SUBMITTED")


def _workflow_created():
    run, persisted = _conclude_with_workflow()
    return run, persisted, "WORKFLOW_CREATED"


def _workflow_started():
    """A moderator starts a workflow by hand (W-11, workflow/views.py start): the event is in start_workflow's
    transaction, which the view's audit-row transaction encloses."""
    from apps.authentication.models import User
    from apps.workflow.models import ApprovalWorkflow
    from tests.soul_account_support import dead_soul, officer_client

    tenant = _cn()
    soul = dead_soul(tenant, name="手动发起灵魂")
    moderator = User.objects.get_or_create(username="evlog_moderator",
                                           defaults={"role": "MODERATOR", "tenant": tenant})[0]
    return (lambda: officer_client(moderator).post("/api/v1/workflows/start/",
                                                   {"soul": str(soul.pk), "case_type": "ROUTINE", "reason": "x"},
                                                   format="json"),
            lambda: ApprovalWorkflow.all_objects.filter(soul=soul).exists(), "WORKFLOW_CREATED")


def _judge(username="evlog_judge"):
    from apps.authentication.models import User

    return User.objects.get_or_create(username=username, defaults={"role": "JUDGE", "tenant": _cn()})[0]


def _workflow_decision(verdict, event_type):
    """An officer decides the current node through the real endpoint (workflow/views.py approve_node)."""
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus
    from tests.soul_account_support import dead_soul, officer_client

    def path():
        tenant = _cn()
        soul = dead_soul(tenant, name="审批灵魂")
        wf = ApprovalWorkflow.objects.create(soul=soul, workflow_name="普通审批", case_type="STANDARD",
                                             status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=tenant)
        node = ApprovalNode.objects.create(workflow=wf, node_name="初审", node_order=1, node_type="EVALUATION",
                                           approver_type="ROLE", approver_role="JUDGE", status=NodeStatus.PENDING,
                                           activated_at=timezone.now())
        wf.current_node = node
        wf.save(update_fields=["current_node"])
        judge = _judge()
        return (lambda: officer_client(judge).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                                   {"verdict": verdict, "notes": "x"}, format="json"),
                lambda: ApprovalNode.all_objects.get(pk=node.pk).status != NodeStatus.PENDING, event_type)
    return path


def _purgatory_review_ascends():
    """2026-10-27(docs-others E-1):炼狱复核的最后一站通过 → 灵魂升天堂,PURGATORY_ASCENDED 与那次决定同一事务。"""
    from apps.authentication.models import User
    from apps.realms.models import Realm
    from apps.realms.path import SoulPathService
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus
    from tests.soul_account_support import dead_soul, officer_client

    tenant = plan.tenant("EU_HEAVEN_HELL")
    purgatory, _heaven = (Realm.all_objects.create(realm_code=code, civilization="EUROPEAN", name_local=code,
                                                   realm_type=kind, tenant=tenant)
                          for code, kind in (("EU_PURGATORY", "PURGATORY"), ("EU_HEAVEN", "BLISS")))
    soul = dead_soul(tenant, name="炼狱魂", state=SoulState.SETTLED)
    Disposition.objects.create(soul=soul, tenant=tenant, destination_realm=purgatory, is_executed=True,
                               executed_at=timezone.now(), sentence_years=10)
    SoulPathService.enter(soul, purgatory, tenant_id=tenant.pk)
    wf = ApprovalWorkflow.objects.create(soul=soul, workflow_name="炼狱复核", case_type="PURGATORY_REVIEW",
                                         status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=tenant)
    node = ApprovalNode.objects.create(workflow=wf, node_name="天堂准入终审", node_order=1, node_type="FINAL",
                                       approver_type="ROLE", approver_role="JUDGE", status=NodeStatus.PENDING,
                                       activated_at=timezone.now())
    wf.current_node = node
    wf.save(update_fields=["current_node"])
    judge = User.objects.get_or_create(username="evlog_eu_judge", defaults={"role": "JUDGE", "tenant": tenant})[0]
    return (lambda: officer_client(judge).post(f"/api/v1/workflows/{wf.pk}/approve_node/",
                                               {"verdict": "PASSED", "notes": "x"}, format="json"),
            lambda: ApprovalNode.all_objects.get(pk=node.pk).status != NodeStatus.PENDING, "PURGATORY_ASCENDED")


def _handover():
    """2026-10-27:官员交接把审判移给另一位官员,每个受影响的灵魂一条 OFFICER_HANDOVER,与交接同一事务。"""
    from apps.judgment import handover

    tenant = _cn()
    soul, case = plan.open_case(tenant, name="交接魂")
    tag = soul.pk.hex[:8]
    a, b = (plan.officer(f"ho_{who}_{tag}", "JUDGE", tenant) for who in ("a", "b"))
    Judgment.all_objects.filter(pk=case.pk).update(claimed_by=a, claimed_at=timezone.now())
    return (lambda: handover.commit(a, b, tenant.pk, actor=b),
            lambda: Judgment.all_objects.get(pk=case.pk).claimed_by_id == b.pk, "OFFICER_HANDOVER")


def _duat_passage(old, new):
    """2026-10-27:死后改 duat_passage,未结的原审跟着走(放行入殿 / 退回杜阿特入口),DUAT_PASSAGE_CHANGED 同一事务。"""
    def path():
        from apps.authentication.models import User
        from apps.realms.models import Realm
        from tests.soul_account_support import officer_client

        tenant = plan.tenant("EG_DUAT")
        for code in ("EG_DUAT_ENTRY", "EG_HALL_TWO_TRUTHS"):
            Realm.all_objects.get_or_create(realm_code=code, tenant=tenant, defaults={
                "civilization": "EGYPTIAN", "name_local": code, "realm_type": "HEAVEN"})
        soul = Soul.objects.create(name="Ka", tenant=tenant, current_state=SoulState.ALIVE, duat_passage=old)
        case = soul.die(death_date=datetime.date.today() - datetime.timedelta(days=10))
        admin = User.objects.get_or_create(username="evlog_admin", defaults={"role": "ADMIN", "is_staff": True,
                                                                             "is_superuser": True})[0]

        def run():
            res = officer_client(admin).patch(f"/api/v1/souls/{soul.pk}/", {"duat_passage": new}, format="json")
            assert res.status_code == 200, res.data
            return res

        return run, lambda: Judgment.all_objects.get(pk=case.pk).duat_stage == (new or "EMBALMING"), \
            "DUAT_PASSAGE_CHANGED"
    return path


def _workflow_timeout_reject():
    from apps.workflow import timeouts
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus
    from tests.test_workflow_timeout_and_reject_to import _age, _node, _workflow

    wf = _workflow(_cn(), [_node(1, timeout_hours=1, timeout_action="AUTO_REJECT"), _node(2)])
    _age(wf.current_node, 2)
    return (lambda: timeouts._fire(wf.pk, timezone.now()),
            lambda: ApprovalWorkflow.all_objects.get(pk=wf.pk).status == ApprovalWorkflowStatus.REJECTED
            and ApprovalNode.all_objects.filter(workflow=wf, notes="超时自动驳回").exists(), "WORKFLOW_REJECTED")


def _submitted_application():
    from apps.soul_accounts import rebirth

    account, _client = rebirth_ready_soul(_cn())
    return account, rebirth.submit(SoulAccount.objects.get(pk=account.pk), "HUMAN", "愿为人")


def _rejected_application():
    """Submitted, then the workflow is rejected and the application follows (the real sync, uninjected)."""
    from apps.soul_accounts import rebirth
    from apps.workflow.models import ApprovalWorkflow

    account, application = _submitted_application()
    ApprovalWorkflow.all_objects.filter(pk=application.workflow_id).update(status="REJECTED")
    rebirth.sync_from_workflow(application.workflow_id)
    return account, type(application).objects.get(pk=application.pk)


def _rebirth_submit_workflow_created():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication

    account, _client = rebirth_ready_soul(_cn())
    return (lambda: rebirth.submit(SoulAccount.objects.get(pk=account.pk), "HUMAN", "愿为人"),
            lambda: RebirthApplication.objects.filter(soul=account.soul).exists(), "WORKFLOW_CREATED")


def _rebirth_appeal(event_type):
    def path():
        from apps.soul_accounts import rebirth
        from apps.soul_accounts.models import RebirthApplication

        account, application = _rejected_application()
        return (lambda: rebirth.appeal(SoulAccount.objects.get(pk=account.pk), application.pk, "申诉"),
                lambda: RebirthApplication.objects.get(pk=application.pk).appeal_workflow_id is not None,
                event_type)
    return path


def _devour_voids_the_appeal():
    """吞噬执行(EG_ANNIHILATION)把开着的申诉作废,事件写在执行的事务里(P2-10)。业务写 = 处置已执行。"""
    from apps.disposition.services import DispositionService
    from apps.judgment.models import JudgmentAppeal
    from tests.soul_account_support import ready_soul

    eg = plan.tenant("EG_DUAT")
    account, _client = ready_soul(eg, state=SoulState.DISPOSED)
    soul = account.soul
    judgment = Judgment.all_objects.create(soul=soul, civilization="EGYPTIAN", court="Hall of Two Truths", tenant=eg,
                                           verdict="FAILED", is_final=True, concluded_at=timezone.now())
    JudgmentAppeal.all_objects.create(judgment=judgment, soul=soul, tenant=eg, round=1, reason="冤",
                                      original_verdict="FAILED")
    disposition = Disposition.all_objects.create(
        soul=soul, tenant=eg, destination_realm=plan.realm(DispositionService.EG_ANNIHILATION, "EGYPTIAN", eternal=True))
    return (lambda: DispositionService.execute(Disposition.all_objects.get(pk=disposition.pk)),
            lambda: Disposition.all_objects.get(pk=disposition.pk).is_executed, "JUDGMENT_APPEAL_DECIDED")


def _rebirth_sync():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication, RebirthApplicationStatus
    from apps.workflow.models import ApprovalWorkflow

    account, application = _submitted_application()
    ApprovalWorkflow.all_objects.filter(pk=application.workflow_id).update(status="REJECTED")
    return (lambda: rebirth.sync_from_workflow(application.workflow_id),
            lambda: RebirthApplication.objects.get(pk=application.pk).status == RebirthApplicationStatus.REJECTED,
            "REBIRTH_STATUS_CHANGED")


def _rebirth_cooldown_decide():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import CooldownShorteningRequest, CooldownShorteningStatus

    account, application = _rejected_application()
    request = rebirth.request_cooldown_shortening(SoulAccount.objects.get(pk=account.pk), "家中有事")
    judge = _judge()
    return (lambda: rebirth.decide_cooldown_shortening(request.pk, judge, approve=False, note="冷却照旧"),
            lambda: CooldownShorteningRequest.objects.get(pk=request.pk).status == CooldownShorteningStatus.REJECTED,
            "COOLDOWN_SHORTENING_DECIDED")


def _rebirth_cross_civ():
    from apps.soul_accounts import rebirth
    from apps.soul_accounts.models import RebirthApplication

    account, application = _submitted_application()
    judge = _judge()
    return (lambda: rebirth.decide_cross_civilization(application.pk, judge, True),
            lambda: RebirthApplication.objects.get(pk=application.pk).cross_civilization is True,
            "REBIRTH_CROSS_CIV_DECIDED")


def _rebirth_decision_syncs_the_application():
    """The officer rejects a rebirth application through the real endpoint. The workflow decision and the
    application's status (`rebirth.sync_from_workflow`) are ONE transaction: an event failure in the SYNC step
    (REBIRTH_STATUS_CHANGED) must undo the approval too."""
    from apps.soul_accounts.models import RebirthApplication
    from apps.workflow.models import ApprovalNode, NodeStatus
    from tests.soul_account_support import officer_client

    account, application = _submitted_application()
    judge = _judge()
    node = ApprovalNode.all_objects.get(workflow_id=application.workflow_id, node_order=1)
    return (lambda: officer_client(judge).post(
                f"/api/v1/workflows/{application.workflow_id}/approve_node/",
                {"verdict": "FAILED", "notes": "x", "rejection_reason_for_soul": "业障未消"}, format="json"),
            lambda: (ApprovalNode.all_objects.get(pk=node.pk).status != NodeStatus.PENDING
                     or RebirthApplication.objects.get(pk=application.pk).status != "UNDER_REVIEW"),
            "REBIRTH_STATUS_CHANGED")


def _rebirth_timeout_syncs_the_application():
    from apps.soul_accounts.models import RebirthApplication
    from apps.workflow import timeouts
    from apps.workflow.models import ApprovalNode, ApprovalWorkflow

    account, application = _submitted_application()
    ApprovalNode.all_objects.filter(workflow_id=application.workflow_id, node_order=1).update(
        timeout_hours=1, timeout_action="AUTO_REJECT", activated_at=timezone.now() - datetime.timedelta(hours=2))
    return (lambda: timeouts._fire(application.workflow_id, timezone.now()),
            lambda: (ApprovalWorkflow.all_objects.get(pk=application.workflow_id).status != "IN_PROGRESS"
                     or RebirthApplication.objects.get(pk=application.pk).status != "UNDER_REVIEW"),
            "REBIRTH_STATUS_CHANGED")


def _rebirth_workflow_orm_save():
    """An admin-style `workflow.save()` of the rebirth workflow's status (not `approve_node`, not a timeout; the
    PATCH endpoint cannot set `status`, so the ORM save is the route). The post_save signal syncs the application IN
    the save's own transaction, so a failed REBIRTH_STATUS_CHANGED event rolls the workflow edit back too. (It used
    to run in `on_commit`: the edit stayed, and the error was swallowed.)"""
    from apps.soul_accounts.models import RebirthApplication
    from apps.workflow.models import ApprovalWorkflow

    account, application = _submitted_application()
    pk = application.workflow_id

    def run():
        wf = ApprovalWorkflow.all_objects.get(pk=pk)
        wf.status = "REJECTED"
        wf.save()
    return (run,
            lambda: (ApprovalWorkflow.all_objects.get(pk=pk).status != "IN_PROGRESS"
                     or RebirthApplication.objects.get(pk=application.pk).status != "UNDER_REVIEW"),
            "REBIRTH_STATUS_CHANGED")


def _retry_dispatch():
    """调拨被拒后官员重新发起(`requests.retry_dispatch`):节点回到 DISPATCHING 与 SENTENCE_NODE_REDISPATCHED 同一事务。"""
    from apps.dispatch.models import DispatchRecord
    from apps.dispatch.services import DispatchService
    from apps.sentence_plan import requests as plan_requests

    home, away = _cn(), plan.tenant("EG_DUAT")
    soul, p = plan.planned(home, [(away, plan.stop_realm(away), 5)])
    plan.serve(soul, p, 1)
    DispatchService.reject(DispatchRecord.all_objects.get(pk=plan.node(p, 2).dispatch_record_id),
                           plan.officer("evlog_eg_rej", "MODERATOR", away), "不收")
    node = plan.node(p, 2)
    return (lambda: plan_requests.retry_dispatch(p, node.pk, user=None),
            lambda: plan.node(p, 2).status == "DISPATCHING", "SENTENCE_NODE_REDISPATCHED")


def _cancel_proposed_dispatch():
    """发起方在对方批准前取消移交(`DispatchService.cancel_proposed`):状态 CANCELLED 与 DISPATCH_CANCELLED 事件同一事务。"""
    from apps.dispatch.models import DispatchRecord, DispatchStatus
    from apps.dispatch.services import DispatchService

    home, away = _cn(), plan.tenant("EG_DUAT")
    officer = plan.officer("evlog_cancel_mod", "MODERATOR", home)
    soul = Soul.objects.create(name="取消之魂", tenant=home)
    record = DispatchService.propose(home, away, soul, officer, "x" * 30)
    return (lambda: DispatchService.cancel_proposed(DispatchRecord.all_objects.get(pk=record.pk), officer, "改主意"),
            lambda: DispatchRecord.all_objects.get(pk=record.pk).status == DispatchStatus.CANCELLED, "STATE_CHANGED")


def _cross_conclude_appends_stops():
    """第四十三批:并入审批流程的跨域审判以 PASS 结束(原审判已结案),参与方的站追加进受刑计划 ——
    SENTENCE_PLAN_AMENDED 与审判的 CONCLUDED 同一事务(`CrossTenantJudgmentService.conclude` → `append_cross_stops`)。"""
    from apps.dispatch.models import CrossTenantJudgment, JudgmentStatus
    from apps.dispatch.services import CrossTenantJudgmentService
    from tests.test_workflow_segments import World, _template, merged

    w = World()
    w.cn, w.eg = _cn(), plan.tenant("EG_DUAT")
    _template(w.cn, "CHINESE")
    _template(w.eg, "EGYPTIAN")
    _soul, _case, cj, _wf = merged(w, [w.eg])
    # 流程还在走时只有流程自己那条路能结(2026-10-18:手动结束 409 `workflow_running`)。
    return (lambda: CrossTenantJudgmentService.conclude(CrossTenantJudgment.all_objects.get(pk=cj.pk), "PASS", None,
                                                        by_workflow=True),
            lambda: CrossTenantJudgment.all_objects.get(pk=cj.pk).status == JudgmentStatus.CONCLUDED,
            "SENTENCE_PLAN_AMENDED")


def _station_move():
    """十三站(apps/souls/stations.py):官员挪站,DIYU_STATION_CHANGED 与那一列同进退。"""
    from apps.souls import stations

    soul = Soul.objects.create(name="挪站", tenant=_cn())
    soul.die()
    lead = plan.officer(f"st_{soul.pk.hex[:8]}", "MODERATOR", _cn())
    return (lambda: stations.move(Soul.all_objects.get(pk=soul.pk), "WANGXIANG_TERRACE", lead),
            lambda: Soul.all_objects.get(pk=soul.pk).diyu_station == "WANGXIANG_TERRACE", "DIYU_STATION_CHANGED")


def _capture(step):
    """勾魂牒(apps/dispatch/capture.py):发牒 / 拘到 / 交接 / 撤销,各自的事件与它描述的那一笔同进退。"""
    from apps.dispatch import capture
    from apps.dispatch.models import CaptureWarrant

    def path():
        soul = Soul.objects.create(name="阳寿尽", tenant=_cn(), fated_death_year=2000, fated_death_month=1,
                                   fated_death_day=1)
        if step == "issue":
            return (lambda: capture.issue(Soul.all_objects.get(pk=soul.pk)),
                    lambda: CaptureWarrant.all_objects.filter(soul=soul).exists(), "CAPTURE_WARRANT_ISSUED")
        warrant = capture.issue(soul)
        if step == "capture":
            return (lambda: capture.capture(warrant.pk),
                    lambda: CaptureWarrant.all_objects.get(pk=warrant.pk).status == "CAPTURED", "SOUL_CAPTURED")
        if step == "cancel":
            return (lambda: capture.cancel(warrant.pk, "牒发错了"),
                    lambda: CaptureWarrant.all_objects.get(pk=warrant.pk).status == "CANCELLED",
                    "CAPTURE_WARRANT_CANCELLED")
        capture.capture(warrant.pk)
        return (lambda: capture.hand_over(warrant.pk),
                lambda: Soul.all_objects.get(pk=soul.pk).current_state == SoulState.JUDGING, "CAPTURE_HANDED_OVER")
    return path


def _wangsi(step):
    """枉死城的冤情申诉(apps/judgment/wangsi.py):提出 / 属实 / 超度 / 不属实,事件与申诉那几列同进退。"""
    from apps.judgment import wangsi
    from apps.judgment.models import GrievanceLevel, GrievanceStatus

    def path():
        fated = timezone.localdate() + datetime.timedelta(days=400)
        soul = Soul.objects.create(name="枉死", tenant=_cn(), fated_death_year=fated.year,
                                   fated_death_month=fated.month, fated_death_day=fated.day)
        judgment = soul.die(death_date=timezone.localdate())
        Judgment.all_objects.filter(pk=judgment.pk).update(grievance_level=GrievanceLevel.MAJOR)
        admin = plan.officer(f"ws_{soul.pk.hex[:8]}", "ADMIN", _cn())
        status = lambda: Judgment.all_objects.get(pk=judgment.pk).grievance_status  # noqa: E731
        if step == "file":
            return (lambda: wangsi.file_grievance(judgment.pk, admin, "为人所害"),
                    lambda: status() == GrievanceStatus.FILED, "WANGSI_GRIEVANCE_FILED")
        wangsi.file_grievance(judgment.pk, admin, "为人所害")
        if step == "uphold":
            return (lambda: wangsi.decide_grievance(judgment.pk, admin, upheld=True, note="属实"),
                    lambda: status() == GrievanceStatus.UPHELD, "WANGSI_GRIEVANCE_UPHELD")
        if step == "deliver":
            return (lambda: wangsi.decide_grievance(judgment.pk, admin, upheld=True, note="属实", deliver=True),
                    lambda: status() == GrievanceStatus.DELIVERED, "WANGSI_GRIEVANCE_DELIVERED")
        return (lambda: wangsi.decide_grievance(judgment.pk, admin, upheld=False, note="不属实"),
                lambda: status() == GrievanceStatus.REJECTED, "WANGSI_GRIEVANCE_REJECTED")
    return path


PATHS = {
    "wangsi_file/WANGSI_GRIEVANCE_FILED": _wangsi("file"),
    "wangsi_uphold/WANGSI_GRIEVANCE_UPHELD": _wangsi("uphold"),
    "wangsi_reject/WANGSI_GRIEVANCE_REJECTED": _wangsi("reject"),
    "wangsi_deliver/WANGSI_GRIEVANCE_DELIVERED": _wangsi("deliver"),
    "die/DIYU_STATION_CHANGED": _die("DIYU_STATION_CHANGED"),
    "station_move/DIYU_STATION_CHANGED": _station_move,
    "capture_issue/CAPTURE_WARRANT_ISSUED": _capture("issue"),
    "capture/SOUL_CAPTURED": _capture("capture"),
    "capture_hand_over/CAPTURE_HANDED_OVER": _capture("hand_over"),
    "capture_cancel/CAPTURE_WARRANT_CANCELLED": _capture("cancel"),
    "cross_conclude_pass/SENTENCE_PLAN_AMENDED": _cross_conclude_appends_stops,
    "cancel_proposed_dispatch/STATE_CHANGED": _cancel_proposed_dispatch,
    "retry_dispatch/SENTENCE_NODE_REDISPATCHED": _retry_dispatch,
    # judgment conclusion (ORIGINAL) -- three different log calls on one call stack
    "conclude/JUDGMENT_CONCLUDED": _conclude_original("JUDGMENT_CONCLUDED"),
    "conclude/DISPOSITION_CREATED": _conclude_original("DISPOSITION_CREATED"),
    "conclude/STATE_CHANGED": _conclude_original("STATE_CHANGED"),
    "conclude_amendment/JUDGMENT_CONCLUDED": _conclude_amendment,
    "conclude+workflow/WORKFLOW_CREATED": _workflow_created,
    "workflow_start/WORKFLOW_CREATED": _workflow_started,
    "transition_to/STATE_CHANGED": _transition_standalone,
    "die/STATE_CHANGED": _die("STATE_CHANGED"),
    "die/SOUL_ACCOUNT_CREATED": _die("SOUL_ACCOUNT_CREATED"),
    "die_early/JUDGMENT_CONCLUDED": _die_early,
    "die+city_god/CITY_GOD_RECEIVED": _city_god("received"),
    "city_god_send_on/CITY_GOD_SENT_ON": _city_god("sent_on"),
    "city_god_return/CITY_GOD_RETURNED": _city_god("returned"),
    "expire_for_tenant/DISPOSITION_EXPIRED": _expiry,
    "soulrecord_create/KARMA_RECALCULATED": _karma,
    "soul_create/SOUL_CREATED": _soul_created,
    "correct_settlement/SETTLEMENT_CORRECTED": _correct_settlement,
    "reincarnation_execute/REINCARNATION_TRIGGERED": _reincarnation_trigger,
    "complete_rebirth/REINCARNATION_COMPLETED": _rebirth("REINCARNATION_COMPLETED"),
    "complete_rebirth/STATE_CHANGED": _rebirth("STATE_CHANGED"),
    "complete_rebirth/SOUL_ACCOUNT_RETIRED": _rebirth("SOUL_ACCOUNT_RETIRED"),
    "rebirth_submit/REBIRTH_APPLICATION_SUBMITTED": _rebirth_submit,
    "rebirth_submit/WORKFLOW_CREATED": _rebirth_submit_workflow_created,
    "rebirth_appeal/WORKFLOW_CREATED": _rebirth_appeal("WORKFLOW_CREATED"),
    "rebirth_appeal/REBIRTH_STATUS_CHANGED": _rebirth_appeal("REBIRTH_STATUS_CHANGED"),
    "rebirth_sync/REBIRTH_STATUS_CHANGED": _rebirth_sync,
    "devour/JUDGMENT_APPEAL_DECIDED": _devour_voids_the_appeal,
    "rebirth_cooldown_decide/COOLDOWN_SHORTENING_DECIDED": _rebirth_cooldown_decide,
    "rebirth_cross_civ/REBIRTH_CROSS_CIV_DECIDED": _rebirth_cross_civ,
    # workflow decisions: the timeline event is written in the decision's transaction (`record_events`)
    "workflow_approve/WORKFLOW_APPROVED": _workflow_decision("PASSED", "WORKFLOW_APPROVED"),
    "workflow_reject/WORKFLOW_REJECTED": _workflow_decision("FAILED", "WORKFLOW_REJECTED"),
    "workflow_timeout_reject/WORKFLOW_REJECTED": _workflow_timeout_reject,
    "purgatory_review/PURGATORY_ASCENDED": _purgatory_review_ascends,
    "officer_handover/OFFICER_HANDOVER": _handover,
    "duat_release/DUAT_PASSAGE_CHANGED": _duat_passage("NAMELESS", ""),
    "duat_bar/DUAT_PASSAGE_CHANGED": _duat_passage("", "IMPROPER_BURIAL"),
    # the application's status follows the decision IN the decision's transaction (`sync_from_workflow`)
    "rebirth_approve+sync/REBIRTH_STATUS_CHANGED": _rebirth_decision_syncs_the_application,
    "rebirth_timeout+sync/REBIRTH_STATUS_CHANGED": _rebirth_timeout_syncs_the_application,
    # every other write of the workflow: the post_save signal syncs in the save's own transaction
    "rebirth_workflow_orm_save+signal/REBIRTH_STATUS_CHANGED": _rebirth_workflow_orm_save,
}

OUTSIDE_THE_GRID = {"expire_for_tenant/DISPOSITION_EXPIRED", "die/SOUL_ACCOUNT_CREATED"}
GRID = [name for name in PATHS if name not in OUTSIDE_THE_GRID]
CELLS = [(name, ctx) for name in GRID for ctx in CONTEXTS]


def _id(cell):
    return f"{cell[0]}@{cell[1]}"


@pytest.mark.parametrize("cell", CELLS, ids=_id)
def test_a_failed_event_row_rolls_the_business_write_back_and_raises_the_real_error(cell):
    name, ctx = cell
    seen = observe(PATHS[name], ctx)
    assert seen.hits, "the injected INSERT was never attempted, so this proved nothing"
    assert seen.outcome == LOUD_FAIL, f"{name} @ {ctx}: {seen.outcome} (persisted={seen.persisted})"
    assert seen.cause_is_the_failed_insert, f"{name} @ {ctx}: caller saw {seen.error!r}, not the failed insert"
    assert not seen.persisted, f"{name} @ {ctx}: the business write survived a failed event row"
    assert seen.event_rows == 0


@pytest.mark.parametrize("ctx", CONTEXTS)
def test_a_failed_account_event_undoes_the_account_but_not_the_death_by_design(ctx, caplog):
    """`provision_on_death` (soul_accounts/services.py) deliberately does NOT let an account-opening failure roll
    the death back: "death is a fact, the account is derived, `backfill_soul_accounts` fills the gap". So the
    account and its SOUL_ACCOUNT_CREATED event roll back TOGETHER in a savepoint (consistent, not silent: it is
    logged at ERROR with the original exception) and the soul is still JUDGING. This is the one place the
    fail-loud rule does not reach the caller; it was a documented decision before this change."""
    path = PATHS["die/SOUL_ACCOUNT_CREATED"]
    seen = observe(path, ctx)
    assert seen.hits and seen.error is None
    assert not seen.persisted and seen.event_rows == 0          # no account, no event
    assert isinstance(seen.returned, Judgment)                   # the death stands
    assert any(r.exc_info and isinstance(r.exc_info[1], OperationalError) and "provisioning" in r.getMessage()
               for r in caplog.records), "swallowed without logging the original exception"


def test_expiry_logs_counts_and_continues_when_one_row_event_cannot_be_written(caplog):
    run, persisted, event_type = _expiry()
    hits = []
    with _fail_event_inserts(event_type, hits):
        result = run()
    assert hits
    assert not persisted(), "the row was marked expired although its event row could not be written"
    assert result["expired"] == 0 and len(result["failed"]) == 1
    assert any("left unexpired" in r.getMessage() and r.exc_info and isinstance(r.exc_info[1], OperationalError)
               for r in caplog.records), "the failure was not logged with the original exception"


def test_expiry_does_not_let_one_failed_row_stop_the_others():
    run, persisted, event_type = _expiry()
    tenant = _cn()
    soul = Soul.objects.create(name="期满乙", tenant=tenant, birth_year=1900, death_year=1950)
    Soul.all_objects.filter(pk=soul.pk).update(current_state=SoulState.REINCARNATING)
    Disposition.objects.create(soul=soul, tenant=tenant, is_executed=True, executed_at=timezone.now(),
                                        sentence_years=10, term_start_year=2000, term_start_month=6,
                                        term_start_day=15)
    calls = []
    table = SoulEvent._meta.db_table

    def fail_first(execute, sql, params, many, context):
        if sql.lstrip().upper().startswith("INSERT INTO") and f'"{table}"' in sql and event_type in (params or ()):
            calls.append(1)
            if len(calls) == 1:
                raise OperationalError("injected: soulevent insert failed")
        return execute(sql, params, many, context)

    with connection.execute_wrapper(fail_first):
        result = run()
    assert (result["expired"], len(result["failed"])) == (1, 1)
    assert Disposition.all_objects.filter(expired_at__isnull=False).count() == 1


def test_the_ledger_task_logs_counts_and_continues_when_one_soul_cannot_be_recalculated(caplog):
    from apps.ledger.tasks import recalculate_tenant_ledgers

    tenant = _cn()
    soul = Soul.objects.create(name="功过乙", tenant=tenant)
    SoulRecord.objects.create(soul=soul, record_type="MERIT", civilization="CHINESE", description="善举",
                              weight=10, event_year=2000)
    Soul.all_objects.filter(pk=soul.pk).update(merit_score=0)
    hits = []
    with _fail_event_inserts("KARMA_RECALCULATED", hits):
        result = recalculate_tenant_ledgers(str(tenant.pk))
    assert hits
    assert result["updated"] == 0 and result["failed"] == [str(soul.pk)]
    assert Soul.all_objects.get(pk=soul.pk).merit_score == 0, "new scores survived a failed event row"
    assert any(r.exc_info and isinstance(r.exc_info[1], OperationalError) for r in caplog.records)


def test_a_failed_account_opening_tells_the_admins_after_commit_and_only_then():
    """`die()` keeps its design (death stands, account backfilled later) but no longer fails quietly: the
    soul's home-tenant admins -- and the acting officer, if any -- get one in-app notification each, sent by
    `transaction.on_commit`, so a failed notification insert can never take the death with it."""
    from apps.authentication.models import User
    from apps.notifications.models import UserNotification

    tenant = _cn()
    admins = [User.objects.create_user(username=f"evlog_admin{i}", role="ADMIN", tenant=tenant) for i in (1, 2)]
    User.objects.create_user(username="evlog_other_hall_admin", role="ADMIN", tenant=plan.tenant("EG_DUAT"))
    User.objects.create_user(username="evlog_judge_not_admin", role="JUDGE", tenant=tenant)
    soul = Soul.objects.create(name="亡魂", tenant=tenant)
    hits = []
    with _fail_event_inserts("SOUL_ACCOUNT_CREATED", hits), transaction.atomic():
        judgment = Soul.all_objects.get(pk=soul.pk).die()
        assert UserNotification.objects.count() == 0, "notified before the death committed"
    assert hits and judgment is not None
    assert Soul.all_objects.get(pk=soul.pk).current_state == SoulState.JUDGING          # death committed
    assert not SoulAccount.objects.filter(soul=soul).exists()                           # no account
    notes = UserNotification.objects.filter(related_resource="soul", related_id=str(soul.pk))
    assert sorted(n.user_id for n in notes) == sorted(a.pk for a in admins)             # one per home admin
    assert all("backfill_soul_accounts" in n.message and "亡魂" in n.message for n in notes)


def test_a_successful_rebirth_decision_commits_workflow_and_application_together():
    """No window in which the workflow is decided and the application still says UNDER_REVIEW: inside the very
    transaction that decides the node, the application already shows the new status, and one commit makes both
    durable. (It used to follow in an `on_commit` callback, after the decision had committed.)"""
    from apps.soul_accounts.models import RebirthApplication
    from apps.workflow.models import ApprovalWorkflow
    from tests.soul_account_support import officer_client

    account, application = _submitted_application()
    judge = _judge()
    with transaction.atomic():
        response = officer_client(judge).post(
            f"/api/v1/workflows/{application.workflow_id}/approve_node/",
            {"verdict": "FAILED", "notes": "x", "rejection_reason_for_soul": "业障未消"}, format="json")
        assert response.status_code == 200, response.data
        assert ApprovalWorkflow.all_objects.get(pk=application.workflow_id).status == "REJECTED"
        assert RebirthApplication.objects.get(pk=application.pk).status == "REJECTED"  # not deferred to on_commit
    assert RebirthApplication.objects.get(pk=application.pk).status == "REJECTED"
    assert SoulEvent.all_objects.filter(event_type="REBIRTH_STATUS_CHANGED",
                                        payload__application_id=str(application.pk)).count() == 1
