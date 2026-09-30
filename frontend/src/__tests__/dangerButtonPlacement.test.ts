/**
 * 实底红的「危险」按钮只出现在「输入名称以确认」的对话框里(规范 v2 补足 A1:
 * 「永远带 ✕ 和动作文字;只出现在『输入名称以确认』的对话框里」;交互与动效第 2 轮 6c)。
 *
 * 为什么是源码扫描:`variant="danger"` 放在哪是调用点的事,`Button` 管不了 —— 它只管长相。
 * 2026-09-30 收回前全仓有 22 处,其中只有一处(权限矩阵保存,要逐个输入角色名)真的要求
 * 输入名称;其余是删除、驳回、取消、退出登录,甚至批量「移入回收站」。
 *
 * NO CLASS NAME IS WRITTEN OUT HERE (tailwind scans `src/**`, tests included).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const FRONTEND = path.join(__dirname, "..", "..");
const ROOTS = ["app", "components", "src"];
const SKIP = new Set(["node_modules", ".next", "__tests__", "coverage"]);

/** 要求输入名称才能确认的对话框。加一项之前先确认它真的要输入名称。 */
const TYPED_NAME_DIALOGS = [
  "src/components/permissions/MatrixSaveConfirmModal.tsx",
  // v2/web-p3b(cd5c6880)新建的通用「输入名称以确认」对话框;合入前本分支没有这个文件。
  "src/components/admin/NameConfirmDialog.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** `variant="danger"`,或条件表达式里给 variant 的 `"danger"`。 */
const DANGER_USE = /variant=(?:"danger"|\{[^}]*"danger"[^}]*\})/;

const files = ROOTS.flatMap((r) => walk(path.join(FRONTEND, r)));
const users = files
  .filter((f) => DANGER_USE.test(readFileSync(f, "utf8")))
  .map((f) => path.relative(FRONTEND, f).split(path.sep).join("/"))
  .sort();

describe("solid danger buttons live only in type-the-name dialogs", () => {
  it("scans a real tree", () => {
    // A walker that finds nothing makes the next assertion vacuously green.
    expect(files.length).toBeGreaterThan(200);
    expect(users).toContain("src/components/permissions/MatrixSaveConfirmModal.tsx");
  });

  it("no other file asks for variant=\"danger\"", () => {
    const allowed = new Set(TYPED_NAME_DIALOGS);
    expect(users.filter((f) => !allowed.has(f))).toEqual([]);
  });

  it("ConfirmDialog never asks for a name, so its default danger renders as secondary", () => {
    const modal = readFileSync(path.join(FRONTEND, "src/components/ui/Modal.tsx"), "utf8");
    const table = modal.slice(modal.indexOf("const variantButton = {"));
    expect(table).toMatch(/^const variantButton = \{\s*danger: "secondary",/);
  });
});
