/**
 * Contract test for the display convention in src/lib/domainDisplay.ts — the
 * RENDERED SEMANTICS half. (docs/design-handoff/BRIEF.md §4.6 "Raw system
 * values leak into the interface".)
 *
 * §4.6 asks what "not recorded yet" looks like versus "zero" versus "not
 * applicable". The answer is only real if the three are actually
 * distinguishable on screen, so that is asserted against rendered output —
 * glyph and ink token both — rather than against the constant maps, which
 * would be a tautology.
 *
 * The source scan that stops the idiom coming back — the half that actually
 * holds the line across ~20 files — is `domainDisplayContract.test.tsx`. The
 * two were one file until it passed the 500-line ceiling; neither half's
 * assertions changed in the move.
 *
 * <DomainEnum> IS NOT STUBBED HERE and must not become so. A stub rendering
 * `{value}` would put the raw member back on screen — the exact defect §4.6
 * asks to remove — and every assertion below would then be measuring the stub.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { ToastProvider } from "@/src/contexts/ToastContext";
import { DomainEnum, DomainNumber, DomainText, IdentifierChip, MissingValue } from "@/src/components/ui/DomainValue";
import {
  DOMAIN_DISPLAY_I18N_KEYS,
  MISSING_GLYPH,
  MISSING_INK,
  isColumnUninformative,
  isOpaqueIdentifier,
  resolveEnumDisplay,
  shortIdentifier,
  signedNumber,
  signedTone,
  type MissingKind,
} from "@/src/lib/domainDisplay";

const FRONTEND_ROOT = path.join(__dirname, "..", "..");
// ---------------------------------------------------------------------------
// Rendered semantics
// ---------------------------------------------------------------------------

function renderWithI18n(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

/**
 * Copy is read out of the bundle rather than hardcoded here: the default
 * locale is zh-Hans, and pinning English strings would make this file fail on
 * a translation edit instead of on a convention breach.
 */
const DEFAULT_BUNDLE = JSON.parse(readFileSync(path.join(FRONTEND_ROOT, "..", "packages", "core", "messages", "zh-Hans.json"), "utf8"));
function copy(key: string): string {
  return key.split(".").reduce<Record<string, unknown> | string>(
    (acc, part) => (acc as Record<string, unknown>)[part] as Record<string, unknown> | string,
    DEFAULT_BUNDLE
  ) as string;
}

describe("the three missing semantics are distinguishable on screen", () => {
  it("gives unrecorded, zero and inapplicable three different glyphs", () => {
    const { container: unrecorded } = renderWithI18n(<MissingValue kind="unrecorded" />);
    const { container: inapplicable } = renderWithI18n(<MissingValue kind="inapplicable" />);
    const { container: zero } = renderWithI18n(<DomainNumber value={0} signed toned />);

    const glyphs = [unrecorded.textContent, zero.textContent, inapplicable.textContent];
    expect(new Set(glyphs).size).toBe(3);
    // Zero is a digit, not a placeholder — and never carries a fabricated sign.
    expect(zero.textContent).toBe("0");
    expect(zero.textContent).not.toBe("+0");
  });

  it("gives them three different ink tokens", () => {
    const inks = (Object.keys(MISSING_INK) as MissingKind[]).map((k) => MISSING_INK[k]);
    expect(new Set(inks).size).toBe(3);
    const { container } = renderWithI18n(<MissingValue kind="inapplicable" />);
    expect(container.firstElementChild?.className).toContain(MISSING_INK.inapplicable);
  });

  it("names each kind AND its reason in the accessible name, not only in the tooltip", () => {
    // 曾断言 `getByLabelText(kind 名)` —— 也就是 aria-label 里**只有**种类名,
    // 而理由只在 `title` 里。`title` 是鼠标悬停专用:26 个传 `reason` 的调用点
    // 上,那句解释(「余额不适用于埃及灵魂」这类)读屏和触摸都拿不到,而它正是
    // 说明这个格子为什么是一个点的那句话。
    renderWithI18n(<MissingValue kind="inapplicable" reason="balance is a Chinese instrument" />);
    const el = screen.getByLabelText(
      `${copy("common.value.inapplicable")} — balance is a Chinese instrument`
    );
    // `title` 保留,而且和可访问名称是同一串:它仍然是有鼠标的人查一个点最快的
    // 办法,把它拿掉是用一个受众换另一个受众。
    expect(el.getAttribute("title")).toBe(el.getAttribute("aria-label"));
    expect(el.textContent).toBe(MISSING_GLYPH.inapplicable);
  });

  it("没有 reason 时,可访问名称就是种类名 —— 不留一个悬空的破折号", () => {
    renderWithI18n(<MissingValue kind="unrecorded" />);
    const el = screen.getByLabelText(copy("common.value.unrecorded"));
    expect(el.getAttribute("aria-label")).not.toContain("—");
  });

  it("uses no background fill, so the 0.1 badge-tint cap is not in play", () => {
    for (const ink of Object.values(MISSING_INK)) {
      expect(ink).not.toMatch(/\bbg-/);
    }
  });
});

