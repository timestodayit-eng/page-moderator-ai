#!/bin/sh
# Development helper for sandboxes that cannot reach binaries.prisma.sh.
# `prisma generate` only probes the schema-engine binary for its version; this stub satisfies that probe.
# Migrations in such environments are run with `npm run db:migrate:wasm` (scripts/prisma-wasm-migrate.ts).
# NOT needed on servers with normal internet access — `prisma migrate deploy` downloads the real engine.
set -e
DIR="$(dirname "$0")/../node_modules/@prisma/engines"
HASH=$(node -e "console.log(require('@prisma/engines-version').enginesVersion)")
for target in debian-openssl-3.0.x linux-musl-openssl-3.0.x; do
  f="$DIR/schema-engine-$target"
  [ -s "$f" ] && ! grep -q "Dev-only stub" "$f" 2>/dev/null && continue
  cat > "$f" <<STUB
#!/bin/sh
# Dev-only stub
if [ "\$1" = "--version" ]; then echo "schema-engine-cli $HASH"; exit 0; fi
echo "stub schema-engine: use 'npm run db:migrate:wasm' instead" >&2
exit 1
STUB
  chmod +x "$f"
done
echo "prisma engine stub installed ($HASH)"
