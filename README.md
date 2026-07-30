# DutyDesk — Customs Tariff Classifier

Modular rewrite of the legacy monolith: Vite + React + TypeScript frontend, Cloudflare Worker API, D1 database.

## Architecture

- **apps/web** — React SPA (tariff search client-side, API calls for AI/auth/sync)
- **apps/worker** — Hono API on Cloudflare Workers (secrets, auth)
- **packages/tariff-data** — T&T CET tariff JSON + search
- **packages/tax-engine** — CIF/duty/VAT calculations
- **packages/shared-types** — Shared TypeScript types

## Prerequisites

- Node.js 20+
- Cloudflare account (for deploy)
- Anthropic API key (Worker secret only)

## Quick Start (Local)

```bash
cd C:\Users\mwilson\Projects\pas-trinidad
npm install
npm run extract-tariff
npm run db:migrate

# Terminal 1 — API + static assets
npm run dev:worker

# Terminal 2 — frontend with HMR (proxies /api to :8787)
npm run dev
```

Seed admin user (dev only):

```bash
curl -X POST http://localhost:8787/api/auth/seed -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"changeme\",\"name\":\"Admin\",\"role\":\"admin\"}"
```

Open http://localhost:5173 and sign in.

## Security

See [SECURITY.md](./SECURITY.md). **Revoke the legacy Anthropic API key** before deploying.

## Deploy to Cloudflare

1. Create D1 database: `wrangler d1 create pas-trinidad`
2. Update `database_id` in `wrangler.toml`
3. Create KV namespace: `wrangler kv:namespace create SESSIONS`
4. Update KV `id` in `wrangler.toml`
5. Set secret: `wrangler secret put ANTHROPIC_API_KEY`
6. Migrate: `npm run db:migrate:remote`
7. Build web: `npm run build:web`
8. Deploy: `npm run deploy:worker` → https://dutydesk.<your-subdomain>.workers.dev

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run dev:worker` | Wrangler dev (API + built assets) |
| `npm run build` | Build all workspaces |
| `npm run test` | Run unit tests |
| `npm run extract-tariff` | Extract tariff JSON from legacy file |
