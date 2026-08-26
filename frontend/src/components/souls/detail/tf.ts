/**
 * The soul detail page's translator-with-a-code-level-fallback. Declared here
 * so the pieces split out of app/souls/[id]/page.tsx can all name the same
 * type instead of re-spelling the signature — the helper itself still lives on
 * the page, built from that page's `t`.
 */
export type TFunc = (key: string, fallback: string, params?: Record<string, string>) => string;
