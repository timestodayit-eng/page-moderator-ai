#!/bin/sh
# Restore a backup into the running postgres container. STOPS web+worker during restore.
#   ./docker/restore.sh backups/pm-2026-11-15-0300.sql.gz
set -eu
cd "$(dirname "$0")/.."
FILE="${1:?backup file required}"
docker compose stop web worker
docker compose exec -T postgres psql -U "${POSTGRES_USER:-pm}" -d postgres -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB:-pm}\" WITH (FORCE); CREATE DATABASE \"${POSTGRES_DB:-pm}\";"
gunzip -c "$FILE" | docker compose exec -T postgres psql -U "${POSTGRES_USER:-pm}" -d "${POSTGRES_DB:-pm}" -q
docker compose start web worker
echo "restored from $FILE"
