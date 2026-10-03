import { SelectField } from "soulledger";

const CIVS = [
  { value: "CHINESE", label: "中华 · 地府" },
  { value: "EUROPEAN", label: "欧洲 · 天堂地狱" },
  { value: "EGYPTIAN", label: "埃及 · 杜阿特" },
  { value: "GREEK", label: "希腊 · 冥府" },
];

export const Default = () => (
  <div style={{ width: 320 }}>
    <SelectField label="所属文明" options={CIVS} defaultValue="CHINESE" />
  </div>
);

export const Error = () => (
  <div style={{ width: 320 }}>
    <SelectField label="所属文明" required options={[{ value: "", label: "请选择" }, ...CIVS]} defaultValue="" error="请选择一个文明" />
  </div>
);
