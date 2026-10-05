# syntax=docker/dockerfile:1
FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.3-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/bot.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN mkdir -p /app/data && chown bun:bun /app/data
USER bun
VOLUME ["/app/data"]
CMD ["bun", "src/index.ts"]
