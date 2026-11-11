/**
 * 菜单按钮配置页「也需要权限」一列抄的是 `WIRED_BUTTONS[].permission`(rbac-web L-3)。那一列只有在
 * **每个**问配置的按钮旁边真有那道码门时才是真话:灵魂列表的导出曾经只问配置、不看码(现在是 `soul.export`,2026-10-29 从 `soul.read` 拆出);
 * 审判队列「待审」页签的导出曾经连配置都不问(M-5)。
 *
 * 规则:源码里每个 `buttonOn("<id>")` **附近**(上下 `WINDOW` 行内,注释不算)有一道判这个码的门 ——
 * `hasPermission("<码>")` / `has(Any|All)Permission(s)([…"<码>"…])` / `permissions="<码>"` / `permission="<码>"`,
 * 或一个绑定到这样一次调用的变量(`const canX = hasPermission("<码>")`,用的地方在窗口里)。
 * 门在子组件里的,写进 `DELEGATED` 并说明,在那个文件里查同样的门。灵魂批量条的导出走页面算好的 `canExport`(同一个判断)。
 *
 * 此前(审计 2026-11-11 G-04)只要同一文件**任意位置**出现 `"<码>"` 就算有门:注释里提到它、或同文件别的按钮
 * 用了同一个码,都算。`/souls/[id]` 的「删除」就是这样过的 —— 文件里唯一的 `soul.delete` 是「取消归档」的门。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { WIRED_BUTTONS } from "@/src/lib/menuButtons";

const FRONTEND = path.join(__dirname, "..", "..");
const PERMISSION = new Map<string, string>(WIRED_BUTTONS.map((b) => [b.id, b.permission]));

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Comments blanked out, newlines kept, so a line number in the result is a line number in the file. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_, lead: string) => lead);
}

const callSites = [...sources(path.join(FRONTEND, "app")), ...sources(path.join(FRONTEND, "src"))].flatMap((file) => {
  const text = stripComments(readFileSync(file, "utf8"));
  return [...text.matchAll(/buttonOn\("([^"]+)"\)/g)].map((m) => ({
    file: path.relative(FRONTEND, file),
    id: m[1],
    text,
    line: text.slice(0, m.index).split("\n").length - 1,
  }));
});

/** How far from `buttonOn("…")` the gate may sit (a `return null` early-out above a row menu is the farthest today). */
const WINDOW = 10;

/** A gate on `code` written out: the hook call, or the prop on <RequirePermission> / <RequireButton>. */
function gateOn(code: string): RegExp {
  const c = code.replace(/\./g, "\\.");
  return new RegExp(
    `has(?:Any|All)?Permissions?\\(\\s*\\[?[^)]*"${c}"|\\bpermissions?=\\{?\\[?[^>]*?"${c}"`
  );
}

/** Variables bound to a gate on `code` (`const canX = hasPermission("x")`). */
function gateVariables(text: string, code: string): string[] {
  const gate = gateOn(code);
  return [...text.matchAll(/^\s*const (\w+) = ([^;\n]+)/gm)].filter((m) => gate.test(m[2])).map((m) => m[1]);
}

function gatedNear(text: string, line: number, code: string): boolean {
  const lines = text.split("\n");
  const window = lines.slice(Math.max(0, line - WINDOW), line + WINDOW + 1).join("\n");
  if (gateOn(code).test(window)) return true;
  return gateVariables(text, code).some((v) => new RegExp(`\\b${v}\\b`).test(window));
}

/** Buttons whose gate is inside the component the page hands the callback to -> that component, and why. */
const DELEGATED: Record<string, { file: string; why: string }> = {
  "souls.delete": {
    file: "src/components/souls/detail/SoulHeaderActions.tsx",
    why: "页面只交 onDelete;「删除」菜单项由 SoulHeaderActions 按 soul.delete 自己决定画不画。",
  },
};

it("every wired button is asked about somewhere, including the claim queue's export", () => {
  const asked = new Set(callSites.map((c) => c.id));
  for (const b of WIRED_BUTTONS) expect(asked).toContain(b.id);
  expect(callSites.filter((c) => c.id === "judgment.export").map((c) => c.file)).toEqual(
    expect.arrayContaining(["app/judgment/page.tsx", "src/components/judgment/JudgmentClaimQueue.tsx"])
  );
});

it("each button asked about the config is gated, right there, on the code the config page names", () => {
  // The ids `judgment.export` / `disposition.export` / `dispatch.export` are spelled like their codes (2026-10-29);
  // `buttonOn("…")` is not a gate call, so it cannot count as one.
  const missing = callSites
    .filter((c) => {
      const code = PERMISSION.get(c.id)!;
      const delegated = DELEGATED[c.id];
      if (delegated) return !gateOn(code).test(stripComments(readFileSync(path.join(FRONTEND, delegated.file), "utf8")));
      return !gatedNear(c.text, c.line, code);
    })
    .map((c) => `${c.file}:${c.line + 1}: ${c.id} without a gate on "${PERMISSION.get(c.id)}" within ${WINDOW} lines`);
  expect(missing).toEqual([]);
});

it("the rule tells a gate from a comment, a far-away button, or the buttonOn call itself", () => {
  const at = (src: string) => {
    const text = stripComments(src);
    const idx = text.indexOf('buttonOn("x.export")');
    return gatedNear(text, text.slice(0, idx).split("\n").length - 1, "x.export");
  };
  const pad = "\n".repeat(WINDOW + 5);
  expect(at('{buttonOn("x.export") && hasPermission("x.export") && <B />}')).toBe(true);
  expect(at('{buttonOn("x.export") && <RequirePermission permissions="x.export"><B /></RequirePermission>}')).toBe(true);
  expect(at(`const canX = hasPermission("x.export");${pad}\n{canX && buttonOn("x.export") && <B />}`)).toBe(true);
  // Absence: a comment naming the code, the code on another button far away, and the call alone are not gates.
  expect(at('// hasPermission("x.export")\n{buttonOn("x.export") && <B />}')).toBe(false);
  expect(at('/* permissions="x.export" */ {buttonOn("x.export") && <B />}')).toBe(false);
  expect(at(`{buttonOn("x.export") && <B />}${pad}{hasPermission("x.export") && <C />}`)).toBe(false);
  expect(at('{buttonOn("x.export") && <B />} const label = "x.export";')).toBe(false);
});

it("every delegated button is still asked about, and its component still gates it", () => {
  const asked = new Set(callSites.map((c) => c.id));
  for (const [id, { file }] of Object.entries(DELEGATED)) {
    expect(asked).toContain(id);
    expect(stripComments(readFileSync(path.join(FRONTEND, file), "utf8"))).toMatch(gateOn(PERMISSION.get(id)!));
  }
});

it("the souls batch bar's export uses the page's canExport, not an ungated button", () => {
  const bar = readFileSync(path.join(FRONTEND, "src/components/souls/SoulBatchBar.tsx"), "utf8");
  expect(bar).toMatch(/\{canExport && \(\s*<Button[^>]*onClick=\{exportCsv\}/);
  const page = readFileSync(path.join(FRONTEND, "app/souls/page.tsx"), "utf8");
  expect(page).toMatch(/const canExport = buttonOn\("souls\.export"\) && hasPermission\("soul\.export"\);/);
  expect(page).toContain("canExport={canExport}");
});
