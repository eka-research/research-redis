# syntax=docker/dockerfile:1
# Multi-stage: production deps only, non-root runtime.
ARG NODE_IMAGE=node:24.22.2-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE}
# Strip npm/npx/corepack/yarn from the runtime stage: not used at runtime
# (CMD invokes `node` directly), shrinks the image, and eliminates CVEs in
# npm's bundled dependencies (/usr/local/lib/node_modules/npm).
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn*
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 8080
# No HEALTHCHECK: Kubernetes probes (/healthz, /readyz) own this.
CMD ["node", "src/server.js"]
