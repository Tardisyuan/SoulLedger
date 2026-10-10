import { TextAreaField } from "soulledger";

// 审判备注、派遣理由等多行文本。
export const Default = () => (
  <div style={{ width: 360 }}>
    <TextAreaField label="判词备注" placeholder="记录合议要点,如:阳寿未尽,功过相抵。" rows={3} />
  </div>
);

export const WithDescription = () => (
  <div style={{ width: 360 }}>
    <TextAreaField label="派遣理由" required description="将随申请一并送交酆都审批,最多 500 字。" rows={3} defaultValue="王守仁魂魄滞留龙场驿,需转派至酆都复核。" />
  </div>
);

export const Error = () => (
  <div style={{ width: 360 }}>
    <TextAreaField label="驳回理由" required error="驳回时必须填写理由" rows={3} />
  </div>
);

export const Sizes = () => (
  <div style={{ width: 360, display: "grid", gap: 12 }}>
    <TextAreaField label="小" size="sm" rows={2} defaultValue="酆都" />
    <TextAreaField label="大" size="lg" rows={2} defaultValue="酆都" />
  </div>
);
