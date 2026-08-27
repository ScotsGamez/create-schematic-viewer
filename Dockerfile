# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM ghcr.io/astral-sh/uv:0.11.25@sha256:1e3808aa9023d0980e7c15b1fa7c1ac16ff35925780cf5c459858b2d693f01a9 AS uv
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

LABEL org.opencontainers.image.title="Create Schematic Viewer" \
      org.opencontainers.image.description="Local browser viewer and converter for Minecraft schematic files" \
      org.opencontainers.image.source="https://github.com/ScotsGamez/create-schematic-viewer" \
      org.opencontainers.image.licenses="MIT"

ENV HOST=0.0.0.0 \
    DATA_DIR=/data \
    NODE_ENV=production \
    PORT=4173 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

COPY --from=uv /uv /uvx /bin/

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY converter/pyproject.toml converter/uv.lock converter/README.md ./converter/
RUN uv sync --project /app/converter --locked --no-dev --no-install-project

COPY server.js ./server.js
COPY public ./public
COPY src ./src
COPY converter/litematic_converter ./converter/litematic_converter
COPY converter/litematic_to_nbt.py ./converter/litematic_to_nbt.py
COPY tools/apply_replacements.py ./tools/apply_replacements.py
COPY tools/library_data.js ./tools/library_data.js

RUN mkdir -p /app/.tmp/conversions /data \
    && chown -R node:node /app/.tmp /data

USER node
EXPOSE 4173
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173/readyz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "server.js"]
