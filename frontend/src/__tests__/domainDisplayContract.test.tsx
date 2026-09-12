/**
 * Contract test for the display convention in src/lib/domainDisplay.ts — the
 * SOURCE SCAN half. (docs/design-handoff/BRIEF.md §4.6 "Raw system values leak
 * into the interface".)
 *
 * A scan over every .tsx under app/, components/ and src/components/. §4.6 is
 * not a bug in one component — it is the same idiom pasted into ~20 files, each
 * of which drifted separately. A behavioural test of <DomainEnum> would pass
 * forever while a new screen renders `{tmpl.civilization}` next to it. So the
 * scan is the part that holds; the behavioural half only pins down what the
 * scan is pushing everyone towards, and it lives in
 * `domainDisplayRendering.test.tsx`. The two were one file until it passed the
 * 500-line ceiling; neither half's assertions changed in the move.
 *
 * The scan also has to tell a DECISION from a regression: the ledger's audit
 * rows show a record id in a list on purpose, which breaks two clauses of
 * IDENTIFIER_POLICY. That is registered in IDENTIFIER_POLICY_EXCEPTIONS and
 * checked from both ends — an unregistered id render fails, and so does a
 * registered entry whose page has stopped rendering one.
 *
 * THE THING THAT WOULD MAKE THIS FILE LIE is an empty scan. Every rule below
 * is "the offenders are exactly this set", and a walker that returns no files
 * satisfies all of them at once, in silence. `SOURCE_FILES.length > 30` and
 * `sites.length > 0` are the two assertions that exist only to make that state
 * loud; do not delete them to make a refactor green.
 *
 * Sanity check when editing: revert any single fix in the files listed by the
 * scan and rule 1 goes red naming that file and line.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { IDENTIFIER_POLICY_EXCEPTIONS } from "@/src/lib/domainDisplay";

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
  // Added 2026-09-02, after `conclusion_type` shipped as a raw member.
  // `app/cross-judgments/[id]` printed `PASS` / `FAIL` verbatim at text-06 bold
  // — the conclusion of a cross-civilization tribunal, the largest text on the
  // panel — with all 2049 tests green, because this list had never been told
  // the field existed. The rule ran, could go red, and was looking at the wrong
  // subjects. The meta-test below now stops that from happening silently again.
  "conclusion_type",
  "approver_type",
  "reaction_type",
  "visibility",
  // Added 2026-09-03 by the meta-test below, working exactly as intended.
  // `MenuItem.menu_type` had been `string`; narrowing it to the three members
  // `apps.menus.models.MenuType` actually has made it visible to
  // `unionFieldsInApiTypes()`, which then reported it missing here. The subject
  // list grew, and the registry was made to grow with it — which is the whole
  // mechanism this file gained after `conclusion_type`.
  "menu_type",
  // Added 2026-09-12. `User.role` is typed through an alias (`UserRole`, itself
  // built on `BuiltinUserRole`), and the meta-test below only recognised
  // unions spelled inline — so `role` was never reported missing, and
  // `UserDeleteDialog.tsx` printed `{user.role}` verbatim with every gate
  // green (FT-03). The meta-test resolves aliases now; this entry is what it
  // demanded the moment it could see.
  "role",
  // Surfaced by the same alias walk on the same day: `Statute.corpus` and
  // `.polarity` are `StatuteCorpus` / `StatutePolarity`. Both already render
  // through <DomainEnum> on /corpus and in JudgmentGroundsPanel; the registry
  // had simply never been told they were enums.
  "corpus",
  "polarity",
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
  [path.join("src", "components", "judgment", "JudgmentQueueContext.tsx")]:
    "EnumBadge takes its label as a ReactNode prop on a value object, and the badge sets title from that same object; both call sites pass title={soul.current_state}/{soul.civilization} by hand.",
  [path.join("src", "components", "layout", "TenantSignal.tsx")]:
    "The masthead needs the civilization name as a string, not a span: it goes into title/aria-label on the two code-only variants and into a truncating flex child on the third. Carries title={civilization} — the raw member — on all three.",
  [path.join("src", "components", "judgment", "JudgmentQueueConsole.tsx")]:
    "Interpolated into t('judgment.queue.pending_verdict', { verdict }) as a parameter, not rendered. The one place this file DOES render a verdict (the verdict buttons) uses <DomainEnum>.",
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
 * Walks the TypeScript AST rather than the text. Until 2026-09-12 this was a
 * per-line regex for `{expr.enumField}` — one spelling of the defect. The same
 * value reaches the same text node through a template literal
 * (`{`${s.civilization}`}`), a ternary (`{x ? s.civilization : null}`), a
 * destructuring IIFE (`{(() => { const { civilization } = s; return civilization })()}`)
 * or braces split across lines, and the regex saw none of them: 14/14 green
 * against every one, red only against `{s.civilization}` itself (FT-02). The
 * live escapee was `app/dashboard/page.tsx` rendering `{action}` — a bare
 * identifier from `Object.entries(grouped).map(([action, logs]) => …)`, which
 * no `x.action` pattern can match.
 *
 * What "reaches the text node" means here. Start at a JSX *child* expression
 * (attributes are not display — `key={row.state}` is fine) and follow every
 * branch that can become the rendered value: both arms of `?:`, both sides of
 * `||` / `??`, the right side of `&&`, every `${}` of a template, the returns
 * of an immediately-invoked function. A leaf is a property access whose name
 * is an enum field, or a bare identifier bound by destructuring to one
 * (`const { status } = row`, `([action, n]) =>`). A call is a boundary:
 * `t(`souls.states.${s.state}`)` is a lookup, and what it returns is the
 * translator's business.
 */
