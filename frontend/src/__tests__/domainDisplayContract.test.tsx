/**
 * Contract test for the display convention in src/lib/domainDisplay.ts.
 * (docs/design-handoff/BRIEF.md §4.6 "Raw system values leak into the
 * interface".)
 *
 * Two halves, both of which can actually fail:
 *
 *   1. A SOURCE SCAN over every .tsx under app/, components/ and
 *      src/components/. §4.6 is not a bug in one component — it is the same
 *      idiom pasted into ~20 files, each of which drifted separately. A
 *      behavioural test of <DomainEnum> would pass forever while a new screen
 *      renders `{tmpl.civilization}` next to it. So the scan is the part that
 *      holds, and the behavioural tests below only pin down what the scan is
 *      pushing everyone towards.
 *
 *   2. RENDERED SEMANTICS. §4.6 asks what "not recorded yet" looks like
 *      versus "zero" versus "not applicable". The answer is only real if the
 *      three are actually distinguishable on screen, so that is asserted
 *      against rendered output — glyph and ink token both — rather than
 *      against the constant maps, which would be a tautology.
 *
 * Sanity check when editing: revert any single fix in the files listed by the
 * scan and rule 1 goes red naming that file and line.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
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
const SCAN_ROOTS = ["app", "components", path.join("src", "components")];

/**
 * Fields whose values are backend enum members. Rendering one of these
 * directly puts a SCREAMING_SNAKE token in front of a user — the `CHINESE`
 * and `ALIVE — 存活` of §4.6.
 */
const ENUM_FIELDS = [
  "status",
  "state",
  "current_state",
  "old_state",
  "new_state",
  "civilization",
  "verdict",
  "judgment_verdict",
  "node_type",
  "case_type",
  "caseType",
  "entity_type",
  "event_type",
  "realm_type",
  "rebirth_form",
  "severity",
  "disposition_type",
  "action",
];

/** The two modules that are allowed to spell a missing value out. */
const CONVENTION_MODULES = [
  path.join("src", "lib", "domainDisplay.ts"),
  path.join("src", "components", "ui", "DomainValue.tsx"),
];

/**
 * `resolveEnumDisplay` returns a STRING, so a caller using it directly has to
 * remember `title={rawMember}` by hand — and eight of nine callers didn't,
 * which is how a code comment claiming "the raw member goes to `title`" ended
 * up sitting above a badge that had no `title` at all. `<DomainEnum>` carries
 * the attribute itself and, because it renders exactly one span, can take the
 * badge's own className and BE the badge rather than nest inside it.
 *
 * So the string form is allowed only where JSX genuinely cannot go, and each
 * entry names that place. Anything else must use the component.
 */
const ENUM_STRING_CONTEXTS: Record<string, string> = {
  [path.join("app", "dashboard", "page.tsx")]:
    "Recharts `name` on a chart datum, plus list rows that fall back to the API's own label; both carry title={state} by hand.",
  [path.join("app", "ledger", "page.tsx")]:
    "Same server-label fallback as the dashboard; carries title={item.state} by hand.",
  [path.join("app", "dispatch", "[id]", "page.tsx")]:
    "Falls back to STATUS_LABELS copy, which <DomainEnum> cannot express; carries title={dispatch.status} by hand.",
  [path.join("app", "dispatch", "propose", "page.tsx")]:
    "Inside an <option>, which can hold no child element.",
  [path.join("app", "recycle-bin", "page.tsx")]:
    "Interpolated into t('recycle_bin.dependent_count', { type }) as a parameter, not rendered.",
  [path.join("app", "workflow", "[id]", "page.tsx")]:
    "Node status/verdict feed both a rendered span (which sets title) and DomainText's missingReason prop, a string.",
  [path.join("app", "souls", "page.tsx")]:
    "Status badge whose className is a per-state token lookup; sets title={soul.current_state} inline.",
  [path.join("app", "souls", "[id]", "page.tsx")]:
    "Same status badge as the list; sets title={soul?.current_state} inline.",
};

/**
 * Deliberate exceptions, each with the reason it is not a missing value.
 * Keep this list short and argued — an entry added to make a test pass is the
 * failure mode this whole file exists to prevent.
 */
