#!/bin/sh
# Startup for the single-service (Render) image.
#
# Migrations run here rather than as a Render pre-deploy command, because
# pre-deploy is a paid-plan feature — on a free instance it never runs, and the
# app would boot against a schema that does not exist yet.
#
# `migrate deploy` only applies already-generated migrations and takes a
# Postgres advisory lock, so it is safe if more than one instance starts at
# once: the others wait, then find nothing left to apply.
set -e

echo "Applying database migrations…"
npx prisma migrate deploy

# exec so the Node process becomes PID 1's direct child and receives SIGTERM —
# without it the worker would be killed mid-send instead of draining.
echo "Starting server…"
exec node dist/server.js
