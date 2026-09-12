# Build context is the REPOSITORY ROOT (docker-compose sets `context: .`).
#
# It has to be: `frontend` is an npm workspace depending on `@soulledger/core`
# in `packages/core`, and a context rooted at `frontend` does not contain that
# directory, so `npm ci` resolves the workspace link to nothing. The root
# `Dockerfile.frontend` was a second copy of this file; it is gone.

# ---- Dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY packages/core/package.json ./packages/core/
RUN npm ci --ignore-scripts

# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/core ./packages/core
COPY frontend ./frontend
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into the bundle by next.config.js `env:` — a runtime `environment:`
# entry in compose cannot change it, only this build arg can.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
WORKDIR /app/frontend
RUN npm run build

# ---- Production ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The standalone tree is rooted at the workspace root, so the server is
# `frontend/server.js` and it looks for static files and `public/` beside
# itself, under `frontend/` — not at the image root (IS-12).
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public ./frontend/public
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "frontend/server.js"]
