import { Pagination } from "soulledger";

const noop = () => {};

export const Middle = () => (
  <div style={{ width: 560 }}>
    <Pagination page={7} totalPages={152} count={3036} onPageChange={noop} />
  </div>
);

// First page: ⇤ and 上一页 are disabled.
export const FirstPage = () => (
  <div style={{ width: 560 }}>
    <Pagination page={1} totalPages={12} count={236} onPageChange={noop} />
  </div>
);

export const LastPage = () => (
  <div style={{ width: 560 }}>
    <Pagination page={12} totalPages={12} count={236} onPageChange={noop} />
  </div>
);

export const WithoutInfo = () => (
  <div style={{ width: 560 }}>
    <Pagination page={3} totalPages={9} count={172} onPageChange={noop} showInfo={false} />
  </div>
);
