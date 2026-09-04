import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * THE BOUNDARY THIS PACKAGE CLAIMS, CHECKED AGAINST WHAT tsc ACTUALLY RESOLVES.
 *
 * `tsconfig.json` sets `lib: ["ES2020"]` with no `"dom"` and `types: []`, and
 * the header of `../host-globals.d.ts` states the consequence: "Everything
 * absent ... is a compile error in this package." That sentence is false today,
 * and this file is the reason it can stop being quietly false.
 *
 * WHAT LEAKS AND HOW. `types: []` suppresses *automatic* `@types` inclusion. It
 * does nothing about ambient globals reached through an ordinary import.
 * `src/hooks/useStatutes.ts` imports `@tanstack/react-query`, which imports
 * `@types/react`, whose `index.d.ts` pulls in `@types/react/global.d.ts` — a
 * file that declares `Document`, `Element`, `HTMLElement`, `MouseEvent`,
 * `KeyboardEvent`, `TouchEvent`, `FormData` and ~140 more. Verified with
 * `npx tsc -p packages/core/tsconfig.json --listFiles`, which lists
 * `node_modules/@types/react/global.d.ts` in the program.
 *
 * These are not merely present, they are *empty interfaces*, by design: the
 * file's own header says "all of these interfaces are empty". So
 * `const el: HTMLElement = {}` compiles. A DOM-shaped signature therefore reads
 * as accepted and carries zero type safety, and would first fail when someone
 * writes the React Native client, where `HTMLElement` has no implementation at
 * all.
 *
 * WHY THIS IS A TEST AND NOT A tsconfig CHANGE. The only tsconfig-level fixes
 * are to drop `src/hooks/**` from the program (which stops type-checking a real
 * shipped module) or to `paths`-stub `react` (which would make the one
 * React-dependent hook uncheckable). React is a declared *optional* peer
 * dependency of this package, so `@types/react` being in the program is a
 * legitimate consequence of a supported configuration. The leak cannot be
 * closed; what can be closed is the package *using* what leaked. So the rule
 * enforced here is a usage rule, and this test is its enforcement mechanism.
 *
 * ---------------------------------------------------------------------------
 * HOW THE SUBJECT LIST IS CHOSEN — read this before adding a name by hand.
 *
 * This repository's most-repeated failure is a check that runs, can go red, and
 * looks at the wrong or an incomplete population. A hand-written array of
 * `["MouseEvent", "HTMLElement", ...]` is exactly that shape: `@types/react`
 * ships a new element interface, nobody edits the array, and the guard keeps
 * passing while covering less than it did.
 *
 * So the list is not written here. It is *derived*, at test time, by parsing
 * `@types/react/global.d.ts` out of the real program and taking every name it
 * declares at global scope. Whatever that file contains is what gets banned,
 * including names added by a future `npm update`.
 *
 * Derivation alone is not enough — a derivation that silently returns `[]`
 * passes just as loudly as a correct one. Three assertions keep it honest:
 *   1. the file must be present in the program built from the real tsconfig;
 *   2. the derived set must still contain a fixed floor of names that are the
 *      point of the exercise (the event types and element types a UI signature
 *      would reach for, plus `FormData`, which this package really does use);
 *   3. the derived set must not fall below 100 entries — it has 146 today.
 * If `@types/react` reorganises this file, the guard goes red and a human
 * re-derives it, rather than passing on an empty list.
 * ---------------------------------------------------------------------------
 *
 * WHY THE PROGRAM IS BUILT FROM THE REAL tsconfig FILE. Because a hand-copied
 * options object stops matching the config the moment the config changes, and
 * nothing reports it. `ts.getParsedCommandLineOfConfigFile` reads
 * `packages/core/tsconfig.json` off disk, so `lib`, `types`, `include` and
 * `moduleResolution` are whatever that file actually says. Adding `"dom"` to
 * `lib` there is picked up by this test on the next run — that mutation was run
 * and the file-scope probe below went red, which is the only reason to believe
 * the green.
 */

/* ------------------------------------------------------------------ */
/* Program construction: the real config, plus one in-memory probe file. */
/* ------------------------------------------------------------------ */

const REACT_GLOBALS_SUFFIX = "/@types/react/global.d.ts";
const HOST_GLOBALS_SUFFIX = "/src/platform/host-globals.d.ts";

/**
 * The config is found by walking up from the runner's cwd, then *asserted* to
 * be this package's own. Silently type-checking some other tsconfig — the repo
 * root's, say — is the failure this guard is supposed to be immune to.
 */
