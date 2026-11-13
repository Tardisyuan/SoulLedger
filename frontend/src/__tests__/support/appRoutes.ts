/**
 * Which pages exist, read from `frontend/app` — the one walk the route guards share.
 *
 * WHY. Adding `/goodbye` (2026-11-10) meant editing four guards, each carrying its own
 * hand-written copy of "which pages exist and which are public / outside the shell"
 * (docs/test-suite-review-2026-11-10.md §2.1). The decisions themselves live in two
 * source files — `proxy.ts` `PUBLIC_PATHS` (no sign-in needed) and `AppLayoutWrapper.tsx`
 * `AUTH_PATHS` / `PUBLIC_PATHS` (no AppLayout shell) — and everything else here is
 * derived from disk, so a new private page needs no test edit at all.
 *
 * The backend twin is `backend/tests/web_routes.py`; keep the two walks the same shape.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** `frontend/` (this file is `frontend/src/__tests__/support/appRoutes.ts`). */
export const FRONTEND_DIR = path.dirname(path.dirname(path.dirname(__dirname)));
export const APP_DIR = path.join(FRONTEND_DIR, "app");

export interface PageRoute {
  /** Relative to `frontend/`, e.g. `app/(auth)/login/page.tsx`. */
  file: string;
  /** The URL path, dynamic segments kept as written (`/souls/[id]`); route groups dropped. */
  route: string;
}

/** Every `page.tsx` under `app/`, with its URL. A `(group)` directory is not in the URL. */
export function pageRoutes(dir = APP_DIR, prefix = ""): PageRoute[] {
  const out: PageRoute[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...pageRoutes(full, entry.name.startsWith("(") ? prefix : `${prefix}/${entry.name}`));
    } else if (entry.name === "page.tsx") {
      out.push({
        file: path.relative(FRONTEND_DIR, full).split(path.sep).join("/"),
        route: prefix === "" ? "/" : prefix,
      });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** A concrete URL for a route: `[id]` / `[...slug]` become `probe`. The proxy matches
 *  real paths, so handing it the placeholder would test a different string. */
export function concretePath(route: string): string {
  return route.replace(/\[(?:\.{3})?[^\]]+\]/g, "probe");
}

/** One `const NAME = ["…", …];` array of string literals from a source file. */
export function readStringArray(file: string, name: string): string[] {
  const src = readFileSync(file, "utf8");
  const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`${name} not found in ${file}: the guards read it as a one-line array of string literals`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const APP_LAYOUT_WRAPPER = path.join(FRONTEND_DIR, "src/components/layout/AppLayoutWrapper.tsx");

/** AppLayoutWrapper's two arrays: AUTH_PATHS match by prefix, PUBLIC_PATHS exactly
 *  (the same test `AppLayoutWrapper` applies to `usePathname()`). Its third, DESK_PATHS, is not read here:
 *  since 第三十批第 4 步 those pages are inside AppLayout (door rail, door tabs), only `bare` — no toolbar. */
export function shellFreeLists(): { auth: string[]; publik: string[] } {
  return {
    auth: readStringArray(APP_LAYOUT_WRAPPER, "AUTH_PATHS"),
    publik: readStringArray(APP_LAYOUT_WRAPPER, "PUBLIC_PATHS"),
  };
}

/** Whether `AppLayoutWrapper` renders this route bare, without the AppLayout shell. */
export function isOutsideAppLayout(route: string, lists = shellFreeLists()): boolean {
  return (
    lists.auth.some((p) => route === p || route.startsWith(p + "/")) || lists.publik.includes(route)
  );
}
