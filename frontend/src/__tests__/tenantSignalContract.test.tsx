import { render, waitFor } from "@testing-library/react";

import { I18nProvider } from "@/src/contexts/I18nContext";
import { TenantSignal } from "@/src/components/layout/TenantSignal";
import {
  CIVILIZATION_CODES,
  CIVILIZATION_OPTIONS,
  CIVILIZATION_SHORT_CODES,
} from "@/src/config/civilizations";

/**
 * The tenant signal: what the masthead says about which cosmology you are in.
 *
 * TWO THINGS ARE HELD HERE AND THEY FAIL FOR DIFFERENT REASONS.
 *
 * The first is the data. Every member of CIVILIZATION_OPTIONS has to resolve
 * to a name and a two-letter code, so a fifth cosmology fails a test rather
 * than rendering an empty second line under the wordmark — the same
 * enumeration device `civilizationColourContract` uses to stop one slipping
 * the `[data-civ]` gap, which is how GREEK rendered on the logged-out palette
 * for as long as it did.
 *
 * The second is the decision, and it is the one worth writing down: **every
 * variant must be identifiable from its text alone.** Recognition here rests
 * on the marks, and the marks cannot carry it by themselves — three of the
 * four are warm, and simulated for deuteranopia cn/eg/gr land within a few
 * points of each other while only eu stays apart. That is not an argument
 * against Greek's 88°: Stage 9 took it over the geometric optimum because 138°
 * collided with merit green, which is worse. It is that four hues on one wheel
 * cannot be the sole channel for four categories whatever the hues are, and a
 * fifth cosmology has no hue left to be given.
 *
 * So "the mark and text" is an AND, and this file is what stops a later
 * tidy-up from deleting the name as redundant with the dot. Without it that
 * edit is invisible: the component still renders, the dot is still coloured,
 * every other test still passes, and the app is back to colour-only
 * recognition with no measurement to catch it — which is exactly how the
 * surface-ramp premise survived as long as it did.
 */

const VARIANTS = ["line", "rail", "chip"] as const;

function renderSignal(tenantCode: string | null, variant: (typeof VARIANTS)[number]) {
  return render(
    <I18nProvider>
      <TenantSignal tenantCode={tenantCode} variant={variant} />
    </I18nProvider>
  );
}

/** Text with every mark element removed — what a reader who cannot separate
 *  the four hues has left to go on. */
function textWithoutColour(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-tenant-mark]").forEach((el) => el.remove());
  return (clone.textContent ?? "").trim();
}

describe("the fixture is looking at something", () => {
  // If these break, every assertion below goes vacuously green.
  it("has more than one civilization to tell apart", () => {
    expect(CIVILIZATION_OPTIONS.length).toBeGreaterThan(1);
  });

  it("has a tenant code and a short code for each of them", () => {
    for (const civ of CIVILIZATION_OPTIONS) {
      expect(CIVILIZATION_CODES[civ]).toBeTruthy();
      expect(CIVILIZATION_SHORT_CODES[civ]).toBeTruthy();
    }
  });
});

