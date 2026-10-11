"""dispatch 0009 / 0010:把追加在 `reason` 末尾的驳回 / 取消理由拆进 `decision_reason`,可逆。

三类行必须原样不动:状态不是写那个标记的状态(原文里恰好有同样字样)、状态对但没有标记、
没有标记的。拆的时候以**最后一个**标记为界(追加的永远在最后),多行理由整段进字段。
反向把 `decision_reason` 按旧格式追加回 `reason`。

变异证明(2026-10-11):把 `split_forward` 的 `status=status` 筛选去掉 → `test_..._0010_splits_...` 红
(`approved_with_the_words` 被拆);把 `rpartition` 改成 `partition` → 同一条红(多行理由与原文含标记的行);
把 `split_reverse` 的 `.exclude(decision_reason="")` 去掉 → 同一条的往返段红(无理由的行多出标记)。
"""
import pytest

from tests.migration_roundtrip import migrate_to, snapshot_rows

BEFORE = ("dispatch", "0008_draft_status_and_target_realm")
AFTER = ("dispatch", "0010_split_decision_reason_out_of_reason")

REJ = "\n\nRejection reason: "
CAN = "\n\nCancellation reason: "

# name -> (status, reason as the old code left it)
SEEDS = {
    "rejected": ("REJECTED", "移交理由" + REJ + "不收"),
    "rejected_multiline": ("REJECTED", "第一行\n第二行" + REJ + "第一行\n\n第二段"),
    "cancelled": ("CANCELLED", "移交理由" + CAN + "改派"),
    # 提案人自己的话里提到了标记,追加的在后面:以最后一个为界。
    "rejected_quoting_marker": ("REJECTED", "他说过" + REJ + "不是我" + REJ + "不收"),
    # 状态不符:原文里恰好有同样字样,不动。
    "approved_with_the_words": ("APPROVED", "x" + REJ + "a"),
    "executed_with_the_words": ("EXECUTED", "x" + CAN + "a"),
    "cancelled_with_rejection_words": ("CANCELLED", "x" + REJ + "a"),
    "rejected_with_cancellation_words": ("REJECTED", "x" + CAN + "a"),
    # 状态对但没有标记(如其它路径写的):不动。
    "rejected_plain": ("REJECTED", "没有标记的原文"),
    "cancelled_plain": ("CANCELLED", "系统取消"),
}


def _seed(state):
    tenant = state.get_model("tenants", "Tenant")._base_manager
    source = tenant.create(code="MIG_A", display_name="A")
    target = tenant.create(code="MIG_B", display_name="B")
    soul = state.get_model("souls", "Soul")._base_manager
    record = state.get_model("dispatch", "DispatchRecord")._base_manager
    for name, (status, reason) in SEEDS.items():
        record.create(
            source_tenant=source, target_tenant=target, tenant=source, status=status, reason=reason,
            soul=soul.create(name=name, tenant=source),
        )


def _snapshot(state):
    record = state.get_model("dispatch", "DispatchRecord")
    return snapshot_rows(
        record._base_manager.all(),
        key=lambda r: r.soul.name,
        fields={
            "status": "status",
            "reason": "reason",
            # 0008 时点没有这一列:读成 None,与「还没拆」等价地比较。
            "decision": lambda r: getattr(r, "decision_reason", "") or "",
        },
    )


def test_dispatch_0010_splits_only_what_it_can_and_reverses(migration_round_trip):
    def check_forward(state):
        rows = _snapshot(state)
        assert rows["rejected"]["reason"] == "移交理由" and rows["rejected"]["decision"] == "不收"
        assert rows["rejected_multiline"]["reason"] == "第一行\n第二行"
        assert rows["rejected_multiline"]["decision"] == "第一行\n\n第二段"
        assert rows["cancelled"]["reason"] == "移交理由" and rows["cancelled"]["decision"] == "改派"
        assert rows["rejected_quoting_marker"]["reason"] == "他说过" + REJ + "不是我"
        assert rows["rejected_quoting_marker"]["decision"] == "不收"
        # 其余原样:reason 不变,没有决定理由。
        for name in ("approved_with_the_words", "executed_with_the_words", "cancelled_with_rejection_words",
                     "rejected_with_cancellation_words", "rejected_plain", "cancelled_plain"):
            assert rows[name]["reason"] == SEEDS[name][1] and rows[name]["decision"] == "", name

    migration_round_trip(before=BEFORE, after=AFTER, seed=_seed, snapshot=_snapshot, check_forward=check_forward)


def test_dispatch_0010_drops_a_dangling_marker_with_an_empty_reason(migration_round_trip):
    """驳回时没写理由:旧代码留下一个光秃秃的标记。拆开后 `reason` 是原文、决定理由为空;
    反向不为空理由再造标记(标记不带信息,而且没有标记的行本来就不该凭空多一个)。"""
    state = migrate_to([BEFORE])
    tenant = state.get_model("tenants", "Tenant")._base_manager
    source, target = tenant.create(code="MIG_C", display_name="C"), tenant.create(code="MIG_D", display_name="D")
    record = state.get_model("dispatch", "DispatchRecord")._base_manager.create(
        source_tenant=source, target_tenant=target, tenant=source, status="REJECTED", reason="原文" + REJ,
        soul=state.get_model("souls", "Soul")._base_manager.create(name="bare", tenant=source),
    )

    state = migrate_to([AFTER])
    row = state.get_model("dispatch", "DispatchRecord")._base_manager.get(pk=record.pk)
    assert row.reason == "原文" and row.decision_reason == ""

    state = migrate_to([BEFORE])
    assert state.get_model("dispatch", "DispatchRecord")._base_manager.get(pk=record.pk).reason == "原文"


@pytest.mark.parametrize("count", [1201])
def test_dispatch_0010_walks_every_batch(migration_round_trip, count):
    """分批(500 一页)不漏行、不重复:1201 行跨三页(soul 为空:草稿以外的行也允许,这里只量分页),全部拆开。"""
    state = migrate_to([BEFORE])
    tenant = state.get_model("tenants", "Tenant")._base_manager
    source, target = tenant.create(code="MIG_E", display_name="E"), tenant.create(code="MIG_F", display_name="F")
    record = state.get_model("dispatch", "DispatchRecord")._base_manager
    record.bulk_create([
        record.model(source_tenant=source, target_tenant=target, tenant=source, status="REJECTED", reason=f"r{i}{REJ}why{i}")
        for i in range(count)
    ])

    state = migrate_to([AFTER])
    rows = state.get_model("dispatch", "DispatchRecord")._base_manager.all()
    assert rows.count() == count
    assert all(r.reason.startswith("r") and "Rejection reason" not in r.reason for r in rows)
    assert {r.decision_reason for r in rows} == {f"why{i}" for i in range(count)}
