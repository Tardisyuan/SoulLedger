/**
 * An arrow written next to `t("key")` must not repeat an arrow the message
 * already carries. `souls.detail.back_to_list` and `workflow.detail.back_to_list`
 * both read 「← 返回…」 in every bundle, and both pages also wrote `← {t(…)}`,
 * so the back link showed 「←←」 (found on the 规范 v1 soul-detail screenshot,
 * then the same shape on /workflow/[id]).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import zh from "../../../packages/core/messages/zh-Hans.json";

const ROOT = path.join(__dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "__tests__" || name === "node_modules") return [];
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

function message(key: string): unknown {
  return key.split(".").reduce<unknown>((d, k) => (d && typeof d === "object" ? (d as Record<string, unknown>)[k] : undefined), zh);
}

const FILES = [...sources(path.join(ROOT, "app")), ...sources(path.join(ROOT, "src"))];

it("scans the page sources (floor, so an empty scan cannot pass)", () => {
  expect(FILES.length).toBeGreaterThan(150);
});

it("no source line puts ← / → beside a message that already has it", () => {
  const doubled: string[] = [];
  for (const file of FILES) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/(←)\s*\{t\("([^"]+)"\)|t\("([^"]+)"\)\}\s*(→)/g)) {
        const arrow = m[1] ?? m[4];
        const text = message(m[2] ?? m[3]);
        if (typeof text === "string" && text.includes(arrow)) doubled.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  expect(doubled).toEqual([]);
});
