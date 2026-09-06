# Backend image. Serves the API and, with WORKER_ENABLED, the send worker.
# Build from the repository root:  docker build -f backend/Dockerfile .
FROM node:24-alpine AS build

WORKDIR /app/backend

# Dependencies first, so a source-only change reuses the install layer.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
COPY backend/tsconfig.json ./
COPY backend/src ./src

# The Prisma client is generated into the source tree (and gitignored), so it
# must exist before tsc runs. `generate` needs no database connection.
ENV DATABASE_URL=postgresql://placeholder/placeholder
RUN npx prisma generate && npm run build


FROM node:24-alpine AS runtime

# dumb-init gives PID 1 correct signal handling, so SIGTERM reaches Node and
# the worker drains in-flight sends instead of being killed mid-delivery.
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./

# node_modules comes from the build stage rather than a second `npm ci`, so the
# image runs exactly the tree the build was verified against. It keeps the
# Prisma CLI available too, which the `migrate deploy` release step needs — a
# --omit=dev install would drop it.
COPY --from=build /app/backend/node_modules ./node_modules

# Migrations and the Prisma CLI config ship with the image so the release
# command can run `prisma migrate deploy` from this same container.
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
# dist/generated holds the compiled Prisma client — the generator writes into
# the source tree, so tsc emits it alongside everything else.
COPY --from=build /app/backend/dist ./dist

USER node
EXPOSE 4000

# Compose/Kubernetes can override this to `node dist/workers/index.js` to run
# the worker as its own service.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
