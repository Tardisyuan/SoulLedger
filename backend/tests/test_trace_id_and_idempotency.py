"""请求 id(X-Request-ID)与关键写接口的幂等键(Idempotency-Key),2026-10-29。

请求 id:合法的沿用、不合法的与没有的新生成;响应头回给客户端;同一个请求写的审计行用同一个 id;
日志每行带上;Celery 发任务时写进消息头,worker 跑任务前取回。
幂等:第一次执行并存下 2xx;同键同体回放(视图不再执行);同键异体 422;处理中 409;非 2xx 与异常不占键;
不带头照旧;键按用户分开。最后点名清单里每个接口都挂上了。
"""
import json
import logging
from datetime import date
from types import SimpleNamespace

import pytest
from celery.signals import before_task_publish, task_postrun, task_prerun
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from apps.audit.models import AuditLog
from apps.core import trace
from apps.core.idempotency import REPLAYED_HEADER, idempotent
from apps.souls.models import Soul, SoulState
from config.json_logging import JsonFormatter
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


# ── 请求 id ───────────────────────────────────────────────────────────────


class TestRequestId:
    def test_a_valid_id_is_echoed_back(self, api_client):
        res = api_client.get("/health/", HTTP_X_REQUEST_ID="client-abc-123")
        assert res["X-Request-ID"] == "client-abc-123"

    @pytest.mark.parametrize("sent", [None, "short", "has space in it", "x" * 65, "line\nbreak-123"])
    def test_a_missing_or_invalid_id_is_replaced_by_a_fresh_one(self, api_client, sent):
        extra = {} if sent is None else {"HTTP_X_REQUEST_ID": sent}
        res = api_client.get("/health/", **extra)
        echoed = res["X-Request-ID"]
        assert echoed != sent and len(echoed) == 32 and int(echoed, 16) >= 0

    def test_two_requests_get_two_ids_and_nothing_leaks_after_the_request(self, api_client):
        a = api_client.get("/health/")["X-Request-ID"]
        b = api_client.get("/health/")["X-Request-ID"]
        assert a != b
        assert trace.get_trace_id() == ""

    def test_the_audit_row_of_a_request_carries_its_id(self, cn_tenant):
        sp.User.objects.create_user(username="trace_officer", password=PASSWORD, role="JUDGE", tenant=cn_tenant)
        this, other = _login("trace_officer"), _login("trace_officer")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {this['access']}")
        from rest_framework_simplejwt.tokens import AccessToken

        res = client.post(f"/api/v1/auth/sessions/{AccessToken(other['access'])['sid']}/revoke/",
                          HTTP_X_REQUEST_ID="trace-0001-audit")
        assert res.status_code == 204, res.content
        assert res["X-Request-ID"] == "trace-0001-audit"
        row = AuditLog.objects.get(description__startswith="官员退出登录设备")
        assert row.trace_id == "trace-0001-audit"

    def test_an_audit_row_written_outside_a_request_has_no_id(self, cn_tenant):
        row = AuditLog.objects.create(action="EXECUTE", resource="x", tenant=cn_tenant)
        assert row.trace_id == ""

    def test_the_log_filter_and_the_json_formatter_carry_the_id(self):
        token = trace._trace_var.set("trace-log-0001")
        try:
            record = logging.LogRecord("apps.x", logging.INFO, __file__, 1, "hello", None, None)
            assert trace.TraceIdFilter().filter(record) is True
        finally:
            trace._trace_var.reset(token)
        assert record.trace_id == "trace-log-0001"
        assert json.loads(JsonFormatter().format(record))["trace_id"] == "trace-log-0001"
        outside = logging.LogRecord("apps.x", logging.INFO, __file__, 1, "hello", None, None)
        trace.TraceIdFilter().filter(outside)
        assert outside.trace_id == "-"

    def test_the_settings_wire_the_filter_into_every_console_handler(self):
        from django.conf import settings

        for handler in settings.LOGGING["handlers"].values():
            assert "trace" in handler.get("filters", []), handler
        assert settings.MIDDLEWARE[0] == "apps.core.trace.TraceIdMiddleware"


