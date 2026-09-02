/** @type {import('next').NextConfig} */

const nextConfig = {
  output: "standalone",
  // `@soulledger/core` is a workspace package that ships TypeScript source, not
  // a build — there is no `dist/`, and deliberately so: one compiler (this one,
  // and Expo's for the native client) sees the same files the editor does, and
  // there is no stale build to explain a wrong bundle. Next therefore has to be
  // told to transpile it, since it resolves through a node_modules symlink and
  // would otherwise be treated as an already-built dependency.
  transpilePackages: ["@soulledger/core"],
  // The symlink resolves to `<repo>/packages/core`, outside this app's
  // directory. Without this, webpack refuses to compile files from there.
  experimental: {
    optimizeCss: true,
    externalDir: true,
  },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1",
  },
};

// Wrap with Sentry only when SENTRY_DSN is set
if (process.env.SENTRY_DSN) {
  const { withSentryConfig } = require("@sentry/nextjs");
  module.exports = withSentryConfig(nextConfig, {
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
  });
} else {
  module.exports = nextConfig;
}
