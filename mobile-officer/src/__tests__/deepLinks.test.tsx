/**
 * Deep links (soulledger-officer://todo|queue|search|notices|me, .../item/<kind>/<id>, .../judgment/<id>, .../soul/<id>): the
 * parser, the inbox that holds a link while signed out, and the shell landing on the page the
 * way a tapped push does. A link only opens a page.
 */
import { act, screen, waitFor } from "@testing-library/react-native";

import { officerLinks, parseOfficerLink } from "../links";
import { Shell } from "../shell";
import { renderOfficer } from "./harness";

const mockTodo = jest.fn();
const mockItem = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: {
    todo: (...a: unknown[]) => mockTodo(...a),
    item: (...a: unknown[]) => mockItem(...a),
    registerPush: jest.fn(),
    unregisterPush: jest.fn(),
  },
}));
jest.mock("@soulledger/core/api/auth", () => ({
  ...jest.requireActual("@soulledger/core/api/auth"),
  mfaApi: { status: jest.fn(async () => ({ data: { enabled: true, required: true } })) },
}));
const mockJudgmentGet = jest.fn();
const mockSoulGet = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  judgmentApi: {
    list: jest.fn(async () => ({ data: { results: [] } })),
    claim: jest.fn(),
    queueCounts: jest.fn(async () => ({ data: { mine: 0, unclaimed: 0, others: 0, deferred: 0 } })),
    get: (...a: unknown[]) => mockJudgmentGet(...a),
  },
}));
jest.mock("@soulledger/core/api/souls", () => ({
  ...jest.requireActual("@soulledger/core/api/souls"),
  soulsApi: { get: (...a: unknown[]) => mockSoulGet(...a), list: jest.fn(() => new Promise(() => {})) },
}));
jest.mock("@soulledger/core/api/notifications", () => ({
  notificationsApi: { list: jest.fn(async () => ({ data: { results: [] } })), markRead: jest.fn(), markAllRead: jest.fn() },
}));

const group = (items: object[]) => ({ count: items.length, items });
const EMPTY = { approvals: group([]), reassignments: group([]), cooldowns: group([]), rebirths: group([]) };

beforeEach(() => {
  jest.clearAllMocks();
  mockTodo.mockResolvedValue({ data: EMPTY });
  mockItem.mockReturnValue(new Promise(() => {}));
  mockJudgmentGet.mockReturnValue(new Promise(() => {}));
  mockSoulGet.mockReturnValue(new Promise(() => {}));
});

describe("parseOfficerLink", () => {
  it.each(["todo", "queue", "search", "notices", "me"])("%s opens that tab", (tab) =>
    expect(parseOfficerLink(`soulledger-officer://${tab}`)).toEqual({ tab })
  );

  it("item/<kind>/<id> opens that item's detail on the to-do tab", () => {
    expect(parseOfficerLink("soulledger-officer://item/approval/wf-1")).toEqual({ tab: "todo", item: { kind: "approval", id: "wf-1" } });
    expect(parseOfficerLink("soulledger-officer://item/rebirth/a%20b")).toEqual({ tab: "todo", item: { kind: "rebirth", id: "a b" } });
  });

  it("judgment/<id> and soul/<id> open that case's / soul's read-only detail (D6)", () => {
    expect(parseOfficerLink("soulledger-officer://judgment/j-1")).toEqual({ tab: "queue", judgment: "j-1" });
    expect(parseOfficerLink("soulledger-officer://soul/s-1")).toEqual({ tab: "search", soul: "s-1" });
    expect(parseOfficerLink("soulledger-officer://Judgment/j-1")).toEqual({ tab: "queue", judgment: "j-1" });
  });

  it.each([
    "soulledger-officer://",
    "soulledger-officer://judgment",
    "soulledger-officer://judgment/j-1/x",
    "soulledger-officer://judgment/%2e%2e%2fusers",
    "soulledger-officer://judgment/..",
    "soulledger-officer://soul/a%3Fb",
    `soulledger-officer://soul/${"x".repeat(65)}`,
    "soulledger-officer://souls/s-1",
    "soulledger-officer://decide",
    "soulledger-officer://todo/extra",
    "soulledger-officer://item",
    "soulledger-officer://item/approval",
    "soulledger-officer://item/judgment/9",
    "soulledger-officer://item/approval/x/y",
    // The id is decoded and then put in an API path: nothing that can leave its segment gets through.
    "soulledger-officer://item/approval/%2e%2e%2fusers",
    "soulledger-officer://item/approval/..",
    "soulledger-officer://item/approval/a%3Fb",
    "soulledger-officer://item/approval/a%23b",
    "soulledger-officer://item/approval/a%5Cb",
    "soulledger-officer://item/approval/a%25b",
    "soulledger://todo",
    "https://example.com/todo",
    null,
    7,
  ])("ignores %p", (url) => expect(parseOfficerLink(url)).toBeNull());
});

