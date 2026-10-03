import { PageSection, Button, StatusBadge } from "soulledger";

const DT = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))]";
const DD = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink))] min-w-0";

// 移交详情页(app/dispatch/[id])的「移交详情」面板。
export const DetailPanel = () => (
  <div style={{ width: 440 }}>
    <PageSection title="移交详情" actions={<StatusBadge namespace="dispatch.states" value="PROPOSED" />}>
      <dl className="grid grid-cols-[7rem_1fr] text-sm">
        <dt className={DT}>灵魂</dt>
        <dd className={`${DD} font-medium`}>王守仁</dd>
        <dt className={DT}>来源</dt>
        <dd className={DD}>中华 · 酆都第五殿</dd>
        <dt className={DT}>去向</dt>
        <dd className={DD}>希腊 · 极乐园</dd>
        <dt className={DT}>提议时间</dt>
        <dd className={`${DD} font-mono text-xs tabular-nums`}>2026-10-02 14:31</dd>
      </dl>
    </PageSection>
  </div>
);

export const WithActions = () => (
  <div style={{ width: 440 }}>
    <PageSection title="操作">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost">驳回</Button>
        <Button variant="primary">批准移交</Button>
      </div>
    </PageSection>
  </div>
);

// 理由是人写的话:衬线。
export const Reason = () => (
  <div style={{ width: 440 }}>
    <PageSection title="理由">
      <p className="max-w-[72ch] font-serif text-sm text-[oklch(var(--color-ink))] text-pretty">
        此魂生前久居泉州,与希腊商旅往来甚密,其家人请求按希腊冥律另行审理。
      </p>
    </PageSection>
  </div>
);

export const Refreshing = () => (
  <div style={{ width: 440 }}>
    <PageSection title="待审批" isRefreshing>
      <p className="text-sm text-[oklch(var(--color-ink-muted))]">共 12 份移交请求,第 2 / 3 页</p>
    </PageSection>
  </div>
);

export const Error = () => (
  <div style={{ width: 440 }}>
    <PageSection title="移交历史" error="加载失败:网络连接超时">
      <span />
    </PageSection>
  </div>
);
