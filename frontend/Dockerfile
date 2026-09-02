# Build context is the REPOSITORY ROOT, not `frontend/`.
#
# It always was — `COPY frontend/package*.json` only resolves from the root —
# and now it has to be, because `frontend` is an npm workspace whose
# `@soulledger/core` dependency lives in `packages/core`. Installing from
# inside `frontend` cannot see that directory, so the manifests and the package
# both have to be in the image before `npm ci` runs.
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY packages/core/package.json ./packages/core/
RUN npm ci

FROM base AS builder
COPY packages/core ./packages/core
COPY frontend ./frontend
WORKDIR /app/frontend
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app/frontend
COPY --from=builder /app/frontend/.next /app/frontend/.next
COPY --from=builder /app/frontend/public /app/frontend/public
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages /app/packages
EXPOSE 3000
CMD ["npm", "start"]