describe("every civilization resolves to a name and a code", () => {
  it.each(CIVILIZATION_OPTIONS)("%s has a two-letter code derived from its tenant", (civ) => {
    // Derived, not typed: the prefix comes from CIVILIZATION_CODES, which a
    // fifth civilization has to be added to anyway. Two letters is what makes
    // it fit the 64px collapsed rail and the fixed-width mobile chip.
    expect(CIVILIZATION_SHORT_CODES[civ]).toMatch(/^[a-z]{2}$/);
    expect(CIVILIZATION_CODES[civ].split("_")[0].toLowerCase()).toBe(
      CIVILIZATION_SHORT_CODES[civ]
    );
  });

  it("gives the four civilizations four different codes", () => {
    // A collision would make two tenants indistinguishable in exactly the two
    // states that have no room for the name.
    const codes = CIVILIZATION_OPTIONS.map((c) => CIVILIZATION_SHORT_CODES[c]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(CIVILIZATION_OPTIONS)("%s renders a non-empty name in the masthead line", (civ) => {
    const { container } = renderSignal(CIVILIZATION_CODES[civ], "line");
    expect(textWithoutColour(container)).not.toBe("");
  });
});

describe("the mark is never the only channel", () => {
  it.each(VARIANTS)("%s is identifiable with every mark element removed", (variant) => {
    // The load-bearing assertion. Rendered per civilization, colour stripped,
    // and the four results compared: if a variant ever drops to a bare dot the
    // set collapses to one empty string and this goes red.
    const texts = CIVILIZATION_OPTIONS.map((civ) => {
      const { container, unmount } = renderSignal(CIVILIZATION_CODES[civ], variant);
      const text = textWithoutColour(container);
      unmount();
      return text;
    });

    for (const text of texts) expect(text).not.toBe("");
    expect(new Set(texts).size).toBe(CIVILIZATION_OPTIONS.length);
  });

  it.each(VARIANTS)("%s draws its mark outside the text, not inside it", (variant) => {
    // The dot is `aria-hidden` and carries no characters of its own, so
    // stripping it above removes a decoration rather than half a word. A mark
    // that ever became a glyph would make the assertion above pass by
    // accident.
    const { container } = renderSignal(CIVILIZATION_CODES.GREEK, variant);
    const marks = container.querySelectorAll("[data-tenant-mark]");
    for (const mark of Array.from(marks)) {
      expect(mark.textContent).toBe("");
      expect(mark.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("names the tenant to a screen reader in the two states that show only a code", () => {
    // `gr` read aloud is not an answer to "which cosmology am I in". The rail
    // and the chip carry the full name in `aria-label`; the line does not need
    // one because its text is already the name.
    for (const variant of ["rail", "chip"] as const) {
      const { container, unmount } = renderSignal(CIVILIZATION_CODES.GREEK, variant);
      const el = container.querySelector(`[data-tenant-signal="${variant}"]`);
      expect(el?.getAttribute("aria-label")).toBeTruthy();
      expect(el?.getAttribute("aria-label")).not.toBe(CIVILIZATION_SHORT_CODES.GREEK);
      unmount();
    }
  });
});

describe("the two states with no room to grow", () => {
  it("gives the mobile chip the same fixed width for every tenant", () => {
    // Not cosmetic. The chip sits in the header's `flex-1` region because the
    // right-hand cluster's own comment records that when it wrapped it grew
    // past the 64px header and — the header being `sticky z-40` — the overflow
    // landed on the page and swallowed clicks; the 创建灵魂 button on /souls
    // was unreachable at 393px for exactly that. A chip that sizes to its
    // content is the same change that caused it.
    const widths = CIVILIZATION_OPTIONS.map((civ) => {
      const { container, unmount } = renderSignal(CIVILIZATION_CODES[civ], "chip");
      const el = container.querySelector<HTMLElement>('[data-tenant-signal="chip"]');
      const width = el?.style.width ?? "";
      unmount();
      return width;
    });

    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).not.toBe("");
  });

  it("keeps the rail and chip codes stable across locales", () => {
    // The reason these two carry a code rather than a name: the code is not a
    // translation, so its width does not move when the locale switcher does.
    // A localized string in a 64px rail is a layout that works in one language.
    const read = (variant: "rail" | "chip") => {
      const { container, unmount } = renderSignal(CIVILIZATION_CODES.EUROPEAN, variant);
      const text = textWithoutColour(container);
      unmount();
      return text;
    };

    const zh = [read("rail"), read("chip")];
    document.cookie = "soulledger-locale=en;path=/";
    const en = [read("rail"), read("chip")];
    document.cookie = "soulledger-locale=zh-Hans;path=/";

    expect(en).toEqual(zh);
  });
});

describe("no tenant, no claim", () => {
  it.each(VARIANTS)("%s renders nothing when there is no tenant", (variant) => {
    const { container } = renderSignal(null, variant);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(VARIANTS)("%s renders nothing for a tenant this deployment does not map", (variant) => {
    // Same choice TenantContext makes when it deletes `[data-civ]` rather than
    // guessing: a signal that appears blank reads as "this tenant has no
    // name", and an absent one reads as "you are not in one".
    const { container } = renderSignal("XX_SOMEWHERE_ELSE", variant);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the name follows the locale", () => {
  // These two await the bundle. Only zh-Hans is statically imported now; `en`
  // arrives by dynamic import, and until it does `t()` answers from the
  // default bundle — which is Chinese, which is exactly the wrong answer these
  // tests exist to catch. Asserting on the frame before the chunk lands would
  // make them fail for a reason that has nothing to do with the masthead.
  it("reads the catalogue rather than the config's own Chinese label", async () => {
    // CIVILIZATION_LABELS is a Chinese-only map in config/civilizations. If the
    // masthead read it, an English or Egyptian operator would get 中国地府 in
    // the one line whose job is telling them where they are. Asserted as the
    // exact string rather than "contains latin letters": the fallback map's
    // value and the English one differ in language, so a laxer check would go
    // on passing if the component stopped localizing at all.
    document.cookie = "soulledger-locale=en;path=/";
    const { container } = renderSignal(CIVILIZATION_CODES.CHINESE, "line");
    await waitFor(() => expect(textWithoutColour(container)).toBe("Chinese Diyu"));
    document.cookie = "soulledger-locale=zh-Hans;path=/";
  });

  it("says something different in each locale, so the switch is not a no-op", async () => {
    // The cookie is `soulledger-locale`, hyphenated. Spelling it with an
    // underscore sets a cookie nothing reads, and both halves of a
    // locale-comparison assertion then render in the same language and agree —
    // a check that passes because it never switched anything.
    // `differentFrom` rather than a predicate: the only thing worth waiting for
    // here is "no longer the default bundle's answer", and naming that directly
    // reads better than a callback.
    const read = async (differentFrom?: string) => {
      const { container, unmount } = renderSignal(CIVILIZATION_CODES.EGYPTIAN, "line");
      if (differentFrom !== undefined) {
        await waitFor(() =>
          expect(textWithoutColour(container)).not.toBe(differentFrom)
        );
      }
      const text = textWithoutColour(container);
      unmount();
      return text;
    };

    document.cookie = "soulledger-locale=zh-Hans;path=/";
    const zh = await read();
    document.cookie = "soulledger-locale=en;path=/";
    // Wait until it is no longer the default bundle's answer — otherwise `en`
    // could be read mid-flight, equal `zh`, and fail for the wrong reason.
    const en = await read(zh);
    document.cookie = "soulledger-locale=zh-Hans;path=/";

    expect(zh).not.toBe(en);
    expect(zh).not.toBe("");
    expect(en).not.toBe("");
  });
});
