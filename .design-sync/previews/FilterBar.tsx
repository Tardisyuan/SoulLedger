import { FilterBar } from "soulledger";

const noop = () => {};

// 灵魂名册的筛选条:搜索框 + 两个下拉芯片(popup 点击才展开),未筛选时没有「清除」。
export const Default = () => (
  <FilterBar
    searchValue=""
    onSearchChange={noop}
    searchPlaceholder="搜索姓名或编号"
    chips={[
      { key: "civ", label: "文明", value: "", onChange: noop, options: [{ value: "cn", label: "中华" }, { value: "eu", label: "欧洲" }, { value: "eg", label: "埃及" }, { value: "gr", label: "希腊" }] },
      { key: "state", label: "状态", value: "", onChange: noop, options: [{ value: "JUDGING", label: "审理中" }, { value: "DISPOSED", label: "已处置" }] },
    ]}
    isFiltered={false}
    onClearAll={noop}
    clearAllLabel="清除筛选"
  />
);

// 已筛选:搜索词、芯片选中态(强调色底)与右侧「清除筛选」同时出现。
export const Filtered = () => (
  <FilterBar
    searchValue="王守仁"
    onSearchChange={noop}
    searchPlaceholder="搜索姓名或编号"
    chips={[
      { key: "civ", label: "文明", value: "cn", onChange: noop, options: [{ value: "cn", label: "中华" }, { value: "eu", label: "欧洲" }] },
      { key: "state", label: "状态", value: "JUDGING", onChange: noop, options: [{ value: "JUDGING", label: "审理中" }, { value: "DISPOSED", label: "已处置" }] },
    ]}
    isFiltered
    onClearAll={noop}
    clearAllLabel="清除筛选"
  />
);

// 只有芯片、没有搜索框(审计日志按动作/资源筛)。
export const ChipsOnly = () => (
  <FilterBar
    chips={[{ key: "res", label: "资源", value: "", onChange: noop, options: [{ value: "soul", label: "灵魂" }, { value: "judgment", label: "判决" }] }]}
    isFiltered={false}
    onClearAll={noop}
    clearAllLabel="清除筛选"
  />
);
