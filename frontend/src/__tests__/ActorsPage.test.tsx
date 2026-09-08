/**
 * Tests for app/actors/page.tsx — the split between the major gods and the
 * Forty-Two Assessors of Ma'at.
 *
 * The page had no coverage at all when db47b3c seated the bench of 42, which
 * took the Egyptian JUDGE count from 4 to 46. Nothing on an actor row tells an
 * assessor from Osiris — same civilization, same role, same card — so the
 * distinction rests entirely on `assessor_index`, and every way of getting it
 * wrong is silent:
 *
 *   - Sorting the bench by name looks completely plausible. It is wrong:
 *     Aati is 17th in the Papyrus of Nebseni and 1st in the alphabet, which is
 *     why the fixture below uses the real roster in the real order.
 *   - Rendering the 42 flat alongside the 4 named gods gives fifty-one
 *     identical cards on first paint and buries Osiris in the middle of them.
 *   - A count that adds up but comes from a hardcoded English string reads
 *     fine in exactly one locale.
 *
 * `t` here is the real en bundle, not an identity stub: `<DomainEnum>` decides
 * a member is "unrecognized" by comparing t(key) to the key, so a stub `t`
 * would render every badge as unrecognized copy and the badge assertions would
 * pass against nothing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ActorsPage from "@/app/actors/page";
import { actorsApi } from "@soulledger/core/api";
import {
  CIVILIZATION_OPTIONS,
  CIVILIZATION_SHORT_CODES,
} from "@soulledger/core/config/civilizations";
import {
  CIV_PREFIXES,
  THEMES,
  TOKENS_BY_THEME,
  compositeOver,
  deltaE00Rgb,
  hslTripleToRgb,
  readCivAttrRules,
  resolveRampForCiv,
  type Rgb,
  type ThemeName,
} from "./support/globalsCssTokens";

jest.mock("@soulledger/core/api", () => ({
  actorsApi: { list: jest.fn() },
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  // `permissions: ["actors.read"]` 是页面外那道 `<RequirePermission>` 需要的。
  // 这个套件测的是阵容怎么排版,不是权限 —— 给足权限,让它继续测它自己的东西。
  // 门本身由 `tests/test_page_gates_match_the_backend.py` 守。
  useTenant: () => ({
    user: { id: "u1", username: "yama", role: "JUDGE", permissions: ["actors.read"] },
  }),
}));

// The gloss reads the sidebar menu tree over the network; it has its own tests.
jest.mock("@/src/components/layout/MenuGloss", () => ({
  MenuGloss: () => null,
}));

const EN_BUNDLE = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "..", "packages", "core", "messages", "en.json"), "utf8")
) as Record<string, unknown>;

function lookup(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
      EN_BUNDLE
    );
}

const translate = jest.fn((key: string, params?: Record<string, string>): string => {
  const value = lookup(key);
  if (typeof value !== "string") return key;
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (whole, a, b) => {
    const name = a ?? b;
    return name in params ? params[name] : whole;
  });
});

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: translate, locale: "en", hydrated: true }),
}));

// ---------------------------------------------------------------------------
// Fixture — the real roster, in the real order
// ---------------------------------------------------------------------------

/**
 * The Forty-Two in the Papyrus of Nebseni order (Budge 1904, pp. 418-419), as
 * seeded by backend/apps/actors/management/commands/seed_mythology.py. The
 * order is the fixture's whole point: sorted alphabetically these read
 * Ahi-mu, Am-beseku, Am-khaibetu…, which is nothing like the sequence below.
 */
const BENCH_IN_SEAT_ORDER = [
  "Usekht-nemmat", "Hept-shet", "Fenti", "Am-khaibetu", "Neha-hau", "Rerti",
  "Maati-f-em-tes", "Neba-per-em-khetkhet", "Set-kesu", "Uatch-nes", "Qerti",
  "Hetch-abehu", "Am-senf", "Am-beseku", "Neb-Maat", "Thenemi", "Aati",
  "Tutu-f", "Uamemti", "Maa-an-f", "Heri-seru", "Khemi", "Shet-kheru",
  "Nekhen", "Ser-kheru", "Basti", "Hra-f-ha-f", "Ta-ret", "Kenemti",
  "An-hetep-f", "Neb-hrau", "Serekhi", "Neb-abui", "Nefer-Tem", "Tem-sep",
  "Ari-em-ab-f", "Ahi-mu", "Utu-rekhit", "Neheb-nefert", "Neheb-kau",
  "Tcheser-tep", "An-a-f",
];