describe("enum resolution", () => {
  const t = (key: string) => (key === "souls.states.ALIVE" ? "Alive" : key === "common.value.unrecognized" ? "Unrecognized value" : key);

  it("translates a known member", () => {
    expect(resolveEnumDisplay(t, "souls.states", "ALIVE")).toEqual({ state: "known", raw: "ALIVE", label: "Alive" });
  });

  it("never leaks the dotted key when a bundle has no entry", () => {
    const result = resolveEnumDisplay(t, "souls.states", "ASCENDED");
    expect(result.state).toBe("unrecognized");
    expect(result.label).not.toContain("souls.states");
    expect(result.raw).toBe("ASCENDED");
  });

  it("treats an absent value as missing, not as an unknown member", () => {
    expect(resolveEnumDisplay(t, "souls.states", null).state).toBe("missing");
    expect(resolveEnumDisplay(t, "souls.states", "").state).toBe("missing");
  });

  it("keeps the raw member in title and out of the text node", () => {
    renderWithI18n(<DomainEnum namespace="souls.states" value="ALIVE" />);
    const el = screen.getByTitle("ALIVE");
    // The §4.6 defect verbatim: the badge read "ALIVE — 存活", enum and
    // translation side by side. Only the translation is on screen now.
    expect(el.textContent).toBe(copy("souls.states.ALIVE"));
    expect(el.textContent).not.toContain("ALIVE");
  });

  it("shows translated copy, not the key, for a member no bundle covers", () => {
    renderWithI18n(<DomainEnum namespace="souls.states" value="ASCENDED" />);
    const el = screen.getByTitle("ASCENDED");
    expect(el.textContent).toBe(copy("common.value.unrecognized"));
  });
});

describe("identifier policy", () => {
  it("recognises UUIDs and bare primary keys as opaque", () => {
    expect(isOpaqueIdentifier("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
    expect(isOpaqueIdentifier("42")).toBe(true);
    expect(isOpaqueIdentifier("孟婆")).toBe(false);
  });

  it("truncates for reading and leaves short ids alone", () => {
    expect(shortIdentifier("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("3f2504e0");
    expect(shortIdentifier("abc")).toBe("abc");
  });
});

describe("<IdentifierChip>", () => {
  const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  function renderChip() {
    return render(
      <I18nProvider>
        <ToastProvider>
          <IdentifierChip id={UUID} />
        </ToastProvider>
      </I18nProvider>
    );
  }

  it("reads short but carries the whole value in title", () => {
    renderChip();
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("3f2504e0");
    expect(button.textContent).not.toContain(UUID);
    expect(button.getAttribute("title")).toBe(UUID);
  });

  it("copies the FULL id, not the truncation on screen", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderChip();
    fireEvent.click(screen.getByTitle(UUID));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(UUID));
    expect(await screen.findByText(copy("common.value.copied"))).toBeInTheDocument();
  });

  it("stays copyable in the inline variant a registered exception uses", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <I18nProvider>
        <ToastProvider>
          <IdentifierChip id={UUID} variant="inline" ariaLabel="Copy Soul record ID" />
        </ToastProvider>
      </I18nProvider>
    );

    const button = screen.getByRole("button", { name: "Copy Soul record ID" });
    // Without a border, the sigil is what says "record number" — but the
    // behaviour under it is the chip's, which is the point of the variant.
    expect(button.textContent).toBe("#3f2504e0 ⧉");
    expect(button.getAttribute("title")).toBe(UUID);

    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(UUID));
  });

  it("drops the chrome, not the affordance, when it has to repeat down a list", () => {
    const { container: chip } = render(
      <I18nProvider>
        <ToastProvider>
          <IdentifierChip id={UUID} />
        </ToastProvider>
      </I18nProvider>
    );
    const { container: inline } = render(
      <I18nProvider>
        <ToastProvider>
          <IdentifierChip id={UUID} variant="inline" />
        </ToastProvider>
      </I18nProvider>
    );
    const chipClass = chip.querySelector("button")!.className;
    const inlineClass = inline.querySelector("button")!.className;

    expect(chipClass).not.toBe(inlineClass);
    // Ten filled pills down a metadata column read as the page's content. No
    // fill also keeps the variant clear of the 0.1 badge-tint cap entirely.
    expect(chipClass).toMatch(/\bbg-/);
    expect(inlineClass).not.toMatch(/\bbg-/);
    expect(inlineClass).not.toMatch(/\bborder\b/);
    // Both are still buttons with a hover state — the affordance is the part
    // the variant may not economise on.
    expect(inlineClass).toContain("hover:");
  });

  it("says so when the clipboard refuses, rather than looking like a no-op", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderChip();
    fireEvent.click(screen.getByTitle(UUID));

    // The toast renders its own close button, so scope back to the chip.
    expect(await screen.findByText(copy("common.value.id_copy_failed"))).toBeInTheDocument();
    expect(screen.getByTitle(UUID).textContent).toContain("3f2504e0");
  });
});

