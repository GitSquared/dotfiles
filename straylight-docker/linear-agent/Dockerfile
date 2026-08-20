FROM oven/bun:1 AS dependencies

WORKDIR /source

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS build

WORKDIR /source

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY test ./test

RUN bun run check \
    && bun run build \
    && bun audit --production

FROM oven/bun:1 AS bun

FROM oven/bun:1 AS qmd

WORKDIR /opt/qmd

COPY qmd-package.json package.json
COPY qmd-bun.lock bun.lock

RUN bun install --frozen-lockfile --production --ignore-scripts \
    && bun audit --production \
    && mkdir -p /opt/qmd/bin \
    && ln -s /opt/qmd/node_modules/@tobilu/qmd/bin/qmd /opt/qmd/bin/qmd

FROM node:24-trixie-slim AS runtime-system

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && mkdir -p /app/state \
    && chown -R node:node /app \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-system AS runner-system

ARG RTK_VERSION=0.45.0
ARG TARGETARCH

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
    && case "$TARGETARCH" in \
      amd64) RTK_ASSET="rtk-x86_64-unknown-linux-musl.tar.gz"; RTK_SHA256="c4c036fbf181fc55ef329786c8c17e0d427972b053b825944d968a6aafef1ba4" ;; \
      arm64) RTK_ASSET="rtk-aarch64-unknown-linux-gnu.tar.gz"; RTK_SHA256="80a746dd305ef944ff50ef011ae4ce3878dd5ba88dfe35d859d05498191637c3" ;; \
      *) echo "Unsupported Docker architecture for RTK: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/v${RTK_VERSION}/${RTK_ASSET}" -o "/tmp/${RTK_ASSET}" \
    && echo "${RTK_SHA256}  /tmp/${RTK_ASSET}" | sha256sum -c - \
    && tar -xzf "/tmp/${RTK_ASSET}" -C /usr/local/bin rtk \
    && chmod 0755 /usr/local/bin/rtk \
    && rtk --version \
    && rm "/tmp/${RTK_ASSET}" \
    && mkdir -p /workspace \
    && chown -R node:node /app/state /home/node /workspace \
    && rm -rf /var/lib/apt/lists/*

FROM runtime-system AS runtime-base

COPY --from=dependencies --chown=node:node /source/package.json /source/bun.lock /app/
COPY --from=dependencies --chown=node:node /source/node_modules /app/node_modules
COPY --from=build --chown=node:node /source/dist/src /app/dist
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
USER node

ENV NODE_ENV=production \
    HOME=/home/node

FROM runtime-base AS controller

EXPOSE 8787

CMD ["bun", "dist/index.js"]

FROM runner-system AS runner-base

COPY --from=qmd --chown=root:root /opt/qmd /opt/qmd

RUN cd /opt/qmd/node_modules/better-sqlite3 \
    && npm run install \
    && chown -R node:node /opt/qmd

COPY --from=dependencies --chown=node:node /source/package.json /source/bun.lock /app/
COPY --from=dependencies --chown=node:node /source/node_modules /app/node_modules
COPY --from=build --chown=node:node /source/dist/src /app/dist
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

USER node

ENV NODE_ENV=production \
    HOME=/home/node \
    RTK_VERSION=0.45.0 \
    PATH=/opt/qmd/bin:$PATH \
    XDG_CACHE_HOME=/tmp/cache \
    npm_config_cache=/tmp/npm-cache \
    BUN_INSTALL_CACHE_DIR=/tmp/bun-cache

EXPOSE 8788

CMD ["bun", "dist/runner-index.js"]

FROM runner-base AS runner

CMD ["bun", "dist/runner-index.js"]

FROM runner-base AS workbench

CMD ["bun", "dist/workbench-index.js"]
