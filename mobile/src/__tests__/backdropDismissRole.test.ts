/**
 * A tap-outside-to-close backdrop is a button to a screen reader (it carries the "Cancel"/"Close" label, which is
 * only announced with a role). Reads the sources: these sheets sit behind a Modal and a few flows to reach.
 */
import { readFileSync } from "fs";
import { join } from "path";

const SRC = join(__dirname, "..");
const BACKDROPS: [string, RegExp][] = [
  ["logout.tsx", /<Pressable style=\{styles\.fill\}[^\n]*\/>/g],
  ["screens/circlePeople.tsx", /<Pressable style=\{styles\.fill\}[^\n]*\/>/g],
  ["screens/circle.tsx", /<Pressable style=\{styles\.fill\}[^\n]*\/>/g],
  ["screens/mfaParts.tsx", /<Pressable style=\{styles\.fill\}[^\n]*\/>/g],
  ["assistPanel.tsx", /<Pressable\s+testID="assist-scrim"[\s\S]*?\/>/g],
];

it.each(BACKDROPS)("%s: every backdrop Pressable has accessibilityRole=button", (file, re) => {
  const found = readFileSync(join(SRC, file), "utf8").match(re) ?? [];
  expect(found.length).toBeGreaterThan(0);
  for (const pressable of found) expect(pressable).toContain('accessibilityRole="button"');
});
