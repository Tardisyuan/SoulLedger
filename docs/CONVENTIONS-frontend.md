# 前端开发准则与页面一致性 — SoulLedger

> **成文日期 2026-09-06。** 这份文件汇总当天散在 `DESIGN.md`、根 `AGENTS.md`、
> `CONTRIBUTING.md`、`docs/CONVENTIONS.md`、`docs/design-handoff/{BRIEF,ADDENDUM,tokens}.md`、
> `frontend/eslint.config.mjs` 与代码本身里的前端约定，并**逐条标注它有没有执法机制**。
>
> 它取代 `docs/CONVENTIONS.md` 的 `# Frontend Conventions` 一节。后端见
> [`CONVENTIONS-backend.md`](CONVENTIONS-backend.md)。

## 怎么读这份文件

方括号是**执法机制**：

- `[eslint:规则名]` / `[test:文件名]` / `[e2e]` / `[tsc]` / `[hook]` / `[CI]` — 违反会红
- `[文字]` — **没有任何东西检查它**
- `[多数派 n/m]` — 现状统计，不是规则

带【实跑】的数字是 2026-09-06 在本机执行得到的（命令在第 12 节），其余为 grep 计数。

### 三件影响全部读法的前提

1. **`frontend/tailwind.config.js` 不存在。**【实跑】`ls tailwind.config.*` 无命中。
   `8fb0da4`（Tailwind 3.4→4.3.3）把配置搬进了 `app/globals.css` 的 `@theme`。
   **仍有 27 处引用它**（2026-09-06 实测，分布在约 20 个文件）。其中一部分是
   过去时的历史记录（"used to override the `amber` palette"），那是合理的；
   另一部分是**现在时**的断言，读起来像在描述当前配置，例如
   `statusTokenLayering.test.ts:60`「tailwind.config.js scans `./src/**`」、
   `soulStateBadge.ts`「declares no status colour」、`Button.tsx`「so `rounded`
   would be a no-op」—— 这些结论今天仍成立，但它们**援引的依据不存在了**。
   > 2026-09-06 只修了唯一一处会显示给开发者的：`eslint.config.mjs` 的 type-scale
   > 报错文案曾让人"见 tailwind.config.js 的 fontSize"，现指向 `app/globals.css`
   > 的 `@theme`。其余 26 处是注释，留待逐个核实后再改 —— 把现在时改成过去时
   > 需要确认每条结论本身是否还成立，而不是全局替换文件名。
2. **`@headlessui/react` 已经不在依赖里。**【实跑】`frontend/package.json:21` 是
   `@base-ui/react`，headlessui 无命中。
   > 根 `AGENTS.md` §2 曾写"所有弹窗必须使用 @headlessui"并给出一段 `<Transition>`
   > 结构 —— **2026-09-06 已改为 Base UI 的五段 anatomy**。`BRIEF.md:277` 仍是旧的，
   > 但那份属于冻结的交付包（`docs/README.md:196`），不改。测试注释里另有 8 处提及，
   > 多为过去时的迁移记录。
3. **CI 不自动跑**（两个 workflow 都只有 `workflow_dispatch`）。每次都跑的是
   `.git/hooks/pre-commit`（暂存前端文件的 `eslint --max-warnings 0`）和 `pre-push`。
   **pre-push 不跑 E2E**，所以三个 playwright project 唯一的自动执行点是空的。

### 权威顺序

**`app/globals.css` > `eslint.config.mjs` > `DESIGN.md` > 其余一切。**
`DESIGN.md:3` 自己就是这么写的：「globals.css is the authority for every number.
This file is not.」

> **根 `AGENTS.md` §1–§2 曾指向相反的方向，2026-09-06 已重写。** 它规定的是一套
> Linear 风格：`rounded-lg` 卡片、`rounded-md` 按钮、`bg-amber-500` 品牌色、
> `text-sm` 正文，外加一张 `bg-canvas` / `text-ink` / `border-hairline` 的裸类名
> token 表。**那四类今天全是 eslint error，那张表里的裸类名在产品代码里用量为 0。**
> 它同时把 `showToast` 写成对象参数（实为位置参数），把弹窗规定成 `@headlessui`
> 的 `<Transition>` 结构（该包已不在依赖里）。
>
> 这一条留在这里不是为了记账，而是因为**它当时并不显得可疑**：那份文档的语气、
> 表格、代码块都完整自洽，只是描述的是另一个应用。`DESIGN.md:5-18` 早就写明旧规范
> "是一条活的、要你撤销刻意工作的指令"，而 `AGENTS.md:13` 仍在让人"必读 DESIGN.md"
> —— 两份文档互相指路，指向的却是相反的方向。

---

## 1. 目录与分层

| 规则 | 出处 | 执法 |
|---|---|---|
| npm workspaces：根 + `frontend/` + `packages/core/`，根 `package-lock.json` 是唯一锁文件 | `package.json:6-9` | `[CI]`（`npm ci` 在根执行）。`cd frontend && npm ci` **不再可用** |
| `packages/core` 是平台无关层：API 契约 / 两个 WS 客户端 / 领域配置 / 校验 / 三份语言包 / 六个数据 hook | `packages/core/src/index.ts:1-11` | **`[tsc]`** `tsconfig.json:4-12` 的 `lib: ["ES2020"]` + `types: []`；**`[test:domBoundary]`** 从 `@types/react` 派生 ~146 个 DOM 类型名并断言不可解析；**`[test:nodeGlobals]`**；`[eslint]` 禁 `process` 与 `import.meta` |
| 宿主能力只能走 `PlatformAdapter` 的 8 个端口 | `packages/core/src/platform/types.ts`；白名单 `host-globals.d.ts:1-51`「ADDING TO THIS FILE IS THE DECISION」 | `[tsc]` + 上述两测试 |
| 根布局必须渲染 `PlatformProvider` | web 实现 `frontend/lib/platform/web.ts` | `[test:platformAdapterIsInstalled]`（读 `app/layout.tsx` 源码断言） |
| `frontend/src/hooks/` 只剩视图层四个：`useChartColors` / `usePermissions` / `useRowTransitions` / `useSidebarMenus` | 目录实况 | `[多数派]` |

