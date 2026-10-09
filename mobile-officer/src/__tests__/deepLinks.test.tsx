/**
 * Deep links (soulledger-officer://todo|queue|search|notices|me and .../item/<kind>/<id>): the
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
jest.mock("@soulledger/core/api/judgment", () => ({ judgmentApi: { list: jest.fn(async () => ({ data: { results: [] } })), claim: jest.fn() } }));
jest.mock("@soulledger/core/api/notifications", () => ({
  notificationsApi: { list: jest.fn(async () => ({ data: { results: [] } })), markRead: jest.fn(), markAllRead: jest.fn() },
}));

const group = (items: object[]) => ({ count: items.length, items });
const EMPTY = { approvals: group([]), reassignments: group([]), cooldowns: group([]), rebirths: group([]) };

beforeEach(() => {
  jest.clearAllMocks();
  mockTodo.mockResolvedValue({ data: EMPTY });
  mockItem.mockReturnValue(new Promise(() => {}));
});

describe("parseOfficerLink", () => {
  it.each(["todo", "queue", "search", "notices", "me"])("%s opens that tab", (tab) =>
    expect(parseOfficerLink(`soulledger-officer://${tab}`)).toEqual({ tab })
  );

  it("item/<kind>/<id> opens that item's detail on the to-do tab", () => {
    expect(parseOfficerLink("soulledger-officer://item/approval/wf-1")).toEqual({ tab: "todo", item: { kind: "approval", id: "wf-1" } });
    expect(parseOfficerLink("soulledger-officer://item/rebirth/a%20b")).toEqual({ tab: "todo", item: { kind: "rebirth", id: "a b" } });
  });

  it.each([
    "soulledger-officer://",
    "soulledger-officer://decide",
    "soulledger-officer://todo/extra",
    "soulledger-officer://item",
    "soulledger-officer://item/approval",
    "soulledger-officer://item/judgment/9",
    "soulledger-officer://item/approval/x/y",
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

  it("an unknown link changes nothing", async () => {
    renderOfficer(<Shell />);
    await screen.findByTestId("tab-bar");
    await act(async () => officerLinks.push("soulledger-officer://approve/wf-1"));
    expect(screen.getByTestId("tab-todo").props.accessibilityState?.selected).toBe(true);
  });
});
