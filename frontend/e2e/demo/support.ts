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