**`domBoundary.test.ts` 为什么不能被 `typecheck` 替代：** 那些 DOM 类型是空接口，
`const el: HTMLElement = {}` 能编译过。**只有那份测试在执法"平台无关"这个断言。**
而 `ci.yml:98-101` 只跑 core 的 typecheck+lint，**不跑 core 的 vitest** —— pre-push 三条都跑。

**代码搬进 `packages/core` = 搬出 jest 覆盖率分母。** `jest.config.js:4-18` 用
`moduleNameMapper` 直接映射到源码；实测把 `'../packages/core/src/**'` 加进
`collectCoverageFrom` 后，覆盖率数字**逐字节不变、文件一个都不出现**。仍被测试，
但不再被度量。这一点没有任何报错提示你。

**已失效的路径引用**（根 `AGENTS.md:149-150,317-323,343,359`）：`src/middleware.ts`
（实为 `frontend/middleware.ts`）、`lib/api.ts`（已进 `packages/core/src/api/*`）、
`src/components/NavBar.tsx`（不存在）、`messages/{locale}.json`（实为 `packages/core/messages/`）。

---

## 2. 设计 token —— 唯一拼法只有一种

**权威是 `frontend/app/globals.css`。**

### 2.1 颜色

`:root` 是 dark（`:264-371`），`.light` 是 light（`:374-474`）。值是**裸 HSL 三元组**
`H S% L%`，消费方式：

```
text-[hsl(var(--color-ink))]              ✅ 唯一正确拼法
bg-[hsl(var(--color-status-error)/0.1)]   ✅ 带 alpha
text-ink                                  ❌ Tailwind 4 的 @theme 与 :root 同名冲突，
                                             裸形会生成非颜色值
```

`[test:cssTokenReferenceContract:315-371]`「colour tokens are referenced one way only」；
同一份测试还断言每个 `var(--color-*|--civ-*)` 必须在 globals.css 有声明。

### 2.2 六条 design-guard eslint 规则（全部 `error`）

| 规则 | 禁什么 | 位置 |
|---|---|---|
| `type-scale` | `text-xs`…`text-9xl`、`text-[11px]` 等任意长度。只许 `text-01`…`text-08`（11/12/13/15/18/22/32/56px，自带行高字距字重） | `eslint.config.mjs:297-305`；`globals.css:159-186` |
| `spacing-rhythm` | p/m/gap/space 只许 1/2/3/4/6/10/16 + 0/px/auto。**刻意不进 config**（`ADDENDUM.md:429-431`） | `:307-319`。唯一豁免 `Badge.tsx` 的 `py-0.5` |
| `dead-radius` | `rounded` / `-sm` / `-md` / `-lg` / `-xl`… 全是死类名 —— **8 个 shape radius 全为 0**，只剩 `--radius-focus: 2px` 与 `--radius-full` | `:321-327`；`globals.css:193-202` |
| `no-raw-palette` | Tailwind 原生调色板（22 色 × 11 档）与任意值写死颜色 `bg-[hsl(38,92%,50%)]` | `:329-341` |
| `no-hex-colour` | 十六进制。例外 `HEX_ALLOW`：`src/components/workflow/`、`src/components/charts/`、`SettingsDrawer.tsx`、`app/global-error.tsx` | `:394-419` |
| `no-styles-in-csstext` | `style.cssText` 写 radius/animation/transition/font/color/background。`CSSTEXT_ALLOW = []`（刻意空表） | `:364-392` |

**「守卫的守卫」是真的：**`[test:designGuardContract:131-192]` 起真 ESLint 子进程去
lint 违规片段，确认这六条会红。同一份测试还钉住 design-guard 的覆盖范围
（探针打到 `app/ src/ components/ lib/ hooks/` 五个源根）。

### 2.3 LEGACY 基线是双向的

`eslint.design-guard-baseline.json` 记录每个文件当前的违规数：**超出报红，低于也报红**，
没有条目的文件是 0 额度。【实跑】现状 **28 个文件 / 94 条**（type 4 · space 68 · palette 22 · radius 0）。

`[test:designGuardContract:194-293]` 断言基线文件名出现在配置源码里、每个键路径存在且 git 已跟踪。

> `eslint.config.mjs` 里的注释写着「35 个文件 / 564 条」（`:52`）和「44 个文件 / 287 处」（`:622`）。
> 两个都是旧数。以 JSON 实况为准。

### 2.4 其余 token

- **圆角全为 0** —— 这是一个刻意决定，不是遗漏
- **动效三档** `--transition-duration-{press,state,settle}` = 100/160/240ms + 两条缓动
  `--ease-enter/exit`，**无 overshoot**（`globals.css:49-145`）
- **层级（elevation）仍未定义** —— surface 相邻步差仅 1.02–1.05:1，靠 1px hairline 分层
  （`DESIGN.md:50-57`）。`[test:civilizationColourContract:239-300]` 反向钉住「ramp 必须保持平」
- **容器** `--container-prose: 720px` / `--container-page: 1200px`。旧值 `max-w-5xl/6xl` 还有 12 处，`[文字]`
- **z 轴** progress 60 / drawer 70 / dialog 80。旧值 `z-10`…`z-50` 还有 26 处，`[文字]`
- **三族字体一职**：Archivo（UI）/ IBM Plex Mono（标识与数字）/ **Source Serif 4 只用于
  "某人说过的话"**（`app/fonts.ts:24-47`）。`[test:designGuardContract:391-428]` 只保证
  DESIGN.md 不点名 Inter/JetBrains；**衬线的用途本身无执法**
- **类名合并只用 `cn()`**（`lib/utils.ts:4-49`，它扩展了 tailwind-merge 认识 `text-01…08`）
- **Recharts 不读 CSS 变量**，`lib/chart-colors.ts` 是**镜像**且双主题。
  `[test:chartColourContract]` + `[test:civilizationColourContract]` 双向比对

### 2.5 状态 token 分层（容易搞错的一条）

三类互不通用：

