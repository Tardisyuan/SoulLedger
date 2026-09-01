/**
 * The system-event row's copy, asserted against the REAL message bundles.
 *
 * `soulLifecycleRows.test.ts` proves the wiring with sentinel labels — that no
 * branch of `describeSystemEvent` reaches an enum member except through
 * `SystemEventLabels`. It cannot prove the labels are translations, because it
 * supplies them. So this file supplies none: it takes `t` out of the production
 * `I18nProvider`, over `messages/{zh-Hans,en,egy}.json` as shipped, and builds
 * the labels with the production `makeSystemEventLabels`.
 *
 * ── Why every case asserts an absence ──────────────────────────────────────
 *
 * The defect being closed was `${EVENT_TYPE_LABELS.STATE_CHANGED} ${oldState} →
 * ${newState}`: a hard-coded Chinese label with two RAW enum members
 * interpolated after it. The test that stood next to that line asserted
 * `toContain("JUDGING")` and `toContain("DISPOSED")` and was green *because of*
 * the bug. "The right value is shown" stays true while the wrong one sits
 * beside it — so each case here pairs the translation it wants with the raw
 * member it must not find.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/src/contexts/I18nContext";
import {
  describeSystemEvent,
  makeSystemEventLabels,
} from "@/src/components/souls/soulLifecycleRows";
import type { SoulEvent } from "@/lib/api/events";

const MESSAGES_DIR = path.join(__dirname, "..", "..", "messages");
const LOCALES = ["zh-Hans", "en", "egy"] as const;

function bundle(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8"));
}

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, key)
      : [key];
  });
}

/**
 * Every event type the deleted `EVENT_TYPE_LABELS` map covered. Listed here in
 * full rather than derived from the bundle, so that dropping one from
 * `souls.events` fails instead of shrinking what "all of them" means.
 */
const MIGRATED_EVENT_TYPES = [
  "SOUL_CREATED",
  "SOUL_DIED",
  "STATE_CHANGED",
  "RECORD_ADDED",
  "JUDGMENT_INITIATED",
  "JUDGMENT_CONCLUDED",
  "DISPOSITION_CREATED",
  "REINCARNATION_TRIGGERED",
  "KARMA_RECALCULATED",
  "WORKFLOW_CREATED",
  "WORKFLOW_ASSIGNED",
  "WORKFLOW_APPROVED",
  "WORKFLOW_REJECTED",
  "DISPATCH_CREATED",
  "DISPATCH_APPROVED",
  "DISPATCH_REJECTED",
  "DISPATCH_EXECUTED",
  "DISPATCH_STATUS_CHANGED",
  "DEATH_SYNC_RECEIVED",
  "DEATH_SYNC_PROCESSED",
] as const;

/** Raw members that must never reach the screen, in any locale. */
const RAW_STATE_MEMBERS = ["ALIVE", "JUDGING", "DISPOSED", "REINCARNATING", "LOST", "SETTLED"];

