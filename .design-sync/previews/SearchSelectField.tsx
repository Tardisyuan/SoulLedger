import { useState } from "react";
import { SearchSelectField } from "soulledger";

const SOULS = [
  { value: "1", label: "王守仁" },
  { value: "2", label: "苏格拉底" },
  { value: "3", label: "阿尼" },
];

const base = { id: "soul_id", name: "soul_id", label: "目标灵魂", loadingText: "加载中…", emptyText: "无匹配灵魂", placeholder: "搜索灵魂姓名" };

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 340 }}>{children}</div>;
}

// 派遣申请页选目标灵魂:服务端搜索,已选一项。
export const Selected = () => {
  const [q, setQ] = useState("王守仁");
  const [v, setV] = useState("1");
  return (
    <Wrap>
      <SearchSelectField {...base} required value={v} onValueChange={setV} options={SOULS} searchText={q} onSearchTextChange={setQ} moreText="仅显示前 3 条,请继续输入以缩小范围" />
    </Wrap>
  );
};

// 尚未选择。
export const Empty = () => (
  <Wrap>
    <SearchSelectField {...base} required value="" onValueChange={() => {}} options={SOULS} searchText="" onSearchTextChange={() => {}} />
  </Wrap>
);

// 查询失败时页面把错误交给字段。
export const Error = () => (
  <Wrap>
    <SearchSelectField {...base} required error="灵魂列表加载失败,请重试" value="" onValueChange={() => {}} options={[]} searchText="" onSearchTextChange={() => {}} />
  </Wrap>
);

export const Disabled = () => (
  <Wrap>
    <SearchSelectField {...base} disabled value="2" onValueChange={() => {}} options={SOULS} searchText="苏格拉底" onSearchTextChange={() => {}} />
  </Wrap>
);
