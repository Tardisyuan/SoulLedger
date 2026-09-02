/**
 * `@soulledger/core` — everything about SoulLedger that is not a screen.
 *
 * The rule for what belongs here is mechanical: it must compile under this
 * package's `tsconfig.json`, whose `lib` is `["ES2020"]` with no `"dom"`. A
 * module that reaches for `document`, `window`, `localStorage` or `navigator`
 * does not type-check, and that is the whole enforcement — no lint rule, no
 * convention, no comment. Host capabilities arrive through `./platform`.
 */
export * from "./platform/index";
export * from "./domain/dates";
