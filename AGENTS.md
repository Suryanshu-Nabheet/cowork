# AGENTS.md

## Agent & Developer Instructions

CoWork is a pnpm + Turbo monorepo (Node 22, pnpm 9). The dev stack consists of four services started together by `pnpm dev`:
- `@cowork/api` (Hono/oRPC on :3100)
- `@cowork/worker` (Graphile Worker)
- `@cowork/web` (Vite/React on :5173)
- `@cowork/sandbox-supervisor` (:7091)

See `README.md` and `CONTRIBUTING.md` for the full command reference (lint/test/build/run, DB, verify tiers).

### Environment Requirements

- **Node.js**: Requires Node `>=22.19` (Node 22 LTS recommended) and `pnpm >=9`.
- **Database**: PostgreSQL 16 on `127.0.0.1:5432` with database `cowork` and user `cowork:cowork`.

### Database Setup

- Generate Prisma client and run migrations:
  ```bash
  pnpm db:generate
  pnpm db:migrate
  ```

### Running the App

- Create root `.env` from `.env.example`:
  ```bash
  cp .env.example .env
  ```
- In local development mode, `SANDBOX_PROVIDER=fake` allows the API and worker to run without requiring Docker.
- To exercise full bot computers (desktop containers), set `SANDBOX_PROVIDER=docker` and run `pnpm sandbox:build`.
- Start all services:
  ```bash
  pnpm dev
  ```
- Health check: `curl -s http://127.0.0.1:3100/health`
- Web UI: `http://127.0.0.1:5173`

### Lint, Type-Check & Tests

- **Lint**: `pnpm lint` (Biome)
- **Type Check**: `pnpm check`
- **Fast Unit & Integration Tests**: `pnpm verify:fast` (Vitest, in-memory, no live DB needed)
