"use client";

import { useEffect } from "react";

/** The two fontsource index sheets — 202 `@font-face` rules, about 62 KB gzipped — off the critical path.
 *
 * A static `import` in layout.tsx put them in the root CSS, so every route waited for them before its first frame
 * (fe-perf P3). Imported from an effect they become a CSS chunk the bundler's runtime attaches after hydration:
 * the shell characters already have their own face (app/fonts-shell.css), and anything else swaps in when its
 * shard arrives. No inline `onload` handler — script-src has no 'unsafe-inline', so `media="print" onload` would
 * be blocked; the chunk loader's `<link>` is 'self' under style-src. */
export function FontShards() {
  useEffect(() => {
    void import("@fontsource-variable/noto-sans-sc");
    void import("@fontsource-variable/noto-serif-sc");
  }, []);
  return null;
}
