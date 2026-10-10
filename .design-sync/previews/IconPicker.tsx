import { useState } from "react";
import { IconPicker } from "soulledger";

// 菜单编辑弹窗里选导航图标。
export const Default = () => {
  const [v, setV] = useState("Scale");
  return (
    <div style={{ width: 360 }}>
      <IconPicker value={v} onChange={setV} />
    </div>
  );
};

export const NoneSelected = () => (
  <div style={{ width: 360 }}>
    <IconPicker value="" onChange={() => {}} />
  </div>
);