const DASH_EXCEPTIONS: Record<string, string> = {
  [`${path.join("components", "LanguageSwitcher.tsx")}:19`]:
    "Pre-hydration skeleton: an aria-hidden, disabled <option> holding the " +
    "control's width for one tick. It represents a value still loading, not " +
    "a value that is absent.",
};

interface Violation {
  file: string;
  line: number;
  text: string;
}

function walkTsx(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const SOURCE_FILES = SCAN_ROOTS.flatMap((root) => walkTsx(path.join(FRONTEND_ROOT, root))).sort();

function relative(file: string): string {
  return path.relative(FRONTEND_ROOT, file);
}

// ---------------------------------------------------------------------------
// Rule 1 — no raw enum member in a JSX text position
// ---------------------------------------------------------------------------

/**
 * `{expr.enumField}` standing alone inside braces. The two characters before
 * the brace disqualify the non-render cases: `=` covers every JSX attribute
 * (`key={row.state}`, `value={form.node_type}`) and `$` covers template
 * interpolation (``t(`souls.states.${s.current_state}`)``), which is a lookup,
 * not a render.
 */
const RAW_ENUM_RE = new RegExp(String.raw`(^|[^=$])\{\s*([A-Za-z_$][\w$]*(?:\??\.[\w$]+)*\??\.(?:${ENUM_FIELDS.join("|")}))\s*\}`, "g");

/** Drops whole-line comments so prose describing the defect isn't read as the defect. */
function stripComment(line: string): string {
  return line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
}

function scanRawEnums(): Violation[] {
  const found: Violation[] = [];
  for (const file of SOURCE_FILES) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = stripComment(line);
      RAW_ENUM_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RAW_ENUM_RE.exec(code)) !== null) {
        found.push({ file: relative(file), line: i + 1, text: m[2] });
      }
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Rule 2 — no hand-written missing-value glyph
// ---------------------------------------------------------------------------

/**
 * A quoted em dash used as a value: `?? "—"`, `|| '—'`, `: "—"`,
 * `emptyLabel: "—"`, `>—<`. Prose that happens to contain an em dash inside a
 * longer sentence is untouched — the literal has to BE the dash.
 */
