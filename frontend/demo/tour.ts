/**
 * 「一个灵魂的一生」(Design batch 70, T-6 / T-7): one soul per civilization, followed to its end, each step a real record
 * of that soul. `GET /demo/tour/` is answered here (`flows.ts`), so the steps stay true to whatever the recording holds. A
 * record a step needs that is not there sends it to the list instead of failing.
 */
import { type Recording, rowsNow } from "./store";

export interface TourStep {
  n: number;
  /** demo.tour.target.<target>: the words for 「看这里」. */
  target: string;
  route: string;
  /** What to light up: a CSS selector, then text to find in a row. Not found = no highlight, never an error. */
  css?: string;
  text?: string;
  /** Light up the enclosing block of what `text` found, not the row. */
  up?: string;
  /** The desk's tab that holds it (an i18n key): opened first. A segmented control's segment counts as a tab. */
  tab?: string;
  /** The card carries 「试一下越权」 (`OverreachProbe`). */
  probe?: boolean;
}
export interface Tour {
  skin: string;
  steps: TourStep[];
}

const PROTAGONIST: Record<string, string> = { CN_DIYU: "屈原", EU_HEAVEN_HELL: "Francesca da Rimini", EG_DUAT: "Nefertari", GR_HADES: "Penelope" };
const SKIN: Record<string, string> = { CN_DIYU: "cn", EU_HEAVEN_HELL: "eu", EG_DUAT: "eg", GR_HADES: "gr" };
const NAME_EN: Record<string, string> = { 屈原: "Qu Yuan" };

/**
 * 「系统怎么保护自己」(作品集建议 A3): the administrator's console, walked through what keeps the data safe. Only when the
 * home page's second entrance asked for it (this flag, in the tab like the tour's own place): the administrator signed in
 * from the roles row opens on the dashboard as before. The key starts `soulledger_demo_tour`, which a sign-in leaves alone.
 */
export const GUARD_KEY = "soulledger_demo_tour_guard";

export function guardRequested(): boolean {
  try {
    return sessionStorage.getItem(GUARD_KEY) === "1";
  } catch {
    return false;
  }
}

export function requestGuard(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(GUARD_KEY, "1");
    else sessionStorage.removeItem(GUARD_KEY);
  } catch {
    /* no storage: no second tour */
  }
}

const table = "main table, main [role='grid'], main section";
export const GUARD_STEPS: TourStep[] = [
  { n: 1, target: "tenants", route: "/tenants", css: table },
  { n: 2, target: "matrix", route: "/permissions", tab: "permissions.segments.matrix", css: table },
  { n: 3, target: "overreach", route: "/permissions", tab: "permissions.segments.matrix", css: table, probe: true },
  { n: 4, target: "data_scope", route: "/permissions", tab: "permissions.segments.roles", css: table },
  { n: 5, target: "audit", route: "/audit", css: table },
  { n: 6, target: "recycle", route: "/recycle-bin", css: `${table}, main ul` },
];

export function tourOf(rec: Recording): Tour | null {
  if (rec.role === "admin") return guardRequested() ? { skin: "guard", steps: GUARD_STEPS } : null;
  const code = (rec.login.user as { tenant?: { code?: string } }).tenant?.code ?? "";
  if (!SKIN[code] || !rec.role.startsWith("judge")) return null;
  const name = PROTAGONIST[code];
  // The first life by its own name: the same person gone round is another row, 「屈原·来世」, which /rebirths lists.
  const souls = rowsNow(rec, "/souls/");
  const isCalled = (s: { name?: unknown }, match: (a: string, b: string) => boolean) => [name, NAME_EN[name] ?? name].some((n) => match(String(s.name), n));
  const soul = souls.find((s) => isCalled(s, (a, b) => a === b)) ?? souls.find((s) => isCalled(s, (a, b) => a.startsWith(b)));
  const soulRoute = soul ? `/souls/${soul.id}` : "/souls";
  const named = soul ? String(soul.name) : name;
  const judgment = rowsNow(rec, "/judgment/").find((j) => j.soul === soul?.id);
  const desk = judgment ? `/judgment/${judgment.id}` : "/judgment";
  const flow = rowsNow(rec, "/workflows/").find((w) => w.soul === soul?.id && w.case_type !== "REBIRTH_APPLICATION");
  const flowRoute = flow ? `/workflow/${flow.id}` : "/workflow";
  const decision = "[data-testid='current-decision']";
  const death: TourStep = { n: 1, target: "death", route: soulRoute, css: "[data-testid='soul-state']" };
  const timeline = "main [data-testid='soul-route'], main ol";
  const steps: Record<string, TourStep[]> = {
    cn: [
      death,
      { n: 2, target: "capture", route: soulRoute, css: "[data-testid='capture-warrant'], [data-testid='soul-capture']" },
      { n: 3, target: "city_god", route: "/city-god-cases", css: "main table" },
      { n: 4, target: "desk_offence", route: desk, css: decision },
      { n: 5, target: "soul_plan", route: soulRoute, css: "[data-testid='sentence-plan-card']" },
      { n: 6, target: "rebirth_soup", route: "/rebirths", text: named },
    ],
    eu: [
      death,
      { n: 2, target: "desk_place", route: desk, css: decision },
      { n: 3, target: "desk_offence", route: desk, css: "[data-testid='current-ruling']" },
      { n: 4, target: "realm_map", route: "/realms", css: "[data-testid='topology-branches'], [data-testid='topology-schematic'], main section" },
      { n: 5, target: "timeline", route: soulRoute, css: timeline },
    ],
    eg: [
      death,
      { n: 2, target: "confessions", route: desk, tab: "judgment.detail.confession", css: "[data-testid='negative-confessions']" },
      { n: 3, target: "scale", route: desk, css: "[data-testid='weighing-recorded'], [data-testid='weighing-scale']" },
      { n: 4, target: "desk_place", route: desk, css: decision },
      { n: 5, target: "timeline", route: soulRoute, css: timeline },
    ],
    gr: [
      death,
      { n: 2, target: "ferry", route: soulRoute, css: "[data-testid='soul-ferry-passage'], [data-testid='soul-identity']" },
      { n: 3, target: "workflow_fork", route: flowRoute, text: "Rhadamanthus", up: "ol, ul" },
      { n: 4, target: "disposition", route: "/disposition", css: "main section" },
      { n: 5, target: "timeline", route: soulRoute, css: timeline },
      { n: 6, target: "rebirth", route: "/rebirths", text: named },
    ],
  };
  return { skin: SKIN[code], steps: steps[SKIN[code]] };
}
