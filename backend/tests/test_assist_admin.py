"""助手管理页的后端(docs/ARCHITECTURE-assist-admin.md)。

全部离线:供应商是 `FakeProvider`。这里测 §6 列的门禁 —— 非 ADMIN 403(含 MODERATOR)、
env 总开关是硬上限、key 在库里是密文且审计里没有、评测不绕过数据范围 —— 以及生效配置、
连通测试凭证、用量记录、月度上限、评测的预估 / 确认 / 执行。
"""
import json

import pytest
from cryptography.fernet import Fernet
from django.db import connection
from django.urls import get_resolver

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.notifications.models import UserNotification
from apps.soul_assist import config, evals, service, usage
from apps.soul_assist.models import (
    AssistConversation,
    AssistEvalCase,
    AssistEvalResult,
    AssistEvalRun,
    AssistUsage,
)
from apps.soul_assist.providers import FakeProvider
from tests.soul_account_support import officer_client, ready_soul, soul_client

pytestmark = pytest.mark.django_db

BASE = "/api/v1/assist-admin/"
KEY = "sk-live-THE-SECRET-VALUE-1234"


@pytest.fixture(autouse=True)
def assistant_on(settings):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ASSISTANT_MODEL = "env-model"
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    FakeProvider.script = [{"text": "好的。"}]
    FakeProvider.calls = []
    yield
    FakeProvider.script = []
    FakeProvider.calls = []


@pytest.fixture
def admin(cn_tenant):
    return User.objects.create_user(username="yama", password="x", role="ADMIN", tenant=None)


@pytest.fixture
def api(admin):
    return officer_client(admin)


def _enable(tenant, on=True):
    tenant.settings = {**(tenant.settings or {}), "assistant_enabled": on}
    tenant.save(update_fields=["settings"])


def _soul_ask(client, question="怎么申请?", screen="applications"):
    return client.post("/api/v1/me/assist/", {"question": question, "screen": screen}, format="json",
                       HTTP_ACCEPT_LANGUAGE="zh-Hans")


def _patch(api, **body):
    return api.patch(f"{BASE}config/", body, format="json")


def _admin_routes():
    resolver = get_resolver()
    out = []
    for entry in resolver.url_patterns:
        if str(entry.pattern) == "api/v1/assist-admin/":
            for p in entry.url_patterns:
                route = str(p.pattern).replace("<int:tenant_id>", "1").replace("<int:pk>", "1")
                out.append(BASE + route)
    return out


# ── 只许 ADMIN ────────────────────────────────────────────────────────────


def test_the_route_list_is_not_empty():
    """下面那条 403 测试的主体清单来自 URLconf;清单空了它就恒绿。"""
    assert len(_admin_routes()) == 11


@pytest.mark.parametrize("role", ["MODERATOR", "JUDGE", "GUARDIAN", "VIEWER"])
def test_every_route_refuses_every_non_admin_role(cn_tenant, role):
    """按角色判断,不走权限码。变异:`IsAdminRole.has_permission` 恒真 → 红。"""
    client = officer_client(User.objects.create_user(username=f"u-{role}", password="x", role=role,
                                                     tenant=cn_tenant))
    for url in _admin_routes():
        for method in ("get", "post", "patch", "delete"):
            response = getattr(client, method)(url, {}, format="json")
            assert response.status_code == 403, (method, url, response.status_code)


def test_a_soul_token_is_refused(cn_tenant):
    _, soul = ready_soul(cn_tenant)
    assert soul.get(f"{BASE}config/").status_code == 403


def test_the_admin_reads_the_config(api):
    body = api.get(f"{BASE}config/").data
    assert body["model"] == "env-model" and body["enabled"] is True and body["env_enabled"] is True
    assert body["overridden"] == [] and body["api_key"]["source"] == "env"
    assert body["read_only"] == {"max_concurrent": 8, "timeout_seconds": 22.0, "history_turns": 20,
                                 "retention_days": 30}


# ── API key:密文存库、只写不读、审计里没有 ─────────────────────────────────────


