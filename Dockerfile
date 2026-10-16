# syntax=docker/dockerfile:1
# Motion Studio (hosted mode): Hono server + built web app + Remotion renderer (headless Chrome + FFmpeg).
#   docker compose up -d        (see docs/DEPLOY.md)

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PNPM_VERSION=11.17.0

# ---------------------------------------------------------------- deps: node_modules (incl. tsx, the runtime loader)
FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build: the web app (web/dist)
FROM deps AS build
COPY . .
RUN pnpm build:web

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
# Chromium shared libraries Remotion's headless shell needs, FFmpeg (contact sheets, probing), fonts (emoji + labels).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg fontconfig fonts-dejavu-core fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 \
      libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    MOTION_STUDIO_MODE=hosted \
    MOTION_STUDIO_HOST=0.0.0.0 \
    MOTION_STUDIO_PORT=4310 \
    MOTION_STUDIO_DATA=/app/data \
    MOTION_STUDIO_PROJECTS=/app/projects \
    MOTION_STUDIO_CONFIG_DIR=/app/data/config \
    MOTION_STUDIO_GL=swangle

WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node docs ./docs
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node library ./library
RUN mkdir -p /app/data /app/projects /app/.cache && chown -R node:node /app/data /app/projects /app/.cache

USER node
# Download Remotion's Chrome Headless Shell at build time (not on the first render).
RUN node_modules/.bin/remotion browser ensure
# Synthesize the built-in SFX library (library/sfx/*.wav, ~2 s; also regenerated on boot if missing).
RUN node_modules/.bin/tsx scripts/gen-sfx.ts

EXPOSE 4310
VOLUME ["/app/data", "/app/projects"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MOTION_STUDIO_PORT||4310)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