function renderedLeaves(expr: ts.Expression, out: ts.Expression[]): void {
  if (ts.isParenthesizedExpression(expr)) {
    renderedLeaves(expr.expression, out);
  } else if (ts.isConditionalExpression(expr)) {
    renderedLeaves(expr.whenTrue, out);
    renderedLeaves(expr.whenFalse, out);
  } else if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      renderedLeaves(expr.left, out);
      renderedLeaves(expr.right, out);
    } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      renderedLeaves(expr.right, out);
    }
  } else if (ts.isTemplateExpression(expr)) {
    for (const span of expr.templateSpans) renderedLeaves(span.expression, out);
  } else if (ts.isCallExpression(expr)) {
    const callee = ts.isParenthesizedExpression(expr.expression) ? expr.expression.expression : expr.expression;
    if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      if (ts.isBlock(callee.body)) {
        const returns = (node: ts.Node): void => {
          if (ts.isReturnStatement(node) && node.expression) renderedLeaves(node.expression, out);
          else if (!ts.isFunctionLike(node)) ts.forEachChild(node, returns);
        };
        ts.forEachChild(callee.body, returns);
      } else {
        renderedLeaves(callee.body, out);
      }
    }
  } else if (ts.isPropertyAccessExpression(expr) || ts.isIdentifier(expr)) {
    out.push(expr);
  }
}

/**
 * The destructuring that declares `id` in the nearest enclosing scope, walking
 * outward from the identifier: the arrow it sits in, then the block, then the
 * function around that, up to the file. Nested functions along the way are not
 * entered — their bindings are not in scope. Null when `id` is not a
 * destructured name at all (a plain `const label = …` carries no field name
 * and is not this rule's subject).
 */
function destructuringBindingOf(id: ts.Identifier): ts.BindingElement | null {
  for (let scope: ts.Node | undefined = id.parent; scope; scope = scope.parent) {
    if (!(ts.isFunctionLike(scope) || ts.isBlock(scope) || ts.isSourceFile(scope))) continue;
    let hit: ts.BindingElement | null = null;
    const look = (node: ts.Node): void => {
      if (hit) return;
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === id.text) {
        hit = node;
        return;
      }
      if (node !== scope && ts.isFunctionLike(node)) return;
      ts.forEachChild(node, look);
    };
    look(scope);
    if (hit) return hit;
  }
  return null;
}

/**
 * Props are not rows. `function EmptyState({ title, action }: EmptyStateProps)`
 * binds a name that is in ENUM_FIELDS, and `action` there is a ReactNode slot,
 * not an audit action — a component's parameter names are its own API. The
 * discriminator is the annotation: an object pattern on a TYPE-ANNOTATED
 * parameter is a component boundary and is skipped. A pattern in a body
 * (`const { civilization } = soul`), an array pattern (`([action, n]) =>`), or
 * an unannotated callback parameter (`.map(({ status }) => …)`, contextually
 * typed from the row) is data and counts.
 */
function isPropsPattern(pattern: ts.Node): boolean {
  return ts.isObjectBindingPattern(pattern) && ts.isParameter(pattern.parent) && pattern.parent.type !== undefined;
}

