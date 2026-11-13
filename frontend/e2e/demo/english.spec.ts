import { expect, test } from "@playwright/test";
import { enter, recording, rows, type Role } from "./support";

test.use({ locale: "en-US" });

const CJK = /[㐀-鿿]/;
/** Pages not yet free of Chinese, and why. Each is in the report; an empty list is the aim. */
const ALLOWED: Record<string, string> = {
  "/corpus": "the 功過格 statutes are transcribed classical Chinese, the corpus's point",
  "/about": "the sources are cited under their own Chinese titles",
};
const brand = (s: string) => s.replace(/灵魂簿/g, "").replace(/冥/g, "");

test("a browser in English gets English, from the first paint", async ({ page }) => {
  const res = await page.goto("/");
  expect(await res?.text()).toContain('lang="en');
  await expect(page.locator("html")).toHaveAttribute("lang", /^en/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("One question: will this soul pass?");
});

test("a visitor's choice of language sticks", async ({ page }) => {
  await page.goto("/");
  await page.locator("html[data-civ]").waitFor({ state: "attached" }); // hydrated: before this the select has no handler
  await page.locator("select").filter({ visible: true }).first().selectOption("zh-Hans");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("同一个问题：这个灵魂过得了关吗？");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", /^zh/);
});

const PAGES: [Role, string][] = [
  ["judge", "/desk"], ["judge", "/judgment"], ["judge", "/judgment/queue"], ["judge", "/souls"], ["judge", "/disposition"], ["judge", "/sentence-plans"], ["judge", "/rebirths"], ["judge", "/realms"], ["judge", "/social"], ["judge", "/dashboard"],
  ["judge_eu", "/judgment"], ["judge_eu", "/disposition"], ["judge_eu", "/realms"],
  ["judge_eg", "/judgment"], ["judge_eg", "/disposition"], ["judge_eg", "/realms"],
  ["judge_gr", "/judgment"], ["judge_gr", "/disposition"], ["judge_gr", "/realms"],
  ["admin", "/desk/overview"], ["admin", "/dashboard"], ["admin", "/menus"], ["admin", "/users"], ["admin", "/permissions"], ["admin", "/audit"],
  ["moderator", "/moderation"], ["admin", "/soul-inbox"], ["judge", "/profile"], ["judge", "/about"],
  ["judge", "/actors"], ["judge_eu", "/actors"], ["judge_eg", "/actors"], ["judge_gr", "/actors"], ["admin", "/tenants"],
  ["judge", "/workflow"], ["judge_eu", "/workflow"], ["judge_eg", "/workflow"], ["judge_gr", "/workflow"],
];
const detail = (role: Role, list: string, route: string, row = 0): [Role, string] => [role, `${route}${rows(recording(role, "en"), list)[row]?.id}`];
for (const role of ["judge", "judge_eu", "judge_eg", "judge_gr"] as Role[]) {
  PAGES.push(detail(role, "/souls/", "/souls/"), detail(role, "/judgment/", "/judgment/"), detail(role, "/workflows/", "/workflow/"));
}
for (const [role, route] of PAGES) {
  test(`${role} ${route} has no Chinese on it`, async ({ page }) => {
    test.skip(route in ALLOWED, ALLOWED[route]);
    await enter(page, role);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    // Not an empty shell (pages.spec.ts has the same floor): a page that has drawn nothing has no Chinese on it either.
    const main = page.locator("main").first();
    await expect.poll(async () => (await main.innerText()).trim().length, { message: `an empty shell on ${route}` }).toBeGreaterThan(20);
    const text = brand(await page.locator("body").innerText());
    const hits = text.split("\n").filter((line) => CJK.test(line)).slice(0, 12);
    expect(hits).toEqual([]);
  });
}

test("the tour's soul has an English name", async ({ page }) => {
  const soul = rows(recording("judge", "en"), "/souls/").find((s) => String(s.name).startsWith("Qu Yuan"));
  expect(soul).toBeTruthy();
  await enter(page, "judge");
  await page.goto(`/souls/${soul?.id}`);
  await expect(page.locator("main")).toContainText("Qu Yuan");
});
