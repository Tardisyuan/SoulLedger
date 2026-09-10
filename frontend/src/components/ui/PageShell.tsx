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
 *    `min-h-[calc(100vh-4rem)]`（AppLayout.tsx:461），页面再写一次
 *    `min-h-screen` 就永远多出 64px 死滚动 —— 现在 `app/` 下 47 个文件犯了这个。
 *    `src/__tests__/PageShell.test.tsx` 里有一条专门盯着它。
 *
 * 4) **`<h2>` 有三个角色,各钉一档,壳不渲染它们。** 壳拥有 `<h1>`(`text-07`)
 *    与 `eyebrow`(`text-01 font-mono uppercase`);`<h2>` 归页面,而 2026-09-07
 *    实测全站 `<h2>` 用了五种排版(11px…22px,同一个语义槽)。收敛成一档
 *    是错的 —— 里面确实有几个角色:
 *
 *    (那次普查的总数当时记成 32,`d1e7ee7` 复核为 **38**(app/ 25 + src/components
 *    13);2026-09-10 再测仍是 38。数字写在这里只会腐烂,真正的计数由
 *    `PageShell.test.tsx` 每次运行重算。)
 *
 *      区块标签   `text-01 uppercase`  卡片/图表/区段**上方**那行小字。它不是
 *                                      标题,是标签:全大写、字距 0.1em、跟着
 *                                      `--text-01--font-weight: 600` 走,和壳
 *                                      自己的 `eyebrow` 是同一个排版位。
 *      面板标题   `text-06`            一整块面板/区段的标题,和页面的 `<h1>`
 *                                      同族、低一档。weight 由
 *                                      `--text-06--font-weight: 600` 提供。
 *      列表行标题 `text-03 font-medium` 一屏几十个的那种标题 —— 列表/信息流里
 *                                      **每一行**的题头,内容是数据不是版面
 *                                      词汇。2026-09-10 正式命名(见下)。
 *
 *    第三个角色是 2026-09-10 加的,它的来历值得记:2026-09-07 定前两个角色时,
 *    普查**没有覆盖到列表行**,于是 `app/notifications/page.tsx:277` 被记成一条
 *    豁免,理由写的是「规则的证据从没覆盖过这个案例」。那句话是对的,而正确的
 *    处置不是永久豁免,是补上角色。前两个角色都放不进列表行:`text-01 uppercase`
 *    会把后端来的通知标题转成大写并加 0.1em 字距(对 CJK 是错的),`text-06`
 *    是 22px、一行放不下几十个。
 *
 *    **`font-medium` 是角色定义的一部分,不是一处例外。** `--text-03` 和
 *    `--text-02/04/05` 一样**没有**伴生的 `--text-03--font-weight`(带 weight
 *    的是 01/06/07/08 四个标题级,那正是刻度在说哪些是标题)。所以这里的
 *    `font-medium` 不是 `text-06` 旁边那种空操作 —— 去掉它,标题就和它下面那条
 *    `<p>` 消息同为 400,只剩颜色可分。它是这一档**唯一**的层级信号,守卫因此
 *    连它一起钉。反过来也没有给 `--text-03` 补 weight token:`text-03` 站内绝大
 *    多数用处是按钮文字与正文小字,补上会把它们一起加粗 —— 和上面 `--text-05`
 *    那条是同一个论证。
 *
 *    **在 `<h2>` 这一层,这条规则目前由单一案例支撑。** 2026-09-10 扫 `app/`
 *    与 `src/components/` 的 38 个 `<h2>`,`text-03` 的只有
 *    `app/notifications/page.tsx:277` 一个(其余 21 个 `text-01`、16 个
 *    `text-06`)。守卫只管 `<h2>`,所以守卫这一档确实只有一个样本。
 *
 *    **但这个排版本身不是孤例。** 同一天扫 `<h3>`,`text-03 font-medium` 有
 *    **5 处**,全是同一种东西 —— 列表/网格里每一行的题头,或抽屉里每一组的
 *    组头:`app/organizations/page.tsx:142`(组织卡片行)、
 *    `src/components/permissions/RolesGrid.tsx:40`(角色卡片行)、
 *    `src/components/settings/SettingsDrawer.tsx` 的 386/419/464(三个设置分组)。
 *    也就是说这个角色在仓里已经被独立地写出来六次了,只是其中五次挂在 `<h3>`
 *    上、落在守卫的取景框外。**这是支持命名而不是支持豁免的证据**:豁免表说的
 *    是「这一例不算数」,而实际情况是「这一档一直在被用,只是没有名字」。
 *
 *    (那五处 `<h3>` 这一轮**没有动**。`<h3>` 在这份文档里还没有角色划分,
 *    给它们改标签或扩守卫都是另一件事,需要它自己的普查。写在这里是为了下次
 *    有人问「这条规则的证据有多厚」时不用重新扫一遍。)
 *
 *    两条推论,都是 2026-09-07 那一轮实际改动的理由:
 *      - `text-06` 上再写 `font-semibold` 是**空操作**(同一个 600),仓里有 5 处。
 *        删掉,不要在 token 已经给了 weight 的档位上重复声明 —— 留着会让人以为
 *        「不写就不粗」,于是下一个人在 `text-01` 上也补一个。
 *      - `--text-05` **没有**伴生 weight,而它的其余用处全是正文:
 *        `font-serif text-05` 的法条与供词、hero 副标题、PageError 的说明句、
 *        welcome 的三个值。它是**引文档不是标题档**,所以补一个
 *        `--text-05--font-weight` 会把那些正文一起加粗 —— 三处用 `text-05` 的
 *        `<h2>` 改成 `text-06`,而不是给 `text-05` 补 weight。
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
export type PageShellDensity = "table" | "document";

