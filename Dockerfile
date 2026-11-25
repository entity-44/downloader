# syntax=docker/dockerfile:1.7
# ---------- deps: full install (dev deps needed for build) ----------
FROM node:26-bookworm-slim AS deps
WORKDIR /app
# Toolchain only used if better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

# ---------- build ----------
FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build

# ---------- prod-deps: runtime dependencies only ----------
FROM deps AS prod-deps
WORKDIR /app
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:26-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app --home /app app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    DATABASE_URL=file:/data/app.db \
    FFMPEG_PATH=/usr/bin/ffmpeg

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/src/generated ./src/generated
COPY --chown=app:app package.json next.config.ts prisma.config.ts docker-entrypoint.sh ./
COPY --chown=app:app prisma ./prisma

RUN mkdir -p /data && chown app:app /data && chmod 700 /data && chmod +x docker-entrypoint.sh
USER app
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "./docker-entrypoint.sh"]
