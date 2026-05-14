/** @type {import('next').NextConfig} */

// Sentry configuration (only if SENTRY_DSN is set)
let sentryConfig = {};
if (process.env.SENTRY_DSN) {
    const withSentryConfig = require("@sentry/nextjs")({
        sentryUrl: process.env.SENTRY_DSN,
        wideOrient: true,
        setCommits: { auto: true },
    });
    sentryConfig = withSentryConfig;
}

const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1",
  },
};

module.exports = sentryConfig.sentryConfig
    ? sentryConfig.sentryConfig(nextConfig)
    : nextConfig;
