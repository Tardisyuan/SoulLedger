"""审判台上的两个 AI 接入点(docs/audit/2026-11-12-portfolio-ai-ideas.md 第二部分 1 律条引用建议、2 判词草稿)。

- 评测集 `apps/soul_assist/evalsets/statute_suggest.json` 建成已结案审判,标签是它们的实际引用;桩照字面听话
  (连注入句子里点名的、别的文明的编号也给),校验把它们丢掉 —— 证明的是**校验**;关键词基线的分数同时量出来;
- 候选只来自本殿、本文明、未废止的条文,模型的检索工具也一样;
- 送给模型的是白名单:没有灵魂姓名、告白、申诉、证据原文;
- 只建议:接口一行引用 / 一个字的判词都不写;已结案 409;殿没开助手不送模型、退回关键词 / 模板;
- 判词:先有裁决才能起草,确定性检查标出不在已采纳列表里的编号、相反的裁决词、灵魂的名字。
"""
import json
from types import SimpleNamespace

import pytest

from apps.judgment import ai_statutes, ai_verdict
from apps.judgment.models import Judgment, JudgmentCitation, Statute, StatuteCorpus
from apps.soul_assist import config, features
from apps.soul_assist.models import AIDraft, AssistUsage
from apps.soul_assist.providers import FakeProvider
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.tenants.models import Tenant
from tests.ai_feature_support import enable, stub_fixture  # noqa: F401  (fixture `stub`)

pytestmark = pytest.mark.django_db

EVAL = features.evalset("statute_suggest")
HALLS = {"CHINESE": "CN_DIYU", "EUROPEAN": "EU_HEAVEN_HELL", "EGYPTIAN": "EG_DUAT", "GREEK": "GR_HADES"}
CORPUS = {"CHINESE": StatuteCorpus.GONGGUOGE, "EUROPEAN": StatuteCorpus.DEADLY_SIN,
          "EGYPTIAN": StatuteCorpus.NEGATIVE_CONFESSION, "GREEK": StatuteCorpus.GORGIAS}
SECRET_NAME = "秘名张三"


def _hall(civ):
    return Tenant.objects.get_or_create(code=HALLS[civ], defaults={"display_name": HALLS[civ]})[0]


def _corpus():
    for i, s in enumerate(EVAL["statutes"]):
        Statute.objects.create(tenant=_hall(s["civilization"]), corpus=CORPUS[s["civilization"]], ordinal=i,
                               source="eval fixture", **s)


def _case(civ, *, summary="", offence="", evidence=(), verdict=None, cited=(), name=SECRET_NAME):
    tenant = _hall(civ)
    soul = Soul.objects.create(name=name, birth_date="1900-01-01",
                               current_state=SoulState.JUDGING, tenant=tenant)
    j = Judgment.objects.create(soul=soul, civilization=civ, court="第一殿", tenant=tenant, evidence_json={},
                                summary=summary, offence=offence, confession="我的告白:秘密", grievance_plea="秘密申诉",
                                verdict=verdict, is_final=verdict is not None)
    for category in evidence:
        SoulRecord.objects.create(soul=soul, record_type="DEMERIT", category=category, civilization=civ,
                                  tenant=tenant, description=f"{name} 的证据原文", weight=10, event_year=1890)
    for code in cited:
        JudgmentCitation.objects.create(judgment=j, statute=Statute.objects.get(code=code), tenant=tenant)
    return j


def _concluded_eval_cases():
    _corpus()
    return [_case(c["civilization"], summary=c["summary"], offence=c.get("offence", ""), evidence=c["evidence"],
                  verdict="FAILED", cited=c["cited"]) for c in EVAL["cases"]]


def _literal(system, facts, prompt):
    """照字面听话的模型:按案由找回评测用例,回答它的标签加上 `naive` 里的编号。"""
    summary = json.loads(facts)["summary"]
    case = next(c for c in EVAL["cases"] if c["summary"].replace(SECRET_NAME, "该灵魂") == summary)
    rows = [{"code": code, "why": "matches"} for code in case["cited"] + case.get("naive", [])]
    return "建议如下:\n" + json.dumps({"suggestions": rows}, ensure_ascii=False)


def _judge(tenant, username="judge-ai"):
    from apps.authentication.models import User
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})
    for codename in ("judgment.read", "judgment.execute"):
        perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"name": codename,
                                                                                 "category": "judgment"})
        RolePermission.objects.get_or_create(role=role, permission=perm)
    invalidate_all_permissions()
    return User.objects.create_user(username=username, password="x", role="JUDGE", tenant=tenant)


def _client(user):
    from tests.soul_account_support import officer_client

    client = officer_client(user)
    client.defaults["HTTP_ACCEPT_LANGUAGE"] = "zh-Hans"
    return client


