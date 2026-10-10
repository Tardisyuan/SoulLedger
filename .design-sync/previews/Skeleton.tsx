import { Skeleton } from "soulledger";

// 数据加载时占位的基础块(400ms 后才显现)。
export const Block = () => (
  <div style={{ width: 280, display: "grid", gap: 8 }}>
    <Skeleton className="h-4 w-1/3" />
    <Skeleton className="h-8 w-full" />
    <Skeleton className="h-8 w-full" />
  </div>
);

export const Avatar = () => (
  <div style={{ display: "flex", gap: 12, alignItems: "center", width: 280 }}>
    <Skeleton className="h-10 w-10" />
    <div style={{ flex: 1, display: "grid", gap: 6 }}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  </div>
);