/**
 * 正文槽的纵向节奏,按密度。
 *
 * 只有纵向:左右一律 `px-6`,因为列宽归 `variant` 管,两个 prop 各管一件事。
 */
const BODY_CLASS: Record<PageShellDensity, string> = {
  table: "px-6 py-6",
  document: "px-6 pt-10 pb-16",
};

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
  /**
   * 返回链接（`← 返回队列` 一类）。与 `eyebrow` 同一行，但**不是** eyebrow：
   * eyebrow 说「这一页是什么」，返回链接说「离开这一页」。七个详情页现在各自
   * 手写它。给 `<Link>` 或 `<Button variant="ghost">`，不要给纯文本 `←`。
   */
  backLink?: React.ReactNode;
  /**
   * 标签页条。在页头之下、筛选栏之上，**不 sticky**——切换标签改变的是这一页
   * 在看什么，属于页头；钉在视口上会让页面身份跟着滚动条走。
   */
  tabs?: React.ReactNode;
  /** 副标题，`text-04` + `text-ink-subtle`。 */
  subtitle?: React.ReactNode;
  /** 标题行右侧的动作区（「+ 创建灵魂」一类）。 */
  actions?: React.ReactNode;
  /** 筛选栏。唯一 sticky 的一段，`top-16`，高 56（上下各 12 padding）。 */
  filters?: React.ReactNode;
  /**
   * 分页位。见 `PageShellPagination`。
   *
   * **走 DataTable / DataGrid 的页面不要填这一槽。**
   * `components/ui/data-table.tsx:288` 自己在内部渲染 `<Pagination>`，而
   * `src/components/ui/Pagination.tsx:19` 是一个自带 `justify-between` 的整块
   * ——两边都给就会出现两条分页条。这一槽是给**不经 DataTable 的**列表用的
   * （social、tenants 那几处直接引 Pagination 的页面）。
   * 这条不是组件能自己判断的：PageShell 看不见 children 里有没有 DataTable。
   */
  pagination?: PageShellPagination;
  /** 空态。`isEmpty` 为真且给了它时代替 children。 */
  empty?: React.ReactNode;
  /** 骨架屏。`isLoading` 为真且给了它时代替 children（优先于空态）。 */
  skeleton?: React.ReactNode;
  isLoading?: boolean;
  isEmpty?: boolean;
  children?: React.ReactNode;
  /**
   * 这条路由是被**读**的还是被**扫**的。
   *
   * 默认 `"table"`,也就是迁移时 33 条路由拿到的那一套:`py-6`,区段边界与
   * 卡片内边距同重。对一张可排序的表格这是对的 —— 操作员在扫描,任何多余的
   * 留白都是他一秒钟里少看到的一行。
   *
   * `"document"` 是给真正被读的两三条路由的。它们此前**没有一条被认可的途径**
   * 说自己是文档:`app/judgment/[id]` 在四处写 `gap-10 mt-10`,
   * `app/ledger` 写 `space-y-10`,都是从壳内部顶开固定的 `py-6`。壳把统一
   * 当默认是对的,把统一当唯一才是那个缺陷 —— 这个 prop 是那道出口。
   *
   * 实测背景(2026-09-02):全仓 935 处纵向节奏里,96% 挤在 ≤24px,
   * ≥48px 的只有 6 处、占 0.6%。宏观节奏是存在的,只是没人走得到。
   *
   * ── 正文槽**顶层区块之间**的节奏也归这个 prop ────────────────────────
   * 壳给的是四周内边距;顶层区块彼此之间的间距是页面写的那一层
   * `<div className="space-y-*">`,而 2026-09-07 实测它分成两派:
   * `space-y-10` 五处、`space-y-6` 四处,**同一个槽位**。规矩是:
   *
   *     density="table"(默认)   space-y-6    24px
   *     density="document"       space-y-10   40px
   *
   * 也就是说它不是第二个决定,是这一个决定的延伸 —— 扫描页收紧、阅读页放开。
   * 按这条,`ledger`(document)保持 10;`organizations` / `realms` /
   * `permissions`(含它的 loading.tsx,否则加载完会跳一格)收到 6。
   *
   * **为什么不是壳自己加 `space-y-*`。** 壳看不见 children 是什么:走 DataTable
   * 的那些路由正文只有一个孩子,`space-y-*` 对它们是 no-op;但正文有两个以上
   * 未包裹孩子的路由会**当场被重新排版**,而那既没有人要求,也没有测试看着。
   * 同一个理由此前已经写过一次 —— 见上面 `pagination` 那一槽的「这条不是组件
   * 能自己判断的」。所以规矩写在这里,值由页面写,两边指的是同一个 prop。
   */
  density?: PageShellDensity;
  /** 追加到最外层。**不要用它改列宽** —— 那是 variant 的事。 */
  className?: string;
}

