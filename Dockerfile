# Single-service image: the API also serves the built SPA.
#
# Used by render.yaml. Keeping the app and the API on one origin means no CORS
# allowlist and a first-party session cookie, so SameSite=Lax works — the
# alternative (SPA on a CDN, API elsewhere) would need SameSite=None, because
# onrender.com is on the Public Suffix List and two subdomains of it count as
# different sites.
#
# Build from the repository root:  docker build -t reachinbox .

# --- Stage 1: the SPA -------------------------------------------------------
FROM node:24-alpine AS frontend

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Relative, so the bundle calls whatever origin serves it.
ENV VITE_API_URL=/api
RUN npm run build

# --- Stage 2: the API -------------------------------------------------------
FROM node:24-alpine AS backend

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/prisma ./prisma
COPY backend/prisma.config.ts backend/tsconfig.json ./
COPY backend/src ./src

# The Prisma client is generated into the source tree and gitignored, so it must
# exist before tsc runs. `generate` needs no database connection.
ENV DATABASE_URL=postgresql://placeholder/placeholder
RUN npx prisma generate && npm run build

# --- Stage 3: runtime -------------------------------------------------------
FROM node:24-alpine AS runtime

# dumb-init gives PID 1 correct signal handling, so SIGTERM reaches Node and the
# worker drains in-flight sends rather than being killed mid-delivery.
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
# From the build stage rather than a second install, so the image runs exactly
# the tree the build was verified against — and keeps the Prisma CLI that the
# release command needs.
COPY --from=backend /app/backend/node_modules ./node_modules
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
COPY --from=backend /app/backend/dist ./dist

# The SPA. FRONTEND_DIST_PATH resolves relative to the working directory.
COPY --from=frontend /app/frontend/dist /app/frontend/dist
ENV SERVE_FRONTEND=true
ENV FRONTEND_DIST_PATH=../frontend/dist

# Applies migrations, then starts the server. Render's pre-deploy command is a
# paid-plan feature, so the release step has to live inside the container.
COPY docker-start.sh /app/backend/docker-start.sh
RUN chmod +x /app/backend/docker-start.sh

EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
CMD ["./docker-start.sh"]