function resolveCoreConfigPath(): string {
  const found = ts.findConfigFile(ts.sys.getCurrentDirectory(), (f) => ts.sys.fileExists(f), "tsconfig.json");
  if (found === undefined) {
    throw new Error(`no tsconfig.json found upward from ${ts.sys.getCurrentDirectory()}`);
  }
  return found;
}

function parseCoreConfig(configPath: string): ts.ParsedCommandLine {
  const parseHost: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: (rootDir, extensions, excludes, includes, depth) =>
      ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth),
    fileExists: (f) => ts.sys.fileExists(f),
    readFile: (f) => ts.sys.readFile(f),
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, parseHost);
  if (parsed === undefined) {
    throw new Error(`could not parse ${configPath}`);
  }
  return parsed;
}

interface BuiltProgram {
  program: ts.Program;
  packageDir: string;
  probePath: string;
}

/**
 * Builds the package's real program and grafts one extra source file onto it.
 * The probe is in memory rather than on disk so a crashed run cannot leave a
 * file behind that the next `tsc` picks up.
 */
function buildProgramWithProbe(probeSource: string): BuiltProgram {
  const configPath = resolveCoreConfigPath();
  const packageDir = configPath.slice(0, configPath.lastIndexOf("/"));
  const parsed = parseCoreConfig(configPath);
  const probePath = `${packageDir}/src/__dom_boundary_probe__.ts`;

  const host = ts.createCompilerHost(parsed.options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    fileName === probePath
      ? ts.createSourceFile(fileName, probeSource, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreate);
  host.fileExists = (fileName) => (fileName === probePath ? true : fileExists(fileName));
  host.readFile = (fileName) => (fileName === probePath ? probeSource : readFile(fileName));

  const program = ts.createProgram([...parsed.fileNames, probePath], parsed.options, host);
  return { program, packageDir, probePath };
}

/** Every name `@types/react/global.d.ts` introduces at global scope. */
function declaredGlobalNames(file: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of file.statements) {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      if (statement.name !== undefined && ts.isIdentifier(statement.name)) {
        names.push(statement.name.text);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          names.push(decl.name.text);
        }
      }
    }
  }
  return [...new Set(names)];
}

/* ------------------------------------------------------------------ */

