# Frontend image: builds the SPA and serves it as static files behind nginx.
# Build from the repository root:  docker build -f frontend/Dockerfile .
#
# VITE_* values are compiled into the bundle, so the API URL is a build-time
# argument rather than a runtime environment variable. None of them is a secret.
FROM node:24-alpine AS build

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
