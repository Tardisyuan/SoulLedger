// next/link and next/navigation read process.env.__NEXT_* at module scope.
// Next's compiler inlines those; a plain esbuild IIFE leaves them as live
// reads, so the whole bundle throws "process is not defined" on load.
// Imported first in entry.tsx so it runs before any Next module evaluates.
const g = globalThis as { process?: { env: Record<string, string | undefined> } };
g.process ??= { env: {} };
g.process.env ??= {};
export {};