class _Task:
    """A stand-in for a Celery task: signals key on the sender, so it has to be hashable."""

    def __init__(self, **request):
        self.request = SimpleNamespace(**request)


class TestCeleryCarriesTheId:
    def test_publishing_inside_a_request_stamps_the_header(self):
        token = trace._trace_var.set("trace-task-0001")
        headers = {}
        try:
            before_task_publish.send(sender="apps.x.task", headers=headers, body=None)
        finally:
            trace._trace_var.reset(token)
        assert headers["trace_id"] == "trace-task-0001"

    def test_publishing_outside_a_request_stamps_nothing(self):
        headers = {}
        before_task_publish.send(sender="apps.x.task", headers=headers, body=None)
        assert "trace_id" not in headers

    def test_the_worker_runs_the_task_under_the_id_and_clears_it_after(self):
        task = _Task(trace_id="trace-task-0002")
        seen = []
        task_prerun.send(sender=task, task_id="t-1", task=task)
        seen.append(trace.get_trace_id())
        task_postrun.send(sender=task, task_id="t-1", task=task)
        assert seen == ["trace-task-0002"]
        assert trace.get_trace_id() == ""

    def test_a_task_nobody_requested_gets_its_own_id(self):
        task = _Task()
        task_prerun.send(sender=task, task_id="t-2", task=task)
        own = trace.get_trace_id()
        task_postrun.send(sender=task, task_id="t-2", task=task)
        assert len(own) == 32 and trace.get_trace_id() == ""


PASSWORD = "Trace!Pass-2026-x"
_ip = iter(range(10, 250))


def _login(username):
    res = APIClient().post("/api/v1/auth/login/", {"username": username, "password": PASSWORD}, format="json",
                           REMOTE_ADDR=f"198.51.100.{next(_ip)}")
    assert res.status_code == 200, res.content
    return res.data


# ── 幂等 ─────────────────────────────────────────────────────────────────


calls = []


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@idempotent
def _probe(request):
    calls.append(request.data)
    if request.data.get("fail"):
        return Response({"detail": "no"}, status=400)
    if request.data.get("boom"):
        raise RuntimeError("boom")
    if request.data.get("again"):  # 视图还没返回时,同一个键又来了一次
        calls.append(_post(request.user, {"again": True}, key=request.META["HTTP_IDEMPOTENCY_KEY"]).status_code)
    return Response({"n": len(calls), "echo": request.data}, status=201)


_factory = APIRequestFactory()


def _post(user, body, key=None):
    extra = {"HTTP_IDEMPOTENCY_KEY": key} if key is not None else {}
    request = _factory.post("/probe/", body, format="json", **extra)
    force_authenticate(request, user=user)
    return _probe(request)


@pytest.fixture
def officer(cn_tenant):
    calls.clear()
    return sp.officer("idem_officer", "JUDGE", cn_tenant)


