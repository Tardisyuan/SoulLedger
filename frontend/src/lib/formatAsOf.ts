// The rule moved to core (Design v4 第六十一批 E6: the soul app's stale line uses the same formatter); this path stays so
// the dashboard and its test keep their import. Docs: `packages/core/src/domain/dates.ts::formatAsOf`.
export { formatAsOf } from "@soulledger/core/domain/dates";
