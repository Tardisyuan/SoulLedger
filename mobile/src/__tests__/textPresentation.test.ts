/**
 * iOS draws "↗" as a colour emoji unless it carries U+FE0E (text presentation); seen on the
 * officer app's 「忘记密码 ↗」 on an iOS 27 simulator (2026-10-09). Android drew it as text, so
 * only iOS showed the defect. Every such arrow in both apps' sources must be followed by ︎.
 */
import fs from "fs";
import path from "path";

const ROOTS = [path.join(__dirname, ".."), path.join(__dirname, "..", "..", "..", "mobile-officer", "src")];
const EMOJI_CAPABLE = /↗(?!\\uFE0E|︎)/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : files(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

it("every ↗ in the apps asks for text presentation", () => {
  const offenders = ROOTS.flatMap(files).flatMap((f) =>
    fs.readFileSync(f, "utf8").split("\n").flatMap((line, i) => (EMOJI_CAPABLE.test(line) ? [`${path.relative(path.join(__dirname, "..", "..", ".."), f)}:${i + 1}`] : [])),
  );
  expect(offenders).toEqual([]);
});