# --------------------------------------------------------------------------- 1 律条引用建议:评测


def test_the_evaluation_set_passes_against_the_literal_stub(stub):
    stub.reply = staticmethod(_literal)
    judgments = _concluded_eval_cases()
    per = ai_statutes.evaluate(judgments, SimpleNamespace(tenant=None, user=None), conn=config.effective().connection)
    assert set(per) == set(HALLS)
    assert all(row["recall"] == 1.0 and row["precision"] == 1.0 for row in per.values()), per
    assert AssistUsage.objects.filter(feature="statute_suggest").count() == len(judgments)
    assert AIDraft.objects.count() == 0  # 评测不留出处


def test_the_evaluation_turns_red_when_validation_is_skipped(stub, monkeypatch):
    """守卫自己会红:校验原样放行 → 注入与别的文明的编号混进建议,精确率掉下 1。"""
    stub.reply = staticmethod(_literal)
    judgments = _concluded_eval_cases()
    real = ai_statutes.validate

    def lax(raw, seen, cited):
        for row in raw:  # 「见过」的范围放大到全部条文:正是校验要挡的东西
            seen.setdefault(row["code"], Statute(code=row["code"]))
        return real(raw, seen, cited)

    monkeypatch.setattr(ai_statutes, "validate", lax)
    per = ai_statutes.evaluate(judgments, SimpleNamespace(tenant=None, user=None), conn=config.effective().connection)
    assert per["CHINESE"]["precision"] < 1 and per["EUROPEAN"]["precision"] < 1


def test_the_keyword_baseline_is_reported_per_civilization():
    """不靠模型的基线(退路就是它):按文明报召回,不报总数。这里的数字是这份小语料上的读数,不是门槛。"""
    per = ai_statutes.evaluate(_concluded_eval_cases(), None, use_model=False)
    assert set(per) == set(HALLS)
    assert all(0 <= row["recall"] <= 1 for row in per.values())
    assert per["CHINESE"]["recall"] >= 0.5, per


# --------------------------------------------------------------------------- 1 律条引用建议:接口


def test_only_this_halls_civilizations_live_articles_are_candidates(stub):
    _corpus()
    cn = _hall("CHINESE")
    Statute.objects.create(tenant=_hall("EUROPEAN"), corpus=StatuteCorpus.HELL_LAW, civilization="CHINESE",
                           code="CN-OTHER-HALL", title_zh="杀人", text_zh="杀人", source="x")
    retired = Statute.objects.create(tenant=cn, corpus=StatuteCorpus.GONGGUOGE, civilization="CHINESE",
                                     code="CN-RETIRED", title_zh="杀人", text_zh="杀人", source="x")
    retired.delete()
    j = _case("CHINESE", summary="杀人", offence="MURDER", evidence=["MURDER"])
    codes = {s.code for s in ai_statutes.pool(j)}
    assert codes == {s["code"] for s in EVAL["statutes"] if s["civilization"] == "CHINESE"}
    enable(cn)
    stub.reply = staticmethod(lambda s, f, p: json.dumps({"suggestions": [
        {"code": "CN-OTHER-HALL", "why": "x"}, {"code": "CN-RETIRED", "why": "x"}, {"code": "EU-EV-01", "why": "x"},
        {"code": "CN-EV-01", "why": "杀人"}]}))
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/statute-suggestions/")
    assert response.status_code == 200, response.data
    assert [s["code"] for s in response.data["suggestions"]] == ["CN-EV-01"]
    assert response.data["dropped"] == ["CN-OTHER-HALL", "CN-RETIRED", "EU-EV-01"]
    assert response.data["suggestions"][0]["text"].startswith("故意杀人")
    facts = FakeProvider.calls[-1]["facts"]
    assert "CN-OTHER-HALL" not in facts and "CN-RETIRED" not in facts and "EU-EV-01" not in facts


def test_the_search_tool_stays_in_the_pool_and_feeds_what_counts_as_seen(settings):
    """模型用 `search_statutes(query)` 检索:结果只在本殿本文明;检索到的条文才算「见过」、可以被建议。"""
    _corpus()
    cn = _hall("CHINESE")
    enable(cn)
    for i in range(25):  # 超过初始候选的 20 条:第 25 条只有检索得到
        Statute.objects.create(tenant=cn, corpus=StatuteCorpus.GONGGUOGE, civilization="CHINESE", ordinal=100 + i,
                               code=f"CN-PAD-{i:02d}", title_zh=f"杂条{i}", text_zh="无关" if i < 24 else "偷鸡", source="x")
    settings.ASSISTANT_ENABLED = True
    settings.ASSISTANT_PROVIDER = "apps.soul_assist.providers.FakeProvider"
    FakeProvider.calls = []
    FakeProvider.script = [{"tools": [["search_statutes", {"query": "偷鸡 杀人"}]]},
                           {"text": json.dumps({"suggestions": [{"code": "CN-PAD-24", "why": "偷鸡"},
                                                                {"code": "EU-EV-01", "why": "x"}]})}]
    j = _case("CHINESE", summary="杀人", offence="MURDER")
    try:
        response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/statute-suggestions/")
        found = FakeProvider.script[0]["results"][0]
    finally:
        FakeProvider.script = []
    assert response.status_code == 200, response.data
    assert "CN-PAD-24" not in FakeProvider.calls[-1]["facts"]  # 不在初始候选里
    assert {r["code"] for r in found} <= {s.code for s in ai_statutes.pool(j)}
    assert "CN-PAD-24" in {r["code"] for r in found}
    assert [s["code"] for s in response.data["suggestions"]] == ["CN-PAD-24"]


