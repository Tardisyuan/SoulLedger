/**
 * Realm codes the frontend has to know by name.
 *
 * A `realm_code` is a backend identifier. Almost every one of them reaches the
 * UI as data — the realms page looks up `realms.names.${realm.realm_code}` and
 * never spells a code itself — and those do not belong here. This file is for
 * the small set the frontend has to *branch on*, where a specific code carries
 * a meaning no other column expresses.
 *
 * Today that set has one member.
 *
 * ── Why a module rather than a string literal at the use site ──────────────
 *
 * `EG_DEVOURER` was the previous spelling of the code below, and it was
 * hard-coded into `SoulLifecycleTimeline` as a bare literal. That made the
 * rename a coordinated-deploy problem: `79dee57` corrected the realm's name and
 * description but deliberately left the code alone, because renaming it in the
 * backend alone would have left the timeline comparing against a string no row
 * answered to any more — and nothing would have failed. The annihilation state
 * would simply have stopped rendering, quietly, on a component that has no test
 * asserting the *absence* of the ordinary "sent to a realm" treatment.
 *
 * So the code now lives in exactly one place per side of the wire, and
 * `backend/tests/test_annihilation_realm_code.py` reads this file and compares
 * it against `DispositionService.EG_ANNIHILATION`. Change either side alone and
 * that test goes red naming both values. Change them together and it stays
 * green. That is the whole point of the indirection; keep the export name and
 * the `as const` literal shape, because the test parses this file as text (it
 * runs under pytest, with no TypeScript toolchain available to it).
 */

/**
 * The realm a failed Egyptian heart-weighing is routed to.
 *
 * Not a destination. Being devoured by Ammit is the second death: the heart is
 * destroyed and the person ceases to exist — there is no damned population and
 * nowhere for it to be. The realm row exists because `Disposition` has to
 * record an outcome somewhere, and this code is the one concrete signal the API
 * gives that the outcome was annihilation rather than an address. Neither
 * `Disposition` nor `Realm` carries a dedicated "nobody survives this" flag, so
 * the timeline reads this rather than inventing a field for what is a purely
 * presentational distinction.
 *
 * Backend counterpart: `DispositionService.EG_ANNIHILATION`
 * (backend/apps/disposition/services.py).
 */
export const ANNIHILATION_REALM_CODE = "EG_ANNIHILATION" as const;
