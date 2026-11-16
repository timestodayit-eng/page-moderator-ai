# Deployment (Hostinger VPS, Docker Compose)

## 1. Server preparation (Ubuntu)

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

Point your domain's A record at the VPS IP (e.g. `app.yourdomain.com`). The sslip.io staging hostname works for testing but is not for production.

## 2. Configure

```bash
git clone <repo> /opt/page-moderator-ai && cd /opt/page-moderator-ai
cp .env.example .env && nano .env
```

Required in `.env` for Docker:

```
APP_STAGE=production
APP_DOMAIN=app.yourdomain.com
ACME_EMAIL=you@yourdomain.com
APP_URL=https://app.yourdomain.com
POSTGRES_PASSWORD=<strong random>
ENCRYPTION_KEY=<openssl rand -base64 32>
META_APP_ID=… META_APP_SECRET=… META_WEBHOOK_VERIFY_TOKEN=<openssl rand -hex 16>
OPENAI_API_KEY=… (or ANTHROPIC/GEMINI/DEEPSEEK)
EMAIL_PROVIDER=smtp SMTP_HOST=… SMTP_USER=… SMTP_PASS=… EMAIL_FROM="Page Moderator AI <no-reply@yourdomain.com>"
META_AUTOMATION_ENABLED=false   # flip to true only after shadow-mode review
```

`DATABASE_URL` and `REDIS_URL` are set by docker-compose (internal network). Validate: `docker compose config -q`.

## 3. First deploy

```bash
./docker/deploy.sh
docker compose exec web sh -c 'ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD="…" ADMIN_NAME="Jamil" npx tsx scripts/bootstrap-admin.ts'
```

Then open `https://app.yourdomain.com/login`.

The `migrate` service runs `prisma migrate deploy` + seed before web/worker start, so a deploy with a new migration is safe (migrations are additive).

## 4. Health & monitoring

- `https://app.yourdomain.com/api/health` → database, redis, worker heartbeat (503 when degraded) — point UptimeRobot/Hostinger monitoring here
- Platform → System Health shows queue depth, failed jobs, outbox backlog
- Logs: `docker compose logs -f web worker` (structured JSON, secrets redacted)

## 5. Updates

```bash
cd /opt/page-moderator-ai && git pull && ./docker/deploy.sh
```

Deploy keeps the previous image tagged `page-moderator-ai:previous`.

## 6. Rollback

```bash
./docker/rollback.sh
```

Database migrations are additive and never dropped automatically, so an older image keeps working with a newer schema.

## 7. Backups

```bash
./docker/backup.sh                       # manual
crontab -e → 0 3 * * * /opt/page-moderator-ai/docker/backup.sh >> /var/log/pm-backup.log 2>&1
./docker/restore.sh backups/pm-2026-11-15-0300.sql.gz
```

Also back up `.env` (contains `ENCRYPTION_KEY` — without it, stored Page tokens and API keys cannot be decrypted) and the `storage` volume (`docker run --rm -v page-moderator-ai_storage:/s -v $PWD/backups:/b alpine tar czf /b/storage.tgz -C /s .`).

## 8. Sharing a VPS with another site (different subdomain)

If ports 80/443 are already used by another app, run in **shared mode**: the bundled Caddy is skipped and the
server's existing reverse proxy forwards the subdomain to the app.

1. Find what owns 80/443: `sudo ss -tlnp | grep -E ':80 |:443 '` (nginx / apache2 / caddy / a docker container).
2. In `.env` add:
   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.shared.yml
   WEB_PORT=3100            # any free local port
   ```
3. `./docker/deploy.sh` → app listens on 127.0.0.1:3100 only (not reachable from the internet directly).
4. Add the subdomain to the existing proxy:
   - Nginx: copy `docker/nginx-site.conf.example` to `/etc/nginx/sites-available/page-moderator`, edit the
     server_name, enable it, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d app.yourdomain.com`.
   - Host Caddy: add the block from `docker/host-Caddyfile.example` and `systemctl reload caddy`.
   - A hosting panel (CloudPanel, aaPanel, Hostinger panel, Coolify…): create the site as a "reverse proxy" to
     `http://127.0.0.1:3100` and enable Let's Encrypt there.
5. Check `https://app.yourdomain.com/api/health`. The app needs `X-Forwarded-Proto: https` from the proxy
   (included in the examples) — without it logins fail because cookies are marked secure.

## 9. Resource notes for a 1 vCPU / 4 GB VPS

- Memory limits: web 1.2 GB, worker 800 MB, Postgres ~300 MB, Redis 256 MB cap, Caddy ~30 MB
- `WORKER_CONCURRENCY=2` is a sensible start on 1 vCPU
- Enable swap (2 GB) to survive build spikes: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
- Build the image on the VPS once; subsequent builds use the layer cache

## 9. Going live safely

1. Connect Pages → they start in **Shadow** mode
2. Watch AI Moderation for a few days; correct mistakes in the review queue (they become training examples)
3. Run an evaluation from the agent page; aim for high precision on SPAM/SCAM before enabling auto-hide
4. Switch the Page to **Human approval**, then **Automatic** with only the categories you trust
5. Set `META_AUTOMATION_ENABLED=true` and redeploy — until then every automated action is blocked at execution time