/** The Egyptian gods who hold no seat and stay laid out flat. */
const EGYPTIAN_PRINCIPALS = ["Osiris", "Anubis", "Thoth", "Ma'at"];

interface ActorFixture {
  id: string;
  name: string;
  civilization: string;
  role: string;
  is_active: boolean;
  assessor_index?: number | null;
  title?: string;
  name_zh?: string;
}

function principal(name: string, civilization: string, role = "JUDGE"): ActorFixture {
  return { id: `p-${civilization}-${name}`, name, civilization, role, is_active: true };
}

/**
 * Seats are handed out in a SHUFFLED sequence on purpose. If the fixture were
 * built seat 1, 2, 3… in array order, a page that ignored `assessor_index`
 * entirely and just rendered arrival order would still come out right, and
 * every ordering assertion below would be vacuous.
 */
function bench(): ActorFixture[] {
  const seats = BENCH_IN_SEAT_ORDER.map((name, i) => ({ name, seat: i + 1 }));
  const shuffled = [...seats].sort((a, b) => ((a.seat * 7) % 43) - ((b.seat * 7) % 43));
  return shuffled.map(({ name, seat }) => ({
    id: `a-${seat}`,
    name,
    civilization: "EGYPTIAN",
    role: "JUDGE",
    is_active: true,
    assessor_index: seat,
  }));
}

function fullRoster(): ActorFixture[] {
  return [
    ...EGYPTIAN_PRINCIPALS.map((n) => principal(n, "EGYPTIAN")),
    ...bench(),
    principal("阎罗王", "CHINESE"),
    principal("孟婆", "CHINESE", "CONDUIT"),
  ];
}

const mockedList = actorsApi.list as jest.Mock;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ActorsPage />, { wrapper: Wrapper });
}

/** Card names in DOM order inside a container. */
function cardNames(scope: HTMLElement): string[] {
  return [...scope.querySelectorAll("[data-actor-card]")].map(
    (el) => el.getAttribute("data-actor-card") ?? ""
  );
}

/**
 * A card prints the actor's name twice — once as the heading, once as the
 * `name_zh` line, which falls back to the same string when there is no Chinese
 * rendering (the seed leaves it blank on all 42 on purpose). So every name
 * query here is an ALL query; a singular one would fail on the duplicate
 * rather than on the thing being tested.
 */
async function waitForRoster(): Promise<void> {
  await waitFor(() => expect(screen.getAllByText("Osiris").length).toBeGreaterThan(0));
}

function benchSection(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-bench="EGYPTIAN"]');
  if (!el) throw new Error("No bench section rendered for EGYPTIAN");
  return el;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue({ data: { results: fullRoster() } });
});

// ── The split ────────────────────────────────────────────────────────

describe("ActorsPage separates the named gods from the bench of 42", () => {
  it("renders the major gods flat and the bench in its own section", async () => {
    const { container } = renderPage();
    await waitForRoster();

    const principals = container.querySelector<HTMLElement>('[data-principals="EGYPTIAN"]')!;
    expect(cardNames(principals).sort()).toEqual([...EGYPTIAN_PRINCIPALS].sort());

    // Nothing with a seat leaked into the flat grid, and no major god was
    // swept into the bench — the two failure directions are not the same bug.
    for (const name of BENCH_IN_SEAT_ORDER) {
      expect(within(principals).queryAllByText(name)).toHaveLength(0);
    }
    expect(cardNames(benchSection(container))).not.toContain("Osiris");
  });

  it("keeps a civilization with no assessors free of a bench section", async () => {
    const { container } = renderPage();
    await waitForRoster();

    expect(container.querySelector('[data-bench="CHINESE"]')).toBeNull();
    expect(container.querySelector('[data-bench="EGYPTIAN"]')).not.toBeNull();
  });
});

// ── Default state ────────────────────────────────────────────────────