- **lifecycle 六态** `--color-status-{alive,judging,disposed,reincarnating,lost,settled}` — 灵魂状态徽章
- **karma / verdict** `--color-verdict-*`、merit/demerit — 领域判定
- **system feedback** `--color-status-{success,error,warning,info}` — **只用于 toast / 校验 / banner**，
  **不得**上 badge / row / chart

`[test:statusTokenLayering]` 比对 token **名**（不比值）。已登记 5 个违例：
`actors::ROLE_BADGE_CLASSES`、`death-sync::STATUS_COLORS`、`dispatch/[id]::STATUS_COLORS`、
`workflow/[id]::STATUS_COLORS/VERDICT_COLORS`。该测试自述另有"~60 处内联三元，
一个真实缺口，不是决定"。

---

## 3. 四文明主题

四文明 `CHINESE / EUROPEAN / EGYPTIAN / GREEK` ↔ `CN_DIYU / EU_HEAVEN_HELL / EG_DUAT / GR_HADES`，
前缀 cn/eu/eg/gr 由租户码派生，**一处列全**（`packages/core/src/config/civilizations.ts:31-79`）。
`[test:civilizationMapCoverage]` 断言 7 张手写 map 全覆盖。

### 三个 token 族，职责不可互换

```
--color-civ-hue-*    裸色相度：12 / 232 / 44 / 88
--color-civ-mark-*   图形
--color-civ-ink-*    文字
```

`[data-civ]` 规则同时别名 `--civ-hue` / `--civ-mark` / `--civ-ink`；`TenantProvider`
把属性打在 `<html>`。

> **MARK IS THE GRAPHIC, INK IS THE TEXT**（`globals.css:594-598`）。
> `[test:cssTokenReferenceContract:246-313]`「the civilization mark is never used as text」。

### 表面 ramp 不承载身份 —— 这是一个被主动选择过的方案

13% 饱和、7% 亮度下四个租户的表面差 ≤6/255。识别**靠 mark + 文字**，
`[test:civilizationColourContract:239-300]` 断言 ramp 差 ≤8/255 **且** mark 分离 ≥3× ramp
—— 也就是说，把 ramp 饱和提到 35–40% 会报红。

`BRIEF.md §4.9` 索要的是"surface-first"的文明身份，`ADDENDUM.md:354` 选了 Option 2 并
反向钉住。**BRIEF 正文一字未改**，读它时要知道这一节已被推翻。

`[test:tenantSignalContract]`：每个 TenantSignal 变体必须**仅凭文字**可辨（mark 和文字是 AND）。

### 四种读数是四种结构，不是一个组件加 variant

`ADDENDUM.md:14-39,142-272`。希腊两条路**永不合并**、一规则一时钟只画一次、
空路是 `0` 不是 `—`、em-dash 必须 `aria-hidden`。
`[test:SoulReadingPanelFork]`、`[test:readingQuantityContract]`、`[test:ledgerQuantityContract]`

每个文明编号自己的条文：功過格用 卷/門 汉数字、Inferno 罗马数字、
Negative Confession `§ n / 42`、Stephanus 页。`[test:civilizationSigilContract]`

Greek 用 88° 而不是 138°，理由是避免与 merit 绿（150°）语义冲突 —— 值被 contract 钉住，
理由是 `[文字]`。

---

## 4. 一个页面长什么样

【实跑】`app/**/page.tsx` 共 **37** 个，**37/37 都是 `"use client"`**，33 个用 `<PageShell>`。
不用的 4 个：`app/page.tsx`（公开首页，在 AppLayout 之外）、`(auth)/login`、
`judgment/queue`（全屏控制台）、`admin/stats`（重定向壳）。

> `BRIEF.md:277-278` 写「Server-rendered pages」—— 与实况 37/37 相反。

### 标准骨架（以 `app/souls/page.tsx`、`app/judgment/page.tsx`、`app/users/page.tsx` 为准）

```tsx
"use client"
// import 顺序：React → next → @tanstack → @soulledger/core/* → @/src/contexts
//              → @/src/components/ui/* → @/components/ui/data-table → @/lib/utils
const VERDICT_COLORS = { ... }                      // 模块级常量

function XContent() {
  const { t, formatDate } = useI18n()
  const [page, setPage] = useState(1)               // page / filter / ordering / modalOpen
  useEffect(() => { /* 300ms 搜索去抖 */ }, [search])
  const { data, isLoading, isError, refetch } = useQuery({ ... })
  const rows = data?.results ?? []
  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE)

  return (
    <PageShell
      variant="page"                                 // prose 720 / page 1200 / full
      title={<>{t("x.title")}<MenuGloss path="/x" /></>}
      actions={<RequirePermission permissions="x.create"><Button variant="primary">+ …</Button></RequirePermission>}
      filters={/* 裸 input/select 套 fieldControl({size:"md"}) + aria-label，无可见 label */}
    >
      <DataTable density columns data isLoading isError onRetry keyExtractor renderRow
                 sort onSortChange isFiltered onClearFilters emptyMessage
                 page totalPages totalCount onPageChange />
      <XCreateModal … />                             {/* 弹层挂在 PageShell 末尾 */}
    </PageShell>
  )
}

export default function XPage() {                    // 页级权限门包在默认导出外层
  return <RequirePermission permissions="x.read" fallback={<PermissionDenied />}><XContent /></RequirePermission>
}
```

**`PageShell` 自己决定的事**（`src/components/ui/PageShell.tsx`）：`<h1 text-07>` 唯一；
页头不 sticky、只有 `filters` sticky `top-16`；列宽由 `variant` 决定；
`skeleton`/`empty` 三选一且 loading 优先；不渲染面包屑（归 `AppLayout.tsx:330`）。

**不许 `min-h-screen`** —— `AppLayout` 的槽位已是 `calc(100vh-4rem)`。
`[test:viewportHeightContract]`，仅豁免 `app/page.tsx` 与 `(auth)/*`。

**`CONTRIBUTING.md:37` 说的 `PageSection` + `TableSkeleton` 已过时。**
【实跑】`app/` 下引用 `PageShell` 的文件 41 个、`PageSection` 6 个、**`TableSkeleton` 0 个**。

---

## 5. 三态（加载 / 空 / 错）—— 这是全站最不一致的地方

