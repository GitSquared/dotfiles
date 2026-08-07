# syntax=docker/dockerfile:1.7

FROM node:22-trixie-slim AS build

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

FROM node:22-trixie-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      openssh-client \
      python3 \
      ripgrep \
      fd-find \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && mkdir -p /app/state /home/node/.pi/agent /workspace \
    && chown -R node:node /app /home/node /workspace \
    && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build --chown=node:node /source/package.json /source/package-lock.json /app/
COPY --from=build --chown=node:node /source/node_modules /app/node_modules
COPY --from=build --chown=node:node /source/dist/src /app/dist

WORKDIR /app
USER node

ENV NODE_ENV=production \
    HOME=/home/node \
    PI_CODING_AGENT_DIR=/home/node/.pi/agent \
    PI_OFFLINE=1 \
    PI_SKIP_VERSION_CHECK=1 \
    PI_TELEMETRY=0

EXPOSE 8787

CMD ["node", "dist/index.js"]
