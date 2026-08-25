import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 页面外壳 —— Stage 11 B。
 *
 * 替掉 36 个页面各自手写的那层 `min-h-screen` + `h-12 标题条` +
 * `max-w-* mx-auto px-6 py-6`。本波只建组件，不迁移页面。
 *
 * ── 三件事这里做了决定，写下来是因为它们看起来像遗漏 ──────────────────
 *
 * 1) **不渲染面包屑。** 设计规格原话是「面包屑与标题不是两层，是同一层的两行」，
 *    并要求 PageShell 自己画那两行。但 `src/components/layout/AppLayout.tsx:260`
 *    的 sticky `h-16` 里已经有 `<Breadcrumb menus={menus} />`，而 AppLayout 经
 *    `AppLayoutWrapper` 包住了 `app/layout.tsx` 的全部 children —— 也就是每一个
 *    页面。PageShell 再画一遍就是同一条面包屑出现两次。
 *    所以这里只留 `eyebrow`：同样的 `text-01 font-mono uppercase` 排版位，内容
 *    由页面给（卷宗编号、租户、状态一类），面包屑的所有权仍在 AppLayout。
 *    双层头依然被解掉了 —— 解掉的是页面自己那条 `h-12` 标题条，它的 `<h1>` 与
 *    面包屑最后一节说的是同一件事（`app/souls/page.tsx:153`、
 *    `app/audit/page.tsx:176`、`app/menus/page.tsx:255` 等 10 处同形）。
 *
 * 2) **页头不 sticky，只有筛选栏 sticky。** 卷宗的封面不跟着滚；滚动时还需要的
 *    控件只有筛选。筛选栏 `top-16` 贴在 AppLayout 那条 `h-16` 头下沿。
 *
 * 3) **没有 `min-h-screen`。** AppLayout 给的槽位是
 *    `min-h-[calc(100vh-4rem)]`（AppLayout.tsx:418），页面再写一次
 *    `min-h-screen` 就永远多出 64px 死滚动 —— 现在 `app/` 下 47 个文件犯了这个。
 *    `src/__tests__/PageShell.test.tsx` 里有一条专门盯着它。
 */

export type PageShellVariant = "prose" | "page" | "full";

/**
 * 内容列宽。**由 variant 决定，不由页面自选** —— 迁移前站内有 8 种宽度。
 *
 * `full` 的含义不是某个值，是「不加 max-width 类名」，所以这里是空串而不是
 * `max-w-none`：`max-w-none` 会被 tailwind-merge 当成一个 max-width 决定，
 * 在外面传 className 想覆盖时行为不同。`mx-auto` 跟着 max-width 一起给，
 * 没有 max-width 时它是 no-op，留着只会让类名列表说谎。
 */
const WIDTH_CLASS: Record<PageShellVariant, string> = {
  prose: "max-w-prose mx-auto",
  page: "max-w-page mx-auto",
  full: "",
};

/**
 * 分页位的两半。PageShell 负责摆放（左计数、右翻页）与那条 2px 规则线，
 * 页面只给内容。传了这个对象就有占位，**即使两半都空** —— 空结果时分页条
 * 塌陷会让下面的内容往上跳一格。
 */
export interface PageShellPagination {
  /** 左侧：「第 2 页 / 共 7 页，共 133 条」这类计数。 */
  count?: React.ReactNode;
  /** 右侧：翻页控件。 */
  controls?: React.ReactNode;
}

export interface PageShellProps {
  /** 页面标题。全页仅此一处 `<h1>`，`text-07`。 */
  title: React.ReactNode;
  /** 内容列宽。默认 `page`（1200px），绝大多数页面用它。 */
  variant?: PageShellVariant;
  /**
   * 标题上方一行小字，`text-01 font-mono uppercase`。
   * **不是面包屑** —— 面包屑归 AppLayout，见文件头第 1 条。
   */
  eyebrow?: React.ReactNode;
  /** 副标题，`text-04` + `text-ink-subtle`。 */
  subtitle?: React.ReactNode;
  /** 标题行右侧的动作区（「+ 创建灵魂」一类）。 */
  actions?: React.ReactNode;
  /** 筛选栏。唯一 sticky 的一段，`top-16`，高 56（上下各 12 padding）。 */
  filters?: React.ReactNode;
  /** 分页位。见 `PageShellPagination`。 */
  pagination?: PageShellPagination;
  /** 空态。`isEmpty` 为真且给了它时代替 children。 */
  empty?: React.ReactNode;
  /** 骨架屏。`isLoading` 为真且给了它时代替 children（优先于空态）。 */
  skeleton?: React.ReactNode;
  isLoading?: boolean;
  isEmpty?: boolean;
  children?: React.ReactNode;
  /** 追加到最外层。**不要用它改列宽** —— 那是 variant 的事。 */
  className?: string;
}

export function PageShell({
  title,
  variant = "page",
  eyebrow,
  subtitle,
  actions,
  filters,
  pagination,
  empty,
  skeleton,
  isLoading = false,
  isEmpty = false,
  children,
  className,
}: PageShellProps) {
  const width = WIDTH_CLASS[variant];

  // 三选一，顺序是有意的：还在加载时不该先闪一下空态。
  const body = isLoading && skeleton ? skeleton : isEmpty && empty ? empty : children;

  return (
    <div
      data-page-shell=""
      data-variant={variant}
      className={cn("bg-canvas text-ink", className)}
    >
      {/* 页头：不 sticky。 */}
      <header
        data-page-shell-header=""
        className="border-b border-hairline"
      >
        <div className={cn(width, "px-6 pt-10 pb-6")}>
          {eyebrow ? (
            <p
              data-page-shell-eyebrow=""
              className="text-01 font-mono uppercase text-ink-subtle mb-3"
            >
              {eyebrow}
            </p>
          ) : null}

          <div className="flex items-start gap-4">
            <h1 className="text-07 text-ink flex-1 min-w-0">{title}</h1>
            {actions ? (
              <div data-page-shell-actions="" className="shrink-0">
                {actions}
              </div>
            ) : null}
          </div>

          {subtitle ? (
            /* `max-w-prose` 是行长上限，不是列宽：在 variant="full" 下一句副标题
               铺满 1800px 不可读。列宽仍然只由上面那个 `width` 决定，
               PageShell.test.tsx 的 variant 断言也只看四个容器位。 */
            <p
              data-page-shell-subtitle=""
              className="text-04 text-ink-subtle max-w-prose mt-3"
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>

      {/* 筛选栏：全站唯一贴在 AppLayout h-16 头下沿的一段。
          `h-14 py-3` 不冲突 —— border-box 下总高 56、内容 32，正是规格里的
          「上下各 12 padding」。 */}
      {filters ? (
        <div
          data-page-shell-filters=""
          className="sticky top-16 z-30 bg-canvas border-b border-hairline"
        >
          <div className={cn(width, "px-6 h-14 py-3 flex items-center gap-3")}>
            {filters}
          </div>
        </div>
      ) : null}

      <div data-page-shell-body="" className={cn(width, "px-6 py-6")}>
        {body}
      </div>

      {pagination ? (
        <div data-page-shell-pagination="" className={cn(width, "px-6 pb-6")}>
          <div className="border-t-2 border-ink-subtle pt-3 min-h-14 flex items-center justify-between gap-4">
            <div data-page-shell-pagination-count="" className="min-w-0">
              {pagination.count}
            </div>
            <div data-page-shell-pagination-controls="" className="shrink-0">
              {pagination.controls}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
