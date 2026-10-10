import { DataGrid } from "soulledger";

type Soul = { id: string; name: string; civ: string; state: string; died: string; merit: number };
const SOULS: Soul[] = [
  { id: "a1f3c9e2", name: "王守仁", civ: "中华", state: "JUDGING", died: "1529-01-09", merit: 812 },
  { id: "b7d20c41", name: "Dante Alighieri", civ: "欧洲", state: "DISPOSED", died: "1321-09-14", merit: 655 },
  { id: "d41b8f05", name: "Σωκράτης", civ: "希腊", state: "SETTLED", died: "-0399-05-07", merit: 901 },
];
const STATE: Record<string, { tone: "info" | "success" | "neutral"; glyph: string; label: string }> = {
  JUDGING: { tone: "info", glyph: "◐", label: "审理中" },
  DISPOSED: { tone: "success", glyph: "✓", label: "已处置" },
  SETTLED: { tone: "neutral", glyph: "■", label: "已安置" },
};
const noop = () => {};

const COLUMNS = [
  { key: "id", header: "编号", type: "identifier" as const, value: (s: Soul) => s.id },
  { key: "name", header: "姓名", type: "text" as const, sortable: true, value: (s: Soul) => s.name },
  { key: "civ", header: "文明", type: "text" as const, value: (s: Soul) => s.civ },
  { key: "state", header: "状态", type: "enum" as const, value: (s: Soul) => ({ ...STATE[s.state], title: s.state }) },
  { key: "merit", header: "功德", type: "numeric" as const, value: (s: Soul) => s.merit },
  {
    key: "actions", header: "操作", type: "actions" as const, menuLabel: "更多操作",
    primary: () => ({ label: "查看", onSelect: noop }),
    items: () => [{ key: "edit", label: "编辑", onSelect: noop }, { key: "del", label: "删除", tone: "danger" as const, onSelect: noop }],
  },
];

// 灵魂名册:六种列类型(identifier / text / enum / numeric / actions)按类型定对齐与字体。
export const Default = () => (
  <DataGrid<Soul>
    caption="灵魂名册" columns={COLUMNS} data={SOULS} keyExtractor={(s) => s.id}
    sort={{ key: "name", direction: "asc" }} onSortChange={noop}
    page={1} totalPages={4} totalCount={46} onPageChange={noop}
  />
);

// 筛选后没有结果。
export const FilteredEmpty = () => (
  <DataGrid<Soul> caption="灵魂名册" columns={COLUMNS} data={[]} isFiltered onClearFilters={noop} filteredEmptyMessage="没有符合筛选条件的灵魂" keyExtractor={(s) => s.id} />
);
