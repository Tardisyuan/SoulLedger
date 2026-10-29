/**
 * 菜单按钮配置页「也需要权限」一列抄的是 `WIRED_BUTTONS[].permission`(rbac-web L-3)。那一列只有在
 * **每个**问配置的按钮旁边真有那道码门时才是真话:灵魂列表的导出曾经只问配置、不看 `soul.read`;
 * 审判队列「待审」页签的导出曾经连配置都不问(M-5)。
 *
 * 规则:源码里每个 `buttonOn("<id>")` 的文件也写出了 `<id>` 的权限码;灵魂批量条的导出走页面算好的
 * `canExport`(同一个判断)。
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

const callSites = [...sources(path.join(FRONTEND, "app")), ...sources(path.join(FRONTEND, "src"))].flatMap((file) => {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/buttonOn\("([^"]+)"\)/g)].map((m) => ({ file: path.relative(FRONTEND, file), id: m[1], text }));
});

it("every wired button is asked about somewhere, including the claim queue's export", () => {
  const asked = new Set(callSites.map((c) => c.id));
  for (const b of WIRED_BUTTONS) expect(asked).toContain(b.id);
  expect(callSites.filter((c) => c.id === "judgment.export").map((c) => c.file)).toEqual(
    expect.arrayContaining(["app/judgment/page.tsx", "src/components/judgment/JudgmentClaimQueue.tsx"])
  );
});

it("each file that asks the config for a button also gates it on the code the config page names", () => {
  const missing = callSites
    .filter((c) => !c.text.includes(`"${PERMISSION.get(c.id)}"`))
    .map((c) => `${c.file}: ${c.id} without "${PERMISSION.get(c.id)}"`);
  expect(missing).toEqual([]);
});

it("the souls batch bar's export uses the page's canExport, not an ungated button", () => {
  const bar = readFileSync(path.join(FRONTEND, "src/components/souls/SoulBatchBar.tsx"), "utf8");
  expect(bar).toMatch(/\{canExport && \(\s*<Button[^>]*onClick=\{exportCsv\}/);
  const page = readFileSync(path.join(FRONTEND, "app/souls/page.tsx"), "utf8");
  expect(page).toMatch(/const canExport = buttonOn\("souls\.export"\) && hasPermission\("soul\.read"\);/);
  expect(page).toContain("canExport={canExport}");
});
