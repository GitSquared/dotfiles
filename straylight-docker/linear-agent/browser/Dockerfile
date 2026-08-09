FROM mcr.microsoft.com/playwright:v1.62.0-noble

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

USER root
WORKDIR /opt/straylight-playwright

RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund playwright@1.62.0 \
    && npm cache clean --force \
    && chown -R pwuser:pwuser /opt/straylight-playwright

USER pwuser

CMD ["node", "/opt/straylight-playwright/node_modules/playwright/cli.js", "run-server", "--port", "3000", "--host", "0.0.0.0"]
