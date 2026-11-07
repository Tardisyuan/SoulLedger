import { expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Role = "admin" | "judge" | "judge_eu" | "judge_eg" | "judge_gr" | "moderator";

type Row = Record<string, unknown> & { id: string | number };
interface Recording {
  lists: Record<string, { rows: Row[] }>;
  docs: Record<string, { s: number; b: unknown }>;
  login: { user: { id: number } };
}

export const recording = (role: Role, lang: "zh" | "en" = "zh"): Recording =>
  JSON.parse(readFileSync(join(__dirname, "..", "..", "demo", "data", `${role}.${lang}.json`), "utf8")) as Recording;

/** The rows of a list as recorded with no filter. */
export const rows = (rec: Recording, path: string): Row[] => rec.lists[path]?.rows ?? [];

export interface Watch {
  offsite: string[];
  errors: string[];
}

/** Everything a demo page must never do: leave its own origin, touch the API over the wire, log an error. */
export function watch(context: BrowserContext, page: Page): Watch {
  const seen: Watch = { offsite: [], errors: [] };
  context.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.host !== "localhost:3334" || url.pathname.startsWith("/api/")) seen.offsite.push(req.url());
  });
  page.on("websocket", (ws) => seen.offsite.push(ws.url()));
  page.on("console", (m) => {
    if (m.type() === "error") seen.errors.push(m.text());
  });
  page.on("pageerror", (e) => seen.errors.push(`pageerror: ${e.message}`));
  return seen;
}

export function clean(seen: Watch, where: string): void {
  expect(seen.offsite, `requests off this origin on ${where}`).toEqual([]);
  expect(seen.errors, `console errors on ${where}`).toEqual([]);
}

export async function enter(page: Page, role: Role): Promise<void> {
  await page.goto("/login");
  // The button is on the page before its handler is: a click ahead of hydration does nothing, and nothing says so.
  await page.locator("html[data-civ]").waitFor({ state: "attached" });
  await page.getByTestId(`demo-enter-${role}`).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.getByTestId("user-menu").waitFor();
  await page.waitForLoadState("networkidle");
  // Every way in is behind the cover now, the login page's list too: it goes once the console is drawn.
  await page.getByTestId("demo-entrance").waitFor({ state: "detached" });
}

/** The account menu's sign-out, by way of its confirmation. */
export async function signOut(page: Page): Promise<void> {
  await page.getByTestId("user-menu").click();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button").last().click();
  await page.waitForURL((u) => u.pathname === "/");
}

export const BROKEN = /加载失败|没取到|服务器错误|出错了|Something went wrong|Application error|Failed to load/;

type Rect = { x: number; y: number; w: number; h: number };
/** The last frame the entrance cover was up: its seal (or brand mark), the console's own, and whether the landing page was there. */
export type HandOff = { frames: number; cover: Rect | null; real: Rect | null; landing: boolean };

/**
 * Watched in the page from now on, every frame while the cover is up: the seal on the cover and the console's own mark
 * (the band's seal; with no underworld, the sidebar's brand mark). Read it with `handOff` once the cover is gone.
 */
export async function watchHandOff(page: Page): Promise<void> {
  await page.evaluate(() => {
    type R = { x: number; y: number; w: number; h: number };
    const seen = { frames: 0, cover: null as R | null, real: null as R | null, landing: false, done: false };
    (window as unknown as { __handOff: typeof seen }).__handOff = seen;
    const rect = (el: Element | null | undefined): R | null => {
      const b = el?.getBoundingClientRect();
      return b && b.width > 0 && b.right > 0 && b.left < innerWidth ? { x: b.left, y: b.top, w: b.width, h: b.height } : null;
    };
    const tick = () => {
      const cover = document.querySelector("[data-testid='demo-entrance']");
      if (cover) {
        seen.frames++;
        const mine = cover.querySelector("[data-testid='seal'], [data-brand-mark]");
        const css = mine?.matches("[data-brand-mark]") ? "[data-nav-brand] [data-brand-mark]" : "[data-testid='plaque'] .identity-title [data-testid='seal']";
        seen.cover = rect(mine);
        seen.real = Array.from(document.querySelectorAll(css)).map(rect).find(Boolean) ?? null;
        seen.landing = !!document.querySelector("[data-testid='landing-civs']");
      } else if (seen.frames) seen.done = true;
      if (!seen.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export async function handOff(page: Page): Promise<HandOff> {
  await page.waitForFunction(() => (window as unknown as { __handOff?: { done: boolean } }).__handOff?.done, null, { timeout: 10000 });
  return page.evaluate(() => {
    const { frames, cover, real, landing } = (window as unknown as { __handOff: HandOff }).__handOff;
    return { frames, cover, real, landing };
  });
}

/** The cover's seal ended where the console's is, within `px`, with the console (not the landing page) under it. */
export function expectSealHandedOver(seen: HandOff, px = 3): void {
  expect(seen.frames, "the cover was up").toBeGreaterThan(0);
  expect(seen.landing, "the landing page under the cover's last frame").toBe(false);
  expect(seen.real, "the console's own mark on screen at the hand-over").not.toBeNull();
  expect(seen.cover, "the cover's mark on screen at the hand-over").not.toBeNull();
  const off = Math.max(Math.abs(seen.cover!.x - seen.real!.x), Math.abs(seen.cover!.y - seen.real!.y), Math.abs(seen.cover!.w - seen.real!.w));
  expect(off, `seal at the hand-over ${JSON.stringify(seen.cover)} vs the console's ${JSON.stringify(seen.real)}`).toBeLessThanOrEqual(px);
}
