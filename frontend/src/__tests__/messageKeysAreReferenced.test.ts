/**
 * @jest-environment node
 *
 * 语言包里的每个键,要么有源码引用它,要么记在基线里(2026-11-08)。
 *
 * zh-Hans 是 web 首屏整份带上的(`I18nContext` 静态 import),约 400 KB;没人用的键照样下载。
 * 此前没有任何东西问「这个键还有人用吗」—— 键集契约只比三份包之间是否一致,删掉最后一处引用
 * 不会让任何东西变红。这里问一次:
 *
 *   引用 = 产品源码(web、core、灵魂端、官员端、后端;不含测试)里的
 *     1. 一个与键相同的字面量(`"souls.title"`);
 *     2. 以「.」结尾的字面量前缀(`"souls.state." + x`);
 *     3. 模板字面量(`souls.state.${x}`,每个 `${}` 当一段;以 `${}` 或「.」收尾时允许再多几段,
 *        因为它常被当命名空间传给 `DomainEnum` / `enumLabel`);
 *     4. 一个等于某个对象路径的字面量(命名空间,其下全部算引用);
 *     5. `<键>_by_civ.<文明>…` / `_by_realm.<码>…`:底键被引用就算(`civKey`、`nodeStateNamespace`)。
 *   再加 `support/messageKeysDynamic.json` 里按命名空间整体放行的(后端副本按运行时数据取的)。
 *
 * 剩下的全部列在 `support/messageKeysUnreferenced.json`。新加一个没人用的键 → 红;
 * 基线里的键有人用了、或已删掉 → 也红(把它从基线拿掉)。基线只该变短。
 *
 * 这是保守的扫描:它宁可把动态拼出来的键算作「有人用」,也不把它报成死键 —— 所以「不在基线里」
 * 不等于「确实有人用」,只等于「没法证明没人用」。删基线里的键之前,还要在测试、E2E、文档里搜一遍。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import zh from "@soulledger/core/messages/zh-Hans.json";
import dynamicNamespaces from "./support/messageKeysDynamic.json";
import baseline from "./support/messageKeysUnreferenced.json";

const { WEB_UNREAD } = require("../../lib/i18n/dropAppOnlyNamespaces.js") as { WEB_UNREAD: string[] };

const REPO = path.resolve(__dirname, "..", "..", "..");
const ROOTS = [
  "frontend/app",
  "frontend/src",
  "frontend/components",
  "frontend/lib",
  "frontend/demo",
  "packages/core/src",
  "mobile/src",
  "mobile/plugins",
  "mobile/App.tsx",
  "mobile-officer/src",
  "mobile-officer/App.tsx",
  "backend/apps",
  "backend/config",
];
const BUNDLES = new Set(["en.json", "zh-Hans.json", "egy.json"]);
const SKIP_DIRS = new Set(["node_modules", "__tests__", "tests", ".next"]);
const EXT = /\.(tsx?|jsx?|mjs|py|json)$/;
const TEST_FILE = /(\.test\.|^test_|^tests\.py$|^conftest\.py$)/;

function sources(): string[] {
  const out: string[] = [];
  const visit = (full: string) => {
    if (statSync(full).isFile()) {
      out.push(full);
      return;
    }
    for (const e of readdirSync(full, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) visit(path.join(full, e.name));
      } else if (!BUNDLES.has(e.name) && EXT.test(e.name) && !TEST_FILE.test(e.name)) {
        out.push(path.join(full, e.name));
      }
    }
  };
  for (const r of ROOTS) visit(path.join(REPO, r));
  return out;
}

const leaves: string[] = [];
const objects = new Set<string>();
(function walk(node: Record<string, unknown>, prefix: string) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") {
      objects.add(key);
      walk(v as Record<string, unknown>, key);
    } else leaves.push(key);
  }
})(zh as Record<string, unknown>, "");

const T1 = /(?<=["'`])([A-Za-z_][\w-]*(?:\.[\w-]+)+)(?=["'`])/g;
const T2 = /(?<=["'`])([A-Za-z_][\w-]*(?:\.[\w-]+)*\.)(?=["'`])/g;
const T3 = /`([^`\n]*)`/g;
const SEG = "[\\w-]+";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FILES = sources();
const exact = new Set<string>();
const prefixes = new Set<string>();
const patterns = new Set<string>();
for (const file of FILES) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(T1)) exact.add(m[1]);
  for (const m of src.matchAll(T2)) prefixes.add(m[1]);
  for (const m of src.matchAll(T3)) {
    const body = m[1];
    if (!body.includes("${")) continue;
    const parts = body.split(/\$\{[^}]*\}/);
    if (!parts.every((p) => /^[\w.-]*$/.test(p)) || !parts.some((p) => /[A-Za-z]/.test(p))) continue;
    const last = parts[parts.length - 1];
    patterns.add(`^${parts.map(escapeRe).join(SEG)}${last === "" || last.endsWith(".") ? "(?:\\.[\\w-]+)*" : ""}$`);
  }
}
const templates = patterns.size ? new RegExp([...patterns].map((p) => `(?:${p})`).join("|")) : null;
const namespaces = new Set([...exact].filter((e) => objects.has(e)));

function referenced(key: string): boolean {
  if (exact.has(key)) return true;
  const parts = key.split(".");
  for (let i = 1; i < parts.length; i++) if (namespaces.has(parts.slice(0, i).join("."))) return true;
  for (const p of prefixes) if (key.startsWith(p)) return true;
  if (templates?.test(key)) return true;
  const civ = /^(.*?)_by_(?:civ|realm)\.[\w-]+(.*)$/.exec(key);
  return !!civ && (referenced(civ[1] + civ[2]) || referenced(civ[1]));
}

const DYNAMIC = Object.keys(dynamicNamespaces);
const isDynamic = (key: string) => DYNAMIC.some((p) => key === p || key.startsWith(`${p}.`));
const UNREFERENCED = leaves.filter((k) => !isDynamic(k) && !referenced(k)).sort();

describe("every language-pack key is referenced, or listed as not yet", () => {
  it("scans the sources it thinks it scans", () => {
    // 地板,不是钉:一个根目录改了名,扫描会安静地变空,然后一切都「没人用」或一切都绿。
    expect(FILES.length).toBeGreaterThan(1000);
    expect(leaves.length).toBeGreaterThan(5000);
    expect(exact.size).toBeGreaterThan(3000);
  });

  it("no key nobody references is added outside the baseline", () => {
    const listed = new Set<string>(baseline);
    expect(UNREFERENCED.filter((k) => !listed.has(k))).toEqual([]);
  });

  it("the baseline holds only keys that still exist and still have no reference", () => {
    const now = new Set(UNREFERENCED);
    expect(baseline.filter((k) => !now.has(k))).toEqual([]);
    expect([...baseline].sort()).toEqual(baseline);
  });

  it("every dynamic namespace is one the bundle has", () => {
    expect(DYNAMIC.filter((ns) => !objects.has(ns))).toEqual([]);
  });

  it("the namespaces the web build drops are read by no web code", () => {
    // next.config.js 让网页打包丢掉这几个命名空间;网页一旦读其中一个,线上就显示键名而 jest(读整份包)照样绿。
    const loader = path.join(REPO, "frontend/lib/i18n/dropAppOnlyNamespaces.js");
    const web = FILES.filter((f) => /^(frontend|packages)\//.test(path.relative(REPO, f)) && f !== loader);
    expect(web.length).toBeGreaterThan(500);
    expect(WEB_UNREAD.every((ns) => objects.has(ns))).toBe(true);
    const readers = web.flatMap((f) => {
      const src = readFileSync(f, "utf8");
      return WEB_UNREAD.filter((ns) => new RegExp(`["'\`]${ns}[."'\`]`).test(src)).map((ns) => `${path.relative(REPO, f)}: ${ns}`);
    });
    expect(readers).toEqual([]);
  });
});
