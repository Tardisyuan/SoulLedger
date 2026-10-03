import { StatusBadge } from "soulledger";

// 移交(dispatch)的全部流程状态,tone 照 app/dispatch/page.tsx 的 STATUS_TONES:
// 等待与被拒都是中性,意思由字形 + 文字承担。
export const DispatchStates = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <StatusBadge namespace="dispatch.states" value="DRAFT" />
    <StatusBadge namespace="dispatch.states" value="PROPOSED" />
    <StatusBadge namespace="dispatch.states" value="APPROVED" tone="success" />
    <StatusBadge namespace="dispatch.states" value="REJECTED" />
    <StatusBadge namespace="dispatch.states" value="EXECUTED" tone="info" />
    <StatusBadge namespace="dispatch.states" value="CANCELLED" />
  </div>
);

// 死亡登记:只有「部分处理」是可补救的风险(warning),「处理失败」才是错误。
export const DeathSyncStates = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <StatusBadge namespace="death_sync.status" value="PENDING" />
    <StatusBadge namespace="death_sync.status" value="ACCEPTED" tone="info" />
    <StatusBadge namespace="death_sync.status" value="PROCESSED" tone="success" />
    <StatusBadge namespace="death_sync.status" value="PARTIAL" tone="warning" />
    <StatusBadge namespace="death_sync.status" value="FAILED" tone="error" />
    <StatusBadge namespace="death_sync.status" value="DUPLICATE" />
  </div>
);

export const MissingAndUnknown = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <StatusBadge namespace="crossJudgments.states" value="ACTIVE" tone="info" />
    <StatusBadge namespace="crossJudgments.states" value={null} />
    <StatusBadge namespace="crossJudgments.states" value="ARCHIVED_V0" />
  </div>
);