const HARDCODED_DASH_RE = /(\?\?|\|\||:|=|,|\()\s*(["'`])—\2|>\s*—\s*</g;

function scanHardcodedDashes(): Violation[] {
  const found: Violation[] = [];
  for (const file of SOURCE_FILES) {
    const rel = relative(file);
    if (CONVENTION_MODULES.includes(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // Comments explaining the convention are allowed to quote the glyph.
      const code = stripComment(line);
      HARDCODED_DASH_RE.lastIndex = 0;
      if (HARDCODED_DASH_RE.test(code) && !(`${rel}:${i + 1}` in DASH_EXCEPTIONS)) {
        found.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
      }
    });
  }
  return found;
}

function format(violations: Violation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
}

describe("§4.6 source contract", () => {
  it("scans a non-trivial number of files (guards the walker itself)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(30);
  });

  it("renders no raw domain enum member in JSX", () => {
    const violations = scanRawEnums();
    expect(
      violations.length === 0
        ? ""
        : `Raw enum members reach the screen. Route them through <DomainEnum namespace=… value=…>:\n${format(violations)}`
    ).toBe("");
  });

  it("reaches for <DomainEnum> over the raw string helper", () => {
    // resolveEnumDisplay hands back a string; only the component guarantees
    // the raw member reaches `title`. Every string-form caller must therefore
    // be a place JSX cannot go, and must say which.
    const callers = SOURCE_FILES.filter((file) => readFileSync(file, "utf8").includes("resolveEnumDisplay"))
      .map(relative)
      .filter((rel) => !CONVENTION_MODULES.includes(rel));
    const undeclared = callers.filter((rel) => !(rel in ENUM_STRING_CONTEXTS));
    expect(
      undeclared.length === 0
        ? ""
        : `These call resolveEnumDisplay directly but aren't declared string contexts. Prefer <DomainEnum namespace=… value=… className={badgeClasses}/> — it renders one span, so it can BE the badge and sets title itself:\n${undeclared.map((f) => `  ${f}`).join("\n")}`
    ).toBe("");
  });

  it("keeps every declared string context actually using the string helper", () => {
    // A stale entry is a licence nobody is using — and the next file to land
    // at that path inherits it silently.
    for (const rel of Object.keys(ENUM_STRING_CONTEXTS)) {
      const source = readFileSync(path.join(FRONTEND_ROOT, rel), "utf8");
      expect(`${rel} ${source.includes("resolveEnumDisplay")}`).toContain("true");
    }
  });

  it("pairs every string-form enum render with a title carrying the raw member", () => {
    // The defect this rule exists for: `{statusLabel}` inside a bare <span>,
    // under a comment promising the raw member was in `title`. If a file is
    // licensed to build enum labels as strings, every element it renders one
    // into has to hand-roll the attribute the component would have given it.
    const offenders: Violation[] = [];
    for (const rel of Object.keys(ENUM_STRING_CONTEXTS)) {
      const lines = readFileSync(path.join(FRONTEND_ROOT, rel), "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = stripComment(line);
        // A JSX child that is only a COMPOUND *Label helper — `statusLabel`,
        // `verdictLabel`, `ledgerLabel`. The bare word `label` is a generic
        // prop on stat cards and carries no enum.
        if (!/\{\s*\w+Label\s*(\(|\})/.test(code)) return;
        // Not a render at all.
        if (/(missingReason|aria-label)\s*[=:]/.test(code)) return;
        if (/\w+=\{/.test(code) && !/title=\{/.test(code)) return; // prop assignment, e.g. ledgerLabel={ledgerLabel}
        if (/^\s*(const|let|return|\w+:)/.test(code.trim())) return;

        // The attribute may sit on the opening tag a line or two above.
        const context = lines.slice(Math.max(0, i - 3), i + 2).join("\n");
        const title = /title=\{([^}]*)\}/.exec(context);
        // Presence of `title` is not enough — that is the same half-check that
        // let this whole class through the first time. `title={t("…")}` or a
        // string literal is a title that says nothing a reader couldn't
        // already see; only a raw expression off the record carries the
        // member. So: must exist, and must not be a translation or a literal.
        if (title && !/^\s*(t\(|["'`])/.test(title[1])) return;
        offenders.push({
          file: rel,
          line: i + 1,
          text: title ? `title={${title[1].trim()}} is not a raw member — ${line.trim().slice(0, 70)}` : line.trim().slice(0, 110),
        });
      });
    }
    expect(
      offenders.length === 0
        ? ""
        : `An enum label rendered as a string with no title={rawMember} — the raw member is then unrecoverable for anyone diagnosing:\n${format(offenders)}`
    ).toBe("");
  });

  it("keeps every dash exception pointing at a line that still holds a dash", () => {
    // An exception whose line has moved (or been fixed) silently stops
    // covering anything and starts hiding whatever now sits on that line.
    for (const location of Object.keys(DASH_EXCEPTIONS)) {
      const [rel, lineNo] = location.split(":");
      const line = readFileSync(path.join(FRONTEND_ROOT, rel), "utf8").split("\n")[Number(lineNo) - 1];
      expect(`${location} ${line ?? "<past end of file>"}`).toContain("—");
    }
  });

  it("spells no missing value by hand", () => {
    const violations = scanHardcodedDashes();
    expect(
      violations.length === 0
        ? ""
        : `Hand-written em dashes cannot say WHICH kind of missing this is. Use <MissingValue kind="unrecorded"|"inapplicable"> or <DomainText>/<DomainNumber>:\n${format(violations)}`
    ).toBe("");
  });
});

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
const DEFAULT_BUNDLE = JSON.parse(readFileSync(path.join(FRONTEND_ROOT, "messages", "zh-Hans.json"), "utf8"));
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

  it("names each kind in the tooltip, since a middle dot explains nothing alone", () => {
    renderWithI18n(<MissingValue kind="inapplicable" reason="balance is a Chinese instrument" />);
    const el = screen.getByLabelText(copy("common.value.inapplicable"));
    expect(el.getAttribute("title")).toContain("balance is a Chinese instrument");
    expect(el.textContent).toBe(MISSING_GLYPH.inapplicable);
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
    const bundle = JSON.parse(readFileSync(path.join(FRONTEND_ROOT, "messages", `${locale}.json`), "utf8"));
    const missing = DOMAIN_DISPLAY_I18N_KEYS.filter((key) => typeof lookup(bundle, key) !== "string");
    expect(missing).toEqual([]);
  });
});
