# Nestly — sync server + web app in one small image.
#
#   docker build -t nestly .
#   docker run -p 8787:8787 -v nestly-data:/data nestly
#
# Stage 1 compiles the web app; stage 2 runs the zero-dependency server
# directly from its TypeScript sources via Node's built-in type stripping.

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json tsconfig.base.json ./
RUN npm install --no-audit --no-fund --ignore-scripts typescript@^6
COPY core ./core
COPY app ./app
COPY scripts ./scripts
ARG NESTLY_SERVER_URL=
ENV NESTLY_SERVER_URL=$NESTLY_SERVER_URL
RUN node scripts/build.mjs

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
COPY --from=build /src/app/dist ./app/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1
CMD ["node", "server/src/index.ts"]
