"""埃及的「常规」审判**就是**称心 —— 两个 case type 指向同一份模板。

## 分叉的后果不是命名,是一个泛用单节点流程

`frontend/src/config/workflow-templates.ts` 的 `EGYPTIAN_ROUTINE` 预设**叫**
「心脏称重流程」、节点是两真之殿(Anubis / Osiris / Ammit),而它的 `caseType`
写的是 `ROUTINE`。后端只有 `(EGYPTIAN, HEART_WEIGHING)`。实测(2026-09-01):

    (EGYPTIAN, HEART_WEIGHING) → '欧西里斯称重流程'   3 节点
    (EGYPTIAN, ROUTINE)        → 'EGYPTIAN 审批流程'  1 节点  ← 泛用兜底

**两边各自都合法**,所以既有的跨栈守卫一条都不红:`ROUTINE` 确实在
`VALID_CASE_TYPES_BY_CIVILIZATION[EGYPTIAN]` 里,预设确实 POST 201。
但一个埃及 ROUTINE 判决拿到的是一个谁也不指定的单节点,而不是两真之殿。

## 为什么答案是「ROUTINE 指向称重」而不是反过来

**这是考据,不是命名口味。** 埃及没有第二种「普通」审判:每个死者的心都要对着
玛阿特的羽毛称一次(BD 125),称心就是那个程序本身。要给 `(EGYPTIAN, ROUTINE)`
一个别的模板,先得说出「不称心的埃及审判」是什么 —— 而语料里没有那个东西。

对照另外两个文明:中国的 ROUTINE 是十殿审判流程,欧洲的 ROUTINE 落到泛用兜底
(它的两个真流程是封圣与炼狱复核,都不是「常规」)。**三个文明的 ROUTINE 各自
指向它那套宇宙观里的默认程序,而埃及那套只有一个。**
"""
import pytest

from apps.souls.models import Civilization
from apps.workflow.models import CaseType
from apps.workflow.services import WorkflowService
from apps.workflow.templates import WORKFLOW_TEMPLATES


def test_the_two_case_types_share_one_template_object():
    """指同一个对象,不是抄一份 —— 抄一份就会漂。"""
    weighing = WORKFLOW_TEMPLATES[(Civilization.EGYPTIAN, CaseType.HEART_WEIGHING)]
    routine = WORKFLOW_TEMPLATES.get((Civilization.EGYPTIAN, CaseType.ROUTINE))
    assert routine is weighing, (
        "埃及的 ROUTINE 与 HEART_WEIGHING 不是同一份模板 —— "
        "要么少了别名,要么有人抄了一份(那两份会各自漂)"
    )


@pytest.mark.django_db
def test_an_egyptian_routine_judgment_reaches_the_hall_of_two_truths():
    """从 `_resolve_template` 进,不是直接读表 —— 读表证明不了路由走到哪。"""
    template, _row = WorkflowService._resolve_template(
        Civilization.EGYPTIAN, CaseType.ROUTINE, None
    )
    assert template["name"] == "欧西里斯称重流程", (
        f"埃及 ROUTINE 落到了 {template['name']!r} —— 泛用兜底,不是两真之殿"
    )
    assert len(template["nodes"]) == 3
    names = [n["name"] for n in template["nodes"]]
    assert names == [
        "阿努比斯 · 引导与称量",
        "四十二神官 · 否定告白",
        "欧西里斯 · 终审",
    ], names
    # 中间那个节点 `actor` 是 None,而那是**刻意的**:四十二神官是四十二个,
    # 一个 `approver_actor` 外键指不了一群人。它因此走审计过的 `escalate`,
    # 见 `TEMPLATE_NODES_WITHOUT_AN_APPROVER`。
    #
    # 我第一版这里断的是 `"Ammit" in actors` —— 而 Ammit 是**前端预设**里的
    # 失败分支节点,后端这份没有它。断言写的是我以为的形状,不是实测的形状。
    actors = [n.get("actor") for n in template["nodes"]]
    assert actors == ["Anubis", None, "Osiris"], actors


@pytest.mark.django_db
def test_heart_weighing_still_resolves_to_itself():
    """**断存在。** 只断 ROUTINE 的改法,可能把 HEART_WEIGHING 弄丢。"""
    template, _ = WorkflowService._resolve_template(
        Civilization.EGYPTIAN, CaseType.HEART_WEIGHING, None
    )
    assert template["name"] == "欧西里斯称重流程"


@pytest.mark.django_db
def test_the_other_civilizations_are_untouched():
    """别名只给埃及。中国 ROUTINE 是十殿,欧洲 ROUTINE 仍落兜底 —— 那是它的现状,
    不是这次改动带来的。"""
    chinese, _ = WorkflowService._resolve_template(
        Civilization.CHINESE, CaseType.ROUTINE, None
    )
    assert len(chinese["nodes"]) > 1, chinese["name"]

    european, _ = WorkflowService._resolve_template(
        Civilization.EUROPEAN, CaseType.ROUTINE, None
    )
    assert european["name"] == "EUROPEAN 审批流程", (
        "欧洲 ROUTINE 的落点变了 —— 这次改动只该动埃及"
    )


def test_the_frontend_preset_still_declares_routine():
    """前端预设没有被改。

    修的是后端对这个 pair 的答案,不是预设的 `caseType`。**两种改法都能让两边
    一致,而它们说的不是同一件事**:改预设是说「这个流程不是常规的」,
    改后端是说「埃及的常规就是它」。取的是后者,理由在文件头。
    """
    import json
    import pathlib
    import re

    source = (
        pathlib.Path(__file__).resolve().parents[2]
        / "frontend" / "src" / "config" / "workflow-templates.ts"
    ).read_text(encoding="utf-8")
    block = re.search(r"EGYPTIAN_ROUTINE:\s*\{(.*?)\n  \}", source, re.S)
    assert block, "找不到 EGYPTIAN_ROUTINE 预设"
    assert re.search(r'caseType:\s*"ROUTINE"', block.group(1)), (
        "前端预设的 caseType 变了 —— 那是另一种修法,而这个文件记的是后端那种"
    )
    assert "心脏称重" in block.group(1), "预设的名字变了"
    del json