/** The enum field a rendered leaf names, or null when it names none. */
function enumFieldOf(leaf: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(leaf)) return ENUM_FIELDS.includes(leaf.name.text) ? leaf.name.text : null;
  if (!ts.isIdentifier(leaf)) return null;
  const binding = destructuringBindingOf(leaf);
  if (!binding || isPropsPattern(binding.parent)) return null;
  const field = binding.propertyName && ts.isIdentifier(binding.propertyName) ? binding.propertyName.text : binding.name.getText();
  return ENUM_FIELDS.includes(field) ? field : null;
}

function rawEnumViolationsIn(file: string, text: string): Violation[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const leaves: ts.Expression[] = [];
      renderedLeaves(node.expression, leaves);
      for (const leaf of leaves) {
        if (enumFieldOf(leaf) === null) continue;
        found.push({ file, line: sf.getLineAndCharacterOfPosition(leaf.getStart(sf)).line + 1, text: leaf.getText(sf) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Whole-file comment stripping, for the checks that ask "does this file
 * mention X" rather than scanning line by line.
 *
 * `stripComment` below drops a comment LINE, which is enough for the two
 * regex scanners. It is not enough for `readFileSync(file).includes(…)`:
 * that reads the whole file, so one sentence of prose naming a helper counts
 * as calling it. `src/components/workflow/detail/WorkflowInfoCard.tsx` was
 * reported as an undeclared string context on the strength of a comment
 * saying why it does NOT call `resolveEnumDisplay` — the call stays on the
 * page and the label arrives as a prop.
 *
 * That is this file's own subject turned on itself: its header records a
 * comment claiming "the raw member goes to `title`" sitting above a badge
 * with no title. A scanner that cannot tell a prohibition from its
 * explanation is one whose cheapest green is deleting the explanation.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\n]*?\/\/[^\n]*$/gm, "");
}

/** Drops whole-line comments so prose describing the defect isn't read as the defect. */
function stripComment(line: string): string {
  return line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
}

function scanRawEnums(): Violation[] {
  return SOURCE_FILES.flatMap((file) => rawEnumViolationsIn(relative(file), readFileSync(file, "utf8")));
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

// ---------------------------------------------------------------------------
// Rule 3 — identifiers only where IDENTIFIER_POLICY (or its registry) allows
// ---------------------------------------------------------------------------

/**
 * Foreign keys DRF serialises as a bare primary key while **not** being named
 * like one.
 *
 * WHY THIS LIST HAS TO EXIST. The pattern below recognises identifiers by
 * spelling — `id`, `uuid`, `pk`, `*_id` — and that is a complete rule only
 * while every id-bearing field is spelled that way. It is not. A DRF
 * `ForeignKey` with no `source=` override serialises to the related row's pk
 * under **the model field's own name**, and those names are chosen to read as
 * relationships, not as identifiers: `dispatched_by`, `approver`.
 *
 * Both of those were being rendered straight into a JSX text position while
 * every rule in this file was green, because the rule ran, could go red, and
 * its subject list did not contain them. That is the same shape as
 * `conclusion_type` two entries below in ENUM_FIELDS, and as commit `4051e51`.
 * Found by diffing the hand-written API types against the generated OpenAPI
 * schema: both were typed `string` in the frontend and `number | null` in the
 * document.
 *
 * Adding one here is a claim that the field carries a pk. Verify it against
 * the serializer — a `CharField(source="…​.username")` beside it (like
 * `dispatched_by_name`) is the tell that the bare field is the key.
 */
const FK_PRIMARY_KEY_FIELDS = ["dispatched_by", "approver"];

/**
 * Property names holding an opaque pointer to a record: `id`, `uuid`, `pk`,
 * anything `*_id`, and the foreign keys above that are not spelled like one.
 * `.name`, `.code`, `.label` are deliberately absent — they mean something to
 * a reader, which is the whole distinction.
 */
const IDENTIFIER_FIELD_RE = String.raw`id|uuid|pk|[a-z]\w*_id|${FK_PRIMARY_KEY_FIELDS.join("|")}`;

/**
 * `{row.resource_id}` standing in a JSX text position. Two-character guard:
 * `=` disqualifies every attribute — `key={row.id}`, `id={soul.id}`,
 * `href={…}` — and `$` disqualifies template interpolation, which builds a
 * URL rather than rendering. React keys and route segments are not display
 * and the policy does not reach them. (Rule 1 used the same guard as a regex
 * until 2026-09-12; it walks the AST now. This one still reads lines, and so
 * still has the equivalent-spelling blind spot Rule 1 no longer has.)
 */
const RAW_IDENTIFIER_RE = new RegExp(
  String.raw`(^|[^=$])\{\s*([A-Za-z_$][\w$]*(?:\??\.[\w$]+)*\??\.(?:${IDENTIFIER_FIELD_RE}))\s*\}`,
  "g"
);

/**
 * The same identifier, reached through a fallback: `{row.name || row.owner}`.
 *
 * WHY A SECOND PATTERN. `RAW_IDENTIFIER_RE` requires the braced expression to
 * be **only** the member path, so anything with an operator in it slips past —
 * and `name || id` is not an exotic spelling, it is the exact shape this defect
 * takes every time. Two live instances were found this way and neither was
 * visible to the rule above:
 *
 *     {dispatch.dispatched_by_name || dispatch.dispatched_by}
 *     {judgment.soul_name || judgment.soul}          (fixed earlier, same shape)
 *
 * The fallback is what makes it dangerous rather than merely wrong: the id is
 * shown *only* when the name is missing, so it never appears in the happy path
 * a developer or a screenshot exercises. It surfaces for exactly the rows whose
 * subject has been deleted.
 *
 * `||` and `??` both, and the identifier may sit on either side — a name can be
 * the fallback for an id just as easily.
 */
const FALLBACK_EXPRESSION_RE = new RegExp(
  String.raw`(?:^|[^=$])\{[^{}]*(?:\|\||\?\?)[^{}]*\}`,
  "g"
);
const IDENTIFIER_MEMBER_RE = new RegExp(
  String.raw`[A-Za-z_$][\w$]*(?:\??\.[\w$]+)*\??\.(?:${IDENTIFIER_FIELD_RE})\b`,
  "g"
);

/** Where an id reaches a reader, and whether it arrived copyable. */
interface IdentifierSite extends Violation {
  kind: "raw" | "chip";
}

function scanIdentifierSites(): IdentifierSite[] {
  const found: IdentifierSite[] = [];
  for (const file of SOURCE_FILES) {
    const rel = relative(file);
    if (CONVENTION_MODULES.includes(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = stripComment(line);
      RAW_IDENTIFIER_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RAW_IDENTIFIER_RE.exec(code)) !== null) {
        found.push({ file: rel, line: i + 1, text: m[2], kind: "raw" });
      }
      // `{name || id}` — see FALLBACK_EXPRESSION_RE. Reported with the whole
      // expression rather than just the member, because "which side of the
      // `||`" is the first thing a reader needs.
      FALLBACK_EXPRESSION_RE.lastIndex = 0;
      let f: RegExpExecArray | null;
      while ((f = FALLBACK_EXPRESSION_RE.exec(code)) !== null) {
        IDENTIFIER_MEMBER_RE.lastIndex = 0;
        if (IDENTIFIER_MEMBER_RE.test(f[0])) {
          found.push({ file: rel, line: i + 1, text: f[0].trim(), kind: "raw" });
        }
      }
      if (code.includes("<IdentifierChip")) {
        found.push({ file: rel, line: i + 1, text: line.trim().slice(0, 110), kind: "chip" });
      }
    });
  }
  return found;
}

