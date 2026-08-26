"use client";

import { Permission, Role } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import type { GrantMap } from "./matrixDiff";

// ─────────────────────────────────────────────────────────────────────────
// Cell — shape, not weight: a filled check glyph vs a literally empty cell.
// No dot, no dash, no dim icon for "not granted" — that reads as "40 dim
// dots" across a wide matrix instead of a sparse, readable set.
// ─────────────────────────────────────────────────────────────────────────

function MatrixCell({
  granted,
  disabled,
  label,
  onToggle,
}: {
  granted: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={granted}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      // 这里原先是 `focus:outline-none focus-visible:ring-2
      // focus-visible:ring-[hsl(var(--color-accent))]` —— 全仓唯一一处把焦点环
      // 指向 --color-accent 的地方,而那正是 globals.css 用 40 行(:96-134)
      // 论证**不能**做的事:--color-accent 被 SettingsDrawer 的 useAccentColor
      // 以**内联样式**写在 document.documentElement 上,取值是用户在抽屉里随手
      // 挑的六位十六进制。内联样式压过样式表里的一切,所以一个挑了浅琥珀的用户
      // 会静默删掉自己**唯一**的键盘焦点指示器,而且无从察觉。第二条独立理由是
      // 它本身就不合格:hsl(38 92% 50%) 在浅色模式白底上是 2.14:1,连非文字
      // UI 的 3:1 底线都够不到。
      //
      // 两条 `outline-none` 也一起删了 —— 它们是全局规则要越过的那 69 处之一。
      // 删掉之后接管的是 globals.css:459 那条
      // `:focus-visible { outline: 2px solid hsl(var(--color-focus)) !important }`,
      // --color-focus 是字面量三元组(深 258 95% 76% / 浅 258 85% 48%),抽屉
      // 够不着它。本组件不写 outline-none,就是它参与全局焦点环的全部要求
      // (Button.tsx 的「FOCUS: deliberately not here」一节说的是同一件事)。
      className={`flex items-center justify-center w-full h-8 transition-colors ${
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-[hsl(var(--color-surface-3))]"
      }`}
    >
      {granted ? (
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-[hsl(var(--color-accent-ink))]" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M16.704 5.29a1 1 0 01.006 1.415l-7.4 7.5a1 1 0 01-1.42.005l-3.6-3.6a1 1 0 111.414-1.414l2.897 2.897 6.69-6.782a1 1 0 011.413-.021z"
            clipRule="evenodd"
          />
        </svg>
      ) : null}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// One category's sticky sub-header row + its permission rows. Split out so
// the render loop below stays readable.
// ─────────────────────────────────────────────────────────────────────────

function FragmentCategory({
  category,
  perms,
  visiblePerms,
  roleNames,
  checked,
  isSaving,
  onToggle,
  categoryTally,
}: {
  category: string;
  perms: Permission[];
  visiblePerms: Permission[];
  roleNames: string[];
  checked: GrantMap | null;
  isSaving: boolean;
  onToggle: (role: string, permId: number) => void;
  categoryTally: (perms: Permission[], role: string) => string;
}) {
  return (
    <>
      {/* `top-[44px]` 对着表头那一行的 h-11。z 值与表头同在一个层叠上下文里
          比较(sticky 挂在单元格上,不挂在 <tr> 上),所以角单元格 z-30 稳定地
          压在同行其它分类格 z-20 之上,而整行仍在表头 z-30/z-40 之下。 */}
      <tr>
        <td className="sticky top-[44px] left-0 z-30 bg-[hsl(var(--color-surface-2))] border-b border-[hsl(var(--color-hairline))] px-3 py-1 text-02 uppercase text-[hsl(var(--color-ink-muted))] font-semibold">
          {category}
        </td>
        {roleNames.map((role) => (
          <td key={role} className="sticky top-[44px] z-20 bg-[hsl(var(--color-surface-2))] border-b border-[hsl(var(--color-hairline))] px-2 py-1 text-02 text-center text-[hsl(var(--color-ink-subtle))] font-mono">
            {categoryTally(perms, role)}
          </td>
        ))}
      </tr>
      {visiblePerms.map((perm) => (
        /* 行悬停从 `surface-2/40` 换成不透明的 surface-2。冻结的那一列必须有
           不透明底色(否则横向滚过去的单元格会从它底下透出来),而一个不透明的
           格子拿不到 <tr> 的半透明底 —— 两边不同色就等于把「这一行」画成两段。
           所以整行改用同一个不透明值,冻结格靠 group-hover 跟上。 */
        <tr key={perm.id} className="group hover:bg-[hsl(var(--color-surface-2))]">
          <td className="sticky left-0 z-10 bg-[hsl(var(--color-canvas))] group-hover:bg-[hsl(var(--color-surface-2))] border-b border-[hsl(var(--color-hairline))]/50 px-3 py-1 transition-colors">
            <div className="font-mono text-02 text-[hsl(var(--color-ink))]">{perm.codename}</div>
            <div className="text-02 text-[hsl(var(--color-ink-subtle))]">{perm.name}</div>
          </td>
          {roleNames.map((role) => (
            <td key={role} className="border-b border-[hsl(var(--color-hairline))]/50 px-1 py-1 text-center">
              <MatrixCell
                granted={checked?.[role]?.has(perm.id) ?? false}
                disabled={isSaving}
                label={`${role} — ${perm.codename}`}
                onToggle={() => onToggle(role, perm.id)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * 冻结首列的权限矩阵。三样东西必须一起走,拆散就坏:sticky 挂在**单元格**
 * 上(不是 <tr>)、表格用 `border-separate border-spacing-0`(不是
 * border-collapse)、首列 `left-0` 冻结。理由写在下面 return 里那段注释。
 */
export function PermissionMatrixTable({
  matrixReady,
  roleNames,
  roleMeta,
  categories,
  allPerms,
  checked,
  isSaving,
  isVisible,
  onToggle,
  categoryTally,
}: {
  matrixReady: boolean;
  roleNames: string[];
  roleMeta: Record<string, Role>;
  categories: { category: string; perms: Permission[] }[];
  allPerms: Permission[];
  checked: GrantMap | null;
  isSaving: boolean;
  isVisible: (perm: Permission) => boolean;
  onToggle: (role: string, permId: number) => void;
  categoryTally: (perms: Permission[], role: string) => string;
}) {
  const { t } = useI18n();

  if (!matrixReady) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (roleNames.length === 0) {
    return <p className="text-03 text-[hsl(var(--color-ink-muted))]">{t("permissions.matrix.no_roles")}</p>;
  }

  return (
    /* 窄屏上真正坏掉的东西,和它不是什么。

       **原先那句 `overflow-y-auto` 已经能横向滚。** CSS Overflow 3
       规定:overflow-x/y 之一不是 visible 而另一个是 visible 时,
       visible 计算成 auto。所以 `overflow-y: auto` 会把 overflow-x
       一并算成 auto。实测(Playwright + Chromium,把这张表的结构
       照搬成静态页):`overflow-y:auto` 与 `overflow-x:auto;
       overflow-y:auto` 两个容器的 computed overflow-x 都是 "auto",
       scrollWidth 都是 1128 / clientWidth 400,把 scrollLeft 设成
       999 之后两边都停在 728。右边的角色一直够得到。

       坏的是**够到之后不知道自己在看哪一行**:第一列跟着一起滚走,
       于是滚到第 8 个角色时,那一列勾选框对应的是哪条 codename 没有
       任何东西还在说。所以修法不是加一个已经生效的 `overflow-x-auto`,
       是把第一列冻住。

       sticky 从 `<tr>` 挪到了单元格:sticky 元素各自开一个层叠上下文,
       挂在 <tr> 上时表头行、分类行、正文行是三个互不比较 z-index 的
       上下文,冻结列的角单元格无法可靠地压在表头之上。挂在单元格上时
       它们是同一个上下文里的兄弟,z-40 / z-30 / z-20 / z-10 直接可比。
       表格也从 border-collapse 换成 border-separate + border-spacing-0:
       collapse 下边框归表格而不归单元格,sticky 单元格滚动时边框会
       留在原地。 */
    <div className="overflow-auto max-h-[65vh] border border-[hsl(var(--color-hairline))]">
      <table className="w-full border-separate border-spacing-0 text-03">
        <thead>
          <tr className="h-11">
            <th className="sticky top-0 left-0 z-40 bg-[hsl(var(--color-surface-1))] border-b border-[hsl(var(--color-hairline))] text-left px-3 font-medium text-[hsl(var(--color-ink-muted))] min-w-[200px]">
              {t("permissions.matrix.codename_col")}
            </th>
            {roleNames.map((role) => (
              <th key={role} className="sticky top-0 z-30 bg-[hsl(var(--color-surface-1))] border-b border-[hsl(var(--color-hairline))] px-2 font-medium text-[hsl(var(--color-ink))] min-w-[110px] text-center">
                <div>{roleMeta[role]?.display_name || role}</div>
                <div className="text-02 font-normal text-[hsl(var(--color-ink-subtle))] font-mono">
                  {categoryTally(allPerms, role)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map(({ category, perms }) => {
            const visiblePerms = perms.filter(isVisible);
            if (visiblePerms.length === 0) return null;
            return (
              <FragmentCategory
                key={category}
                category={category}
                perms={perms}
                visiblePerms={visiblePerms}
                roleNames={roleNames}
                checked={checked}
                isSaving={isSaving}
                onToggle={onToggle}
                categoryTally={categoryTally}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
