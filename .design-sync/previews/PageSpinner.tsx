import { PageSpinner } from "soulledger";

// 路由级 loading.tsx:整页居中一圈。
export const Default = () => (
  <div style={{ width: 420 }}>
    <PageSpinner />
  </div>
);
