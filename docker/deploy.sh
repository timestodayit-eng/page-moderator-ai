#!/bin/sh
# Zero-surprise deploy/update on the VPS:
#   git pull && ./docker/deploy.sh
# Builds the image, runs migrations (migrate service), then rolls web+worker. Rollback: ./docker/rollback.sh
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env missing — copy .env.example and fill it in"; exit 1; }
docker compose config -q
docker image tag page-moderator-ai:latest page-moderator-ai:previous 2>/dev/null || true
docker compose build web
docker compose up -d --remove-orphans
echo "waiting for health…"; for i in $(seq 1 30); do
  if docker compose exec -T web curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then echo "healthy"; exit 0; fi; sleep 3; done
echo "web did not become healthy — check: docker compose logs web worker"; exit 1
