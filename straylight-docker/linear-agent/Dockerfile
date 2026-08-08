FROM node:24-trixie-slim AS build

WORKDIR /source

COPY package.json package-lock.json ./
RUN npm install --global npm@12.0.2 \
    && npm ci

COPY tsconfig.json ./
COPY src ./src
COPY test ./test

RUN npm run check \
    && npm audit --omit=dev --audit-level=high \
    && npm prune --omit=dev

FROM oven/bun:1 AS bun

FROM node:24-trixie-slim AS runtime-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && mkdir -p /app/state \
    && chown -R node:node /app \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /source/package.json /source/package-lock.json /app/
COPY --from=build --chown=node:node /source/node_modules /app/node_modules
COPY --from=build --chown=node:node /source/dist/src /app/dist

WORKDIR /app
USER node

ENV NODE_ENV=production \
    HOME=/home/node

FROM runtime-base AS controller

EXPOSE 8787

CMD ["node", "dist/index.js"]

FROM runtime-base AS runner-base

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      curl \
      git \
      gh \
      jq \
      openssh-client \
      python3 \
      ripgrep \
      fd-find \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && mkdir -p /app/state/pi-sessions /home/node/.pi/agent /workspace \
    && chown -R node:node /app/state /home/node /workspace \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

USER node

ENV PI_CODING_AGENT_DIR=/home/node/.pi/agent \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0 \
    XDG_CACHE_HOME=/tmp/cache \
    npm_config_cache=/tmp/npm-cache \
    BUN_INSTALL_CACHE_DIR=/tmp/bun-cache

EXPOSE 8788

CMD ["node", "dist/runner-index.js"]

FROM runner-base AS runner

CMD ["node", "dist/runner-index.js"]

FROM runner-base AS workbench

CMD ["node", "dist/workbench-index.js"]
