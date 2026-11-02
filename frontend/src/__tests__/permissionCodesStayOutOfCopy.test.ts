/**
 * A permission code is an identifier, not a word: 「realms.manage · 容量可就地编辑」 showed one on the realms page. Copy names
 * the permission by `permission.names.<code>`. Input placeholders are the exception: there the code is what you type.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MESSAGES = join(__dirname, "..", "..", "..", "packages", "core", "messages");
const CODE = /(?<![\w.])(?:soul_account|soul|judgment|realms|menu|audit|scheduler|actors|dispatch|disposition|workflow|perm|capture|city_god|ledger|tenant|user|social)\.(?:manage|read|execute|approve|export|create|assign|delete|update|reject)(?![\w.])/;

function offenders(node: unknown, path: string): string[] {
  if (typeof node === "string") return CODE.test(node) && !/placeholder/.test(path) ? [path] : [];
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => offenders(v, path ? `${path}.${k}` : k));
  return [];
}

describe.each(["zh-Hans", "en", "egy"])("%s", (pack) => {
  const bundle = JSON.parse(readFileSync(join(MESSAGES, `${pack}.json`), "utf8"));

  it("shows no raw permission code in its copy", () => {
    expect(offenders(bundle, "")).toEqual([]);
  });
});

it("the rule can fail", () => {
  expect(offenders({ a: { hint: "realms.manage · x" } }, "")).toEqual(["a.hint"]);
  expect(offenders({ a: { hint_placeholder: "如 soul.read" } }, "")).toEqual([]);
});
