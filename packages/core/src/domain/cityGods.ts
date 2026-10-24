/**
 * The two city god statuses that keep a case away from the ten courts (claim / defer / conclude answer 409
 * `at_city_god`). In `domain/`, not `api/`: many web tests mock `@soulledger/core/api` wholesale, and a constant
 * imported from there reads as undefined under that mock (2026-10-24, nine suites).
 */
export const AT_CITY_GOD: readonly string[] = ["PENDING", "RETURNED"];

export function isAtCityGod(status: string | null | undefined): boolean {
  return !!status && AT_CITY_GOD.includes(status);
}