### 5.1 加载态四种写法并存

| 写法 | 页数 | 例 |
|---|---|---|
| `PageShell isLoading + skeleton` 槽 | 6 | 槽里放的东西又各不同：`ListSkeleton`(tenants) / `PageSpinner`(corpus) / 三个 `CardSkeleton`(realms) / 手排组合(notifications) |
| `DataTable/DataGrid isLoading` | 8 | souls、judgment、users、menus… |
| 主体里内联三元 `isLoading ? <Skeleton…> : …` | 13 | `dispatch:102`、`social:194-199`、`dashboard:286-288,300-303,384-387` |
| 详情页早退 | 4 | `judgment/[id]:215` 整页 `PageSpinner`；`dispatch/[id]:150` 早退成 `PageShell + Skeleton`；`souls/[id]:368-399` 把 Skeleton 塞进 PageShell 的 `title`/`subtitle` |

另有两处更旧的：`admin/stats/page.tsx:20-27` 仍手搓双环转圈（正是 `Spinner.tsx:10-27`
说要替掉的那六行）；`dashboard/loading.tsx:20-46` 用裸 `div bg-hairline animate-pulse`
而非 `Skeleton`。

**唯一的骨架原语是 `components/ui/skeleton.tsx`**，填色必须 `--color-hairline`
（`[test:cssTokenReferenceContract:416-447]`）。

**翻页 / 换筛选**用 `isPlaceholderData` → tbody `opacity-50 aria-busy`，不是整页重画。

### 5.2 错误态五种

`QueryError`（14 页 17 处）/ `DataTable isError`（8 页）/ 内联 `<p text-04 status-error>`（3 处）/
页面私有 `SectionError`（ledger 3 处）/ 用 `EmptyState` + 重试按钮表达（corpus）。

`dashboard:290-291` 的 error 只包了饼图，**三张柱图失败时按空数据渲染** —— 那正是下面这条
契约要防的形状。

> **`[test:errorIsNotAnEmptyState]` + `[e2e:error-states-differ-from-empty]`**：
> 能渲染空态的页必须同时含 `<QueryError` / `role="alert"` / `isError` 之一；
> 有 `<DataTable` / `<DataGrid` 的页必须传 `isError=`。**500 与"没有数据"不得同文。**

### 5.3 空态

`EmptyState`（23 个文件）：居左、24×2px `--civ-mark` 短线、`text-01` 标题 + `text-04` 原因 + 一个动作。
`DataTable` 自带 `emptyMessage` / `filteredEmptyMessage + onClearFilters`。

**标题语义两派**：以区块名为 title、"没有 X"为 reason（5 页）vs 直接以"没有 X"为 title、
无 reason（5 页）。另有 3 处仍手搓。

---

## 6. 组件用法

| 事项 | 规则 | 执法 |
|---|---|---|
| **弹层** | 用 `BaseModal`（Base UI `Dialog`，五段 anatomy，`max-h-[calc(100dvh-2rem)]` 可滚 body）。`ConfirmDialog` 用 `AlertDialog`，点外部不关，`confirmLoading` 同时禁两键 | **`[test:dialogsAreNotHandRolled]`** —— 但它**只扫 `app/`**。`src/` 下仍有三处手写 `fixed inset-0`：`SoulHeaderActions.tsx:98-108`、`SettingsDrawer.tsx:279`、`AppLayout.tsx:160-167` |
| **抽屉** | `useDrawerA11y`（进/环/回、Escape、`role="dialog" aria-modal`） | `[test:drawerFocusTrap]` |
| **Toast** | 传**消息键**不传句子。mutation 的 toast **由 hook 负责，页面不重复报** | `[test:notifyKeysExistInTheBundles]` 扫 `notify(` 调用，键必须在三份 bundle 里 |
| **表单皮肤** | 单一来源 `fieldControl` cva（`Field.tsx:83-110`）：surface-1 底、hairline 边、focus-visible 变 accent、invalid 保持 status-error | `[文字]` —— 三层并存，见 §10 |
| **校验** | `useFormValidation(schema)` + `aria-invalid` / `aria-describedby` + `role="alert"` 错误行；提交失败聚焦第一个 invalid（`useSubmitErrorFocus`） | `[test:submitErrorFocus]`、`[test:Field]` |
| **Tab 条** | 类名只在 `src/lib/tabClasses.ts` 拼一次；选中态文字用 `--color-accent-ink` 而非 `--color-accent` | `[test:tabClassContract]` |
| **表格排序** | DRF `ordering` 字串往返：`parseOrdering` + `onSortChange(next => "-key")` | `[多数派 3/3 逐字相同]` |

**Toast 有三个入口**（不一致）：`useToast()` 21 文件 / 直接 import `showToast` 4 文件 /
核心 hook 的 `notify()` 33 处。

**`ToastContext` 是穿着 context 外衣的模块单例** —— default 与 provider value 是同一对
模块级函数引用，**有没有 Provider 行为逐字节相同**。这是为什么六个数据 hook 能搬进
`packages/core`：加一个 `notify` 端口就解开了。

---

## 7. 权限在 UI 上

唯一来源 `usePermissions()`（`src/hooks/usePermissions.ts:8-41`）：
`isAdmin = user.role === "ADMIN"` 短路 → `hasPermission(code)` 查 `user.permissions`。
`RequireAdmin` 专给后端硬编码 ADMIN 的接口。

**隐藏而非禁用**是多数派：`<RequirePermission permissions="…">` 无 fallback = 不渲染，40 处。
由权限决定 `disabled` 的只有 1 处。

> **`[test:permissionGatesActuallyWithhold]` 双向断言**：无码名时不在 DOM，有码名时在。
> `[test:suiteShape:256]` 另外规定「never stubs the permission gate itself」——
> **不许 mock 权限门本身**。

**页级门只有 11 页有**（`fallback={<PermissionDenied />}`），26 页没有。
`judgment:181-184` 写了理由：**侧栏只藏链接、不挡路由** —— `useSidebarMenus` 按后端
`visible` 字段过滤，不校 codename。所以页级门是必要的，不是冗余。

---

## 8. 枚举与领域值的显示契约（BRIEF §4.6）