def test_the_api_key_is_ciphertext_in_the_table_and_never_echoed(api):
    response = _patch(api, api_key=KEY)
    assert response.status_code == 200, response.data
    assert KEY not in json.dumps(response.data)
    assert response.data["api_key"] == {"set": True, "last4": "1234", "set_at": response.data["api_key"]["set_at"],
                                        "source": "page"}
    assert KEY not in json.dumps(api.get(f"{BASE}config/").data)
    with connection.cursor() as cursor:
        cursor.execute("select api_key from soul_assist_assistconfig")
        stored = cursor.fetchone()[0]
    assert KEY not in stored and stored.startswith("gAAAA")  # Fernet 令牌
    assert config.effective().connection.api_key == KEY  # 读回来是明文,只在进程内


def test_the_audit_says_replaced_or_cleared_and_never_holds_the_key(api):
    _patch(api, api_key=KEY)
    _patch(api, api_key="")
    rows = list(AuditLog.objects.filter(resource="assistant_config").order_by("id"))
    assert [r.changes["api_key"] for r in rows] == ["replaced", "cleared"]
    assert all(KEY not in json.dumps(r.changes) and KEY not in r.description for r in rows)
    assert config.effective().connection.api_key == ""  # 清除 ≠ 回到 env


def test_a_save_records_changed_keys_with_old_and_new_values(api, admin):
    _patch(api, soul_per_hour=5, effort="high")
    row = AuditLog.objects.get(resource="assistant_config")
    assert row.user == admin and row.action == "UPDATE"
    assert row.changes == {"soul_per_hour": [30, 5], "effort": ["low", "high"]}


# ── 生效配置:库覆盖 env,env 总开关是硬上限 ───────────────────────────────────


def test_env_off_is_a_ceiling_the_page_switch_cannot_lift(api, settings, cn_tenant):
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    settings.ASSISTANT_ENABLED = False
    body = _patch(api, enabled=True).data
    assert body["switch"] is True and body["env_enabled"] is False and body["enabled"] is False
    assert _soul_ask(soul).data["code"] == "assistant_not_configured"
    assert FakeProvider.calls == []


def test_the_page_switch_turns_the_assistant_off_and_on(api, cn_tenant):
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    _patch(api, enabled=False)
    assert _soul_ask(soul).status_code == 503
    _patch(api, enabled=True)
    assert _soul_ask(soul).status_code == 200


def test_a_saved_model_reaches_the_provider_and_the_audit(api, cn_tenant):
    """正式提问读生效配置,保存即失效。变异:`service.ask` 里的 `config.effective()` 换成 `config.env_connection()` → 这里拿到 env-model,红。"""
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    assert api.post(f"{BASE}config/test/", {"model": "new-model"}, format="json").data["ok"] is True
    assert _patch(api, model="new-model").status_code == 200
    assert _soul_ask(soul).status_code == 200
    assert FakeProvider.calls[-1]["model"] == "new-model"
    answer = AuditLog.objects.filter(resource="assistant").latest("id")
    assert answer.changes["model"] == "new-model"


def test_changing_the_model_needs_a_passing_test_of_that_exact_candidate(api):
    assert _patch(api, model="m2").data["code"] == "untested_model"
    api.post(f"{BASE}config/test/", {"model": "m2", "api_key": KEY}, format="json")
    assert _patch(api, model="m2").data["code"] == "untested_model"  # 测的是另一把 key
    assert _patch(api, model="m2", api_key=KEY).status_code == 200
    assert config.effective().connection.model == "m2"


def test_a_failed_test_reports_its_kind_and_does_not_unlock_the_model(api):
    FakeProvider.script = [{"raise": "401", "kind": "auth"}]
    body = api.post(f"{BASE}config/test/", {"model": "m3"}, format="json").data
    assert body["ok"] is False and body["error_kind"] == "auth" and body["model"] == "m3"
    assert _patch(api, model="m3").data["code"] == "untested_model"


