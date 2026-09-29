"""助手的向量检索(docs/ARCHITECTURE-soul-assist.md §7)。

全部离线:向量服务是下面的 `FakeOllama`(固定向量)。条目的向量是按 id 排的单位基向量,问题的向量是
测试写明的几个条目的加权和 —— 于是「谁最近、按什么顺序」由测试决定,不由假实现的巧合决定。

真 pgvector 的查询只在 PostgreSQL 上跑(`skipif(sqlite)`,登记在 test_concurrency 的 PG-only 名单里):
那几条断言库里的 `<=>` 排序与 SQLite 路径的 Python 余弦是同一个排序,以及索引建得出来、用得上。
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.soul_assist import config, corpus, evals, service, usage, vectors
from apps.soul_assist.models import AssistConfig, AssistEvalCase, AssistEvalRun, AssistUsage, HelpChunk
from apps.soul_assist.providers import FakeProvider
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

BASE = "/api/v1/assist-admin/"
IDS = sorted({e["id"] for loc in corpus.LOCALES for aud in corpus.AUDIENCES for e in corpus.entries(loc, aud)})
TOTAL = sum(len(corpus.entries(loc, aud)) for loc in corpus.LOCALES for aud in corpus.AUDIENCES)
SQLITE = connection.vendor == "sqlite"


class FakeOllama:
    """`/api/embed` 的替身。条目文本 → 该条目 id 的基向量;问题 → `queries` 里写的加权和;其余 → 均匀向量
    (与任何条目都不像)。认 `dimensions`(截断),`wrong_dims` 模拟服务返回的维度不对。"""

    def __init__(self, dims=64):
        self.dims = dims
        self.calls = []
        self.queries = {}
        self.fail = None  # 设成 EmbeddingError 的 kind 就失败
        self.wrong_dims = False
        self.texts = {vectors.entry_text(e): e["id"] for loc in corpus.LOCALES for aud in corpus.AUDIENCES
                      for e in corpus.entries(loc, aud)}

    def basis(self, entry_id, weight=1.0):
        v = [0.0] * self.dims
        v[IDS.index(entry_id)] = weight
        return v

    def vector(self, text, dims):
        if text.startswith(vectors.QUERY_INSTRUCTION):
            weights = self.queries.get(text[len(vectors.QUERY_INSTRUCTION):])
            if weights is None:
                v = [1.0] * self.dims
            else:
                v = [0.0] * self.dims
                for entry_id, w in weights.items():
                    v[IDS.index(entry_id)] += w
                v[-1] += 0.01  # 不与任何条目同向;不改变排序
        else:
            v = self.basis(self.texts[text])
        return v[:dims] if dims else v

    def __call__(self, url, payload, timeout):
        self.calls.append({"url": url, "payload": payload, "timeout": timeout})
        if self.fail:
            raise vectors.EmbeddingError(self.fail)
        dims = payload.get("dimensions")
        out = [self.vector(t, dims) for t in payload["input"]]
        if self.wrong_dims:
            out = [v[:-1] for v in out]
        return {"model": payload["model"], "embeddings": out}


@pytest.fixture
def ollama(monkeypatch):
    fake = FakeOllama()
    monkeypatch.setattr(vectors, "_post", fake)
    return fake


@pytest.fixture(autouse=True)
def assistant_on(settings):
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    settings.ASSISTANT_EMBEDDING_URL = "http://ollama.test:11434"
    settings.ASSISTANT_EMBEDDING_MODEL = "fake-embed"
    settings.ASSISTANT_EMBEDDING_DIMS = None
    settings.ASSISTANT_RETRIEVAL_K = 5
    settings.ASSISTANT_RETRIEVAL_MIN_SIMILARITY = 0.5
    FakeProvider.script = [{"text": "好的。"}]
    FakeProvider.calls = []
    config.invalidate()
    yield
    FakeProvider.script = []
    FakeProvider.calls = []


def _embeds(fake):
    """实际嵌入的文本条数(一次调用可以是一批)。"""
    return sum(len(c["payload"]["input"]) for c in fake.calls)


# ── 网络 ──────────────────────────────────────────────────────────────────


def test_the_embedding_host_is_blocked_in_tests():
    """根 conftest 的 autouse fixture:没装假实现的测试碰不到 192.168.2.2。
    变异:删掉那个 fixture → 这里真的去连默认地址(通则不抛,不通则报 ConnectionError 而不是这句)→ 红。"""
    with pytest.raises(vectors.EmbeddingError, match="network blocked in tests"):
        vectors.embed(["x"], config.Embedding("http://192.168.2.2:11434", "m", None), 3)


# ── 同步 ──────────────────────────────────────────────────────────────────


def test_sync_embeds_every_entry_once_and_then_nothing(ollama):
    first = vectors.sync()
    assert first["embedded"] == TOTAL and first["unchanged"] == 0 and first["deleted"] == 0
    assert HelpChunk.objects.count() == TOTAL and _embeds(ollama) == TOTAL
    assert all(len(c["payload"]["input"]) <= vectors.BATCH for c in ollama.calls)
    ollama.calls.clear()
    again = vectors.sync()
    assert again["embedded"] == 0 and again["unchanged"] == TOTAL
    assert ollama.calls == []  # 哈希没变:一次都不调
    row = AssistConfig.objects.get(pk=1)
    assert row.vectors_synced_model == "fake-embed" and row.vectors_synced_at is not None


def test_a_changed_entry_is_re_embedded_and_a_removed_one_deleted(ollama, monkeypatch):
    vectors.sync()
    ollama.calls.clear()
    original = corpus.entries

    def edited(locale, audience="soul"):
        rows = original(locale, audience)
        if (locale, audience) != ("zh-Hans", "soul"):
            return rows
        out = [dict(e, body=e["body"] + "(修订)") if e["id"] == "circle" else e for e in rows]
        return tuple(e for e in out if e["id"] != "language")

    monkeypatch.setattr(corpus, "entries", edited)
    ollama.texts.update({vectors.entry_text(e): e["id"] for e in edited("zh-Hans")})
    result = vectors.sync()
    assert (result["embedded"], result["deleted"]) == (1, 1)
    assert [c["payload"]["input"] for c in ollama.calls] == [[vectors.entry_text(
        next(e for e in edited("zh-Hans") if e["id"] == "circle"))]]
    assert not HelpChunk.objects.filter(locale="zh-Hans", entry_id="language").exists()
    assert HelpChunk.objects.filter(locale="en", entry_id="language").exists()


@pytest.mark.parametrize("change", [{"ASSISTANT_EMBEDDING_MODEL": "other-embed"}, {"ASSISTANT_EMBEDDING_DIMS": 32}])
def test_a_new_model_or_truncation_re_embeds_everything(ollama, settings, change):
    vectors.sync()
    ollama.calls.clear()
    for k, v in change.items():
        setattr(settings, k, v)
    assert vectors.sync()["embedded"] == TOTAL
    if "ASSISTANT_EMBEDDING_DIMS" in change:
        assert all(c["payload"]["dimensions"] == 32 for c in ollama.calls)
        assert set(HelpChunk.objects.values_list("dims", flat=True)) == {32}
    else:
        assert all("dimensions" not in c["payload"] for c in ollama.calls)


def test_a_failed_sync_changes_nothing(ollama):
    vectors.sync()
    before = list(HelpChunk.objects.order_by("pk").values_list("pk", "model", "content_hash"))
    ollama.fail = "timeout"
    with pytest.raises(vectors.EmbeddingError):
        vectors.sync(config.Embedding("http://ollama.test:11434", "other-embed", None))
    assert list(HelpChunk.objects.order_by("pk").values_list("pk", "model", "content_hash")) == before


def test_a_dims_mismatch_from_the_service_fails_the_sync(ollama, settings):
    settings.ASSISTANT_EMBEDDING_DIMS = 32
    ollama.wrong_dims = True
    with pytest.raises(vectors.EmbeddingError) as exc:
        vectors.sync()
    assert exc.value.kind == "dims_mismatch" and HelpChunk.objects.count() == 0


def test_the_command_runs_the_same_sync(ollama):
    from io import StringIO

    from django.core.management import call_command

    out = StringIO()
    call_command("sync_help_vectors", stdout=out)
    assert f"embedded={TOTAL}" in out.getvalue() and HelpChunk.objects.count() == TOTAL


# ── 检索 ──────────────────────────────────────────────────────────────────


def test_retrieval_orders_by_cosine_and_takes_k(ollama, settings):
    vectors.sync()
    ollama.queries["申诉"] = {"rebirth-appeal": 0.9, "rebirth-apply": 0.5, "rebirth-review": 0.3, "letters": 0.2}
    settings.ASSISTANT_RETRIEVAL_K = 3
    config.invalidate()
    found = vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE")
    assert found.mode == "vector"
    assert found.entries == ("rebirth-appeal", "rebirth-apply", "rebirth-review")
    assert found.top_similarity == pytest.approx(0.9 / (0.9**2 + 0.5**2 + 0.3**2 + 0.2**2 + 0.01**2) ** 0.5)


def test_retrieval_filters_by_audience_locale_and_civilization(ollama, settings):
    settings.ASSISTANT_RETRIEVAL_MIN_SIMILARITY = 0.0  # 这里只看过滤,不看下限
    """埃及灵魂拿不到只写给中国、希腊的条目;灵魂拿不到官员条目;PINNED 不经检索(它总在前缀里)。
    断言缺席:这些条目在问题向量里的权重最大。"""
    vectors.sync()
    ollama.queries["q"] = {"rebirth-appeal": 0.9, "officer-roles": 0.8, "codes": 0.7, "no-rebirth": 0.2,
                           "circle": 0.1}
    egyptian = vectors.retrieve("q", "en", "soul", "EGYPTIAN")
    assert egyptian.entries[:2] == ("no-rebirth", "circle")
    assert {"rebirth-appeal", "officer-roles", "codes"}.isdisjoint(egyptian.entries)
    chinese = vectors.retrieve("q", "en", "soul", "CHINESE")
    assert chinese.entries[0] == "rebirth-appeal" and "no-rebirth" not in chinese.entries
    officer = vectors.retrieve("q", "en", "officer", None)
    assert officer.entries[0] == "officer-roles"
    assert all(e.startswith("officer-") for e in officer.entries)
    assert [c["payload"]["input"][0] for c in ollama.calls[-1:]] == [vectors.QUERY_INSTRUCTION + "q"]


def test_no_vectors_falls_back_without_calling_the_service(ollama):
    assert vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE").mode == "fallback"
    assert ollama.calls == []


@pytest.mark.parametrize("kind", ["timeout", "connection", "model_not_found", "other"])
def test_an_embedding_failure_falls_back(ollama, kind):
    vectors.sync()
    ollama.fail = kind
    assert vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE") == vectors.Retrieval("fallback")


def test_the_question_is_embedded_with_the_short_timeout(ollama, settings):
    vectors.sync()
    settings.ASSISTANT_EMBEDDING_TIMEOUT_SECONDS = 3
    ollama.queries["申诉"] = {"rebirth-appeal": 1.0}
    vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE")
    assert ollama.calls[-1]["timeout"] == 3
    assert all(c["timeout"] == vectors.SYNC_TIMEOUT_SECONDS for c in ollama.calls[:-1])


def test_vectors_of_another_dimension_fall_back(ollama, settings):
    """换了截断维度还没重建:库里的行与问题向量维度不同,不拿它们比,退回整份语料。"""
    vectors.sync()
    settings.ASSISTANT_EMBEDDING_DIMS = 32
    config.invalidate()
    ollama.queries["申诉"] = {"rebirth-appeal": 1.0}
    assert vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE").mode == "fallback"


def test_a_question_like_nothing_falls_back_for_low_similarity(ollama):
    vectors.sync()
    found = vectors.retrieve("今天天气怎么样", "zh-Hans", "soul", "CHINESE")  # 均匀向量:与每条都只有 1/8
    assert found.mode == "fallback_low_similarity" and found.entries == ()
    assert found.top_similarity == pytest.approx(1 / 64 ** 0.5)


# ── 提问路径 ──────────────────────────────────────────────────────────────


def _enable(tenant):
    tenant.settings = {**(tenant.settings or {}), "assistant_enabled": True}
    tenant.save(update_fields=["settings"])


def _ask(client, question):
    return client.post("/api/v1/me/assist/", {"question": question, "screen": "applications"}, format="json",
                       HTTP_ACCEPT_LANGUAGE="zh-Hans")


def test_the_retrieved_entries_replace_the_corpus_and_the_rules_stay_cached(cn_tenant, ollama, settings):
    settings.ASSISTANT_RETRIEVAL_K = 2
    _enable(cn_tenant)
    vectors.sync()
    ollama.queries["被驳回了还能申诉吗"] = {"rebirth-appeal": 0.9, "rebirth-apply": 0.4}
    _, client = ready_soul(cn_tenant)
    assert _ask(client, "被驳回了还能申诉吗").status_code == 200
    call = FakeProvider.calls[0]
    assert call["system"] == corpus.system_prompt("zh-Hans", retrieved=True)
    assert "### codes" in call["system"] and "### rebirth-appeal" not in call["system"]
    assert call["facts"].index("### rebirth-appeal") < call["facts"].index("### rebirth-apply")
    # 断言缺席:没进 top-k 的条目不在任何一段里。
    assert "### circle" not in call["system"] + call["facts"]
    assert AssistUsage.objects.get().retrieval == "vector"
    assert AuditLog.objects.get(resource="assistant").changes["retrieval"] == "vector"


@pytest.mark.parametrize("setup", ["no_vectors", "service_down", "low_similarity"])
def test_every_fallback_sends_the_whole_corpus_and_is_recorded(cn_tenant, ollama, setup):
    _enable(cn_tenant)
    if setup != "no_vectors":
        vectors.sync()
    ollama.fail = "timeout" if setup == "service_down" else None
    _, client = ready_soul(cn_tenant)
    assert _ask(client, "今天天气怎么样").status_code == 200
    assert FakeProvider.calls[0]["system"] == corpus.system_prompt("zh-Hans")
    assert "HELP ENTRIES (retrieved" not in FakeProvider.calls[0]["facts"]
    expected = "fallback_low_similarity" if setup == "low_similarity" else "fallback"
    assert AssistUsage.objects.get().retrieval == expected
    report = usage.report({})
    assert report["by_retrieval"][expected] == 1 and sum(report["by_retrieval"].values()) == 1


def test_the_embedding_time_counts_against_the_answer_deadline(cn_tenant, ollama, monkeypatch):
    """取向量用掉的时间从 22 秒里扣,不另加(§7.5)。取向量让时钟走 2.5 秒:截止时刻在它之前定下 → 122;
    变异:把 `deadline = …` 挪到 `vectors.retrieve` 之后 → 124.5 → 红。"""
    _enable(cn_tenant)
    vectors.sync()
    now = [100.0]
    monkeypatch.setattr(service.time, "monotonic", lambda: now[0])

    def slow(url, payload, timeout):
        now[0] += 2.5
        return ollama(url, payload, timeout)

    monkeypatch.setattr(vectors, "_post", slow)
    _, client = ready_soul(cn_tenant)
    assert _ask(client, "申诉").status_code == 200
    assert FakeProvider.calls[0]["deadline"] == 100.0 + 22


# ── 管理接口 ──────────────────────────────────────────────────────────────


@pytest.fixture
def api(cn_tenant):
    return officer_client(User.objects.create_user(username="yama", password="x", role="ADMIN", tenant=None))


def test_the_admin_reads_the_embedding_config_and_status(api, ollama):
    body = api.get(f"{BASE}embedding/").data
    assert body["embedding_url"] == "http://ollama.test:11434" and body["embedding_model"] == "fake-embed"
    assert body["embedding_dims"] is None and body["retrieval_k"] == 5 and body["overridden"] == []
    assert body["status"]["entries"] == TOTAL and body["status"]["embedded"] == 0
    assert body["status"]["needs_rebuild"] is True and body["status"]["last_rebuild_at"] is None


def test_the_test_button_reports_latency_and_dims(api, ollama):
    body = api.post(f"{BASE}embedding/test/", {}, format="json").data
    assert body["ok"] is True and body["dims"] == 64 and body["error_kind"] is None
    body = api.post(f"{BASE}embedding/test/", {"embedding_dims": 32}, format="json").data
    assert body["ok"] is True and body["dims"] == 32 and body["embedding_dims"] == 32


def test_a_dims_mismatch_fails_the_test(api, ollama):
    ollama.wrong_dims = True
    body = api.post(f"{BASE}embedding/test/", {"embedding_dims": 32}, format="json").data
    assert body["ok"] is False and body["error_kind"] == "dims_mismatch" and body["dims"] is None


@pytest.mark.parametrize("change", [{"embedding_model": "other-embed"}, {"embedding_dims": 32},
                                    {"embedding_url": "http://other.test:11434"}])
def test_a_connection_change_must_be_tested_first(api, ollama, change):
    """变异:去掉 PATCH 里的 `was_tested` 判断 → 未测的这一次也 200 → 红。"""
    response = api.patch(f"{BASE}embedding/", change, format="json")
    assert response.status_code == 400 and response.data["code"] == "untested_embedding"
    assert AssistConfig.objects.filter(pk=1).first() is None or AssistConfig.objects.get(pk=1).values == {}
    assert api.post(f"{BASE}embedding/test/", change, format="json").data["ok"] is True
    response = api.patch(f"{BASE}embedding/", change, format="json")
    assert response.status_code == 200
    key, value = next(iter(change.items()))
    assert response.data[key] == value and response.data["overridden"] == [key]
    audit = AuditLog.objects.get(resource="assistant_config", description="assistant embedding config updated")
    assert list(audit.changes) == [key]


def test_a_failed_test_does_not_unlock_the_save(api, ollama):
    ollama.fail = "model_not_found"
    assert api.post(f"{BASE}embedding/test/", {"embedding_model": "x"}, format="json").data["error_kind"] == \
        "model_not_found"
    assert api.patch(f"{BASE}embedding/", {"embedding_model": "x"}, format="json").status_code == 400


def test_k_and_the_similarity_floor_save_without_a_test(api, ollama):
    response = api.patch(f"{BASE}embedding/", {"retrieval_k": 3, "retrieval_min_similarity": 0.6}, format="json")
    assert response.status_code == 200 and ollama.calls == []
    assert (response.data["retrieval_k"], response.data["retrieval_min_similarity"]) == (3, 0.6)
    assert config.effective().retrieval_k == 3


def test_rebuild_embeds_and_reports_status(api, ollama):
    body = api.post(f"{BASE}embedding/rebuild/", format="json").data
    assert body["embedded"] == TOTAL and body["status"]["embedded"] == TOTAL
    assert body["status"]["needs_rebuild"] is False and body["status"]["last_rebuild_model"] == "fake-embed"
    assert AuditLog.objects.filter(resource="assistant_config", resource_id="vectors").count() == 1
    assert api.post(f"{BASE}embedding/rebuild/", format="json").data["embedded"] == 0


def test_rebuild_when_the_service_is_down_is_503_and_changes_nothing(api, ollama):
    ollama.fail = "connection"
    response = api.post(f"{BASE}embedding/rebuild/", format="json")
    assert response.status_code == 503 and response.data["code"] == "embedding_unavailable"
    assert response.data["error_kind"] == "connection" and HelpChunk.objects.count() == 0


def test_a_failed_rebuild_keeps_the_previous_set_and_is_reported(api, ollama, settings, monkeypatch):
    """全有或全无(Design):换了模型后重建,第二批失败 → 一行都不换,上一套完整向量还在,
    状态里报失败原因与时间;下一次成功清掉它。"""
    api.post(f"{BASE}embedding/rebuild/", format="json")
    before = list(HelpChunk.objects.order_by("pk").values_list("pk", "model", "content_hash"))
    settings.ASSISTANT_EMBEDDING_MODEL = "other-embed"
    config.invalidate()
    calls = []

    def second_batch_fails(url, payload, timeout):
        calls.append(1)
        if len(calls) == 2:
            raise vectors.EmbeddingError("timeout")
        return ollama(url, payload, timeout)

    monkeypatch.setattr(vectors, "_post", second_batch_fails)
    response = api.post(f"{BASE}embedding/rebuild/", format="json")
    monkeypatch.setattr(vectors, "_post", ollama)
    assert response.status_code == 503 and response.data["error_kind"] == "timeout"
    assert list(HelpChunk.objects.order_by("pk").values_list("pk", "model", "content_hash")) == before
    status = api.get(f"{BASE}embedding/").data["status"]
    assert status["last_error"] == "timeout" and status["last_error_at"] is not None
    assert status["needs_rebuild"] is True and status["last_rebuild_model"] == "fake-embed"
    ok = api.post(f"{BASE}embedding/rebuild/", format="json").data["status"]
    assert ok["last_error"] is None and ok["last_error_at"] is None and ok["needs_rebuild"] is False


def test_saving_a_new_model_does_not_rebuild_and_retrieval_falls_back_until_it_does(api, ollama):
    """测试通过不自动重建(Design);重建前绝不拿别的模型的向量来比。"""
    api.post(f"{BASE}embedding/rebuild/", format="json")
    ollama.queries["申诉"] = {"rebirth-appeal": 1.0}
    assert vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE").mode == "vector"
    assert api.post(f"{BASE}embedding/test/", {"embedding_model": "other-embed"}, format="json").data["ok"]
    embeds = _embeds(ollama)
    saved = api.patch(f"{BASE}embedding/", {"embedding_model": "other-embed"}, format="json").data
    assert _embeds(ollama) == embeds  # 保存没有触发任何嵌入
    assert saved["status"]["needs_rebuild"] is True and saved["status"]["embedded"] == 0
    assert vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE").mode == "fallback"
    api.post(f"{BASE}embedding/rebuild/", format="json")
    assert vectors.retrieve("申诉", "zh-Hans", "soul", "CHINESE").mode == "vector"


def test_the_status_says_when_a_rebuild_is_running(api, ollama):
    from django.core.cache import cache

    assert api.get(f"{BASE}embedding/").data["status"]["rebuild_running"] is False
    cache.add(vectors.REBUILD_LOCK, 1, 60)
    assert api.get(f"{BASE}embedding/").data["status"]["rebuild_running"] is True


def test_the_test_button_waits_longer_than_the_ask_path(api, ollama):
    api.post(f"{BASE}embedding/test/", {}, format="json")
    assert ollama.calls[-1]["timeout"] == vectors.TEST_TIMEOUT_SECONDS == 10


def test_a_second_rebuild_while_one_runs_is_409(api, ollama):
    from django.core.cache import cache

    cache.add(vectors.REBUILD_LOCK, 1, 60)
    response = api.post(f"{BASE}embedding/rebuild/", format="json")
    assert response.status_code == 409 and response.data["code"] == "rebuild_running" and ollama.calls == []


@pytest.mark.parametrize("role", ["MODERATOR", "JUDGE"])
def test_the_embedding_routes_refuse_non_admins(cn_tenant, ollama, role):
    client = officer_client(User.objects.create_user(username=f"u-{role}", password="x", role=role,
                                                     tenant=cn_tenant))
    for method, route in (("get", ""), ("patch", ""), ("post", "test/"), ("post", "rebuild/")):
        assert getattr(client, method)(f"{BASE}embedding/{route}", {}, format="json").status_code == 403
    assert ollama.calls == [] and HelpChunk.objects.count() == 0


# ── 评测 ──────────────────────────────────────────────────────────────────


def test_an_eval_case_names_only_entries_that_exist(api):
    base = {"side": "soul", "locale": "zh-Hans", "screen": "applications", "question": "q"}
    response = api.post(f"{BASE}eval/cases/", {**base, "expected_entries": ["no-such-entry"]}, format="json")
    assert response.status_code == 400 and "expected_entries" in response.data
    officer_only = api.post(f"{BASE}eval/cases/", {**base, "expected_entries": ["officer-roles"]}, format="json")
    assert officer_only.status_code == 400
    ok = api.post(f"{BASE}eval/cases/", {**base, "expected_entries": ["rebirth-appeal"]}, format="json")
    assert ok.status_code == 201 and ok.data["expected_entries"] == ["rebirth-appeal"]


def test_eval_runs_report_the_retrieval_hit_rate(cn_tenant, ollama, api):
    vectors.sync()
    account, _ = ready_soul(cn_tenant)
    free = {config.effective().connection.model: {"input": 0, "output": 0}}  # 定价了,花费上限才不会先停
    AssistConfig.objects.update_or_create(pk=1, defaults={"eval_soul_account": account, "values": {"prices": free, "retrieval_k": 1}})
    config.invalidate()
    ollama.queries["申诉"] = {"rebirth-appeal": 0.9}
    ollama.queries["朋友圈"] = {"circle": 0.9}
    cases = [AssistEvalCase.objects.create(side="soul", screen="applications", question="申诉",
                                           expected_entries=["rebirth-appeal"]),
             AssistEvalCase.objects.create(side="soul", screen="applications", question="朋友圈",
                                           expected_entries=["letters"]),
             AssistEvalCase.objects.create(side="soul", screen="applications", question="申诉",
                                           expected_entries=["codes"]),  # PINNED:总在上下文里
             AssistEvalCase.objects.create(side="soul", screen="applications", question="申诉")]
    FakeProvider.script = [{"text": "好的。"}] * 4
    stored = evals._stored(config.effective().connection)
    run = AssistEvalRun.objects.create(candidates=[stored], case_ids=[c.pk for c in cases], total=4)
    assert evals.execute(run.pk) == "done"
    hits = {r.case_id: (r.retrieval, r.retrieval_hit) for r in run.results.all()}
    assert hits == {cases[0].pk: ("vector", True), cases[1].pk: ("vector", False),
                    cases[2].pk: ("vector", True), cases[3].pk: ("vector", None)}
    summary = AssistEvalRun.objects.get(pk=run.pk).summary[0]
    assert summary["retrieval_hit_rate"] == pytest.approx(2 / 3) and summary["retrieval_fallbacks"] == 0
    detail = api.get(f"{BASE}eval/runs/{run.pk}/").data
    assert detail["summary"][0]["retrieval_hit_rate"] == pytest.approx(2 / 3)
    assert {r["retrieval_hit"] for r in detail["results"]} == {True, False, None}


# ── 只在 PostgreSQL 上:真 pgvector ─────────────────────────────────────────


def _load(dims):
    """同一组行写进库:每条的向量是若干基向量的混合,相似度两两不同(没有并列,排序才唯一)。"""
    rows = []
    for n, entry_id in enumerate(e["id"] for e in corpus.entries("zh-Hans", "soul") if e["id"] not in corpus.PINNED):
        v = [0.0] * dims
        v[n] = 1.0
        v[(n * 7 + 3) % dims] += 0.3 + n / 50
        v[dims - 1] += n / 10
        rows.append(HelpChunk(entry_id=entry_id, locale="zh-Hans", audience="soul", content="x", content_hash="h",
                              model="m", dims=dims, embedding=v))
    HelpChunk.objects.bulk_create(rows)
    query = [((i * 13) % 7) / 7 + 0.05 for i in range(dims)]
    return query


@pytest.mark.skipif(connection.vendor == "sqlite", reason="pgvector 的 <=> 只在 PostgreSQL 上")
def test_pgvector_orders_exactly_like_the_python_cosine():
    """vector(N) 转型(64 维)与 halfvec(N) 转型(2560 维)两条路径。不用参数化:PG-only 名单按名字数,
    参数化会让 SQLite 与 PG 的 skip 数之差比名单长度多一。"""
    for dims in (64, 2560):
        HelpChunk.objects.all().delete()
        query = _load(dims)
        in_db = vectors.nearest(HelpChunk.objects.filter(model="m"), query, 20)
        by_hand = sorted(((vectors.cosine(r.embedding, query), r.entry_id) for r in HelpChunk.objects.all()),
                         key=lambda t: (-t[0], t[1]))
        assert [e for _, e in in_db] == [e for _, e in by_hand], dims
        for (a, _), (b, _) in zip(in_db, by_hand, strict=True):
            assert a == pytest.approx(b, abs=1e-3)  # halfvec 是半精度


@pytest.mark.skipif(connection.vendor == "sqlite", reason="HNSW 索引只在 PostgreSQL 上")
def test_the_hnsw_index_is_built_past_the_threshold_used_and_dropped_with_its_model(ollama, settings):
    vectors.sync(index_threshold=10_000)
    assert vectors.sync(index_threshold=10_000)["index"] is None  # 未到阈值:不建
    built = vectors.sync(index_threshold=1)
    name = vectors.index_name("fake-embed", 64)
    assert built["index"] == name
    ollama.queries["申诉"] = {"rebirth-appeal": 1.0}
    rows = HelpChunk.objects.filter(model="fake-embed", dims=64, locale="zh-Hans", audience="soul")
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL enable_seqscan = off")
    with CaptureQueriesContext(connection) as ctx:
        assert vectors.nearest(rows, ollama.vector(vectors.QUERY_INSTRUCTION + "申诉", None), 3)[0][1] == \
            "rebirth-appeal"
    with connection.cursor() as cursor:
        cursor.execute("EXPLAIN " + ctx.captured_queries[-1]["sql"])
        plan = "\n".join(r[0] for r in cursor.fetchall())
    assert name in plan, plan  # 查询的表达式与索引同形,索引才用得上
    settings.ASSISTANT_EMBEDDING_MODEL = "other-embed"
    moved = vectors.sync(index_threshold=10_000)
    assert moved["dropped"] == [name] and moved["index"] is None
    with connection.cursor() as cursor:
        cursor.execute("SELECT indexname FROM pg_indexes WHERE tablename = %s", [vectors.TABLE])
        assert not [r for (r,) in cursor.fetchall() if r.startswith(vectors.INDEX_PREFIX)]
