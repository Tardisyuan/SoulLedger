"""受刑计划节点的转移表(状态机审计 2026-11-20 §4-1):`SentenceNode.move` 只走 `NODE_TRANSITIONS` 里的边。

期望的边在这里另写一份,不读表:表多了一条或少了一条,这里都红。边从全部写点推出,并在受刑计划 / 处置 /
调拨 / 审判的测试上用「只记录不抛」跑过一轮,观察到的边全在表内。
"""

import pytest

from apps.sentence_plan.models import NODE_TRANSITIONS, InvalidNodeTransitionError, SentenceNode, SentenceNodeStatus

S = SentenceNodeStatus

EXPECTED = {
    S.PENDING: {S.DISPATCHING, S.ACTIVE, S.REMOVED, S.CANCELLED},
    S.DISPATCHING: {S.ACTIVE, S.PENDING, S.CANCELLED, S.REMOVED},
    S.ACTIVE: {S.ETERNAL, S.WAITING, S.COMPLETED, S.ABORTED, S.REMOVED},
    S.WAITING: {S.COMPLETED, S.ABORTED},
    S.ETERNAL: {S.ABORTED},
}
TERMINAL = {S.COMPLETED, S.ABORTED, S.REMOVED, S.CANCELLED}
PAIRS = [(a, b) for a in S for b in S]


def test_the_table_is_the_expected_one():
    assert {k: set(v) for k, v in NODE_TRANSITIONS.items()} == EXPECTED
    assert set(S) - set(EXPECTED) == TERMINAL


@pytest.mark.parametrize(("source", "target"), PAIRS, ids=[f"{a}->{b}" for a, b in PAIRS])
def test_move_takes_exactly_the_edges_in_the_table(source, target):
    node = SentenceNode(status=source)
    if target in EXPECTED.get(source, ()):
        node.move(target)
        assert node.status == target
    else:
        with pytest.raises(InvalidNodeTransitionError):
            node.move(target)
        assert node.status == source