def test_the_real_adapters_classify_sdk_errors():
    import anthropic
    import httpx2
    import openai

    from apps.soul_assist.providers import _kind

    request = httpx2.Request("POST", "http://example.invalid")

    def status(cls, code, body=None):
        return cls("x", response=httpx2.Response(code, request=request), body=body)

    assert _kind(status(anthropic.AuthenticationError, 401)) == "auth"
    assert _kind(status(openai.NotFoundError, 404)) == "model_not_found"
    assert _kind(openai.APITimeoutError(request=request)) == "timeout"
    assert _kind(status(openai.BadRequestError, 400, {"error": "this model does not support tools"})) == \
        "tools_unsupported"
    assert _kind(status(openai.BadRequestError, 400, {"error": "bad"})) == "other"


def test_the_hourly_limit_is_read_from_the_config(api, cn_tenant):
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    _patch(api, soul_per_hour=1)
    assert _soul_ask(soul).status_code == 200
    second = _soul_ask(soul)
    assert second.status_code == 429 and second.data["code"] == "rate_limited"
    assert AssistUsage.objects.filter(status="rate_limited", side="soul", tenant=cn_tenant).count() == 1


def test_a_cap_without_a_price_for_the_model_is_refused(api):
    assert _patch(api, monthly_cap=10).data["code"] == "unpriced_model"
    assert _patch(api, monthly_cap=10, prices={"env-model": {"input": 1, "output": 2}}).status_code == 200


# ── 每殿开关 ──────────────────────────────────────────────────────────────


def test_the_hall_list_counts_souls_homed_there_and_toggles_with_an_audit(api, cn_tenant, eu_tenant):
    from apps.souls.models import Soul

    Soul.objects.create(name="甲", tenant=cn_tenant)
    Soul.objects.create(name="乙", tenant=eu_tenant, home_tenant=cn_tenant)  # 暂居 EU,原属 CN
    halls = {h["code"]: h for h in api.get(f"{BASE}halls/").data}
    assert halls["CN_DIYU"]["souls_homed"] == 2 and halls["EU_HEAVEN_HELL"]["souls_homed"] == 0
    assert halls["CN_DIYU"]["assistant_enabled"] is False
    body = api.patch(f"{BASE}halls/{cn_tenant.pk}/", {"assistant_enabled": True}, format="json").data
    assert body["assistant_enabled"] is True
    cn_tenant.refresh_from_db()
    assert cn_tenant.settings["assistant_enabled"] is True
    row = AuditLog.objects.get(resource="assistant_config", resource_id="tenant:CN_DIYU")
    assert row.changes == {"assistant_enabled": [False, True]}


# ── 用量 ──────────────────────────────────────────────────────────────────


def test_every_outcome_is_recorded_without_any_text(cn_tenant):
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    _soul_ask(soul, question="独一无二的提问文本")
    FakeProvider.script = [{"raise": "timeout"}]
    _soul_ask(soul)
    FakeProvider.script = [{"text": "  "}]
    _soul_ask(soul)
    _enable(cn_tenant, False)
    _soul_ask(soul)
    assert list(AssistUsage.objects.order_by("id").values_list("status", flat=True)) == [
        "ok", "unavailable", "empty", "not_configured"]
    ok = AssistUsage.objects.get(status="ok")
    assert (ok.side, ok.tenant, ok.model, ok.input_tokens, ok.output_tokens) == ("soul", cn_tenant, "env-model", 1, 1)
    text_fields = [f.name for f in AssistUsage._meta.fields if f.get_internal_type() in ("TextField",)]
    assert text_fields == []