**四个组件是唯一出口**（`src/components/ui/DomainValue.tsx`）：

| 组件 | 规则 |
|---|---|
| `<DomainEnum namespace value>` | 译文进文本节点，**原始成员进 `title`**；未识别成员斜体 + `t("common.value.unrecognized")`；缺值转 `MissingValue` |
| `<MissingValue kind="unrecorded\|inapplicable" reason>` | **三种缺失三种字形**：`—`（未记录）/ `0`（真的是零）/ `·`（不适用），各配自己的 ink。`title` 与 `aria-label` 同串 |
| `<DomainNumber signed toned>` | **零永不带号** |
| `<DomainText>` | 空串/null → 缺值 |
| `<IdentifierChip>` | UUID 唯一出口："详情页头、可复制、一次、绝不代替名字"。例外登记在 `IDENTIFIER_POLICY_EXCEPTIONS`，现有两条（ledger、death-sync） |

**执法**（`[test:domainDisplayContract]` 扫源码 + `[test:domainDisplayRendering]` 渲染）：

- JSX 里不许出现 `{x.civilization}` 这类 `ENUM_FIELDS` 原值
- 不许手写 `"—"`（例外需登记行号）
- 每个字串形态枚举渲染上方最近的 `title=` **必须是原始成员**（不是 `t("some.key")`）
- **`domainDisplayRendering` 明确禁止 stub `DomainEnum`** —— 因为
  `DomainEnum: ({value}) => <span>{value}</span>` 这个 stub 会**逐字复现被测的缺陷**，
  于是测试测的是 stub
- 三份 bundle 每个 namespace 的成员集合必须相同（`[test:domainNamespaceContract]`）

> 曾经的"domainDisplayContract 42 条测试"记录已失效 —— `d80ac68` 把它拆成三份，
> 42 现在既不等于其中任何一份，也不等于合计。

---

## 9. i18n

三份 bundle 在 `packages/core/messages/{zh-Hans,en,egy}.json`。
【实跑】**各 1350 个叶键**（三份一致）。`egy` 对外声明 BCP47 = `en`。

> `BRIEF.md:289` 写「886 keys per bundle」，`tables/README.md:29` 写 1275。两个都是旧数。

**最容易踩的一条：`t(key)` 找不到键时返回键本身，永不返回 undefined。** 所以：

```tsx
t("x.y") || "English"        // ❌ 右侧不可达。现存 92 处
tf("x.y", "中文兜底")         // ✅ 真的会兜底。现存 52 处
```

92 处不可达兜底集中在 `UserModal.tsx`(24)、`SettingsDrawer.tsx`(11)、
`UserDeleteDialog.tsx`(10)、`CommentThread.tsx`(8)。

**漏翻的裸字串（实例）**：`Modal.tsx:82 aria-label="Close"`、
`EditableNode.tsx:80,88 title="通过"/"否决"`、`(auth)/layout.tsx:5` 标题、
`audit/page.tsx:20-27` 的英文 label、`dashboard:450` 的 `"action"/"actions"` 英文复数。

**日期**：`useI18n().formatDate/formatDateTime`（55 处），历史日期走
`formatHistoricalDate(value, locale)`（6 处）。`recycle-bin:149` 是唯一直接
`toLocaleString()` 的。

**执法**：`[test:messageValuesAreNotTheirOwnKeys]`（文案不得等于自己的键、不得为空、
末段不得当文案）、`[test:domainNamespaceContract]`、`[test:civilizationCopyCoverage]`。

**没有执法的**：key 前缀约定（`AGENTS.md:161-168`）、"新增 key 三份同时加"
（三份计数一致 1350 是**实测，不是断言**）、"文案不得烙进布局宽度"
（中文是英文宽度的 40–60%，egy 更长）。

**导航是数据库内容，永远中文** —— 不走 bundle（`ADDENDUM.md:63-82`）。

---

## 10. 无障碍

| 规则 | 执法 |
|---|---|
| **jsx-a11y recommended 全套 34 条 + `label-has-associated-control`，全部 `error`** | `[eslint]`（测试文件除外；`no-autofocus` 仅对 4 个对话框文件关闭） |
| 全局 `:focus-visible { outline: 2px solid hsl(var(--color-focus)) !important }`。**不得用 `--color-accent`** —— 用户可运行时改写它，且浅色下只有 2.14:1，不过 WCAG 1.4.11 | **`[test:focusRingContract]`** 断言规则存在、带 `!important`、只点名 focus token、在全部表面上 ≥3:1 |
| `prefers-reduced-motion: reduce` 下动画/过渡收敛到 **1ms，不是 `none`**（Base UI 等靠 `transitionend` 卸载）。spinner 不豁免 | **`[test:reducedMotionContract]`** 断言不含 `none` 且仍有动效可压 |
| JS 驱动的动效（gsap / recharts）在 `lib/motion.ts::prefersReducedMotion()` 读偏好 | `[test:workflowAutoLayoutMotion]` + `[e2e]` |
| 所有文字 ≥ AA 4.5:1 | `[test:inkOnSurfaceContract]`（4 主题 × 租户 × 表面 × ink = **128 对**）、`[test:civIdentityInkContract]`（32 对）、`[test:dataGridToneContract]`（badge 填充 ≤0.1 alpha） |
| 不得只靠颜色传达状态 | `[test:selectionIsNotColourOnly]`（侧栏 `aria-current`、折叠时有名字） |
| 截断的数据值必须带 `title` | `[test:truncatedValuesAreRecoverable]` —— 自述**触摸层仍无覆盖** |
| `role="menu"` / `"listbox"` 必须兑现键盘契约 | `[test:gridPopupKeyboardContract]` |
| viewport meta 不设 `maximumScale` / `userScalable:false` | `[文字]` |

计数：`aria-hidden` 66、`aria-label` 63、`aria-expanded` 14、`aria-pressed` 9、
`role="alert"` 30、`role="status"` 24。

**标签条用 `aria-pressed` 而非 `role="tab"`**（理由写在 `social:120-128`）—— 但
`judgment:88-95` 和 `workflow:143-152` 没写 `aria-pressed`，`selectionIsNotColourOnly.test.tsx:31-35`
自述 `app/social` 两处"没有覆盖"。