def test_what_reaches_the_model_is_the_whitelist(stub):
    _corpus()
    cn = _hall("CHINESE")
    enable(cn)
    stub.reply = staticmethod(lambda s, f, p: '{"suggestions": []}')
    j = _case("CHINESE", summary=f"{SECRET_NAME}于 1888-03-04 杀人", offence="MURDER", evidence=["MURDER"])
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/statute-suggestions/")
    assert response.status_code == 200
    sent = json.dumps(FakeProvider.calls[-1], ensure_ascii=False, default=str)
    for secret in (SECRET_NAME, "1888-03-04", "我的告白", "秘密申诉", "证据原文", str(j.soul_id)):
        assert secret not in sent, secret
    facts = json.loads(FakeProvider.calls[-1]["facts"])
    assert facts["summary"] == "该灵魂于 [date] 杀人"
    assert facts["admitted_evidence"][0]["category"] == "Murder / Killing"


def test_it_writes_no_citation_and_keeps_provenance_without_the_text(stub):
    from apps.audit.models import AuditLog

    _corpus()
    cn = _hall("CHINESE")
    enable(cn)
    stub.reply = staticmethod(lambda s, f, p: '{"suggestions": [{"code": "CN-EV-01", "why": "杀人"}]}')
    j = _case("CHINESE", summary="杀人", offence="MURDER")
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/statute-suggestions/")
    assert response.status_code == 200
    assert not JudgmentCitation.objects.filter(judgment=j).exists()
    draft = AIDraft.objects.get(pk=response.data["draft_id"])
    assert (draft.feature, draft.target_type, draft.target_id) == ("statute_suggest", "judgment", str(j.pk))
    assert json.loads(draft.output) == ["CN-EV-01"]
    assert "CN-EV-01" not in json.dumps(AuditLog.objects.filter(resource="ai_draft").first().changes)


def test_a_cited_article_is_not_suggested_again(stub):
    _corpus()
    cn = _hall("CHINESE")
    enable(cn)
    stub.reply = staticmethod(lambda s, f, p: '{"suggestions": [{"code": "CN-EV-01", "why": "x"}]}')
    j = _case("CHINESE", summary="杀人", cited=["CN-EV-01"])
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/statute-suggestions/")
    assert response.data["suggestions"] == [] and response.data["dropped"] == ["CN-EV-01"]


@pytest.mark.parametrize("why", ["provider_down", "hall_off"])
def test_without_a_model_it_falls_back_to_keyword_matches(why, stub):
    _corpus()
    cn = _hall("CHINESE")
    enable(cn, why != "hall_off")
    if why == "provider_down":
        stub.fail = "timeout"
    j = _case("CHINESE", summary="放火烧屋", offence="ARSON", evidence=["MURDER"])
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/statute-suggestions/")
    assert response.status_code == 200, response.data
    assert response.data["fallback"] is True and response.data["draft_id"] is None
    assert {s["source"] for s in response.data["suggestions"]} == {"keyword"}
    assert "CN-EV-04" in [s["code"] for s in response.data["suggestions"]]
    if why == "hall_off":
        assert FakeProvider.calls == []  # 殿没开:它的数据一个字都不送


def test_a_concluded_case_is_refused(stub):
    _corpus()
    cn = _hall("CHINESE")
    enable(cn)
    j = _case("CHINESE", verdict="FAILED")
    user = _judge(cn)
    assert _client(user).post(f"/api/v1/judgment/{j.pk}/statute-suggestions/").status_code == 409
    assert _client(user).post(f"/api/v1/judgment/{j.pk}/verdict-draft/", {"verdict": "FAILED"},
                              format="json").status_code == 409
    assert FakeProvider.calls == []