def test_the_usage_report(api, cn_tenant, judge_user):
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    _patch(api, prices={"env-model": {"input": 1_000_000, "output": 2_000_000}}, monthly_cap=None)
    _soul_ask(soul)
    officer_client(judge_user).post("/api/v1/assist/", {"question": "q", "screen": "judgment"}, format="json")
    FakeProvider.script = [{"text": ""}]
    _soul_ask(soul)
    usage.record("soul", cn_tenant, "ok", "unpriced-model", {"input": 5, "output": 5})
    usage.record("soul", cn_tenant, "ok", "env-model", {"input": 1000, "output": 1000}, is_eval=True)
    body = api.get(f"{BASE}usage/").data
    assert body["requests"] == 4 and body["by_status"]["ok"] == 3 and body["by_status"]["empty"] == 1
    assert body["spent"] == 9.0  # 3 次 × (1 + 2);评测那条不计,未定价那条不当 0 也不计
    assert body["unpriced_models"] == ["unpriced-model"]
    assert {s["side"]: s["requests"] for s in body["by_side"]} == {"soul": 3, "officer": 1}
    assert body["by_hall"][0]["code"] == "CN_DIYU" and body["by_day"][0]["requests"] == 4
    assert body["failure_rates"]["empty"] == 0.25
    assert body["phase4"]["corpus_threshold"] == 80_000 and body["phase4"]["empty_reached"] is True
    assert api.get(f"{BASE}usage/?month=2020-01").data["requests"] == 0
    assert api.get(f"{BASE}usage/?month=bad").data["code"] == "invalid_month"


# ── 月度上限 ──────────────────────────────────────────────────────────────


def test_reaching_the_monthly_cap_turns_the_switch_off_audits_and_notifies(api, admin, cn_tenant):
    """变异:删掉 `ask` 里的 `usage.enforce_cap()` → 开关不关、没有通知,红。"""
    _enable(cn_tenant)
    _, soul = ready_soul(cn_tenant)
    _patch(api, prices={"env-model": {"input": 1_000_000, "output": 1_000_000}}, monthly_cap=3)
    assert _soul_ask(soul).status_code == 200  # 花了 2
    assert config.effective().enabled is True
    assert UserNotification.objects.filter(user=admin).count() == 0
    assert _soul_ask(soul).status_code == 200  # 花了 4 ≥ 3
    assert config.effective().enabled is False
    trip = AuditLog.objects.filter(resource="assistant_config", user=None).get()
    assert trip.changes == {"enabled": [True, False]} and "monthly cap" in trip.description
    assert UserNotification.objects.filter(user=admin, related_resource="assistant_config").count() == 1
    assert _soul_ask(soul).data["code"] == "assistant_not_configured"
    assert usage.enforce_cap() is False  # 已经关了:不再关、不再通知
    assert UserNotification.objects.filter(user=admin).count() == 1


def test_eval_spend_does_not_count_toward_the_cap(api, cn_tenant):
    _patch(api, prices={"env-model": {"input": 1_000_000, "output": 1_000_000}}, monthly_cap=3)
    usage.record("soul", cn_tenant, "ok", "env-model", {"input": 50, "output": 50}, is_eval=True)
    assert usage.enforce_cap() is False and config.effective().enabled is True


# ── 评测 ──────────────────────────────────────────────────────────────────


def test_the_drafted_eval_set_is_there():
    assert AssistEvalCase.objects.filter(side="soul").count() >= 20
    assert AssistEvalCase.objects.filter(side="officer").count() >= 15


def test_eval_cases_are_validated_against_the_side(api):
    bad_tool = api.post(f"{BASE}eval/cases/", {"side": "soul", "screen": "life", "question": "q",
                                               "expected_tools": ["inbox_counts"]}, format="json")
    assert bad_tool.status_code == 400 and "expected_tools" in bad_tool.data
    bad_screen = api.post(f"{BASE}eval/cases/", {"side": "officer", "screen": "life", "question": "q"},
                          format="json")
    assert bad_screen.status_code == 400 and "screen" in bad_screen.data
    ok = api.post(f"{BASE}eval/cases/", {"side": "officer", "screen": "judgment", "question": "q",
                                         "expected_tools": ["judgment_queue_counts"]}, format="json")
    assert ok.status_code == 201
    assert api.patch(f"{BASE}eval/cases/{ok.data['id']}/", {"active": False}, format="json").status_code == 200
    assert api.delete(f"{BASE}eval/cases/{ok.data['id']}/").status_code == 204