export function PageShell({
  title,
  variant = "page",
  density = "table",
  eyebrow,
  backLink,
  tabs,
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
      className={cn("bg-[oklch(var(--color-canvas))] text-[oklch(var(--color-ink))]", className)}
    >
      {/* 页头：不 sticky。 */}
      <header
        data-page-shell-header=""
        className="border-b border-[oklch(var(--color-hairline))]"
      >
        <div className={cn(width, "px-6 pt-10 pb-6")}>
          {/* 返回链接与 eyebrow 共用标题上方那一行，但它们不是一回事，所以是
              两个槽而不是让页面把 `←` 塞进 eyebrow。eyebrow 是**这一页是什么**
              （卷宗号、租户、状态），返回链接是**离开这一页**。七个详情页现在
              各自手写这条链接（judgment/[id]:127、dispatch/[id]:112、
              souls/[id]:282、social/[id]:23、social/profile/[id]:32、
              social/follows:29、users:71）；塞进 eyebrow 会让一个导航控件继承
              一个纯排版位的 uppercase + 字距，读起来像标签而不是链接。 */}
          {backLink || eyebrow ? (
            <div className="flex items-baseline gap-3 mb-3">
              {backLink ? (
                <div data-page-shell-back="" className="shrink-0">
                  {backLink}
                </div>
              ) : null}
              {eyebrow ? (
                <p
                  data-page-shell-eyebrow=""
                  className="text-01 font-mono uppercase text-[oklch(var(--color-ink-subtle))] min-w-0"
                >
                  {eyebrow}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-start gap-4">
            <h1 className="text-07 text-[oklch(var(--color-ink))] flex-1 min-w-0">{title}</h1>
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
              className="text-04 text-[oklch(var(--color-ink-subtle))] max-w-prose mt-3"
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>

      {/* 标签页条：在页头之下、筛选栏之上，且**不 sticky**。
          五个页面有这一条（judgment:72、workflow:155、dashboard:168、
          notifications:107、social/follows:39），迁移前它们的写法分成两派
          （gap-1 + hairline/50 与 gap-2 + 实线 hairline）。
          为什么不复用 `filters` 槽：那一槽是 sticky 的，而标签页切换的是
          **这一页在看什么**，属于页头的一部分——把它钉在视口上等于让页面
          的身份跟着滚动条走，而滚动时真正还需要的只有筛选。
          为什么不塞进 children：它必须在筛选栏之上，否则筛选看起来像作用于
          所有标签页而不是当前这个。 */}
      {tabs ? (
        <div data-page-shell-tabs="" className="border-b border-[oklch(var(--color-hairline))]">
          <div className={cn(width, "px-6 flex items-center gap-1")}>{tabs}</div>
        </div>
      ) : null}

      {/* 筛选栏：全站唯一贴在 AppLayout h-16 头下沿的一段。
          `h-14 py-3` 不冲突 —— border-box 下总高 56、内容 32，正是规格里的
          「上下各 12 padding」。 */}
      {filters ? (
        <div
          data-page-shell-filters=""
          className="sticky top-16 z-filters bg-[oklch(var(--color-canvas))] border-b border-[oklch(var(--color-hairline))]"
        >
          {/* `overflow-x-auto` 不是装饰。这一行是固定高度、不换行的 flex —— 而
              筛选控件的数量由每个页面自己决定。灵魂页放了搜索框、两个数字输入、
              一个下拉和一个开关,在 393px 的手机上总宽 738px。
              
              没有这一行的话,撑宽的不是这个容器,是**整个文档**:实测
              `documentElement.scrollWidth` 738 而 `clientWidth` 393。后果远不止
              横向滚动条 —— 所有 `fixed inset-0` 的东西(遮罩、弹窗容器)都会跟着
              摊到 738,于是弹窗居中在 369、一半落在可视区外,里面的提交按钮
              「可见、可用、可滚动到」却点不动。mobile-chrome 上三条 E2E 长期
              超时失败,根因就在这里,而它看起来完全不像一个筛选栏的问题。
              
              滚动而不是换行:`h-14`(56px = 上下各 12 padding + 32 内容)是规格里
              写死的高度,换行会破坏它。 */}
          <div
            className={cn(
              width,
              "px-6 h-14 py-3 flex items-center gap-3 overflow-x-auto"
            )}
          >
            {filters}
          </div>
        </div>
      ) : null}

      <div data-page-shell-body="" data-density={density} className={cn(width, BODY_CLASS[density])}>
        {body}
      </div>

      {pagination ? (
        <div data-page-shell-pagination="" className={cn(width, "px-6 pb-6")}>
          <div className="border-t-2 border-[oklch(var(--color-ink-subtle))] pt-3 min-h-14 flex items-center justify-between gap-4">
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
