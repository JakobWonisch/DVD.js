# syntax=docker/dockerfile:1

# --- build (TypeScript + Solid viewer) ---------------------------------------
FROM node:24-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vitest.config.ts ./
COPY bin ./bin
COPY config/app.example.json ./config/app.example.json
COPY public ./public
COPY src ./src
COPY viewer ./viewer

RUN pnpm build

# --- production dependencies only --------------------------------------------
FROM node:24-bookworm-slim AS prod-deps

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# --- runtime (HTTP server; convert stays on the host) ------------------------
FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    DVD_MENU_ARCHIVE_WEB_FOLDER=/data/web \
    DVD_MENU_ARCHIVE_PORT=3000 \
    DVD_MENU_ARCHIVE_EVICT_DISC_CACHE=true

RUN mkdir -p /data/web \
  && groupadd --system --gid 10001 dvd-menu-archive \
  && useradd --system --uid 10001 --gid dvd-menu-archive --home-dir /app --shell /usr/sbin/nologin dvd-menu-archive \
  && chown dvd-menu-archive:dvd-menu-archive /data/web

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin
COPY --from=build /app/public ./public
COPY --from=build /app/config/app.example.json ./config/app.example.json

USER dvd-menu-archive

EXPOSE 3000

VOLUME ["/data/web"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DVD_MENU_ARCHIVE_PORT||process.env.DVDJS_PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./bin/http-server.js"]