describe("the bench starts folded", () => {
  it("shows none of the 42 on first paint", async () => {
    const { container } = renderPage();
    await waitForRoster();

    expect(cardNames(benchSection(container))).toEqual([]);
    for (const name of BENCH_IN_SEAT_ORDER) {
      expect(screen.queryAllByText(name)).toHaveLength(0);
    }
  });

  it("keeps the first paint to the named gods rather than fifty-one cards", async () => {
    const { container } = renderPage();
    await waitForRoster();

    // 4 Egyptian gods + 2 Chinese. The regression this guards is the flat
    // render of 51 Egyptian cards that db47b3c would otherwise have produced.
    expect(container.querySelectorAll("[data-actor-card]")).toHaveLength(6);
  });

  it("reports the bench as collapsed to assistive tech", async () => {
    const { container } = renderPage();
    await waitForRoster();

    const toggle = within(benchSection(container)).getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

// ── Ordering ─────────────────────────────────────────────────────────

describe("the expanded bench is in seat order", () => {
  async function expandBench(container: HTMLElement) {
    fireEvent.click(within(benchSection(container)).getByRole("button"));
    await waitFor(() => expect(screen.getAllByText("Aati").length).toBeGreaterThan(0));
  }

  it("renders all 42 once opened", async () => {
    const { container } = renderPage();
    await waitForRoster();
    await expandBench(container);

    expect(cardNames(benchSection(container))).toHaveLength(42);
  });

  it("orders by assessor_index, not by name", async () => {
    const { container } = renderPage();
    await waitForRoster();
    await expandBench(container);

    const rendered = cardNames(benchSection(container));
    expect(rendered).toEqual(BENCH_IN_SEAT_ORDER);

    // The assertion above only means something because the two orders differ.
    // Alphabetical would put Aati first; the papyrus puts him 17th.
    const alphabetical = [...BENCH_IN_SEAT_ORDER].sort();
    expect(rendered).not.toEqual(alphabetical);
    expect(rendered[0]).toBe("Usekht-nemmat");
    expect(alphabetical[0]).toBe("Aati");
    expect(rendered.indexOf("Aati")).toBe(16);
  });

  it("labels each card with the seat the papyrus gives it", async () => {
    const { container } = renderPage();
    await waitForRoster();
    await expandBench(container);

    const cards = benchSection(container).querySelectorAll<HTMLElement>("[data-actor-card]");
    expect(within(cards[0]).getByText("Seat 1")).toBeInTheDocument();
    expect(within(cards[16]).getByText("Seat 17")).toBeInTheDocument();
    expect(within(cards[41]).getByText("Seat 42")).toBeInTheDocument();
  });

  it("folds back up again", async () => {
    const { container } = renderPage();
    await waitForRoster();
    await expandBench(container);

    fireEvent.click(within(benchSection(container)).getByRole("button"));
    await waitFor(() => expect(screen.queryAllByText("Aati")).toHaveLength(0));
    expect(cardNames(benchSection(container))).toEqual([]);
  });
});

// ── Counts ───────────────────────────────────────────────────────────

describe("the counts", () => {
  it("counts the folded bench into the civilization total", async () => {
    renderPage();
    await waitForRoster();

    // 4 named gods + 42 assessors. A total taken from what is on screen would
    // read 4 while the bench is closed.
    expect(screen.getByText("46 actors")).toBeInTheDocument();
    expect(screen.getByText("2 actors")).toBeInTheDocument();
  });

  it("shows the seat count on the bench header while it is still folded", async () => {
    const { container } = renderPage();
    await waitForRoster();

    expect(within(benchSection(container)).getByText("42 seats")).toBeInTheDocument();
  });

  it("builds both counts through i18n rather than an English literal", async () => {
    renderPage();
    await waitForRoster();

    expect(translate).toHaveBeenCalledWith("actors.count", { count: "46" });
    expect(translate).toHaveBeenCalledWith("actors.assessors.count", { count: "42" });
    expect(translate).toHaveBeenCalledWith("actors.assessors.title");
  });
});

// ── Enum display ─────────────────────────────────────────────────────

describe("enum display", () => {
  it("translates the role and keeps the raw member in title", async () => {
    const { container } = renderPage();
    await waitForRoster();

    const card = container.querySelector<HTMLElement>('[data-actor-card="孟婆"]')!;
    const badge = within(card).getByTitle("CONDUIT");
    expect(badge.textContent).toBe("Soul Conduit");
    expect(badge.textContent).not.toContain("CONDUIT");
  });

  it("translates the civilization heading", async () => {
    renderPage();
    await waitForRoster();

    const heading = screen.getByTitle("EGYPTIAN");
    expect(heading.textContent).toBe("Egyptian Duat");
  });

  it("tints no badge past the 0.1 cap the light-mode tokens were measured at", async () => {
    const { container } = renderPage();
    await waitForRoster();

    // Same cap as src/__tests__/dataGridToneContract.test.ts, applied to the
    // badges this page rolls by hand instead of through the shared grid.
    const html = container.innerHTML;
    const tints = [...html.matchAll(/bg-\[hsl\(var\(--color-[\w-]+\)\/([\d.]+)\)\]/g)];
    expect(tints.length).toBeGreaterThan(0);
    for (const [, alpha] of tints) {
      expect(Number(alpha)).toBeLessThanOrEqual(0.1);
    }
  });
});

// ── Civilization ground ──────────────────────────────────────────────

/**
 * THE DEFECT THIS BLOCK EXISTS FOR. The whole page is four civilization
 * accordions, and until this change every one of them rendered in the logged-in
 * tenant's colours. The section carried `data-civilization={civ}` — the full
 * member, `EGYPTIAN` — and `app/globals.css` has **zero** rules matching that
 * attribute. It reads exactly like a style hook and is a test anchor;
 * `app/corpus/page.tsx` carries both it and `data-civ`, and only the second one
 * paints.
 *
 * WHAT IS BEING PINNED, and why it is not "the attribute is present". Stamping
 * `data-civ` is necessary and nowhere near sufficient:
 *
 *   - A `[data-civ='xx']` rule has to exist for that prefix, and it has to
 *     alias `--civ-mark`. A civilization with tokens but no rule renders on the
 *     neutral grey fallback while looking, in the stylesheet, fully wired — the
 *     way GREEK shipped invisible once already.
 *   - The class list has to CONSUME the alias. `data-civ` on its own repoints
 *     three custom properties and paints nothing.
 *   - The four resulting grounds have to be far enough apart to be told apart,
 *     measured in the space the eye reads.
 *
 * MEASURED IN ΔE00, NOT IN CHANNEL DELTAS. The same four grounds come out at
 * 4-8/255 on max-channel, which reads as "basically identical" on that scale
 * and is simply wrong: max-channel is nearly blind to a hue-only difference,
 * and two reviews in this repository were misled by it before `deltaE00Rgb`
 * landed (86cac4a). 3.5 is the "perceptible at a glance" rung of the published
 * CIEDE2000 ladder — the same number, and the same derivation,
 * `civilizationColourContract` uses for the surface ramp. It is re-declared
 * here rather than imported because pulling an export out of another
 * `.test.ts` would make jest run that file's cases a second time.
 *
 * WHY `--color-surface-1` IS THE BACKDROP. `PageSection` renders
 * `bg-[hsl(var(--color-surface-1))]` and the section sits directly inside it.
 * That backdrop is the HOST tenant's, not the section's: restamping `data-civ`
 * on a descendant does not move `--color-surface-*`, because a custom
 * property's `var()`s are substituted at the element that declares it and those
 * are declared on `:root`. So every host tenant is measured, not just one.
 */
const PERCEPTIBLE_AT_A_GLANCE = 3.5;

/** One principal per civilization — the four accordions, nothing else. */
function everyCivilizationRoster(): ActorFixture[] {
  return CIVILIZATION_OPTIONS.map((civ) => principal(`${civ}_PRINCIPAL`, civ));
}

async function renderEveryCivilization(): Promise<HTMLElement> {
  mockedList.mockResolvedValue({ data: { results: everyCivilizationRoster() } });
  const { container } = renderPage();
  await waitFor(() =>
    expect(container.querySelectorAll("[data-civilization]")).toHaveLength(
      CIVILIZATION_OPTIONS.length
    )
  );
  return container;
}

function sectionsByCivilization(container: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>("[data-civilization]")) {
    out.set(el.getAttribute("data-civilization") ?? "", el);
  }
  return out;
}

/**
 * The `--civ-mark` tint alpha this section's class list actually asks for, read
 * off the rendered DOM rather than restated here. Delete the class and this
 * throws; change the number and every ΔE00 below moves with it.
 */
function groundAlpha(section: HTMLElement): number {
  const hits = [
    ...(section.getAttribute("class") ?? "").matchAll(
      /bg-\[hsl\(var\(--civ-mark\)\/([\d.]+)\)\]/g
    ),
  ];
  if (hits.length !== 1) {
    throw new Error(
      `Expected exactly one \`bg-[hsl(var(--civ-mark)/α)]\` on the ` +
        `${section.getAttribute("data-civilization")} section, found ${hits.length}: ` +
        `${section.getAttribute("class")}`
    );
  }
  return Number(hits[0][1]);
}

/** What that section's ground rasterises to, on one host tenant, in one theme. */
function groundRgb(theme: ThemeName, hostPrefix: string, section: HTMLElement): Rgb {
  const civPrefix = section.getAttribute("data-civ");
  if (!civPrefix) {
    throw new Error(
      `The ${section.getAttribute("data-civilization")} section carries no ` +
        `\`data-civ\`, so nothing repoints --civ-mark and its ground falls to ` +
        `the neutral grey fallback.`
    );
  }
  const mark = TOKENS_BY_THEME[theme][`--color-civ-mark-${civPrefix}`];
  if (mark === undefined) {
    throw new Error(`No \`--color-civ-mark-${civPrefix}\` in the ${theme} tokens.`);
  }
  const backdrop = resolveRampForCiv(theme, hostPrefix, "--color-surface-1");
  return compositeOver(
    hslTripleToRgb(mark),
    hslTripleToRgb(backdrop),
    groundAlpha(section)
  );
}

describe("each civilization section gets its own ground", () => {
  it("stamps the prefix globals.css keys off, one per civilization, all distinct", async () => {
    const container = await renderEveryCivilization();
    const sections = sectionsByCivilization(container);

    expect([...sections.keys()].sort()).toEqual([...CIVILIZATION_OPTIONS].sort());

    const stamped = CIVILIZATION_OPTIONS.map((civ) =>
      sections.get(civ)!.getAttribute("data-civ")
    );
    // Each section's OWN prefix — not merely "some prefix". A page that stamped
    // the logged-in tenant's code on all four would sail through a presence
    // check and paint one colour.
    expect(stamped).toEqual(CIVILIZATION_OPTIONS.map((civ) => CIVILIZATION_SHORT_CODES[civ]));
    expect(new Set(stamped).size).toBe(CIVILIZATION_OPTIONS.length);
    expect([...stamped].sort()).toEqual([...CIV_PREFIXES].sort());
  });

  it("stamps a prefix globals.css actually aliases --civ-mark for", async () => {
    const container = await renderEveryCivilization();
    const rules = readCivAttrRules();

    for (const section of sectionsByCivilization(container).values()) {
      const prefix = section.getAttribute("data-civ")!;
      // A prefix with no rule, or a rule that omits the mark, paints the
      // neutral grey fallback — identical on all four, and silent.
      expect(rules[prefix]?.mark).toBe(`--color-civ-mark-${prefix}`);
    }
  });

  it("draws the rule and the ground off that alias, not off a surface token", async () => {
    const container = await renderEveryCivilization();

    for (const section of sectionsByCivilization(container).values()) {
      const classes = section.getAttribute("class") ?? "";
      // The 3px civilization rule, same construction as app/corpus/page.tsx.
      expect(classes).toContain("border-t-3");
      expect(classes).toContain("border-[hsl(var(--civ-mark))]");
      // ABSENCE, not just presence: a `--color-surface-*` ground is the same
      // colour on all four sections and would look entirely deliberate sitting
      // next to the alias.
      expect(classes).not.toMatch(/bg-\[hsl\(var\(--color-surface-\d\)/);
      expect(groundAlpha(section)).toBeGreaterThan(0);
    }
  });

  it("puts the four grounds a perceptible distance apart, on every host tenant and both themes", async () => {
    const container = await renderEveryCivilization();
    const sections = [...sectionsByCivilization(container).values()];
    expect(sections).toHaveLength(CIVILIZATION_OPTIONS.length);

    const tooClose: string[] = [];
    let narrowest = Infinity;
    let comparisons = 0;

    for (const theme of THEMES) {
      for (const host of CIV_PREFIXES) {
        for (let i = 0; i < sections.length; i += 1) {
          for (let j = i + 1; j < sections.length; j += 1) {
            const d = deltaE00Rgb(
              groundRgb(theme, host, sections[i]),
              groundRgb(theme, host, sections[j])
            );
            comparisons += 1;
            narrowest = Math.min(narrowest, d);
            if (d < PERCEPTIBLE_AT_A_GLANCE) {
              tooClose.push(
                `${theme} on host ${host}: ` +
                  `${sections[i].getAttribute("data-civilization")} vs ` +
                  `${sections[j].getAttribute("data-civilization")} = ${d.toFixed(2)} ΔE00`
              );
            }
          }
        }
      }
    }

    // A floor under the SUBJECT SET, not just under the result: an empty
    // comparison list is the state in which this whole block passes over
    // nothing examined.
    expect(comparisons).toBe(THEMES.length * CIV_PREFIXES.length * 6);
    expect(tooClose).toEqual([]);
    expect(narrowest).toBeGreaterThanOrEqual(PERCEPTIBLE_AT_A_GLANCE);
  });
});
