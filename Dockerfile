# REC Smart Audio — server + dashboard (+ agent installer package) in one image
# ------------------------------------------------------------------ dashboard (static export)
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ------------------------------------------------------------------ server build
FROM node:22-bookworm-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
COPY server/prisma.config.ts ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ------------------------------------------------------------------ runtime
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_DIR=/data/audio \
    WEB_DIR=/app/web/out \
    AGENT_DIR=/app/agent
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates openssl tar gzip \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/audio && chown -R node:node /data
WORKDIR /app/server
COPY --from=server --chown=node:node /app/server/node_modules ./node_modules
COPY --from=server --chown=node:node /app/server/dist ./dist
COPY --from=server --chown=node:node /app/server/prisma ./prisma
COPY --from=server --chown=node:node /app/server/prisma.config.ts /app/server/package.json ./
COPY --from=web --chown=node:node /app/web/out /app/web/out
# agent sources: packaged at startup so playback machines install with one command
COPY --chown=node:node agent/rec_agent /app/agent/rec_agent
COPY --chown=node:node agent/install /app/agent/install
COPY --chown=node:node agent/requirements.txt agent/config.example.toml agent/README.md /app/agent/
USER node
EXPOSE 4000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# migrations are applied automatically at startup
CMD ["node", "dist/index.js"]
