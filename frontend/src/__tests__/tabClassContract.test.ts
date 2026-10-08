/**
 * The bottom-rule tab is spelled in exactly one place.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * The string `px-4 py-2 text-sm font-medium transition-colors border-b-2
 * -mb-px` was written SIX times: five inline copies (judgment, dashboard,
 * workflow, and twice in workflow/[id]) and one that had already been given a
 * name in `app/notifications/page.tsx`. Naming it there also REORDERED the
 * active/inactive strings — `border-… text-…` where the five wrote
 * `text-… border-…` — so the sixth copy was independently reformatted while
 * still rendering identically. That is exactly the state `CIVILIZATION_ICONS`
 * was found in (1f68be0): equal values, drifted spelling.
 *
 * What makes it worth a guard rather than only a cleanup is WHICH token is in
 * there. `TAB_ON` names `--color-accent-ink`, and accent-vs-accent-ink is the
 * mistake this codebase keeps making one site at a time (globals.css's own
 * token note, `Badge.tsx:70-74`, `app/welcome/page.tsx:134-138`, and four
 * masthead hovers). Correcting one of six copies leaves five disagreeing, and
 * nothing anywhere goes red.
 *
 * ── WHY IT PINS THE SUBJECT SET, NOT JUST THE ABSENCE ─────────────────────
 * "No file contains this string" is clean when it scans nothing, which is the
 * failure mode `suiteShape.test.ts` names: a scanner that stops finding files
 * passes loudest. So the scan is required to (a) reach a floor of source files
 * and (b) FIND the string in `src/lib/tabClasses.ts` — the one file that is
 * supposed to have it. If the module is renamed or the constants inlined back
 * into it under another spelling, this reddens instead of quietly passing.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";

const FRONTEND_ROOT = path.join(__dirname, "..", "..");

/** The same roots and skips `cssTokenReferenceContract` and `statusTokenLayering` scan. */
const SOURCE_ROOTS = ["app", "components", "lib", "src"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__", "coverage"]);
const SOURCE_FILE = /\.(tsx?|css)$/;

/** The module that is allowed to spell it, relative to the frontend root. */
const HOME = path.join("src", "lib", "tabClasses.ts");

/** The geometry half of the recipe — the part all six copies shared verbatim. */
const GEOMETRY = "border-b-2 -mb-px";

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (SOURCE_FILE.test(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(path.join(FRONTEND_ROOT, root));
  return out;
}

const FILES = sourceFiles();

describe("the tab recipe is written once", () => {
  it("scans a plausible number of source files", () => {
    // The floor, without which every assertion below is vacuously green.
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("`src/lib/tabClasses.ts` is among them and does spell it", () => {
    // Presence, asserted before absence: this is what proves the scanner is
    // looking where it thinks it is.
    const home = FILES.find((f) => path.relative(FRONTEND_ROOT, f) === HOME);
    expect(home).toBeDefined();
    expect(readFileSync(home as string, "utf8")).toContain(GEOMETRY);
  });

  it("and nothing else does", () => {
    const offenders = FILES.map((f) => path.relative(FRONTEND_ROOT, f))
      .filter((rel) => rel !== HOME)
      .filter((rel) => readFileSync(path.join(FRONTEND_ROOT, rel), "utf8").includes(GEOMETRY));
    expect(offenders).toEqual([]);
  });
});

describe("the five strips read it from there", () => {
  /**
   * Pinned by name rather than counted. Adding one importer and dropping
   * another nets to zero under a count, and "a page stopped using the shared
   * recipe" is precisely the edit a count would wave through.
   */
  const EXPECTED_IMPORTERS = [
    "app/dashboard/page.tsx",
    // app/judgment/page.tsx 于 2026-09-25 离开(v1 分段切换),2026-09-30 回来:规范 v2 补足 B9
    // 把「待审 / 已结案」重新画成下划线标签(ink 600 + 2px ink,计数 11 等宽)。
    "app/judgment/page.tsx",
    // app/moderation/page.tsx 于 2026-09-25 离开:朋友圈审核四区(举报 / 敏感词 / 禁言 / 已处理)
    // 改成 E 组页头的分段切换(墨底为当前),与审判队列同一种写法。
    "app/notifications/page.tsx",
    // 2026-10-08:转生申请页的「转生申请 / 缩短冷却申请」两个页签(同审判队列的写法)。
    "app/rebirth-applications/page.tsx",
    // 2026-09-20:定时任务的「任务 / 运行历史」两个页签,第八条。
    "app/scheduler/page.tsx",
    // 2026-09-30(v2 第三批):动态与关注两页的页签此前各写一份强调色下划线,v2 没有强调色,
    // 改读这里的 A1 类名。
    "app/social/follows/page.tsx",
    "app/social/page.tsx",
    "app/workflow/[id]/page.tsx",
    "app/workflow/page.tsx",
    // 2026-09-29:助手管理的「配置与测试 / 实际用量」两个页签(两条路由,Link 而非 button)。
    "src/components/assist-admin/parts.tsx",
    // 2026-10-04:审计页的「操作记录 / 登录日志」与 Death-Sync 页的「登记 / API 密钥」页签(两条路由，同 assist-admin)。
    "src/components/audit/AuditTabs.tsx",
    // 2026-10-08:仪表盘「趋势」的区间与维度两组开关(aria-pressed,同仪表盘页签)。
    "src/components/dashboard/TrendsPanel.tsx",
    "src/components/death-sync/DeathSyncTabs.tsx",
    // 2026-10-02(A5):动态页右列「关注」卡的「关注中 / 粉丝」两个页签。
    "src/components/social/FollowPanel.tsx",
    // 2026-10-02(v3 A1):审批流编辑器检查器的「节点 / 出口 / 问题 / 版本」四个页签。
    "src/components/workflow/WorkflowEditorPanels.tsx",
  ];

  it("exactly these files import the module", () => {
    const importers = FILES.map((f) => path.relative(FRONTEND_ROOT, f))
      .filter((rel) =>
        readFileSync(path.join(FRONTEND_ROOT, rel), "utf8").includes('from "@/src/lib/tabClasses"')
      )
      .sort();
    expect(importers).toEqual(EXPECTED_IMPORTERS);
  });
});

describe("the selected tab is painted in ink (规范 v2 A1: no accent colour exists any more)", () => {
  it("TAB_ON draws its text and its 2px rule in --color-ink, weight 600", () => {
    expect(TAB_ON).toContain("text-[oklch(var(--color-ink))]");
    expect(TAB_ON).toContain("border-[oklch(var(--color-ink))]");
    expect(TAB_ON).toContain("font-semibold");
  });

  it("no tab class reaches for the retired accent or the plaque colour", () => {
    for (const cls of [TAB_BASE, TAB_ON, TAB_OFF]) {
      expect(cls).not.toContain("--color-accent");
      expect(cls).not.toContain("--color-main");
    }
  });

  it("TAB_OFF hovers to an ink3 underline and has a disabled state", () => {
    expect(TAB_OFF).toContain("hover:border-[oklch(var(--color-line-strong))]");
    expect(TAB_OFF).toContain("disabled:text-[oklch(var(--color-ink-subtle))]");
  });

  it("TAB_BASE carries the geometry and no colour", () => {
    expect(TAB_BASE).toContain(GEOMETRY);
    // `hsl(` until the OKLCH migration. Left as `hsl(` it would have become a
    // check that can never fire — the string exists nowhere in the app any
    // more — which is the failure shape this repository writes contract tests
    // to avoid, not to acquire.
    expect(TAB_BASE).not.toContain("oklch(");
  });

  it("TAB_BASE 的点击区至少 44(v3 控件高),字在多出的高度里居中", () => {
    // py-2 + text-sm 只有约 38。高度写 token,不写 h-11 / min-h-11(globals.css 的约定)。
    expect(TAB_BASE.split(" ")).toEqual(
      expect.arrayContaining(["min-h-(--control-h-sm)", "inline-flex", "items-center", "justify-center"]),
    );
  });
});