/** Registry keys are POSIX; the scan reports platform separators. */
const REGISTERED_EXCEPTION_FILES = new Set(IDENTIFIER_POLICY_EXCEPTIONS.map((e) => e.file.split("/").join(path.sep)));

/**
 * Clause 1's "the entity the page is *about*": a route with a dynamic segment
 * whose leaf is the page itself. A list under app/souls/page.tsx is not one;
 * app/souls/[id]/page.tsx is.
 */
function isDetailPage(rel: string): boolean {
  return rel.startsWith(`app${path.sep}`) && rel.endsWith(`${path.sep}page.tsx`) && /\[[^\]]+\]/.test(rel);
}

function format(violations: Violation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
}

/**
 * THE LIST OF ENUM FIELDS IS ITSELF A SUBJECT LIST, AND IT WAS WRONG.
 *
 * Every rule in this file works by recognising a field name. `ENUM_FIELDS` is
 * hand-written, so a field it has never heard of is invisible to all of them —
 * the check runs, the check can go red, and it is watching the wrong set. That
 * is exactly how `conclusion_type` reached production: `PASS` / `FAIL` printed
 * verbatim as a tribunal's verdict, with every gate green.
 *
 * This cannot be fully derived — most enum fields in `lib/api/*.ts` are typed
 * as plain `string`, so nothing in the types says they are enums. But the ones
 * that ARE declared as string unions can be derived exactly, and requiring the
 * list to contain all of them closes the mechanical half. What remains
 * hand-maintained is now explicitly the `string`-typed half, rather than the
 * whole thing being hand-maintained without anyone saying so.
 */
