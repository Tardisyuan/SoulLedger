import { PageError } from "soulledger";

// 路由 error.tsx:500,带 trace digest。
export const WithDigest = () => (
  <div style={{ width: 460 }}>
    <PageError error={Object.assign(new Error("审判台数据暂时无法读取"), { digest: "a41f9c07" })} reset={() => {}} />
  </div>
);

export const Plain = () => (
  <div style={{ width: 460 }}>
    <PageError error={new Error("")} reset={() => {}} />
  </div>
);
