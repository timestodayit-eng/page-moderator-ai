#!/bin/sh
# Roll back web+worker to the previously deployed image (database migrations are additive, so no DB rollback).
set -eu
cd "$(dirname "$0")/.."
docker image inspect page-moderator-ai:previous >/dev/null 2>&1 || { echo "no previous image"; exit 1; }
docker image tag page-moderator-ai:previous page-moderator-ai:latest
docker compose up -d --no-build web worker
echo "rolled back to previous image"
