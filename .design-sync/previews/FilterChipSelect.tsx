import { useState } from "react";
import { FilterChipSelect } from "soulledger";

const STATES = [
  { value: "", label: "全部" },
  { value: "ALIVE", label: "存活" },
  { value: "JUDGING", label: "审判中" },
  { value: "DISPOSED", label: "已处置" },
  { value: "REINCARNATING", label: "轮回中" },
  { value: "LOST", label: "迷失" },
  { value: "SETTLED", label: "已终结" },
];
const CIVS = [
  { value: "", label: "全部" },
  { value: "CHINESE", label: "中国" },
  { value: "EUROPEAN", label: "欧洲" },
  { value: "EGYPTIAN", label: "埃及" },
  { value: "GREEK", label: "希腊" },
];
const DEATH_SYNC = [
  { value: "", label: "全部" },
  { value: "PENDING", label: "待验证" },
  { value: "PROCESSED", label: "已处理" },
  { value: "FAILED", label: "处理失败" },
];

// 灵魂名册的筛选条(app/souls):状态已选、文明未选。
export const SoulFilters = () => {
  const [state, setState] = useState("JUDGING");
  const [civ, setCiv] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <FilterChipSelect label="状态" value={state} options={STATES} onChange={setState} clearLabel="清除「状态」筛选" />
      <FilterChipSelect label="文明" value={civ} options={CIVS} onChange={setCiv} clearLabel="清除「文明」筛选" />
    </div>
  );
};

export const Active = () => {
  const [civ, setCiv] = useState("GREEK");
  return <FilterChipSelect label="文明" value={civ} options={CIVS} onChange={setCiv} clearLabel="清除「文明」筛选" />;
};

export const Disabled = () => (
  <FilterChipSelect label="状态" value="" options={DEATH_SYNC} onChange={() => {}} clearLabel="清除「状态」筛选" disabled />
);
