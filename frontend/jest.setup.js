// Jest setup file
require('@testing-library/jest-dom');

// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000/api/v1';

// `structuredClone`, which jsdom 26 still does not implement.
//
// NOT a product gap and not a shim for our own code: every browser this app
// supports has had it since 2022, and so has Node 20 — it is missing ONLY
// inside jest's jsdom environment. `@dagrejs/dagre` (the workflow editor's
// graph layout) calls it once per layout, on a plain array of arrays of node
// ids, so without this every suite that lays out a graph dies on
// `ReferenceError: structuredClone is not defined` from inside the library.
//
// v8.serialize/deserialize IS the structured clone algorithm — the same one
// the DOM spec defers to — rather than a JSON round trip, which would quietly
// flatten Map, Set, Date and undefined if dagre ever cloned one.
if (typeof globalThis.structuredClone === 'undefined') {
  const { serialize, deserialize } = require('node:v8');
  globalThis.structuredClone = (value) => deserialize(serialize(value));
}

// The browser adapter for `@soulledger/core`, installed for every suite.
//
// jsdom IS a browser for these purposes: the tests plant tokens in
// `sessionStorage` and cookies in `document.cookie` and then assert what the API
// and WebSocket clients do with them. Without this the package reads its null
// adapter, `connect()` finds no token and returns before opening a socket, and
// ~90 tests fail on a missing socket rather than on anything they meant to
// check.
//
// Installed globally rather than per-suite so that a new suite touching auth
// does not have to know this exists. The one suite that does know —
// `accessTokenNeverBecomesACookie.test.ts` — still configures it explicitly,
// because there the adapter is the subject rather than the scenery.
require('./lib/platform/web').installWebPlatform();
