import { BaseModal, Button, TextField } from "soulledger";

export const Open = () => (
  <BaseModal
    isOpen
    onClose={() => {}}
    title="退回重审"
    footer={
      <>
        <Button variant="ghost">取消</Button>
        <Button variant="warning">退回</Button>
      </>
    }
  >
    <p style={{ marginBottom: 12 }}>王守仁的判决将退回审判台,原判官会收到通知。</p>
    <TextField label="退回理由" required placeholder="写明需要补正的证据" />
  </BaseModal>
);
