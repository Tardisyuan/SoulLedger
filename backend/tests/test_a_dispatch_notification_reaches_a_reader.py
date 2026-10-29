"""A dispatch notification must land where something can read it.

WHY THIS FILE EXISTS. There were two notification models. `UserNotification`
(`apps.notifications`) is the one with a serializer, a viewset, a WebSocket
consumer and a page in the web client. `Notification` (`apps.tenants`) had four
writers — all in `apps/dispatch/services.py` — and **no reader anywhere in the
repository**: no serializer, no view, no consumer, no test. Every notification
the dispatch and cross-tenant-judgment flows produced went into a table nothing
selects from, and `DISPATCH_PROPOSED` — "a proposal is pending your approval" —
is the message the whole approve/reject flow exists to deliver.

Nothing went red for that. `apps/dispatch/services.py` wrote rows, the rows
were written, and no assertion anywhere asked *who could read them*. That is
the shape this repository keeps hitting: the check that exists asks whether
something was written, and the question that matters is whether anything reads
it.

So these assertions are deliberately about the reader's model, not the writer's
call. Asserting that `EventService.notify_user` was invoked would pass just as
happily against a bus with no handler attached, which is the same defect one
layer up.

`bulk_create` was the mechanism as well as the symptom: it emits no
`post_save`, so even adding a reader later could not have rescued those rows
onto the socket or a webhook. The replacement publishes one event per
recipient.
"""

import pytest

from apps.dispatch.services import DispatchService
from apps.notifications.models import NotificationType, UserNotification
from apps.souls.models import Soul
from apps.tenants.models import Tenant


@pytest.fixture
def target_tenant(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="EG_DUAT",
        defaults={"display_name": "Egyptian Duat", "dispatch_enabled": True},
    )
    return tenant


@pytest.fixture
def proposer(db, django_user_model, cn_tenant):
    return django_user_model.objects.create_user(
        username="dispatch_proposer", password="x", role="ADMIN", tenant=cn_tenant
    )


@pytest.fixture
def target_operator(db, django_user_model, target_tenant):
    """A user in the receiving tenant — the person the message is *for*."""
    return django_user_model.objects.create_user(
        username="duat_operator", password="x", role="ADMIN", tenant=target_tenant
    )


@pytest.fixture
def soul(db, cn_tenant):
    return Soul.objects.create(name="A soul in transit", tenant=cn_tenant)


def test_proposing_a_dispatch_notifies_the_target_tenant(
    db, cn_tenant, target_tenant, proposer, target_operator, soul, django_capture_on_commit_callbacks
):
    """The target tenant's operator can read the proposal notice.

    Read through `UserNotification`, the model the API serves. Before this was
    fixed the row existed only as `apps.tenants.Notification`, so this query
    returned nothing while the feature looked implemented.
    """
    with django_capture_on_commit_callbacks(execute=True):  # notices go out after commit
        DispatchService.propose(
            source_tenant=cn_tenant,
            target_tenant=target_tenant,
            soul=soul,
            dispatcher=proposer,
            reason="Judged under the wrong cosmology.",
        )

    delivered = UserNotification.objects.filter(user=target_operator)
    assert delivered.count() == 1, (
        "the target tenant's operator has no readable notification. The "
        "proposal was created, so the flow 'worked' — but the message telling "
        "them to act on it went somewhere nothing can select from."
    )

    notice = delivered.get()
    assert notice.notification_type == NotificationType.DISPATCH_PROPOSED
    assert notice.related_resource == "DispatchRecord"
    assert notice.related_id, "without the id the client cannot deep-link to the proposal"
    assert soul.name in notice.message


def test_the_proposer_is_not_notified_of_their_own_proposal(
    db, cn_tenant, target_tenant, proposer, target_operator, soul
):
    """Assert the absence too.

    A `notify_user` loop over the wrong queryset would satisfy the test above
    while also messaging the source tenant, and "the right person got it" reads
    identical to "everybody got it" unless the second half is asserted.
    """
    DispatchService.propose(
        source_tenant=cn_tenant,
        target_tenant=target_tenant,
        soul=soul,
        dispatcher=proposer,
        reason="Judged under the wrong cosmology.",
    )

    assert not UserNotification.objects.filter(user=proposer).exists(), (
        "the proposing tenant was notified of its own proposal — the approval "
        "queue belongs to the target tenant, and this is the notification "
        "half of that same confusion."
    )


# `test_no_dispatch_notification_is_written_to_the_unread_model` removed
# 2026-09-13 (BP-13): it pinned `apps.tenants.Notification`'s row count at 0.
# The model itself is now deleted (migration 0010 in `apps/tenants`), so the
# table it guarded against a dual-write into no longer exists to write to.


def test_only_officers_who_can_read_dispatches_are_notified(
    db, django_user_model, cn_tenant, target_tenant, proposer, target_operator, soul,
    django_capture_on_commit_callbacks,
):
    """RBAC 严查 2026-10-29 M1:提案通知只给目标殿持 `dispatch.read` 的在职官员。

    此前发给目标殿全部 is_active User:每个灵魂账号一行,JUDGE / VIEWER(调拨视图对
    他们 403)也从通知里拿到灵魂名与来源殿。"""
    def make(name, role, **kw):
        return django_user_model.objects.create_user(
            username=name, password="x", role=role, tenant=target_tenant, **kw)

    moderator = make("duat_moderator", "MODERATOR")
    judge = make("duat_judge", "JUDGE")
    viewer = make("duat_viewer", "VIEWER")
    soul_account = make("duat_soul", "SOUL")
    retired = make("duat_retired", "MODERATOR", is_active=False)

    with django_capture_on_commit_callbacks(execute=True):
        DispatchService.propose(
            source_tenant=cn_tenant, target_tenant=target_tenant, soul=soul,
            dispatcher=proposer, reason="Judged under the wrong cosmology.",
        )

    got = set(UserNotification.objects.filter(
        notification_type=NotificationType.DISPATCH_PROPOSED).values_list("user_id", flat=True))
    assert {target_operator.pk, moderator.pk} <= got
    assert not got & {judge.pk, viewer.pk, soul_account.pk, retired.pk}, got


def test_cross_judgment_notices_go_to_cross_judgment_readers_only(
    db, django_user_model, target_tenant, target_operator,
):
    """联审通知(入席 / 结案 / 取消)的收件人:持 `cross_judgment.read` 的在职官员,不含灵魂。"""
    from apps.dispatch.services import _holders

    def make(name, role):
        return django_user_model.objects.create_user(
            username=name, password="x", role=role, tenant=target_tenant)

    judge, viewer, soul_account = make("cj_judge", "JUDGE"), make("cj_viewer", "VIEWER"), make("cj_soul", "SOUL")
    got = {u.pk for u in _holders([target_tenant], "cross_judgment.read")}
    assert {target_operator.pk, judge.pk} <= got
    assert viewer.pk not in got and soul_account.pk not in got
