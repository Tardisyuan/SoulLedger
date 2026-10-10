import { CardListPageSkeleton } from "soulledger";

// 处置页等卡片列表的路由 loading.tsx。
export const Default = () => (
  <div style={{ width: 720 }}>
    <CardListPageSkeleton cards={3} sections={1} />
  </div>
);
