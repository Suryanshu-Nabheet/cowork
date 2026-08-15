# Self-Hosting CoWork

CoWork is designed to be easily self-hosted on your own infrastructure or cloud environment. The platform gives you complete ownership over your AI coworkers, their computer environments, persistent memory, and routines.

## Core System Architecture

CoWork consists of five primary components:
- **API Server (`@cowork/api`)**: Built on Hono & oRPC, handling authentication, routing, and bot orchestration.
- **Background Worker (`@cowork/worker`)**: Powered by Graphile Worker for reliable asynchronous task processing and scheduled routines.
- **Database (`@cowork/db`)**: PostgreSQL 16 with pgvector for semantic search and `LISTEN`/`NOTIFY` (`cowork_events`) for real-time reactivity.
- **Computer Sandboxes**: Sandboxed Linux desktop environments (Chromium, Fluxbox, X11, noVNC) managed via Docker or E2B.
- **Client Applications**: React 19 + Vite web client (`@cowork/web`), Electron desktop application (`@cowork/desktop`), and Expo mobile app (`@cowork/mobile`).

---

## Quick Start with Docker Compose

1. **Clone the repository and copy configuration**:
   ```bash
   git clone https://github.com/Suryanshu-Nabheet/cowork.git
   cd cowork
   cp .env.example .env
   ```

2. **Configure mandatory security keys**:
   Edit `.env` and configure:
   - `BETTER_AUTH_SECRET`: A secure random 32+ character string.
   - `ENCRYPTION_KEY`: A secure random 64-character hexadecimal key.
   - `OPENROUTER_API_KEY`: (Optional) Default API key for Pi agent model inference, or configure per-user keys during onboarding.

3. **Start the complete stack**:
   ```bash
   docker compose -f infra/compose/docker-compose.yml up --build -d
   ```

4. **Access the Web Interface**:
   Navigate to [http://127.0.0.1:5173](http://127.0.0.1:5173). The first account registered automatically becomes the deployment administrator.

---

## Computer Providers & Sandbox Isolation

CoWork supports multiple execution targets for bot computer environments:

| Provider | Configuration | Description | Isolation Level |
| --- | --- | --- | --- |
| **Docker** (Default) | `SANDBOX_PROVIDER=docker` | Spawns isolated Docker containers per bot (`cowork/computer:local`) with desktop GUI and browser. | High. Runs in local container with dedicated `/home/cowork`. |
| **E2B** | `SANDBOX_PROVIDER=e2b`<br>`E2B_API_KEY=...` | Executes commands and GUI sessions in secure cloud-isolated micro-VMs. | Maximum. Recommended for multi-tenant and public deployments. |
| **Desktop Host** | `SANDBOX_PROVIDER=desktop` | Executes commands directly on the host system. Selected per-bot or via Electron desktop app. | Low. Runs with local process privileges. Recommended for single-user local setups only. |

---

## Production Deployment & Reverse Proxy

When deploying on a remote VPS or dedicated server behind a reverse proxy (Nginx, Caddy, Cloudflare), configure your public URLs in `.env`:

```env
NODE_ENV=production
BETTER_AUTH_URL=https://cowork.yourdomain.com
WEB_ORIGIN=https://cowork.yourdomain.com
API_URL=https://cowork.yourdomain.com
DATABASE_URL=postgres://cowork:YOUR_STRONG_PASSWORD@postgres:5432/cowork
BETTER_AUTH_SECRET=your-secure-random-32-char-string
ENCRYPTION_KEY=your-secure-random-64-char-hex-string
SANDBOX_PROVIDER=docker
AGENT_RUNTIME=pi
WAKEUP_DRIVER=graphile
SANDBOX_IDLE_MS=600000
```

### Example Nginx Configuration

```nginx
server {
    server_name cowork.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3100/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /rpc/ {
        proxy_pass http://127.0.0.1:3100/rpc/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Backup & Disaster Recovery

### Automated Backup
The backup utility exports the complete PostgreSQL database via `pg_dump` and archives persistent bot homes:

```bash
./scripts/backup.sh
```
Backups are archived into timestamped bundles located at `./backups/<YYYYMMDD-HHMMSS>/`.

### Restore from Backup
To restore state into a fresh or existing instance:

```bash
./scripts/restore.sh backups/<YYYYMMDD-HHMMSS>
```

---

## Maintenance & Upgrades

To update your CoWork instance to the latest release:

```bash
git pull origin main
pnpm install
pnpm db:migrate
docker compose -f infra/compose/docker-compose.yml up -d --build
```