function event(overrides: Partial<SoulEvent> = {}): SoulEvent {
  return {
    id: "e1",
    soul: "s1",
    event_type: "STATE_CHANGED",
    payload: { old_state: "JUDGING", new_state: "DISPOSED" },
    actor: "system",
    create_time: "2020-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * The production `t`, bound to a real bundle. No mock, no stand-in.
 *
 * `async` because only the default bundle is statically imported now — `en`
 * and `egy` arrive by dynamic import (see LAZY_BUNDLES in I18nContext). Before
 * the chunk lands, `t` answers from zh-Hans through the same fallback a
 * missing key takes, which here would fail as "the en bundle says 状态变更".
 * The wait is on a key whose value differs per locale, so it cannot pass early.
 */
async function translatorFor(locale: (typeof LOCALES)[number]) {
  const { result } = renderHook(() => useI18n(), { wrapper: I18nProvider });
  act(() => result.current.setLocale(locale));
  const marker = { "zh-Hans": "状态变更", en: "State changed", egy: "Set Medu Khemen Seth" }[locale];
  await waitFor(() => expect(result.current.t("souls.events.STATE_CHANGED")).toBe(marker));
  return result.current.t;
}

describe("system-event copy resolves through the shipped bundles", () => {
  const expected: Record<(typeof LOCALES)[number], { event: string; from: string; to: string }> = {
    "zh-Hans": { event: "状态变更", from: "审判中", to: "已处置" },
    en: { event: "State changed", from: "Judging", to: "Disposed" },
    egy: { event: "Set Medu Khemen Seth", from: "Em Sheemtet", to: "Em Wetep" },
  };

  it.each(LOCALES)("renders a STATE_CHANGED row in %s and leaks no raw member", async (locale) => {
    const text = describeSystemEvent(event(), makeSystemEventLabels(await translatorFor(locale)));

    expect(text).toContain(expected[locale].event);
    expect(text).toContain(expected[locale].from);
    expect(text).toContain(expected[locale].to);

    // The other half of the pair. Substring checks, because the failure mode is
    // the raw member sitting *next to* the translation rather than replacing it.
    expect(text).not.toContain("STATE_CHANGED");
    for (const member of RAW_STATE_MEMBERS) {
      expect(text).not.toContain(member);
    }
    // And the dotted key itself: `t()` echoes the key on a miss, so a bundle
    // gap would print "souls.states.JUDGING" — worse than the raw enum, which
    // is the trap resolveEnumDisplay exists to close.
    expect(text).not.toContain("souls.states.");
    expect(text).not.toContain("souls.events.");
  });

  it.each(LOCALES)("renders every migrated event type in %s without falling through to the member", async (locale) => {
    const t = await translatorFor(locale);
    const labels = makeSystemEventLabels(t);
    const unrecognized = t("common.value.unrecognized");

    for (const type of MIGRATED_EVENT_TYPES) {
      const text = describeSystemEvent(event({ event_type: type, payload: {} }), labels);
      expect(text).not.toContain(type);
      expect(text).not.toBe(unrecognized);
      expect(text.trim()).not.toBe("");
    }
  });

  it("shows translated 'unrecognized' copy, not the member, for an event type no bundle covers", async () => {
    const t = await translatorFor("en");
    const text = describeSystemEvent(
      event({ event_type: "SOME_FUTURE_EVENT_TYPE", payload: {} }),
      makeSystemEventLabels(t)
    );
    expect(text).toBe(t("common.value.unrecognized"));
    expect(text).not.toContain("SOME_FUTURE_EVENT_TYPE");
  });
});

describe("bundle parity", () => {
  it("keeps the three catalogues on exactly the same key set", async () => {
    const [reference, ...rest] = LOCALES.map((l) => flatten(bundle(l)).sort());
    for (const other of rest) {
      expect(other).toEqual(reference);
    }
    expect(reference.length).toBeGreaterThan(0);
  });

  it("carries every migrated event type in all three catalogues", async () => {
    for (const locale of LOCALES) {
      const keys = new Set(flatten(bundle(locale)));
      for (const type of MIGRATED_EVENT_TYPES) {
        expect(keys.has(`souls.events.${type}`)).toBe(true);
      }
    }
  });

  it("carries the inheritance caption the card now formats from the API's rates", async () => {
    for (const locale of LOCALES) {
      const keys = new Set(flatten(bundle(locale)));
      expect(keys.has("ledger.carry_forward_rate")).toBe(true);
    }
    // It has to take both placeholders, or the percentages silently vanish.
    for (const locale of LOCALES) {
      const b = bundle(locale) as { ledger: Record<string, string> };
      expect(b.ledger.carry_forward_rate).toContain("{{merit}}");
      expect(b.ledger.carry_forward_rate).toContain("{{demerit}}");
    }
  });
});
