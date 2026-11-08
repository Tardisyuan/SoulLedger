/** @type {import('next').NextConfig} */

// The Vercel demo (docs/DEPLOYMENT-demo.md): no backend anywhere, every request answered in the browser.
const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

const nextConfig = {
  // Vercel packages the app itself; standalone is for this repo's Dockerfile.
  output: demo ? undefined : "standalone",
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
    externalDir: true,
  },
  reactStrictMode: true,
  // The shared language packs carry namespaces only the apps and the backend read; the web build drops
  // them (lib/i18n/dropAppOnlyNamespaces.js). `path` is project-relative, and the project root is the repo's.
  turbopack: {
    rules: {
      "*.json": {
        condition: { path: /^packages\/core\/messages\/(?:en|zh-Hans|egy)\.json$/ },
        loaders: [require.resolve("./lib/i18n/dropAppOnlyNamespaces.js")],
        as: "*.js",
      },
    },
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || (demo ? "/api/v1" : "http://localhost:8000/api/v1"),
    // Always defined, for the same reason as the DSN below: the demo's only entry points are folded out on this literal.
    NEXT_PUBLIC_DEMO_MODE: demo ? "1" : "",
    // Always defined (empty when unset), so Next inlines it as a literal and
    // `instrumentation-client.ts` can drop the Sentry SDK from a DSN-less build.
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN || "",
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
