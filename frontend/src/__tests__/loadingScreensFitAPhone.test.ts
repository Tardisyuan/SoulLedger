/**
 * A route's `loading.tsx` is on screen for a few frames at every width, including 393.
 * A skeleton bar with a fixed width near that (`w-96` = 384 px, plus the page's 16 px gutter = 400)
 * pushes the document 7 px wider than the phone for those frames. That is what made
 * `e2e/gaps-round-surfaces.spec.ts:126` fail one run in a few on mobile-chrome (2026-10-11): it measured
 * the width once, right after navigating, and sometimes caught the skeleton.
 *
 * Rule: in a `loading.tsx`, a fixed width of 20rem (`w-80`) or more must carry `max-w-full`.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const APP = join(__dirname, "..", "..", "app");
const WIDE = /\bw-(80|96|\[\d{3,}px\])(?![\w-])/;

function loadingFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return loadingFiles(path);
    return name === "loading.tsx" ? [path] : [];
  });
}

describe("loading screens fit a 393 px phone", () => {
  const files = loadingFiles(APP);

  it("finds the loading screens it is meant to read", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("gives every wide fixed-width skeleton bar max-w-full", () => {
    const offenders = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, where: `${file.slice(APP.length + 1)}:${i + 1}` }))
        .filter(({ line }) => /className=/.test(line) && WIDE.test(line) && !/\bmax-w-full\b/.test(line))
        .map(({ where }) => where),
    );
    expect(offenders).toEqual([]);
  });
});