describe("the enum-field registry is not quietly behind the API types", () => {
  /** Members of a domain enum are SCREAMING_SNAKE; `"asc" | "desc"` is a sort order, not one. */
  const isMemberLiteral = (t: ts.TypeNode): boolean =>
    ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) && /^[A-Z][A-Z0-9_]*$/.test(t.literal.text);

  /** A field whose type is a union of enum members, spelled inline OR through
   *  an alias, in any `packages/core/src/api/*.ts`.
   *
   *  Aliases matter: until 2026-09-12 this was a regex for `field: "A" | "B"`
   *  on one line, so `role: UserRole` — where `UserRole` is
   *  `BuiltinUserRole | (string & {})` and `BuiltinUserRole` is the five-member
   *  union — was invisible, and `role` never reached ENUM_FIELDS (FT-03). Alias
   *  resolution iterates to a fixed point so an alias of an alias counts.
   *  `readdirSync` throws on a wrong path rather than quietly scanning nothing. */
  function unionFieldsInApiTypes(): string[] {
    const dir = path.join(FRONTEND_ROOT, "..", "packages", "core", "src", "api");
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ts.createSourceFile(f, readFileSync(path.join(dir, f), "utf8"), ts.ScriptTarget.Latest, true));
    const aliases = new Map<string, ts.TypeNode>();
    for (const sf of sources) {
      sf.forEachChild((n) => {
        if (ts.isTypeAliasDeclaration(n)) aliases.set(n.name.text, n.type);
      });
    }
    const enumLike = new Set<string>();
    const isEnumLike = (t: ts.TypeNode): boolean => {
      if (ts.isParenthesizedTypeNode(t)) return isEnumLike(t.type);
      if (ts.isUnionTypeNode(t)) return t.types.filter(isMemberLiteral).length >= 2 || t.types.some(isEnumLike);
      return ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && enumLike.has(t.typeName.text);
    };
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, t] of aliases) {
        if (!enumLike.has(name) && isEnumLike(t)) {
          enumLike.add(name);
          grew = true;
        }
      }
    }
    const names = new Set<string>();
    const visit = (n: ts.Node): void => {
      if (ts.isPropertySignature(n) && n.type && ts.isIdentifier(n.name) && isEnumLike(n.type)) names.add(n.name.text);
      n.forEachChild(visit);
    };
    for (const sf of sources) visit(sf);
    return [...names].sort();
  }

  it("finds union-typed fields to check, so this cannot pass on an empty set", () => {
    expect(unionFieldsInApiTypes().length).toBeGreaterThanOrEqual(5);
  });

  it("sees a field typed through an alias, not only an inline union", () => {
    // `User.role: UserRole` is the live case; if the alias walk regresses to
    // inline-only, this is the assertion that says so, not a silent shrink.
    expect(unionFieldsInApiTypes()).toContain("role");
  });

  it("registers every field the API types declare as a string union", () => {
    const missing = unionFieldsInApiTypes().filter((n) => !ENUM_FIELDS.includes(n));
    if (missing.length > 0) {
      throw new Error(
        `These fields are declared as string unions in packages/core/src/api/ but are not in ` +
          `ENUM_FIELDS, so every rule in this file is blind to them — including ` +
          `the one that stops a raw member reaching the screen. Add them.\n\n` +
          missing.join("\n")
      );
    }
    expect(missing).toEqual([]);
  });
});

