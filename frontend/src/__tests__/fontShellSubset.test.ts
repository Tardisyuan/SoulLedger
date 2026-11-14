/**
 * @jest-environment node
 *
 * The two fontsource index sheets (202 `@font-face`, ~62 KB gzipped) must not be in the root layout's
 * synchronous CSS: there they block every route's first frame (fe-perf P3, measured 2026-11-14). The shell
 * characters come from one preloaded subset instead (app/fonts-shell.css, generated), and the shards are
 * attached after hydration by app/FontShards.tsx.
 *
 * Pinned: no static fontsource import in layout.tsx; the shards are imported only lazily, from an effect;
 * the subset faces sit ahead of the shards in the stacks; the preloaded file is the one the CSS declares and
 * it exists. The last one is red until the generator has been run with the source fonts — on purpose: an
 * empty placeholder would preload a 404.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const FRONTEND = path.join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(FRONTEND, ...p), "utf8");
const LAYOUT = read("app", "layout.tsx");
const SHARDS = read("app", "FontShards.tsx");
const SHELL_CSS = read("app", "fonts-shell.css");
const GLOBALS = read("app", "globals.css");
const PACKAGES = ["@fontsource-variable/noto-sans-sc", "@fontsource-variable/noto-serif-sc"];
const staticImport = (pkg: string) => new RegExp(`^\\s*import\\s+(?:[^;]*?\\sfrom\\s+)?["']${pkg}(?:/[^"']*)?["']`, "m");

describe("fontsource shards stay off the critical path", () => {
  it.each(PACKAGES)("layout.tsx does not import %s synchronously", (pkg) => {
    expect(LAYOUT).not.toMatch(staticImport(pkg));
    expect(LAYOUT).not.toContain(pkg);
  });

  it("layout.tsx loads the subset CSS before globals.css and mounts <FontShards />", () => {
    const shell = LAYOUT.indexOf('import "./fonts-shell.css"');
    expect(shell).toBeGreaterThan(-1);
    expect(shell).toBeLessThan(LAYOUT.indexOf('import "./globals.css"'));
    expect(LAYOUT).toMatch(/<FontShards\s*\/>/);
  });

  it.each(PACKAGES)("FontShards imports %s only dynamically, inside an effect", (pkg) => {
    expect(SHARDS.startsWith('"use client"')).toBe(true);
    expect(SHARDS).not.toMatch(staticImport(pkg));
    const effect = /useEffect\(\(\) => \{([\s\S]*?)\}, \[\]\)/.exec(SHARDS)?.[1] ?? "";
    expect(effect).toContain(`import("${pkg}")`);
  });
});

describe("subset faces come before the shards", () => {
  it.each([
    ["--font-sans", "SoulLedger Shell Sans", "Noto Sans SC Variable"],
    ["--font-mono", "SoulLedger Shell Sans", "Noto Sans SC Variable"],
    ["--font-serif", "SoulLedger Title Serif", "Noto Serif SC Variable"],
    ["--font-serif", "Juan Latin", "SoulLedger Title Serif"],
  ])("%s lists '%s' before '%s'", (token, first, then) => {
    const stack = new RegExp(`${token}:\\s*([^;]+);`).exec(GLOBALS)?.[1] ?? "";
    expect(stack.indexOf(`'${first}'`)).toBeGreaterThan(-1);
    expect(stack.indexOf(`'${first}'`)).toBeLessThan(stack.indexOf(`'${then}'`));
  });

  it("the title stack is the serif stack", () => {
    expect(/--font-title:\s*([^;]+);/.exec(GLOBALS)?.[1].trim()).toBe("var(--font-serif)");
  });
});

describe("the generated subset CSS", () => {
  const urls = [...SHELL_CSS.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
  const preload = /<link rel="preload" href="\/fonts\/([^"]+)" as="font"/.exec(LAYOUT)?.[1];

  it("declares the file layout.tsx preloads, and every file it names exists", () => {
    expect(preload).toBe("shell-sans.woff2");
    expect(urls).toContain(preload);
    for (const f of urls) expect(existsSync(path.join(FRONTEND, "public", "fonts", f))).toBe(true);
  });

  it.each(["SoulLedger Shell Sans", "SoulLedger Title Serif", "Juan Latin"])("declares '%s'", (family) => {
    expect(SHELL_CSS).toContain(`font-family: '${family}';`);
  });

  it("the shell face claims CJK only, so Geist keeps every Latin letter", () => {
    const face = /@font-face\s*{[^}]*'SoulLedger Shell Sans'[^}]*}/.exec(SHELL_CSS)?.[0] ?? "";
    const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1] ?? "";
    expect(range).not.toBe("");
    for (const part of range.split(",")) {
      const lo = parseInt(/U\+([0-9A-F]+)/i.exec(part)?.[1] ?? "0", 16);
      expect(lo).toBeGreaterThanOrEqual(0x3000);
    }
  });
});