---

## 11. 响应式

Playwright 三个 project：chromium / firefox / **mobile-chrome = Pixel 5（393px）**。
`ci.yml` 的 matrix 三条腿都跑 —— **`CLAUDE.md` 此前只给了 chromium，于是"跑过 E2E"
在本地和在 CI 是两件不同的事**。393px 下工作流工具栏按钮压在输入框上那条真缺陷，
在 main 上待了一整轮，因为没人跑过那个 project。

**E2E 跑构建产物**（`start:e2e` = `next start`），**必须先 `npm run build`**。
理由在 `playwright.config.ts` 的注释里：dev server 按需编译，于是
`waitForLoadState("networkidle")` 等的是"编译完没有"；实测同一份代码连跑三次，
失败 3/4/2 条且中招路由每次都换。换成构建产物后三个 project 各 108 passed，快三倍。

> `CONTRIBUTING.md:54` 只写 `npm run test:e2e`，**没说先 build**。

### 页面里的实际写法

- 37 页里**只有 12 页含任何响应式类**。25 个列表页是 0 —— 它们靠 `DataTable` 的
  `overflow-x-auto` 和 `PageShell` 筛选栏的 `overflow-x-auto h-14`
  （`PageShell.tsx:257-261` 的注释记录了 393px 下 738px 撑宽全文档的事故）
- 网格多数派：`grid grid-cols-1 lg:grid-cols-2|3`、`grid-cols-2 md:grid-cols-4`
- 侧栏+主体：`flex flex-col gap-6 lg:flex-row` + `lg:w-80 lg:shrink-0`
- 壳层：侧栏在 `md` 以下是 `-translate-x-full` 抽屉 + `md:hidden` 遮罩/汉堡；
  masthead 右侧用 `hidden sm:block` 逐项丢弃（9 处）
- 弹窗用 `max-h-[calc(100dvh-2rem)]`（`Modal.tsx:73-75` 写了用 dvh 的理由）
- **没有 `useMediaQuery` 类 hook**；`matchMedia` 只在 `lib/motion.ts` 与 `ActionsMenu.tsx`

**`[e2e:no-route-overflows-the-document]`**：26 条静态路由**没有哪条**让
`documentElement.scrollWidth > clientWidth`。
**`[e2e:off-screen-motion-does-not-widen-the-document]`**：屏外滑入动效在 240ms 内不得撑宽文档。

---

## 12. 门禁与测试

```bash
nvm use                                    # node >= 20.9.0，.nvmrc 钉 20.19.5
cd frontend && npx tsc --noEmit
cd frontend && npm run lint                # = eslint . --max-warnings 0
cd frontend && npm run build
cd frontend && npm run test:coverage       # 不是 npm test！

npm run --workspace packages/core typecheck
npm run --workspace packages/core lint
npm run --workspace packages/core test     # vitest —— CI 不跑这条，pre-push 跑

cd frontend && npm run build                        # E2E 前必须
cd frontend && npx playwright test --project=chromium
cd frontend && npx playwright test --project=firefox
cd frontend && npx playwright test --project=mobile-chrome
```

**`npm test` 不检查覆盖率门。** `jest.config.js:88` 有 `coverageThreshold` 却没有
`collectCoverage`，阈值**只在传 `--coverage` 时才评估**。实测裸 `npm test` 输出里
"coverage" 出现 0 次。【实跑】阈值现值：**branches 46 / functions 44 / lines 55 / statements 54**
（`jest.config.js:88-95`，注释解释了为什么留一个点的余量）。

**pre-push 的 jest 是 `--coverage=false`** —— 阈值只在（手动触发的）CI 上评估。

**`npm run lint` 2026-09-05 起才是 `--max-warnings 0`。** 此前是裸 `eslint .`，
于是 **warning 不改变退出码**：唯一会拦 warning 的是 pre-commit 钩子里那条，而它只扫暂存文件。
结果是本地提交被挡、CI 却绿。真踩过一次。

**测试套件的形状本身被钉住**（`[test:suiteShape]`）：逐名钉住文件集合、禁 `.only`/`.skip`、
声明数不许减少。**契约测试的通用写法**：先断主体集合非空（`SOURCE_FILES.length > 30`），
再断缺失 —— 防止"永远不会触发的检查"。

**node 版本坑**：v18.20.8 下 `next build` 直说需要 >=20.9.0，但 `packages/core` 的 vitest
报的是 `SyntaxError: 'node:util' does not provide an export named 'styleText'` —— 那句话
不指向版本。

---

## 13. 只是文字、没有执法的规则（已 grep 求证）

| 规则 | 出处 |
|---|---|
| 组件 PascalCase / hook camelCase **文件名** | `CONVENTIONS.md:39-53`。无 filename 规则、无测试 |
| **Query key 必须走工厂** `usersKeys.list()`，禁 `["users"]` 字面量 | `CONVENTIONS.md:55-67`。【实跑】`app/` `src/` 非测试代码里 `queryKey: ["…"]` 字面量 **59** 处，零规则 |
| **导入顺序** | **仓库内任何文档都没写**，`eslint-plugin-import` / `simple-import-sort` 未安装 |
| 禁 `shadow-*` | `AGENTS.md:17`。`no-raw-palette` 只管 `shadow-<色名>-<档>`，`shadow-lg/xl/xs` 与任意值阴影不在任何规则里。【实跑】7 个文件 8 处在用 |
| 禁 `bg-white` / `bg-black` | `AGENTS.md:23`。`RAW_PALETTE` 只匹配带数字档的色阶。`text-black` 45 处 / `text-white` 17 处（primary 按钮文字与遮罩是有意的） |
| 衬线只用于"某人说过的话" | `DESIGN.md:59-63`。无规则检查 `font-serif` 的使用位置 |
| `--container-page/prose` 与 z 轴三档 | `globals.css:206-218`。旧值 `max-w-5xl/6xl` 12 处、`z-10…z-50` 26 处 |
| `--color-status-*` 不得内联进 JSX 三元 | `statusTokenLayering.test.ts:56-61` 自述"~60 处，一个真实缺口" |
| 触摸端读取被截断值 | `truncatedValuesAreRecoverable.test.ts:19-21` 自述"这一层仍然没有覆盖" |
| 500 行上限 | `CLAUDE.md:11-24`。无 `max-lines`，自述"applied by eye" |
| Git 提交格式 | 2026-09-06 起唯一权威是 `CLAUDE.md` 的 `## Git`（另两份是指针）。仍**无执法**：`.git/hooks/` 没有 commit-msg |
| i18n key 前缀 / 新增 key 三份同加 | `AGENTS.md:161-168,349-355`。无 key 集 parity 的独立测试 |
| 文案不得烙进布局宽度 / n=0,1,10000 都要成立 | `BRIEF.md:287-291,313-315` |
| `.pre-commit-config.yaml` 的 prettier / eslint-mirror | 框架未装，prettier 不在任何 devDependencies，无 `.prettierrc` |
| coverageThreshold | 只在手动触发的 CI 评估；pre-push 用 `--coverage=false` |
| E2E 三 project | pre-push 不跑，CI 手动 —— **唯一的自动执行点为空** |