describe("§4.6 source contract", () => {
  it("scans a non-trivial number of files (guards the walker itself)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(30);
  });

  it("sees every spelling that reaches the text node, and none that does not", () => {
    // The scanner's own proof. Each line below is a way the same value can
    // reach the same text node; the regex this replaced saw only the first.
    const probe = `
      const V = () => (
        <div>
          {soul.civilization}
          {\`\${soul.civilization}\`}
          {ok ? soul.civilization : null}
          {(() => { const { civilization } = soul; return civilization; })()}
          {
            soul.civilization
          }
          {label || soul.civilization}
          {Object.entries(g).map(([action, n]) => <b key={action}>{action}</b>)}
          {rows.map(({ status }) => <i key={status}>{status}</i>)}
          <span title={soul.civilization} data-state={soul.status}>{t(\`souls.civ.\${soul.civilization}\`)}</span>
          <DomainEnum namespace="x" value={soul.civilization} />
        </div>
      );
      function Slot({ title, action }: { title: string; action?: React.ReactNode }) {
        return <p>{title}{action}</p>;
      }`;
    expect(rawEnumViolationsIn("probe.tsx", probe).map((v) => v.line)).toEqual([4, 5, 6, 7, 9, 11, 12, 13]);
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
    // `codeOf`, not `readFileSync`: a comment naming the helper is not a call.
    const callers = SOURCE_FILES.filter((file) => codeOf(file).includes("resolveEnumDisplay"))
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
      // Also `codeOf`: a declared licence whose only trace is a comment is
      // stale in the direction this test exists to catch.
      const source = codeOf(path.join(FRONTEND_ROOT, rel));
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

describe("§4.6 identifier placement", () => {
  // IDENTIFIER_POLICY has four clauses, and the owner's ruling on the ledger's
  // audit rows is that clauses 1-2 (detail pages, once per page) can be argued
  // with in a named entry, while 3-4 (copyable, never as a name) cannot. These
  // three rules encode exactly that split, so a registered exception licenses a
  // PLACE and never a behaviour.

  it("finds the identifier renders it is supposed to be policing", () => {
    // Without this the two rules below pass by scanning nothing — the same
    // vacuous-green failure the file's own walker guard exists to catch.
    const sites = scanIdentifierSites();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.some((s) => s.kind === "chip")).toBe(true);
  });

  it("renders no identifier a reader cannot copy", () => {
    // Clause 3, and no registry entry suspends it: `#{activity.resource_id}`
    // as bare text is a primary key someone has to retype by eye into a query.
    // Being listed in IDENTIFIER_POLICY_EXCEPTIONS does not help here — that
    // registry answers "where", never "how".
    const raw = scanIdentifierSites().filter((s) => s.kind === "raw");
    expect(
      raw.length === 0
        ? ""
        : `Identifiers rendered as dead text. Use <IdentifierChip id={…} variant="inline"|"chip"> — truncated on screen, whole value on the clipboard:\n${format(raw)}`
    ).toBe("");
  });

  it("shows an identifier outside a detail-page header only where the registry says so", () => {
    const sites = scanIdentifierSites();
    const perFile = new Map<string, IdentifierSite[]>();
    for (const site of sites) perFile.set(site.file, [...(perFile.get(site.file) ?? []), site]);

    const offenders: Violation[] = [];
    for (const [file, fileSites] of perFile) {
      if (REGISTERED_EXCEPTION_FILES.has(file)) continue; // clauses 1-2 waived, in writing
      if (!isDetailPage(file)) {
        // Clause 1 — a list row or a nested reference showing a primary key.
        offenders.push(...fileSites.map((s) => ({ ...s, text: `not a detail page — ${s.text}` })));
      } else if (fileSites.length > 1) {
        // Clause 2 — the right page, but the id has started repeating.
        offenders.push(...fileSites.map((s) => ({ ...s, text: `${fileSites.length} identifier renders on one page — ${s.text}` })));
      }
    }
    expect(
      offenders.length === 0
        ? ""
        : "An identifier appears where IDENTIFIER_POLICY does not sanction one. Show the NAME, or — if the id is genuinely the content, as it is in an audit line — add an entry to IDENTIFIER_POLICY_EXCEPTIONS in src/lib/domainDisplay.ts saying so:\n" +
          format(offenders)
    ).toBe("");
  });

  it("keeps every registered exception pointing at a page that still renders an identifier", () => {
    // An exception whose site has gone away is a licence nobody is using, and
    // the next code to land in that file inherits it in silence — the same
    // decay the dash-exception check above guards against.
    const scanned = new Set(scanIdentifierSites().map((s) => s.file));
    for (const exception of IDENTIFIER_POLICY_EXCEPTIONS) {
      const rel = exception.file.split("/").join(path.sep);
      expect(`${rel} still renders an identifier: ${scanned.has(rel)}`).toContain("true");
    }
  });

  it("makes every exception argue its case rather than just occupy a slot", () => {
    for (const exception of IDENTIFIER_POLICY_EXCEPTIONS) {
      expect(statSync(path.join(FRONTEND_ROOT, exception.file)).isFile()).toBe(true);
      expect(exception.registered).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(exception.site.length).toBeGreaterThan(10);
      // A one-liner like "needed for debugging" is how a registry turns into a
      // rubber stamp; the reason has to survive being read by the next person.
      expect(`${exception.file}: ${exception.reason}`.length).toBeGreaterThan(160);
    }
  });
});
