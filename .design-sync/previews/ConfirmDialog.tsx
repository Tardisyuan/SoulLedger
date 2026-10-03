import { ConfirmDialog } from "soulledger";

// 回收站永久删除(app/recycle-bin):不可撤回,后果写在标题与正文里;
// danger 画成次按钮,确认文字带 ✕。
export const PermanentDelete = () => (
  <ConfirmDialog
    isOpen
    title="永久删除？"
    message="「王守仁」将被永久删除，此操作无法撤销。"
    confirmText={<><span aria-hidden="true">✕</span> 永久删除</>}
    onConfirm={() => {}}
    onCancel={() => {}}
  />
);
