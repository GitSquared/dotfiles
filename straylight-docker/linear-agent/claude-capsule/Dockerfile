FROM node:22-trixie-slim

ARG CLAUDE_CODE_VERSION=2.1.226

RUN npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force \
    && mkdir -p /home/node/.claude /workspace /opt/capsule \
    && chown -R node:node /home/node /workspace /opt/capsule

WORKDIR /opt/capsule

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --chown=node:node server.mjs agent-request.mjs agent-request.test.mjs /opt/capsule/
RUN node --test /opt/capsule/agent-request.test.mjs \
    && node --input-type=module -e 'import("./agent-request.mjs").then(({ createStraylightTools }) => createStraylightTools({ taskUrl: "http://task", workbenchUrl: "http://workbench", taskToken: "build-check", awaitingInput: false }))' \
    && rm /opt/capsule/agent-request.test.mjs
COPY --chown=node:node settings.json /opt/capsule/settings.json
RUN node -e 'JSON.parse(require("node:fs").readFileSync("/opt/capsule/settings.json", "utf8"))'

USER node
WORKDIR /workspace

ENV HOME=/home/node \
    DISABLE_TELEMETRY=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

EXPOSE 8790

CMD ["node", "/opt/capsule/server.mjs"]