---

## 14. 文档之间 / 文档与配置矛盾

> **2026-09-06 修掉了其中 6 条**（下面标 ✅）。修的原则是：只改**非冻结**文档与注释里
> 我核实过的事实错误，不改任何会影响行为的配置。`docs/design-handoff/` 整包冻结
> （`docs/README.md:196`），其中的错误一律不动，只在这里记明。

1. ✅ **设计系统整体** —— 根 `AGENTS.md:9-70`（Linear 风格、圆角、amber、`text-sm`）
   vs `globals.css` + 六条 eslint error。**§1 已重写**为指向 globals.css 的三条要点。
2. ✅ **弹窗库** —— `AGENTS.md:74-118` 说 @headlessui vs 实况 Base UI。**§2 已重写**
   为五段 anatomy。`BRIEF.md:277`（冻结）与 `reducedMotionContract.test.ts:13-16`
   的注释仍是旧的。
3. ✅ **技术栈版本** —— `AGENTS.md:279-283`「Next.js 14 / Tailwind 3.x / @headlessui 2.x」
   vs 实况 next ^16.2.7 / tailwindcss ^4.3.3 / @base-ui/react。**已更正**，并补了
   workspaces 说明。
4. ✅ **Dialog z 轴** —— `AGENTS.md` 曾写 `z-[10000]` vs `globals.css:213-215` dialog=80。
   **已随 §2 重写更正。**
5. ✅ **Git 提交格式三处不同** —— `CLAUDE.md` 带 scope；`CONTRIBUTING.md` 带 scope
   但 types 无 `style`；`AGENTS.md` **无 scope**、types 无 `chore`/`ci`。
   **2026-09-06 收敛到 `CLAUDE.md` 的 `## Git`**，另两份改为指针。判据是实测：
   818 条提交里带 scope 543 / 不带 250，`CLAUDE.md` 的八个 type 覆盖 95.4% ——
   三份里它最接近实践，且它是唯一每次会话自动加载的文件。落在八类之外的
   `merge`(21)/`i18n`(4)/`security`(3)/`perf`(3)/`build`(3) 合计不到 5%，
   **刻意不收进清单**：为长尾扩表只会让清单再次脱节。
5b. ✅ **`showToast` 签名** —— `AGENTS.md` 曾写 `showToast({type, title, message})`，
   实为位置参数 `showToast(message, type?, duration?)`（`Toast.tsx:131-135`）。
   照文档写会把一个对象当字符串渲染。**已更正**，并补了 `notify` 端口的说明。
6. ✅ **`tokens.md`** —— **`docs/design-handoff/` 四份文件里，只有这一份该改。**
   这个包内部有一套自己的区分，别一锅端：

   | 文件 | 自我声明 | 该不该动 |
   |---|---|---|
   | `tokens.html` | 顶部：「point-in-time snapshot, not a reference … **Do not build against this page**」 | **绝不要动。**里面的旧值是**记录**，不是错误。`tokens.md` 开头专门写了一段禁止「修正」它 |
   | `BRIEF.md` | `Date: 2026-08-02` 的简报 | 不动。「三个文明」「886 keys」是那天的事实 |
   | `ADDENDUM.md` | §7 标题即「这份追补停在 2026-08-23」 | 不动。边界是它自己声明的 |
   | `tokens.md` | 「Everything below is the **current** state」 | **有对账义务**，且 2026-08-26 真的对过一次账 |

   **2026-09-06 已对账**：31 行颜色表 × 两个主题 = 62 个值逐个核过，**只错 1 个**
   （`--color-accent-ink` light 34% → 31%）。漂掉的全在表格之外：动效栏写「仍然没有」
   而三档时长/两条缓动/八个 `--animate-*` 早已落地（并据此把动效列进「还需要提案」——
   在让设计师做一套已完成的活）；`a` 的 hover 目标与时长两项都错（实为 `accent-ink` /
   160ms）；`--color-civ-mark` 写「只有一处消费」而实测至少四处；全节援引已不存在的
   `tailwind.config.js`。另补了从未登记的 `--color-focus`。

   > 这一条此前把 `tokens.md` 和冻结件并列成一串「矛盾」。按那个写法读，会有人去改
   > `tokens.html` —— 而那正是 `tokens.md` 明文禁止的。**"这份文档过时了"不是一个
   > 单一判断**：要先问它有没有声称自己是当前态。冻结件的旧值是资产，活文件的旧值是缺陷。
7. **BRIEF 与后续** —— 「三个文明」vs 四个；「886 keys」vs 1350；
   「Server-rendered pages」vs 37/37 client；「domainDisplayContract 42 条」已失效。
