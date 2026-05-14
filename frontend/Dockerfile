FROM node:20-alpine AS base
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci

FROM base AS builder
COPY frontend/ .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next /app/.next
COPY --from=builder /app/public /app/public
COPY --from=builder /app/node_modules /app/node_modules
EXPOSE 3000
CMD ["npm", "start"]
