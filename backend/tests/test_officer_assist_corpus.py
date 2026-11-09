"""官员帮助语料的防漂移(docs/ARCHITECTURE-officer-assist.md §2.3、§5 阶段 3b)。

灵魂语料的同类测试在 `test_soul_assist_corpus.py`;这里另加三条官员端才有的:
页面清单钉在 `frontend/app/` 上、工具权限码钉在权限种子上、两端语料互不进对方的 system prompt。
"""
import re

import pytest

from apps.perm.models import DEFAULT_PERMISSIONS
from apps.soul_assist import corpus, officer_tools
from apps.soul_assist.models import OFFICER_SCREENS
from tests.web_routes import is_outside_app_layout, top_segments

#: 官员语料里一个数字都不写:期限、上限、条数都在代码与工具里,写进语料就是第二份会漂的副本。
ANY_DIGIT = re.compile(r"\d")
#: 中文正文里紧挨汉字的半角标点。
HALF_WIDTH = re.compile(r"[一-鿿][,.;:?!()]|[,;:?!()][一-鿿]")


@pytest.fixture(params=corpus.LOCALES)
def locale(request):
    return request.param


def _officer(locale):
    return corpus.entries(locale, "officer")


def _shell_segments():
    """`frontend/app/<段>/**/page.tsx` 的顶层段里,至少有一页在 AppLayout 外壳里的那些。

    `(auth)` 这类路由组不在页头里,不算。助手入口在外壳(AppLayout)里,所以整段都不在外壳里的段
    (`verdict-print`:只给无头 Chromium 渲染判决书 PDF;`goodbye`:退出登录之后的再会页)没有助手页面 id。
    「在不在外壳里」读 `AppLayoutWrapper.tsx` 的两个数组(`tests/web_routes.py`),不在这里另写一份例外 ——
    2026-11-10 之前这里写着 `- {"verdict-print", "goodbye"}`,加一个无外壳页要来这里补。"""
    return {seg for seg, routes in top_segments().items() if not all(map(is_outside_app_layout, routes))}


def test_officer_screens_are_the_web_route_segments():
    """加一个页面而不加 OFFICER_SCREENS(或反过来)→ 红。"""
    segments = _shell_segments()
    assert len(segments) >= 25  # 目录找错了会得到空集,而空集与空集相等
    # 「不在外壳里」的推导坏成恒为真时 segments 为空,上一行红;坏成恒为假时无外壳段会被要求
    # 一个助手 id,下一行红。两头都封住,不必再钉住具体是哪几段。
    # 曾有具名例外 NO_SCREEN = {"about"}:关于页归到 "other"。2026-09-30 用户拍板给它一个页面 id,
    # 例外随之删掉 —— 现在每个在外壳里的段都有助手页面 id。
    assert set(OFFICER_SCREENS) - {"other"} == segments


def test_every_screen_has_an_officer_entry(locale):
    """变异:删掉只覆盖某一段的那个条目的该段(例如 officer-scheduler 的 scheduler)→ 红。"""
    covered = {s for e in _officer(locale) for s in e["screens"]}
    assert set(OFFICER_SCREENS) - covered == set()


def test_officer_entries_are_well_formed(locale):
    ids = [e["id"] for e in _officer(locale)]
    assert ids and all(i.startswith("officer-") for i in ids)
    for e in _officer(locale):
        assert set(e["screens"]) <= set(OFFICER_SCREENS), e["id"]
        assert e["civilizations"] == [] and e["codes"] == [] and e["questions"], e["id"]
    # 反过来:灵魂条目不许用 officer- 前缀,免得一个错写的 audience 把灵魂条目塞给官员。
    assert not [e["id"] for e in corpus.entries(locale, "soul") if e["id"].startswith("officer-")]


def test_ids_and_metadata_match_across_locales():
    def meta(loc):
        return {e["id"]: e["screens"] for e in _officer(loc)}
    assert meta("zh-Hans") == meta("en")


def test_no_numbers_in_officer_entries(locale):
    assert [(e["id"], m.group()) for e in _officer(locale) for m in ANY_DIGIT.finditer(e["body"])] == []


def test_zh_entries_use_full_width_punctuation():
    offenders = [(e["id"], m.group()) for e in _officer("zh-Hans") for m in HALF_WIDTH.finditer(e["body"])]
    assert offenders == []


def test_every_tool_codename_is_in_the_permission_seed():
    """`soul_inbox` 不是码名,`soul_inbox.read` 才是 —— 一个不存在的码名对非 ADMIN 永远答 False。"""
    seeded = {codename for codename, _, _ in DEFAULT_PERMISSIONS}
    required = {c for c, _fn, _doc in officer_tools.TOOLS.values() if c is not None}
    assert required and required <= seeded
    assert set(officer_tools.REPORTED_CODENAMES) <= seeded


def test_the_corpora_never_leak_into_each_others_prompt(locale):
    """断言缺席:灵魂的 system prompt 里没有任何官员条目,反之亦然。
    变异:`entries` 不按 audience 过滤 → 红。"""
    soul_prompt = corpus.system_prompt(locale)
    officer_prompt = corpus.system_prompt(locale, "officer")
    officer_ids = [e["id"] for e in _officer(locale)]
    soul_ids = [e["id"] for e in corpus.entries(locale, "soul")]
    assert all(f"### {i}\n" in officer_prompt for i in officer_ids)
    assert not [i for i in officer_ids if f"### {i}\n" in soul_prompt]
    assert not [i for i in soul_ids if f"### {i}\n" in officer_prompt]
    assert "help desk inside the SoulLedger soul app" not in officer_prompt
    assert "help desk inside the SoulLedger officer console" not in soul_prompt


def test_every_screen_fits_the_column():
    """`screen` 是 max_length=20;「rebirth-applications」正好 20。更长的新路由在 SQLite 上过、在 PG 上插入失败(审查 6)。"""
    from apps.soul_assist.models import OFFICER_SCREENS, SCREENS, AssistConversation

    limit = AssistConversation._meta.get_field("screen").max_length
    assert max(len(s) for s in (*OFFICER_SCREENS, *SCREENS)) <= limit
