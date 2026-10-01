import { EmptyState, Button } from "soulledger";

export const WithAction = () => (
  <EmptyState title="还没有灵魂" reason="名册是空的。新灵魂由死亡同步写入,也可以手动登记。" action={<Button variant="primary">登记灵魂</Button>} />
);

export const ReasonOnly = () => <EmptyState title="今日无待审案件" reason="队列已清空,新案件会在死亡同步后出现。" />;
