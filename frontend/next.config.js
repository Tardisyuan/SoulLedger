/** @type {import('next').NextConfig} */

const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    optimizeCss: true,
  },
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
