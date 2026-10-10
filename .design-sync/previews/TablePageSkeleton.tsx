import { TablePageSkeleton } from "soulledger";

// 灵魂 / 回收站等表格页的路由 loading.tsx。
export const Default = () => (
  <div style={{ width: 720 }}>
    <TablePageSkeleton rows={5} />
  </div>
);

export const WithTabs = () => (
  <div style={{ width: 720 }}>
    <TablePageSkeleton rows={4} withTabs />
  </div>
);
