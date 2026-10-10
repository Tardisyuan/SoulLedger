/**
 * Every officer-side entry the system offers outside the app (Android launcher shortcuts, iOS App
 * Intents / Siri: mobile/plugins/voiceEntries.js) is a deep link the app's parser recognises.
 *
 * Both sides are plain data and the plugin's output is never run by a test, so an entry whose `path`
 * the parser does not know would ship as a shortcut that opens the app on the default tab and says
 * nothing. The list is WALKED, not copied here: an entry added to voiceEntries.js is covered the day
 * it lands, and one the parser does not know turns this red.
 */
import { parseOfficerLink } from "../links";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { APPS } = require("../../../mobile/plugins/voiceEntries") as {
  APPS: { officer: { scheme: string; entries: { id: string; path: string }[]; asks: { id: string; path: string }[] } };
};
const officer = APPS.officer;
const TABS = ["todo", "queue", "search", "notices", "me"];

describe("the officer app's voice / shortcut entries", () => {
  it("walks a real list, so the checks below are not vacuous", () => {
    expect(officer.entries.length).toBeGreaterThan(0);
    expect(officer.scheme).toBe("soulledger-officer");
  });

  it.each(officer.entries.map((e) => [e.id, e.path]))("entry %s (%s) opens something the parser knows", (_id, path) => {
    const link = parseOfficerLink(`${officer.scheme}://${path}`);
    expect(link).not.toBeNull();
    if (!path.includes("/")) {
      // A bare path is a tab, and it must be the tab of the same name.
      expect(TABS).toContain(path);
      expect(link).toEqual({ tab: path });
    }
  });

  it("every ask (none today) opens something the parser knows, with its question attached", () => {
    // A plain loop, not it.each: `.each` throws on an empty table, and the officer app has no asks yet.
    for (const ask of officer.asks) {
      expect({ ask: ask.id, link: parseOfficerLink(`${officer.scheme}://${ask.path}?q=hello`) }).not.toEqual({
        ask: ask.id,
        link: null,
      });
    }
  });

  it("the check can fail: a path no entry uses is not recognised", () => {
    expect(parseOfficerLink(`${officer.scheme}://no-such-tab`)).toBeNull();
    expect(officer.entries.map((e) => e.path)).not.toContain("no-such-tab");
  });
});
