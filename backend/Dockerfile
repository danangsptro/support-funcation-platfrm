# Build context: root repository. Multi-arch (amd64/arm64) via node:22.23.4-alpine (versi yang diverifikasi; sama dengan .nvmrc).
# Tiga target:
#   build   — dependency lengkap, prisma generate, kompilasi TypeScript.
#   migrate — turunan build (punya Prisma CLI): `prisma migrate deploy` + seed. Dipakai service `migrate`.
#   runtime — hanya dependency produksi + Prisma Client hasil generate + dist. Dipakai service `api`.
FROM node:22.23.4-alpine AS base
RUN apk add --no-cache openssl && npm install -g pnpm@10.13.1
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY backend/prisma backend/prisma
COPY frontend/package.json frontend/
# postinstall backend menjalankan `prisma generate` (butuh schema di atas).
RUN pnpm install --frozen-lockfile --filter api...
COPY backend backend
RUN pnpm --filter api exec prisma generate && pnpm --filter api build

FROM build AS migrate
COPY samples/test-data /app/samples/test-data
RUN chown -R node:node /app/backend/prisma
USER node
WORKDIR /app/backend
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/database/seed/run.js"]

# Dependency produksi saja, dipasang ulang dari lockfile secara --offline (memakai store pnpm stage build:
# versi persis sesuai pnpm-lock.yaml, tanpa akses registry). Prisma Client hasil generate (termasuk query engine)
# disalin dari stage build ke lokasi @prisma/client yang baru.
FROM build AS prod-deps
RUN prisma_dir() { node -p "require('path').join(require('path').dirname(require.resolve('@prisma/client/package.json', { paths: ['/app/backend'] })), '../../.prisma')"; } \
  && cp -r "$(prisma_dir)" /tmp/generated-prisma \
  && rm -rf node_modules backend/node_modules frontend/node_modules \
  && pnpm install --frozen-lockfile --prod --offline --ignore-scripts --filter api... \
  && rm -rf "$(prisma_dir)" && cp -r /tmp/generated-prisma "$(prisma_dir)" \
  && rm -rf backend/src backend/test backend/tsconfig*.json backend/jest*.js backend/eslint.config.* frontend

FROM base AS runtime
ENV NODE_ENV=production
# --chown saat COPY (bukan `RUN chown -R`) agar node_modules tidak terduplikasi di layer baru.
COPY --from=prod-deps --chown=node:node /app /app
COPY --chown=node:node samples/test-data /app/samples/test-data
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/ready >/dev/null || exit 1
CMD ["node", "dist/main.js"]