def _only(side, **fields):
    """把评测集收窄到一条,好算数。"""
    AssistEvalCase.objects.all().delete()
    defaults = {"screen": "applications" if side == "soul" else "judgment", "question": "Q",
                "expected_tools": [], "must_include": [], "must_not_include": []}
    return AssistEvalCase.objects.create(side=side, **{**defaults, **fields})


def test_the_preview_names_what_blocks_a_run(api):
    _only("soul")
    body = api.post(f"{BASE}eval/preview/", {"side": "soul", "candidates": [{}]}, format="json").data
    assert body["confirm_token"] is None and set(body["problems"]) == {"unpriced_model", "no_eval_soul"}
    _patch(api, prices={"env-model": {"input": 1, "output": 1}}, eval_spend_cap=0)
    body = api.post(f"{BASE}eval/preview/", {"side": "soul", "candidates": [{}]}, format="json").data
    assert "over_spend_cap" in body["problems"]


def _eval_ready(api, cn_tenant, judge_user):
    account, _ = ready_soul(cn_tenant)
    _patch(api, prices={"env-model": {"input": 1, "output": 1}, "cand-b": {"input": 2, "output": 2}},
           eval_soul_account=str(account.pk), eval_officer=judge_user.pk)
    return account


def test_a_run_needs_the_previews_token_once_and_from_the_same_admin(api, cn_tenant, judge_user):
    _eval_ready(api, cn_tenant, judge_user)
    _only("soul")
    preview = api.post(f"{BASE}eval/preview/", {"side": "soul", "candidates": [{}, {"model": "cand-b"}]},
                       format="json").data
    assert preview["problems"] == [] and preview["asks"] == 2 and preview["estimated_cost"] > 0
    other = officer_client(User.objects.create_user(username="yama2", password="x", role="ADMIN"))
    assert other.post(f"{BASE}eval/runs/", {"confirm_token": preview["confirm_token"]},
                      format="json").data["code"] == "invalid_confirm_token"
    started = api.post(f"{BASE}eval/runs/", {"confirm_token": preview["confirm_token"]}, format="json")
    assert started.status_code == 202 and started.data["status"] == "queued" and started.data["total"] == 2
    assert api.post(f"{BASE}eval/runs/", {"confirm_token": preview["confirm_token"]},
                    format="json").data["code"] == "invalid_confirm_token"


def test_an_eval_run_goes_through_ask_side_by_side_and_leaves_no_trace_in_usage(api, cn_tenant, judge_user,
                                                                               django_capture_on_commit_callbacks):
    account = _eval_ready(api, cn_tenant, judge_user)
    _only("soul", expected_tools=["rebirth"], must_include=["申诉"], must_not_include=["已为你提交"])
    FakeProvider.script = [{"tools": ["rebirth"]}, {"text": "可以申诉。"}]
    preview = api.post(f"{BASE}eval/preview/", {"side": "soul", "candidates": [{}, {"model": "cand-b"}]},
                       format="json").data
    from unittest.mock import patch

    from apps.soul_assist import tasks

    with patch.object(tasks.run_eval, "delay", side_effect=tasks.run_eval.run), \
            django_capture_on_commit_callbacks(execute=True):
        run_id = api.post(f"{BASE}eval/runs/", {"confirm_token": preview["confirm_token"]}, format="json").data["id"]
    run = api.get(f"{BASE}eval/runs/{run_id}/").data
    assert run["status"] == "done" and run["done"] == 2
    assert [c["model"] for c in run["candidates"]] == ["env-model", "cand-b"]
    assert [c["model"] for c in FakeProvider.calls] == ["env-model", "cand-b"]
    first = run["results"][0]
    assert first["tools_called"] == ["rebirth"] and first["passed"] is True
    assert first["included"] == {"申诉": True} and first["excluded"] == {"已为你提交": False}
    summary = run["summary"]
    assert [s["tool_accuracy"] for s in summary] == [1.0, 1.0]
    assert [s["cost"] for s in summary] == [0.000002, 0.000004]
    # 评测的会话:不进本人的列表、不计用量
    assert AssistConversation.objects.filter(account=account, is_eval=True).count() == 2
    assert soul_client(account).get("/api/v1/me/assist/conversations/").data == []
    assert AssistUsage.objects.filter(is_eval=False).count() == 0
    assert AssistUsage.objects.filter(is_eval=True).count() == 2
    assert api.get(f"{BASE}usage/").data["requests"] == 0