describe("packages/core DOM boundary", () => {
  /**
   * The floor. Chosen as the names a UI-shaped signature written by mistake in
   * this package would actually reach for — the four event types that show up
   * in handler props (`MouseEvent`, `KeyboardEvent`, `TouchEvent`, and their
   * base `Event`), the three element types that show up in anchor/ref/target
   * props (`HTMLElement`, `HTMLInputElement`, `Element`), the document root
   * (`Document`), and `FormData`, which is the one name on the list this
   * package genuinely uses. It is a floor, not the subject list: the subject
   * list is everything the file declares.
   */
  const REQUIRED_FLOOR = [
    "Document",
    "Element",
    "Event",
    "FormData",
    "HTMLElement",
    "HTMLInputElement",
    "KeyboardEvent",
    "MouseEvent",
    "TouchEvent",
  ];

  it("derives the banned-name list from @types/react/global.d.ts, and the derivation is not empty", () => {
    const { program } = buildProgramWithProbe("export {};\n");
    const globalsFile = program.getSourceFiles().find((f) => f.fileName.endsWith(REACT_GLOBALS_SUFFIX));

    expect(
      globalsFile,
      "@types/react/global.d.ts is no longer in this package's program. That may " +
        "mean the leak was closed at the tsconfig level — good — but this guard " +
        "then has nothing to check and must be rewritten rather than left green.",
    ).toBeDefined();

    const names = declaredGlobalNames(globalsFile as ts.SourceFile);
    expect(names.length).toBeGreaterThan(100);
    for (const required of REQUIRED_FLOOR) {
      expect(names, `${required} vanished from the derived list; re-derive before trusting this guard`).toContain(
        required,
      );
    }
  });

  /**
   * THE GUARD. Not "does the name resolve" — it does, and this package cannot
   * stop it resolving — but "does anything in `src/` use a name that only
   * resolves because of the leak".
   *
   * A name is allowed iff `src/platform/host-globals.d.ts` also declares it.
   * That file is the deliberate allowlist and its header says adding an entry
   * *is* the decision. Declaration merging means an allowed name ends up with
   * declarations in both files, so the test asks whether host-globals.d.ts is
   * among them rather than whether global.d.ts is the only one — which also
   * makes the rule survive someone adding `"dom"` to `lib`, where every one of
   * these names would additionally be declared in `lib.dom.d.ts`.
   */
  it("no source file uses a global that exists only because @types/react leaked into the program", () => {
    const { program, packageDir } = buildProgramWithProbe("export {};\n");
    const checker = program.getTypeChecker();
    const globalsFile = program.getSourceFiles().find((f) => f.fileName.endsWith(REACT_GLOBALS_SUFFIX));
    if (globalsFile === undefined) {
      throw new Error("@types/react/global.d.ts not in program — see the previous test");
    }
    const banned = new Set(declaredGlobalNames(globalsFile));

    const violations: string[] = [];
    const sourceRoot = `${packageDir}/src/`;
    for (const file of program.getSourceFiles()) {
      if (!file.fileName.startsWith(sourceRoot)) continue;
      // The allowlist file necessarily names what it allows.
      if (file.fileName.endsWith(HOST_GLOBALS_SUFFIX)) continue;

      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && banned.has(node.text)) {
          const symbol = checker.getSymbolAtLocation(node);
          const declarations = symbol?.declarations ?? [];
          const fromLeak = declarations.some((d) => d.getSourceFile().fileName.endsWith(REACT_GLOBALS_SUFFIX));
          const fromAllowlist = declarations.some((d) => d.getSourceFile().fileName.endsWith(HOST_GLOBALS_SUFFIX));
          if (fromLeak && !fromAllowlist) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart());
            violations.push(`${file.fileName.slice(packageDir.length + 1)}:${line + 1}  ${node.text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }

    expect(
      violations,
      "These names resolve only through @types/react/global.d.ts, where they are " +
        "declared as EMPTY interfaces — `const x: HTMLElement = {}` compiles. They " +
        "give no type safety here and do not exist on React Native. Either drop the " +
        "DOM-shaped signature, or, if the host really does provide the thing on every " +
        "platform, declare it deliberately in src/platform/host-globals.d.ts with a " +
        "comment saying why (that is what was done for FormData).",
    ).toEqual([]);
  });

  /**
   * The second half of the boundary, and the half that notices a `lib` change.
   * These names are the ones `host-globals.d.ts` names in its header as the
   * absences that matter. None of them is declared in `@types/react/global.d.ts`
   * — the leak brings in DOM *types*, not DOM *values* — so the rule above
   * cannot see them. Adding `"dom"` to `lib` in tsconfig.json makes every one
   * of them resolve, and this is what goes red when it does.
   *
   * The probe is compiled by the same program the package's own `tsc --noEmit`
   * builds, from the same config file on disk. There is no second copy of the
   * compiler options to drift.
   *
   * WHY THIS ASKS THE CHECKER AND NOT THE DIAGNOSTIC LIST. The first draft
   * matched diagnostics with code 2304, "Cannot find name 'x'", and reported
   * `document` as resolving when it does not: TypeScript has a *special* error
   * for the DOM names, TS2584, "Cannot find name 'document'. Do you need to
   * change your target library?", and 2304 never fires for them. A guard keyed
   * to error numbers is keyed to the wrong thing twice over — the numbers vary
   * by name, and the message text is localised. `getSymbolAtLocation` returning
   * `undefined` *is* the property under test: the name does not resolve.
   */
  it("host-only DOM values are unresolvable (this is what catches a `lib: dom` change)", () => {
    const forbidden = ["document", "window", "localStorage", "sessionStorage", "navigator", "location", "alert"];
    const probeSource = forbidden.map((name, i) => `export const probe${i} = ${name};`).join("\n") + "\n";

    const { program, probePath } = buildProgramWithProbe(probeSource);
    const checker = program.getTypeChecker();
    const probeFile = program.getSourceFiles().find((f) => f.fileName === probePath);
    if (probeFile === undefined) {
      throw new Error(`probe file ${probePath} did not make it into the program`);
    }

    const resolved: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && forbidden.includes(node.text)) {
        const symbol = checker.getSymbolAtLocation(node);
        const from = symbol?.declarations?.[0]?.getSourceFile().fileName ?? "";
        if (symbol !== undefined) {
          resolved.push(`${node.text} (declared in ${from})`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(probeFile);

    // Guard the guard: if the probe were dropped from the program, or its
    // identifiers never visited, `resolved` would be empty for the wrong
    // reason and this test would pass while checking nothing.
    expect(probeFile.statements).toHaveLength(forbidden.length);

    expect(
      resolved,
      "These browser globals resolve inside @soulledger/core. The package is " +
        "consumed by React Native as well as by Next.js and none of them exist " +
        'there. Check whether `lib` in packages/core/tsconfig.json grew a "dom" ' +
        "entry, or whether a dependency dragged in a DOM lib reference.",
    ).toEqual([]);
  });
});
