/**
 * The words the app asks for exist: every static `officer_app.*` / borrowed key written in this
 * app's source is in the zh and en bundles, the two `officer_app` trees have the same keys, and
 * the egy tree (which leaves out what the closed vocabulary cannot yet say) never has a key or
 * a placeholder zh does not.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import egy from "@soulledger/core/messages/egy.json";
import en from "@soulledger/core/messages/en.json";
import zh from "@soulledger/core/messages/zh-Hans.json";

type Tree = { [key: string]: Tree | string };

function flatten(node: unknown, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  if (!node || typeof node !== "object") return {};
  return Object.assign({}, ...Object.entries(node).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)));
}
function at(tree: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Tree)[part] : undefined), tree);
}
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const SRC = join(__dirname, "..");
const CODE = [...sources(SRC), join(SRC, "..", "App.tsx")].map((p) => readFileSync(p, "utf8")).join("\n");

describe("the keys the code asks for", () => {
  const written = [...CODE.matchAll(/["'`]((?:officer_app|officer_assist|soul_app|souls|notifications)\.[\w.${}]*)["'`]/g)].map((m) => m[1]);

  it("finds the keys at all (the scan is not silently empty)", () => {
    expect(written.length).toBeGreaterThan(60);
  });

  it.each([...new Set(written)])("%s exists in zh and en", (key) => {
    const dynamic = key.includes("${");
    const base = dynamic ? key.slice(0, key.indexOf("${")).replace(/\.$/, "") : key;
    for (const bundle of [zh, en]) {
      const found = at(bundle, base);
      // A template key (`officer_app.kinds.${kind}`) must at least name an object of strings.
      // So must a namespace handed to enumLabel(`enumLabel("users.roles", role)`).
      const namespace = CODE.includes(`enumLabel("${key}"`);
      if (dynamic || namespace) expect(found && typeof found === "object" && Object.keys(found).length).toBeGreaterThan(0);
      else expect(typeof found).toBe("string");
    }
  });

  it("the generated login and two-step failure keys exist", () => {
    for (const key of ["bad_credentials", "locked", "network", "other"]) expect(typeof at(zh, `officer_app.login.reasons.${key}`)).toBe("string");
    for (const key of ["wrong", "expired", "locked", "network", "other"]) expect(typeof at(zh, `officer_app.mfa.reasons.${key}`)).toBe("string");
    for (const key of ["already_handled", "deadline_passed", "permission_changed", "network", "other"]) {
      expect(typeof at(zh, `officer_app.confirm.reasons.${key}`)).toBe("string");
      expect(typeof at(en, `officer_app.confirm.reasons.${key}`)).toBe("string");
    }
    for (const key of ["todo", "queue", "search", "notices"]) expect(typeof at(zh, `officer_app.areas.${key}`)).toBe("string");
    for (const key of ["approval", "reassignment", "cooldown", "rebirth"]) {
      expect(typeof at(zh, `officer_app.kinds.${key}`)).toBe("string");
      expect(typeof at(zh, `officer_app.confirm.approve_body.${key}`)).toBe("string");
    }
  });
});

describe("the three bundles agree", () => {
  const ZH = flatten((zh as Tree).officer_app, "officer_app");
  const EN = flatten((en as Tree).officer_app, "officer_app");
  const EGY = flatten((egy as Tree).officer_app, "officer_app");

  it("zh and en have the same keys and the same placeholders", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ZH).sort());
    for (const key of Object.keys(ZH)) expect(placeholders(EN[key])).toEqual(placeholders(ZH[key]));
  });

  it("egy has no key zh lacks, and the same placeholders where it has one", () => {
    for (const key of Object.keys(EGY)) {
      expect(ZH[key]).toBeDefined();
      expect(placeholders(EGY[key])).toEqual(placeholders(ZH[key]));
    }
  });

  it("the lock screen sentence is the server's, with the count", () => {
    expect(ZH["officer_app.push.lock"]).toBe("有 {{n}} 件待你处理");
    expect(EN["officer_app.push.lock"]).toBe("{{n}} items waiting on you");
  });
});