def test_another_halls_case_is_404_and_a_reader_is_403(stub):
    from apps.authentication.models import User

    _corpus()
    cn = _hall("CHINESE")
    other = _case("EUROPEAN")
    assert _client(_judge(cn)).post(f"/api/v1/judgment/{other.pk}/statute-suggestions/").status_code == 404
    viewer = User.objects.create_user(username="viewer-ai", password="x", role="VIEWER", tenant=cn)
    mine = _case("CHINESE")
    assert _client(viewer).post(f"/api/v1/judgment/{mine.pk}/statute-suggestions/").status_code == 403
    assert FakeProvider.calls == []


# --------------------------------------------------------------------------- 2 判词草稿


def _cited_case(cn):
    _corpus()
    enable(cn)
    return _case("CHINESE", summary="持刀杀人", offence="MURDER", evidence=["MURDER"], cited=["CN-EV-01"])


def test_a_draft_needs_the_chosen_verdict_and_writes_nothing(stub):
    cn = _hall("CHINESE")
    j = _cited_case(cn)
    client = _client(_judge(cn))
    assert client.post(f"/api/v1/judgment/{j.pk}/verdict-draft/", {}, format="json").status_code == 400
    stub.reply = staticmethod(lambda s, f, p: "经查属实。依 CN-EV-01,判:定罪,入第九殿。")
    response = client.post(f"/api/v1/judgment/{j.pk}/verdict-draft/", {"verdict": "FAILED"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["text"].startswith("经查属实") and response.data["fallback"] is False
    assert response.data["checks"] == {"unknown_codes": [], "contrary_verdict_words": [], "names_soul": False}
    j.refresh_from_db()
    assert j.notes == "" and j.verdict is None  # 草稿不进 notes,判词仍由判官保存
    facts = json.loads(FakeProvider.calls[-1]["facts"])
    assert facts["verdict"] == "FAILED" and [a["code"] for a in facts["cited_articles"]] == ["CN-EV-01"]
    assert AIDraft.objects.get(pk=response.data["draft_id"]).feature == "verdict_draft"


def test_the_checks_flag_an_unadopted_article_a_contrary_verdict_and_the_souls_name(stub):
    cn = _hall("CHINESE")
    j = _cited_case(cn)
    stub.reply = staticmethod(lambda s, f, p: f"{SECRET_NAME}依 CN-EV-01 与 CN-EV-04,判:无罪。")
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/verdict-draft/", {"verdict": "FAILED"},
                                        format="json")
    assert response.data["checks"] == {"unknown_codes": ["CN-EV-04"], "contrary_verdict_words": ["无罪"],
                                       "names_soul": True}


def test_style_samples_come_from_this_halls_concluded_verdicts_redacted(stub):
    cn = _hall("CHINESE")
    j = _cited_case(cn)
    done = _case("CHINESE", verdict="FAILED", name="另一秘名")
    done.notes = "另一秘名生前杀人,判入第九殿。"
    done.save(update_fields=["notes"])
    elsewhere = _case("EUROPEAN", verdict="FAILED")
    elsewhere.notes = "EUROPEAN SAMPLE"
    elsewhere.save(update_fields=["notes"])
    stub.reply = staticmethod(lambda s, f, p: "判:定罪。")
    _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/verdict-draft/", {"verdict": "FAILED"}, format="json")
    samples = json.loads(FakeProvider.calls[-1]["facts"])["style_samples"]
    assert samples == ["该灵魂生前杀人,判入第九殿。"]


def test_without_a_model_the_draft_is_a_template_and_not_provenance(stub):
    cn = _hall("CHINESE")
    j = _cited_case(cn)
    stub.fail = "timeout"
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/verdict-draft/", {"verdict": "FAILED"},
                                        format="json")
    assert response.status_code == 200
    assert response.data["fallback"] is True and response.data["draft_id"] is None
    assert "CN-EV-01" in response.data["text"] and ai_verdict.passed(response.data["checks"])


def test_only_whoever_may_edit_the_case_may_draft(stub):
    cn = _hall("CHINESE")
    j = _cited_case(cn)
    owner = _judge(cn, "judge-owner")
    Judgment.objects.filter(pk=j.pk).update(claimed_by=owner)
    response = _client(_judge(cn)).post(f"/api/v1/judgment/{j.pk}/verdict-draft/", {"verdict": "FAILED"},
                                        format="json")
    assert response.status_code == 403
    assert FakeProvider.calls == []


@pytest.mark.parametrize("text, ok", [
    ("依 CN-EV-01,判:定罪。", True),
    ("依 CN-EV-02,判:定罪。", False),
    ("依 CN-EV-01,判:无罪。", False),
    (f"{SECRET_NAME},定罪。", False),
])
def test_the_deterministic_checks(text, ok):
    checks = ai_verdict.check(text, verdict="FAILED", cited_codes=["CN-EV-01"], soul_name=SECRET_NAME)
    assert ai_verdict.passed(checks) is ok