describe("the launcher shortcuts and Siri entries", () => {
  it("each opens a tab this parser understands", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { APPS } = require("../../../mobile/plugins/voiceEntries");
    for (const e of APPS.officer.entries) expect(parseOfficerLink(`${APPS.officer.scheme}://${e.path}`)).toEqual({ tab: e.path });
  });
});

describe("landing in the shell", () => {
  it("a tab link switches tab", async () => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-bar");
    await act(async () => officerLinks.push("soulledger-officer://queue"));
    expect(await screen.findByTestId("tab-queue")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("tab-queue").props.accessibilityState?.selected).toBe(true));
  });

  it("an item link opens the detail", async () => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-bar");
    await act(async () => officerLinks.push("soulledger-officer://item/approval/wf-1"));
    expect(await screen.findByTestId("detail")).toBeTruthy();
    expect(mockItem).toHaveBeenCalledWith("approval", "wf-1");
  });

  it("a link that arrives before any shell is mounted (signed out) is applied once one is", async () => {
    // App.tsx mounts the shell only when signed in, so while signed out nothing subscribes.
    officerLinks.push("soulledger-officer://notices");
    renderOfficer(<Shell />);
    await waitFor(() => expect(screen.getByTestId("tab-notices").props.accessibilityState?.selected).toBe(true));
  });

  it.each([
    ["queue", "desk"],
    ["notices", "me"],
    ["search", "roll"],
  ])("each voice / shortcut page (%s) lands on its own page, under its door (%s), while signed in", async (tab, door) => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-bar");
    await act(async () => officerLinks.push(`soulledger-officer://${tab}`));
    await waitFor(() => expect(screen.getByTestId(`door-${door}`).props.accessibilityState?.selected).toBe(true));
    expect(await screen.findByTestId(`tab-${tab}-screen`)).toBeTruthy();
  });

  it("a judgment link opens that case's detail, a soul link that soul's -- the same landing as a notice (D6)", async () => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-bar");
    await act(async () => officerLinks.push("soulledger-officer://judgment/j-1"));
    await waitFor(() => expect(mockJudgmentGet).toHaveBeenCalledWith("j-1"));
    expect(mockSoulGet).not.toHaveBeenCalled();
    expect(mockItem).not.toHaveBeenCalled();
  });

  it("a soul link opens that soul's detail (D6)", async () => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-bar");
    await act(async () => officerLinks.push("soulledger-officer://soul/s-1"));
    await waitFor(() => expect(mockSoulGet).toHaveBeenCalledWith("s-1"));
    expect(mockJudgmentGet).not.toHaveBeenCalled();
  });

  it("an unknown link changes nothing", async () => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-bar");
    await act(async () => officerLinks.push("soulledger-officer://approve/wf-1"));
    expect(screen.getByTestId("tab-queue").props.accessibilityState?.selected).toBe(true);
  });
});