def test_an_eval_does_not_need_the_switches_but_keeps_the_data_scope(api, cn_tenant, eu_tenant, judge_user):
    """评测官员是 CN 的判官:它看到的计数与它在正式提问里看到的一样,只有 CN。"""
    from apps.judgment.models import Judgment
    from apps.souls.models import Soul, SoulState

    for tenant in (cn_tenant, eu_tenant, eu_tenant):
        soul = Soul.objects.create(name="x", tenant=tenant, current_state=SoulState.JUDGING)
        Judgment.objects.create(soul=soul, civilization=soul.civilization, court="一", tenant=tenant,
                                evidence_json={})
    _eval_ready(api, cn_tenant, judge_user)
    _patch(api, enabled=False)
    case = _only("officer", expected_tools=["judgment_queue_counts"])
    FakeProvider.script = [{"tools": ["judgment_queue_counts"]}, {"text": "一件。"}]
    run = AssistEvalRun.objects.create(candidates=[evals._stored(config.effective().connection)],
                                       case_ids=[case.pk], total=1)
    assert evals.execute(run.pk) == "done"
    counts = FakeProvider.script[0]["results"][0]
    assert counts["scope"] == "this_hall" and counts["total"] == 1
    assert AssistEvalResult.objects.get(run=run).passed is True


def test_the_run_stops_at_the_spend_cap(api, cn_tenant, judge_user):
    _eval_ready(api, cn_tenant, judge_user)
    _patch(api, prices={"env-model": {"input": 1_000_000, "output": 1_000_000}}, eval_spend_cap=3)
    cases = [_only("soul")] + [AssistEvalCase.objects.create(side="soul", screen="life", question=f"Q{i}")
                               for i in range(3)]
    run = AssistEvalRun.objects.create(candidates=[evals._stored(config.effective().connection)],
                                       case_ids=[c.pk for c in cases], total=4)
    assert evals.execute(run.pk) == "stopped_at_cap"
    assert run.results.count() == 2  # 2 + 2 ≥ 3 之后停


def test_a_stored_candidate_key_is_ciphertext_and_not_in_the_response(api, cn_tenant, judge_user):
    _eval_ready(api, cn_tenant, judge_user)
    _only("soul")
    token = api.post(f"{BASE}eval/preview/", {"side": "soul", "candidates": [{"api_key": KEY}]},
                     format="json").data["confirm_token"]
    body = api.post(f"{BASE}eval/runs/", {"confirm_token": token}, format="json").data
    assert KEY not in json.dumps(body)
    stored = AssistEvalRun.objects.get().candidates[0]["api_key"]
    assert KEY not in stored and evals._connection(AssistEvalRun.objects.get().candidates[0]).api_key == KEY


# ── 语料 ──────────────────────────────────────────────────────────────────


def test_the_corpus_view_lists_every_entry(api):
    from apps.soul_assist import corpus

    body = api.get(f"{BASE}corpus/").data
    expected = sum(len(corpus.entries(lo, au)) for lo in corpus.LOCALES for au in corpus.AUDIENCES)
    assert len(body["entries"]) == expected > 0
    assert body["total_tokens"] == max(p["tokens"] for p in body["prompts"]) > 0
    assert {e["audience"] for e in body["entries"]} == {"soul", "officer"}


def test_service_answer_still_checks_the_switch_outside_evals(cn_tenant):
    """评测跳过开关,正式提问不跳:`answer` 仍先问 `enabled_for`。"""
    account, _ = ready_soul(cn_tenant)
    with pytest.raises(service.AssistError):
        service.answer(account, "q", "life", locale="zh-Hans")
