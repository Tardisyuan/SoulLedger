import { TextField } from "soulledger";

export const Default = () => (
  <div style={{ width: 320 }}>
    <TextField label="姓名" placeholder="如:王守仁" />
  </div>
);

export const WithDescription = () => (
  <div style={{ width: 320 }}>
    <TextField label="卒日" required description="按公历填写;公元前用负年份,如 -0399-05-07。" defaultValue="1529-01-09" />
  </div>
);

export const Error = () => (
  <div style={{ width: 320 }}>
    <TextField label="功德值" required defaultValue="一千" error="请输入 0 到 1000 之间的整数" />
  </div>
);

export const Sizes = () => (
  <div style={{ width: 320, display: "grid", gap: 12 }}>
    <TextField label="小" size="sm" defaultValue="酆都" />
    <TextField label="中" size="md" defaultValue="酆都" />
    <TextField label="大" size="lg" defaultValue="酆都" />
  </div>
);