class TestIdempotencyKey:
    def test_the_first_request_runs_and_a_repeat_replays_it_without_running(self, officer):
        first = _post(officer, {"a": 1}, key="k-1")
        again = _post(officer, {"a": 1}, key="k-1")
        assert len(calls) == 1
        assert (first.status_code, again.status_code) == (201, 201)
        assert again.data == first.data == {"n": 1, "echo": {"a": 1}}
        assert again[REPLAYED_HEADER] == "true"
        assert not first.has_header(REPLAYED_HEADER)

    def test_the_same_key_with_another_body_is_422(self, officer):
        _post(officer, {"a": 1}, key="k-2")
        res = _post(officer, {"a": 2}, key="k-2")
        assert (res.status_code, res.data["code"]) == (422, "idempotency_key_reused")
        assert len(calls) == 1

    def test_a_repeat_while_the_first_is_still_running_is_409(self, officer):
        res = _post(officer, {"again": True}, key="k-3")
        assert res.status_code == 201
        assert calls == [{"again": True}, 409]

    def test_a_refusal_or_a_crash_does_not_hold_the_key(self, officer):
        assert _post(officer, {"fail": True}, key="k-4").status_code == 400
        assert _post(officer, {"fail": True}, key="k-4").status_code == 400
        with pytest.raises(RuntimeError):
            _post(officer, {"boom": True}, key="k-5")
        with pytest.raises(RuntimeError):
            _post(officer, {"boom": True}, key="k-5")
        assert len(calls) == 4

    def test_without_the_header_every_request_runs(self, officer):
        _post(officer, {"a": 1})
        _post(officer, {"a": 1})
        assert len(calls) == 2

    def test_the_key_belongs_to_one_user(self, officer, cn_tenant):
        other = sp.officer("idem_other", "JUDGE", cn_tenant)
        _post(officer, {"a": 1}, key="k-6")
        res = _post(other, {"a": 1}, key="k-6")
        assert len(calls) == 2 and not res.has_header(REPLAYED_HEADER)

    def test_an_unprintable_key_is_400(self, officer):
        res = _post(officer, {"a": 1}, key="has space")
        assert (res.status_code, res.data["code"]) == (400, "idempotency_key_invalid")
        assert calls == []


def test_a_real_endpoint_replays_instead_of_claiming_twice(eu_tenant, monkeypatch):
    from apps.judgment import views as judgment_views

    soul = Soul.objects.create(name="李四", tenant=eu_tenant, current_state=SoulState.ALIVE)
    judgment = soul.die(death_date=date.today())
    judge = sp.officer("idem_eu_judge", "JUDGE", eu_tenant)
    real = judgment_views.claims.claim
    ran = []
    monkeypatch.setattr(judgment_views.claims, "claim", lambda *a, **k: ran.append(1) or real(*a, **k))
    client = officer_client(judge)
    first = client.post(f"/api/v1/judgment/{judgment.pk}/claim/", HTTP_IDEMPOTENCY_KEY="claim-1")
    again = client.post(f"/api/v1/judgment/{judgment.pk}/claim/", HTTP_IDEMPOTENCY_KEY="claim-1")
    assert (first.status_code, again.status_code) == (200, 200), first.content
    assert again[REPLAYED_HEADER] == "true" and len(ran) == 1
    client.post(f"/api/v1/judgment/{judgment.pk}/claim/")
    assert len(ran) == 2  # 不带键照旧执行


def test_every_named_write_endpoint_is_idempotent():
    """清单(2026-10-29 用户决定):审判结案 / 认领 / 评议、调拨建单 / 批准 / 执行、书信回复(官员与灵魂)、
    处置执行 / 释放、转世提交(官员的 reborn 与灵魂的转世申请)。"""
    from apps.chat.views import MeChatMessagesView, OfficerInboxViewSet
    from apps.dispatch.views import DispatchRecordViewSet
    from apps.disposition.views import DispositionViewSet
    from apps.judgment.views import JudgmentViewSet
    from apps.reincarnation.views import ReincarnationViewSet
    from apps.soul_accounts.me_views import MeRebirthApplicationsView

    named = [
        JudgmentViewSet.conclude, JudgmentViewSet.claim, JudgmentViewSet.add_comment,
        DispatchRecordViewSet.create, DispatchRecordViewSet.approve, DispatchRecordViewSet.execute,
        OfficerInboxViewSet.reply, MeChatMessagesView.post,
        DispositionViewSet.execute, DispositionViewSet.release,
        ReincarnationViewSet.reborn, MeRebirthApplicationsView.post,
    ]
    missing = [f.__qualname__ for f in named if getattr(f, "__wrapped__", None) is None
               or f.__code__ is not idempotent(lambda: None).__code__]
    assert missing == []
