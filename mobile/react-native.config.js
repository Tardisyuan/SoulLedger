/**
 * A build without a Sentry DSN (every dev client so far) leaves out Sentry's native code — about a
 * third of what Xcode compiled for this app (243 of 721 files, 2026-10-27). src/crashReport.ts never
 * `require`s the SDK when the DSN is empty, so nothing calls into the missing module. A build with
 * EXPO_PUBLIC_SENTRY_DSN_SOUL set links it as before. Set the DSN at build time and at bundle time together.
 */
module.exports = {
  dependencies: process.env.EXPO_PUBLIC_SENTRY_DSN_SOUL
    ? {}
    : { "@sentry/react-native": { platforms: { ios: null, android: null } } },
};
