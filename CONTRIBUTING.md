# Contributing to CoWork

Thanks for contributing to CoWork! We welcome contributions to improve the platform. Please keep changes focused, well-documented, and testable.

## Getting Started

See [README.md](README.md) for full instructions. Quick start from the repository root:

```bash
cp .env.example .env
# Set BETTER_AUTH_SECRET and ENCRYPTION_KEY to secure random strings.
docker compose -f infra/compose/docker-compose.yml up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

## Quality & Verification Checks

| Command | Description |
| --- | --- |
| `pnpm verify:fast` | **Default validation bar.** Runs unit, property, and in-process contract tests with emulators (scripted runtime, fake sandbox, in-memory wakeup). |
| `pnpm verify` | Full verification suite including database, emulators, API, and Playwright end-to-end tests. |
| `pnpm verify:providers` | Optional canary verification for live OpenRouter / E2B sandbox providers. |
| `pnpm check` | Full TypeScript (`tsc`) type check across the workspace. |
| `pnpm lint` | Biome code formatting and lint verification. |

## Security & Secrets Policy

- **Never** commit `.env` files, API keys, or secrets to version control.
- Ensure all sensitive data uses environment variables or encrypted secrets storage.
- The standard production stack is **Pi + Docker + Graphile**. Emulators are intended for unit and fast test runs.

## Pull Requests

- Keep pull requests focused and well-scoped.
- Target the `main` branch.
- Describe what changed and include reproduction / verification steps.
- Link related issues where applicable.

## Maintainer & Contact

- **Developer / Maintainer**: Suryanshu Nabheet ([@Suryanshu-Nabheet](https://github.com/Suryanshu-Nabheet))
- **Repository**: [https://github.com/Suryanshu-Nabheet/cowork](https://github.com/Suryanshu-Nabheet/cowork)
