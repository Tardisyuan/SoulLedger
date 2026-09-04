import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * THE OTHER HALF OF THE ALLOWLIST: the Node surface must not resolve either.
 *
 * `domBoundary.test.ts` beside this file guards the *browser* absences —
 * `document`, `window`, `localStorage` and the ~146 DOM type names that leak in
 * through `@types/react`. It cannot see this one. `host-globals.d.ts`'s header
 * records that `@types/node` was considered and rejected ("it would supply
 * `process` and the timers, but it would also supply `Buffer`, `global`,
 * `__dirname` and the rest of the Node surface, which no browser and no phone
 * has"), and then the file declared `process` by hand anyway. `types: []` keeps
 * `@types/node` out; nothing kept the hand-written half out.
 *
 * WHY `process` IN PARTICULAR. Its `env` was read by three modules for
 * `NEXT_PUBLIC_API_URL`, which is the leak that produced `PlatformAdapter`
 * itself: Expo defines no `NEXT_PUBLIC_*`, Tauri reads `import.meta.env.VITE_*`,
 * and both would have taken a `http://localhost:8000` fallback in silence — on
 * a phone, `localhost` is the phone. `eslint.config.mjs` bans the syntax, but a
 * syntax selector matches shapes and there are at least four shapes that reach
 * the same value (`process["env"].X`, `const { env } = process`,
 * `const p = process; p.env.X`, `globalThis.process.env.X` — the first three
 * were confirmed to slip past the previous `MemberExpression` selector). An
 * undeclared name has no shapes, so the declaration going away is the real
 * fix and this is what holds it.
 *
 * `Buffer`, `global`, `__dirname`, `__filename`, `require` and `module` are
 * here alongside it because they are the rest of what accepting `@types/node`
 * would have meant. None is declared today; naming them makes that a checked
 * fact rather than a coincidence, and makes the diagnostic obvious if someone
 * adds the dependency to make one test file compile.
 *
 * WHY THE PROBE MACHINERY IS DUPLICATED FROM domBoundary.test.ts RATHER THAN
 * SHARED. Sharing it would mean a support module imported by both, and vitest's
 * `include` is `src/**&#47;*.test.ts` — a support file is not a suite and must not
 * be collected as one, so it would have to sit outside `__tests__` or be named
 * around the matcher. That is a real option; it was not taken because this file
 * needs only the two smallest pieces (parse the config off disk, graft one
 * in-memory source file onto the program) and duplicating ~40 lines is cheaper
 * than the indirection. If a third probe suite appears, extract it then.
 *
 * The config is read from disk rather than reconstructed, for the reason
 * domBoundary states: a hand-copied options object stops matching the config
 * the moment the config changes, and nothing reports it.
 */

const CONFIG_SUFFIX = "/packages/core/tsconfig.json";

function buildProbeProgram(probeSource: string): { program: ts.Program; probePath: string } {
  const configPath = ts.findConfigFile(ts.sys.getCurrentDirectory(), (f) => ts.sys.fileExists(f), "tsconfig.json");
  if (configPath === undefined) {
    throw new Error(`no tsconfig.json found upward from ${ts.sys.getCurrentDirectory()}`);
  }
  // Type-checking some other package's tsconfig — the repo root's, say — would
  // pass for the wrong reason. Assert the subject before using it.
  if (!configPath.endsWith(CONFIG_SUFFIX)) {
    throw new Error(`found ${configPath}, which is not this package's tsconfig`);
  }

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

  const packageDir = configPath.slice(0, configPath.lastIndexOf("/"));
  const probePath = `${packageDir}/src/__node_globals_probe__.ts`;

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

  return {
    program: ts.createProgram([...parsed.fileNames, probePath], parsed.options, host),
    probePath,
  };
}

describe("packages/core Node-global boundary", () => {
  const FORBIDDEN = ["process", "Buffer", "global", "__dirname", "__filename", "require", "module"];

  it("Node globals do not resolve — `process.env` is a compile error, not a lint finding", () => {
    const probeSource = FORBIDDEN.map((name, i) => `export const probe${i} = ${name};`).join("\n") + "\n";
    const { program, probePath } = buildProbeProgram(probeSource);
    const checker = program.getTypeChecker();
    const probeFile = program.getSourceFiles().find((f) => f.fileName === probePath);
    if (probeFile === undefined) {
      throw new Error(`probe file ${probePath} did not make it into the program`);
    }

    const resolved: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && FORBIDDEN.includes(node.text)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol !== undefined) {
          const from = symbol.declarations?.[0]?.getSourceFile().fileName ?? "(no declaration)";
          resolved.push(`${node.text} (declared in ${from})`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(probeFile);

    // Guard the guard. If the probe were dropped from the program, or its
    // identifiers never visited, `resolved` would be empty for the wrong reason
    // and this test would pass while checking nothing.
    expect(probeFile.statements).toHaveLength(FORBIDDEN.length);

    expect(
      resolved,
      "These Node globals resolve inside @soulledger/core. `process.env` is the " +
        "one that has already cost this package a shipped defect — a Next.js " +
        "build-time variable read from a platform-independent layer, with a " +
        "localhost fallback that fires silently on Expo and Tauri. A host " +
        "capability belongs on PlatformAdapter (src/platform/types.ts). Check " +
        "whether host-globals.d.ts grew a declaration back, or whether " +
        '`types: []` / a `@types/node` dependency changed in tsconfig.json.',
    ).toEqual([]);
  });

  it("the probe would see a declaration if there were one (this test's own control)", () => {
    // Without this, the assertion above could be green because the probe never
    // resolves anything — a broken harness and a clean package look identical
    // from the outside. `console` IS on the allowlist, so it must resolve, and
    // it must resolve *from host-globals.d.ts*.
    const { program, probePath } = buildProbeProgram("export const control = console;\n");
    const checker = program.getTypeChecker();
    const probeFile = program.getSourceFiles().find((f) => f.fileName === probePath);
    if (probeFile === undefined) {
      throw new Error(`probe file ${probePath} did not make it into the program`);
    }

    let declaredIn: string | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "console") {
        declaredIn = checker.getSymbolAtLocation(node)?.declarations?.[0]?.getSourceFile().fileName;
      }
      ts.forEachChild(node, visit);
    };
    visit(probeFile);

    expect(declaredIn, "`console` did not resolve — the probe machinery is broken, not the package").toBeDefined();
    expect(declaredIn).toContain("/src/platform/host-globals.d.ts");
  });
});