describe("<DomainText>", () => {
  it("passes real text through untouched", () => {
    const { container } = renderWithI18n(<DomainText value="孟婆汤" />);
    expect(container.textContent).toBe("孟婆汤");
  });

  it.each(["", null, undefined] as const)("treats %p as the missing kind it was told", (value) => {
    const { container } = renderWithI18n(<DomainText value={value} missingKind="inapplicable" />);
    expect(container.textContent).toBe(MISSING_GLYPH.inapplicable);
  });
});

describe("<DomainNumber>", () => {
  it("shows a missing value rather than a zero when there is no number", () => {
    const { container } = renderWithI18n(<DomainNumber value={null} />);
    expect(container.textContent).toBe(MISSING_GLYPH.unrecorded);
    expect(container.textContent).not.toBe("0");
  });

  it("does not colour an unsigned count by sign", () => {
    const { container } = renderWithI18n(<DomainNumber value={12} />);
    expect(container.textContent).toBe("12");
    expect(container.firstElementChild?.className).not.toContain("status-success");
  });
});

describe("signed numbers", () => {
  it("never signs a zero", () => {
    expect(signedNumber(0)).toBe("0");
    expect(signedNumber(7)).toBe("+7");
    expect(signedNumber(-7)).toBe("−7");
  });

  it("gives zero neutral ink — it is neither good news nor bad", () => {
    expect(signedTone(0)).toBe("neutral");
    expect(signedTone(1)).toBe("success");
    expect(signedTone(-1)).toBe("error");
  });
});

describe("columns that earn no space", () => {
  const rows = [{ death: null }, { death: null }];

  it("flags a column with no value on any row", () => {
    expect(isColumnUninformative(rows, (r) => r.death !== null)).toBe(true);
  });

  it("keeps the column the moment one row has a value", () => {
    expect(isColumnUninformative([...rows, { death: "1911-10-10" }], (r) => r.death !== null)).toBe(false);
  });

  it("concludes nothing from an empty page", () => {
    expect(isColumnUninformative([], () => false)).toBe(false);
  });
});

describe("i18n", () => {
  const BUNDLES = ["en", "zh-Hans", "egy"] as const;

  function lookup(bundle: Record<string, unknown>, key: string): unknown {
    return key.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), bundle);
  }

  it.each(BUNDLES)("%s carries every key the convention needs", (locale) => {
    // Two floors before the rule, because the rule is "this filter came back
    // empty" and an empty INPUT satisfies it just as well as a complete bundle.
    //
    // `DOMAIN_DISPLAY_I18N_KEYS` is imported, not written here: if it were ever
    // emptied — or rebuilt from a spread that silently produced nothing — all
    // three locales would report zero missing keys and this suite would go on
    // claiming the convention is translated everywhere. It is nine keys today
    // (three MISSING_LABEL_KEY values plus six literals); the floor is set
    // below that so adding one is not an edit here, and removing most of them
    // is.
    expect(DOMAIN_DISPLAY_I18N_KEYS.length).toBeGreaterThan(6);
    // And the locale list itself. jest refuses an empty `.each` table outright,
    // so total deletion is loud; a list quietly narrowed to one locale is not,
    // and that is the shape this catches.
    expect(BUNDLES).toHaveLength(3);

    const bundle = JSON.parse(readFileSync(path.join(FRONTEND_ROOT, "..", "packages", "core", "messages", `${locale}.json`), "utf8"));
    const missing = DOMAIN_DISPLAY_I18N_KEYS.filter((key) => typeof lookup(bundle, key) !== "string");
    expect(missing).toEqual([]);
  });
});

