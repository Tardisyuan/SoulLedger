import { DataTable, SoulStateBadge, IdentifierChip } from "soulledger";

type Soul = { id: string; name: string; civ: string; died: string; merit: number; state: string };

const SOULS: Soul[] = [
  { id: "a1f3c9e2", name: "王守仁", civ: "中华", died: "1529-01-09", merit: 812, state: "JUDGING" },
  { id: "b7d20c41", name: "Dante Alighieri", civ: "欧洲", died: "1321-09-14", merit: 655, state: "DISPOSED" },
  { id: "c90e6a77", name: "Ahmose", civ: "埃及", died: "-1525-03-02", merit: 430, state: "REINCARNATING" },
  { id: "d41b8f05", name: "Σωκράτης", civ: "希腊", died: "-0399-05-07", merit: 901, state: "SETTLED" },
];

const COLUMNS = [
  { key: "name", header: "姓名", sortable: true },
  { key: "civ", header: "文明" },
  { key: "died", header: "卒日", sortable: true },
  { key: "merit", header: "功德", align: "right" as const },
  { key: "state", header: "状态" },
];

const row = (s: Soul) => (
  <>
    <td className="px-3 py-2">
      <p className="font-medium text-[oklch(var(--color-ink))]">{s.name}</p>
      <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
        <IdentifierChip id={s.id} />
      </p>
    </td>
    <td className="px-3 py-2">{s.civ}</td>
    <td className="px-3 py-2 font-mono tabular-nums">{s.died}</td>
    <td className="px-3 py-2 text-right font-mono tabular-nums">{s.merit}</td>
    <td className="px-3 py-2">
      <SoulStateBadge state={s.state} />
    </td>
  </>
);

export const Default = () => (
  <DataTable<Soul>
    caption="灵魂名册"
    columns={COLUMNS}
    data={SOULS}
    keyExtractor={(s) => s.id}
    renderRow={row}
    sort={{ key: "died", direction: "desc" }}
    onSortChange={() => {}}
    page={1}
    totalPages={12}
    totalCount={46}
    onPageChange={() => {}}
  />
);

export const Compact = () => (
  <DataTable<Soul>
    caption="灵魂名册"
    density="compact"
    columns={COLUMNS}
    data={SOULS.slice(0, 3)}
    keyExtractor={(s) => s.id}
    renderRow={row}
  />
);

export const Loading = () => (
  <DataTable<Soul> caption="灵魂名册" columns={COLUMNS} data={[]} isLoading skeletonRows={3} keyExtractor={(s) => s.id} renderRow={row} />
);

export const FilteredEmpty = () => (
  <DataTable<Soul>
    caption="灵魂名册"
    columns={COLUMNS}
    data={[]}
    isFiltered
    onClearFilters={() => {}}
    keyExtractor={(s) => s.id}
    renderRow={row}
  />
);
