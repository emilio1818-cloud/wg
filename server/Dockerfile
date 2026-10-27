# Nestly sync server + web app.
#
# Build from the repository root after building the web app:
#   npm run build
#   docker build -f server/Dockerfile -t nestly .
#   docker run -p 8787:8787 -v nestly-data:/data nestly
#
# The server has no npm dependencies and runs its TypeScript sources directly
# via Node's built-in type stripping (Node >= 22.18).
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DB_PATH=/data/nestly.db \
    STATIC_DIR=/app/app/dist \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app

# package.json marks the sources as ES modules and provides the version.
COPY package.json ./
COPY core/src ./core/src
COPY server/src ./server/src
COPY app/dist ./app/dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

CMD ["node", "server/src/index.ts"]
