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
import { actorsApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  actorsApi: { list: jest.fn() },
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: "u1", username: "yama" } }),
}));

// The gloss reads the sidebar menu tree over the network; it has its own tests.
jest.mock("@/src/components/layout/MenuGloss", () => ({
  MenuGloss: () => null,
}));

const EN_BUNDLE = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "messages", "en.json"), "utf8")
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
