"""裁决名在三份 bundle 里都存在 —— `souls.detail.verdict_*` 与 `workflow.verdicts.*`。

## 这条发现被更正过一半

审计的 L30 说「`Verdict` union、`souls.events.*`、`souls.detail.verdict_*` 都无
机制」。**`souls.events.*` 那半是错的**:`tests/test_frontend_event_types_
track_the_backend.py` 已经守着它,而且守得很好 —— 它拿的是 `EventType` 的
**soul 域子集**(从 `apps/events/models.py` 的分组注释解析出来),而不是整个枚举。

写这个文件的第一版时,我拿整个 `EventType` 去比 `souls.events.*`,于是它报出
十条「缺失」:社交事件和通知事件。**那正是那个文件的 docstring 里逐字写着的、
它自己犯过一次的错**——「主体清单选错了」。一条帖子被点赞不属于一个灵魂的生平。

留下的是真正没有机制的那半:裁决名。

## 方向

Django 拥有枚举,三份 bundle 与它比对,不反过来 —— 与 statute 那个文件一致。
"""
import json
from pathlib import Path

import pytest

from apps.judgment.models import Verdict

REPO_ROOT = Path(__file__).resolve().parents[2]
MESSAGES = REPO_ROOT / "frontend" / "messages"
LOCALES = ("en", "zh-Hans", "egy")

def _node_action_choices():
    """审批节点接受的裁决 —— **从序列化器取,不手抄**。

    这和案件的 `Verdict` 是两套词汇,而且既不是包含关系也不是相等关系:
    节点接受 CONFIRMED / REJECTED / SKIPPED(`Verdict` 没有),
    `Verdict` 有 PURGATORY / RETRY(节点不接受)。

    这个文件第一版拿 `Verdict` 去比 `workflow.verdicts.*`,报出
    「缺 PURGATORY / RETRY」—— **又一次主体清单选错**,与上面 docstring 里
    记的那次同形。正确的主体就写在 `WorkflowNodeActionSerializer` 上。
    """
    from apps.workflow.serializers import WorkflowNodeActionSerializer

    return set(WorkflowNodeActionSerializer().fields["verdict"].choices)


def _node(locale, *path):
    node = json.loads((MESSAGES / f"{locale}.json").read_text(encoding="utf-8"))
    for part in path:
        node = node.get(part, {})
    return node if isinstance(node, dict) else {}


def test_the_parser_found_something():
    """守卫的守卫:取不到命名空间时,下面每一条差集都是空的。"""
    for locale in LOCALES:
        assert len(_node(locale, "workflow", "verdicts")) >= 3, locale
        detail = _node(locale, "souls", "detail")
        assert any(k.startswith("verdict_") for k in detail), locale


@pytest.mark.parametrize("locale", LOCALES)
def test_every_verdict_has_a_name_on_the_soul_page(locale):
    declared = {
        key[len("verdict_"):].upper()
        for key in _node(locale, "souls", "detail")
        if key.startswith("verdict_")
    }
    missing = {member.value for member in Verdict} - declared
    assert not missing, (
        f"{locale}.json 的 souls.detail 里没有 {sorted(missing)} 的裁决名 —— "
        f"灵魂详情页会把枚举成员原样印出来。"
    )


@pytest.mark.parametrize("locale", LOCALES)
def test_every_node_verdict_has_a_name_in_the_workflow_picker(locale):
    declared = {key.upper() for key in _node(locale, "workflow", "verdicts")}
    missing = _node_action_choices() - declared
    assert not missing, (
        f"{locale}.json 的 workflow.verdicts 里没有 {sorted(missing)} —— "
        f"审批下拉框会把枚举成员原样印出来。"
    )


@pytest.mark.parametrize("locale", LOCALES)
def test_the_workflow_picker_invents_nothing(locale):
    declared = {key.upper() for key in _node(locale, "workflow", "verdicts")}
    extra = declared - _node_action_choices()
    assert not extra, (
        f"{locale}.json 的 workflow.verdicts 里有 {sorted(extra)},而"
        f"`WorkflowNodeActionSerializer` 不接受它们 —— 一个选不出结果的选项。"
    )


def test_the_two_vocabularies_really_are_different():
    """守卫的守卫。

    上面两组用的是**两个不同的主体**(案件 `Verdict` 与节点 choices)。如果哪天
    它们变成同一个集合,这个文件就是在把同一件事查两遍,而两组断言里必有一组
    在测另一件事时不会红。
    """
    case = {member.value for member in Verdict}
    node = _node_action_choices()
    assert case != node, "两套词汇已经相同了,这个文件该合并"
    assert case - node, f"案件独有的裁决没有了:{sorted(case)}"
    assert node - case, f"节点独有的裁决没有了:{sorted(node)}"


def test_the_three_bundles_agree_on_these_namespaces():
    """键集一致由全局检查管;这里断的是**这两个命名空间**逐一相同 ——
    「三份一致地都缺同一个成员」是全局检查抓不到的形状。"""
    for path in (("souls", "detail"), ("workflow", "verdicts")):
        sets = [set(_node(locale, *path)) for locale in LOCALES]
        assert sets[0] == sets[1] == sets[2], (
            path,
            {locale: sorted(keys) for locale, keys in zip(LOCALES, sets, strict=True)},
        )
