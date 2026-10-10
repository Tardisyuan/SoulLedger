import { PageShell, Button, Badge, EmptyState } from "soulledger";

const wrap = (n: React.ReactNode) => <div style={{ width: 760 }}>{n}</div>;

// 大多数列表页:标题 + 副标题 + 右侧动作。
export const Default = () =>
  wrap(
    <PageShell eyebrow="SOULS" title="灵魂名册" subtitle="登记在册的全部灵魂" actions={<Button variant="primary">登记灵魂</Button>}>
      <div style={{ padding: 16, border: "1px solid oklch(var(--color-line))", fontSize: 14 }}>王守仁 · 苏格拉底 · 阿尼</div>
    </PageShell>
  );

// 详情页:返回链接 + 状态徽章。
export const Detail = () =>
  wrap(
    <PageShell variant="prose" backLink={<Button variant="ghost" size="sm">← 返回队列</Button>} title="王守仁" subtitle="待审 · 酆都" actions={<Badge>待审</Badge>}>
      <p style={{ fontSize: 14 }}>生于成化八年,卒于嘉靖七年。</p>
    </PageShell>
  );

// 空态替换内容。
export const Empty = () =>
  wrap(<PageShell title="审判台" isEmpty empty={<EmptyState title="今日无待审案件" reason="队列已清空。" />} />);
