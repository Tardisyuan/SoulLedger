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

/**
 * 要求输入名称才能确认的对话框。加一项之前先确认它真的要输入名称。
 * 权限矩阵的保存确认(`MatrixSaveConfirmModal`)仍要逐个输入角色名,但它的确认键是主按钮
 * (用户 2026-10-02,Design A6):保存权限可以再改回来,不是删除。所以它不在这张表里 ——
 * 输入名称是 danger 的必要条件,不是充分条件。下面最后一条钉住它仍要输入角色名。
 */
const TYPED_NAME_DIALOGS = [
  // v2/web-p3b(cd5c6880)新建的通用「输入名称以确认」对话框;合入前本分支没有这个文件。
  "src/components/admin/NameConfirmDialog.tsx",
  // 管理员「重置两步验证」(A12):理由必填之外,还要输入被重置账号的用户名才解锁确认键(`typed.trim() === user.username`);
  // Design 定稿保留红色确认键。
  "src/components/users/MfaResetDialog.tsx",
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
    expect(users).toContain("src/components/admin/NameConfirmDialog.tsx");
  });

  it("no other file asks for variant=\"danger\"", () => {
    const allowed = new Set(TYPED_NAME_DIALOGS);
    expect(users.filter((f) => !allowed.has(f))).toEqual([]);
  });

  // 2026-09-30 用户拍板:没有名称的不可撤回删除(删帖、删评论、多选删敏感词)用普通确认框,
  // 不让人输入动作词「删除」。所以 NameConfirmDialog 要输入的 `name` 必须是被删对象自己的名字
  // (词、标题、用户名、权限码……),不能是一条翻译出来的文案 —— `t(...)` 就是动作词的样子。
  it("NameConfirmDialog is only asked to type a real name, never a translated word", () => {
    const offenders: string[] = [];
    let dialogs = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<NameConfirmDialog\b([\s\S]*?)\/>/g)) {
        dialogs += 1;
        const name = /\sname=\{([^\n]*)\}\s*$/m.exec(m[1])?.[1] ?? "";
        if (/\bt\(/.test(name)) offenders.push(`${path.relative(FRONTEND, f)}: name={${name}}`);
      }
    }
    expect(dialogs).toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });

  // 用户 2026-10-02:矩阵保存确认的确认键是主按钮,但仍然要逐个输入角色名才可用。
  it("the matrix save confirm is a primary button that stays disabled until every role name is typed", () => {
    const modal = readFileSync(path.join(FRONTEND, "src/components/permissions/MatrixSaveConfirmModal.tsx"), "utf8");
    const confirm = /<Button\b[^>]*?onClick=\{onConfirm\}[^>]*>/.exec(modal)?.[0] ?? "";
    expect(confirm).toMatch(/variant="primary"/);
    expect(confirm).toMatch(/disabled=\{[^}]*!canConfirmSave[^}]*\}/);
    expect(modal).toMatch(/id=\{`type-confirm-\$\{diff\.role\}`\}/);
    const cells = readFileSync(path.join(FRONTEND, "src/components/permissions/useMatrixCells.ts"), "utf8");
    expect(cells).toMatch(/canConfirmSave = tier3\.every\(\(d\) => \(typedRoleNames\[d\.role\] \?\? ""\)\.trim\(\) === d\.role\)/);
  });

  it("ConfirmDialog never asks for a name, so its default danger renders as secondary", () => {
    const modal = readFileSync(path.join(FRONTEND, "src/components/ui/Modal.tsx"), "utf8");
    const table = modal.slice(modal.indexOf("const variantButton = {"));
    expect(table).toMatch(/^const variantButton = \{\s*danger: "secondary",/);
  });
});
