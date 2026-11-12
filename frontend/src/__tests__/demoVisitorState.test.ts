/**
 * A sign-in or sign-out leaves nothing of the last visitor (F-DEMO-04): the old pattern only matched `soulledger_`, so
 * the `soulledger.<page>.filters` and `soulledger-queue-…` keys survived to the next one. Preferences stay.
 */
import { clearVisitorState } from "@/demo/store";

it("clears every separator's visitor keys, in both storages, and keeps preferences and the role", () => {
  const leave = ["soulledger.souls.filters", "soulledger.search.recent.7", "soulledger_draft_x"];
  const keep = ["soulledger_theme", "soulledger-locale", "soulledger-density", "soulledger-nav-mode", "soulledger_demo_role", "soulledger-demo-entered", "other"];
  [...leave, ...keep].forEach((k) => localStorage.setItem(k, "1"));
  sessionStorage.setItem("soulledger-queue-session-deferred", "[1]");
  sessionStorage.setItem("soulledger_demo_tour", "1");

  clearVisitorState();

  for (const k of leave) expect(localStorage.getItem(k)).toBeNull();
  for (const k of keep) expect(localStorage.getItem(k)).toBe("1");
  expect(sessionStorage.getItem("soulledger-queue-session-deferred")).toBeNull();
  expect(sessionStorage.getItem("soulledger_demo_tour")).toBe("1");
});
