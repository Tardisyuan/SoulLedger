import type { ReactNode } from "react";

/**
 * 页面级分节标题(规范 v2 §四「行标 · 分节」):48×12 的匾纹片段 section-{civ}(线色 ink3,
 * 只有细线与中线两级、不加质感)+ 13 的节名(画布写 13/600;这里 500,因为仓库的 <h2>
 * 13 号一档钉死 `text-sm font-medium`,PageShell.test 守着 —— 要 600 得先改那条规则)。
 * 只用在页面级分节上 —— 审判台的甲乙丙、
 * 详情页各节、概览区块;表格、列表、表单内部的小分组仍是 1px 细线加 11px 标签,不用它。
 */
export function SectionTitle({
  id,
  children,
  aside,
}: {
  id?: string;
  children: ReactNode;
  /** 节名右侧的注记(件数等),11px 等宽 ink3。 */
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" data-testid="section-rule" className="section-rule" />
      <h2 id={id} className="text-sm font-medium text-[oklch(var(--color-ink))]">
        {children}
      </h2>
      {aside ? <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{aside}</span> : null}
    </div>
  );
}
