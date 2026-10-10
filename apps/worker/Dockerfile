# Worker image for a hosted supervisor (ADR-0032). Build context: repository root.
# Bun installs and bundles; Node.js stays the runtime (§ 3 of the plan, ADR-0012).
FROM oven/bun:1.4.2-slim AS build
WORKDIR /repo
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/app/package.json apps/app/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
RUN bun install --frozen-lockfile --filter @impuls/worker
COPY apps/worker apps/worker
COPY packages packages
RUN bun run --cwd apps/worker build

# Only the external runtime dependency (pg) of the bundle.
FROM oven/bun:1.4.2-slim AS runtime-deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/app/package.json apps/app/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
RUN bun install --frozen-lockfile --production --filter @impuls/worker \
  && rm -rf node_modules/@impuls

FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist/index.mjs ./index.mjs
USER node
# The mode flag comes from the supervisor; Node is PID 1 so SIGTERM reaches the shutdown handler.
ENTRYPOINT ["node", "/app/index.mjs"]
CMD ["--status"]
