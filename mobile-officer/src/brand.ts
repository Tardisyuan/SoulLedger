/**
 * The officer app's brand: the S-and-L balance mark in INK on a PAPER ground (the soul app is gold
 * on its deep brand ground -- `brand` in mobile/src/theme.ts). The values were v3's light ink and
 * canvas, the same two the splash in app.json and the icons (scripts/gen-officer-icons.mjs) are
 * painted with. v4 leaves the mark alone, as it does the soul app's, so they stay (2026-11-06).
 * For the cold start and the login mark only -- never a UI colour; the UI takes the hall's theme.
 */
export const OFFICER_BRAND = { mark: "#181A17", ground: "#EFEFEB" } as const;
