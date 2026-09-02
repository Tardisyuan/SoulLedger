// Jest setup file
require('@testing-library/jest-dom');

// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:8000/api/v1';

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
