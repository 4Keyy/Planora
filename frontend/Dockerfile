FROM node:22-bookworm-slim AS base
WORKDIR /app

# These origins are deployment configuration, never credentials. Rewrites are built into .next.
ARG NEXT_PUBLIC_API_URL=http://localhost:5132
ARG API_GATEWAY_INTERNAL_URL=http://api-gateway:80
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_API_SAME_ORIGIN=1 \
    API_GATEWAY_INTERNAL_URL=${API_GATEWAY_INTERNAL_URL}

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json /app/next.config.js ./
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
