#!/bin/sh
# Nightly PostgreSQL backup (run via cron on the host): ./docker/backup.sh
# Keeps 14 days. Restore: ./docker/restore.sh backups/pm-YYYY-MM-DD.sql.gz
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date -u +%Y-%m-%d-%H%M)
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-pm}" -d "${POSTGRES_DB:-pm}" --no-owner | gzip > "backups/pm-$STAMP.sql.gz"
find backups -name 'pm-*.sql.gz' -mtime +14 -delete
echo "backup written: backups/pm-$STAMP.sql.gz ($(du -h backups/pm-$STAMP.sql.gz | cut -f1))"