8. ✅ **`eslint.config.mjs` 自相矛盾** —— `:17-19` 说 `npm run lint` 是裸 `eslint .`
   vs `:487-490` 说那个不对称 2026-09-05 关掉了（`package.json:13` 证实后者）；
   `:52` 的基线数字是旧数；`:300` 的报错文案指向不存在的文件。
   **三处已修**：`:17-19` 改为记录理由被推翻后重估的结果（**结论保留，因为"几百行
   黄字没人读"仍然成立**）；`:52` 的条目数**整个删掉**而不是更新 —— 手写的计数每迁
   一个文件就变一次，注释不会跟着变；`:300` 改指 `app/globals.css` 的 `@theme`。
   `:622` 的「44 个文件 / 287 处」是**过去时的叙述**（讲那个统计当初漏了 `components/`），
   保留不动。
9. **pre-commit 注释** —— 说「eslint config ignores `src/__tests__/**`」
   vs `eslint.config.mjs:441`「不再被忽略」。
10. **`AGENTS.md:173`** 说 Footer 象形文字按语言显示 —— 三份 bundle 圣书体字符 **0 个**，
    `𓋴` 在 `7bd1e8c` 已删。
11. **`AGENTS.md:174`** 说语言切换器用下拉菜单 vs `BRIEF.md:198-199` 把
    「native unstyled `<select>`」列为**缺陷**；现状 `LanguageSwitcher.tsx:25-38`
    仍是原生 `<select>`（且带 `text-sm`，在基线里）。
12. ✅ **`CONTRIBUTING.md:37`** 的 `PageSection` + `TableSkeleton` vs 实况 41 / 6 / **0**。
    **已更正**为 `PageShell`，并补了"颜色只有一种拼法"与 E2E 必须先 build 两条。
13. **CI 与 pre-push 对 core 的覆盖不同** —— CI 不跑 core vitest（`domBoundary` 就在那里）。

---

## 15. 页面之间现存的不一致（"你会看到两三种写法"清单）

除 §5 的三态外：

| 事项 | 现状 |
|---|---|
| **分页四种** | `DataTable` 内置 `<Pagination>`（8 页）/ `PageShell pagination` 槽 + `showInfo={false}`（social）/ 同一槽自拼两个 `<Button>`（tenants 用 `secondary sm` 带箭头、corpus 用 `ghost sm` 无箭头）/ 不用槽、把 `<Pagination>` 塞进 `PageSection` 两次（dispatch） |
| **返回链接五种** | `<a>` + `ink-muted` / `<Link>` + `ink-muted` / `<Link>` + `accent-ink hover:underline` / `<Link text-02>` 无箭头 / `<Button ghost onClick={router.back()}>` |
| **数据获取** | 26 页直接 `useQuery`，7 页走 `@soulledger/core/hooks`，`souls/[id]` 混用。`queryKey` 手写 45 处 vs 工厂 14 处。`enabled: !!user` 守卫 12 页有、其余没有。300ms 去抖 `useEffect` 三处逐字复制 |
| **表单控件三层** | `Field` 家族 47 处 / 裸 `fieldControl()` 15 处 / **完全手写 className 的 `<input>` 25+ 处**（`Modal.tsx:242` 用 `border-red-500`、`SoulEditModal.tsx:115` 用 `bg-amber-500`）。字段错误文字有 `text-red-500` / `text-red-400` / `--color-status-error` 三种 |
| **状态徽章同一枚举两套上色** | dispatch 列表用 `Badge tone`、详情用 `--color-status-*` 映射（文件注释明说两套并存）；灵魂状态列表包 `<Badge px-2 py-0.5 text-02>`、详情包裸 `<span BADGE_SHAPE="px-2 py-1 text-01">` |
| **标签条** | 5 文件用 `TAB_BASE/ON/OFF`（`px-4 py-2`），social 两处手写同配方但 `px-3 py-2`；`aria-pressed` 四处写两处没写；tab 状态只有 dashboard 存 URL `?tab=`，其余全 `useState` |
| **卡片配方** | `surface-1 p-4 border hairline` 21 处 vs `surface-1 border hairline p-4` 18 处（同一组类两种顺序）；另有 `p-6` 5 / `p-5` 4 / `p-3` 2 |
| **区块标题** | `<h2 text-01 uppercase ink-subtle mb-4>` 7 处（全在 dashboard）vs `<h2 text-06>` 八种变体，**其中一半多写了 `font-semibold`** —— `text-06` 已含 600 weight |
| **日期** | `formatDate/formatDateTime` 55 处；notifications 与 dashboard 各自再包一层；`recycle-bin:149` 直接 `toLocaleString()` |
| **页级门** | 11 页有 `PermissionDenied`（居中 🔒 `h1`），`audit` 改用左对齐 `EmptyState` 并保留页头，26 页无门 |
| **硬编码颜色** | hex 非注释约 20 行（`global-error.tsx` 7 行是有意脱离 token；`SettingsDrawer` accent 预设；`WorkflowEditor` 2 处）；Tailwind 调色板类 14 行；脱离八档的字号 `not-found.tsx:12 text-2xl`、`LanguageSwitcher.tsx:17,29 text-sm` |

---

## 16. 本文件数字的复核命令

```bash
cd /Users/tardis/Downloads/SoulLedger/frontend
python3 -c "import json;d=json.load(open('eslint.design-guard-baseline.json'));print(len(d), sum(sum(v.values()) for v in d.values() if isinstance(v,dict)))"
find app -name 'page.tsx' | wc -l
grep -rlE "^[\"']use client[\"']" app --include='page.tsx' | wc -l
grep -rnE 'queryKey: \[["'"'"']' app src components lib --include='*.tsx' --include='*.ts' | grep -v __tests__ | wc -l
for c in PageShell PageSection TableSkeleton; do echo -n "$c: "; grep -rl "$c" app --include='*.tsx' | wc -l; done
grep -rlE 'shadow-' app src components lib | grep -v __tests__
for f in ../packages/core/messages/*.json; do echo -n "$(basename $f) "; python3 -c "
import json
def flat(o): return sum(flat(v) if isinstance(v,dict) else 1 for v in o.values())
print(flat(json.load(open('$f'))))"; done
sed -n '88,95p' jest.config.js
```

**这些数字会随代码变化。** 写在这里是为了让"某处 N 个"这类断言可被推翻 ——
`eslint.config.mjs` 里同时躺着「35 文件/564 条」和「44 文件/287 处」两个旧数，
而实况是 28/94，就是不复核的代价。
