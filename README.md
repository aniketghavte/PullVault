# PullVault

> Pokemon card collectibles platform. Pack drops, real market data, peer-to-peer trading, and live auctions.

This is the implementation for the **PullVault work trial** ([assignment.md](./assignment.md)). For architecture, schema, and parameter justification, see [architecture.md](./architecture.md).

---

## Stack

| Layer            | Tech                                                |
| ---------------- | --------------------------------------------------- |
| Frontend         | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Backend (REST)   | Next.js API routes (TypeScript)                     |
| Backend (Realtime) | Express + Socket.io + BullMQ (TypeScript)         |
| Database         | Supabase Postgres (Drizzle ORM)                     |
| Cache / Pub-Sub  | Upstash Redis                                       |
| Money            | decimal.js                                          |
| Card Data        | Pokemon TCG API (free) → TCGPlayer when approved   |

We run two long-lived processes: `apps/web` (Next.js) and `apps/realtime` (Express+Socket.io+workers). They share a Postgres schema and a Redis instance. **Why two?** Real-time sockets and delayed jobs require a persistent process, while the web app serves UI and REST APIs. Full reasoning in [architecture.md](./architecture.md).

---

## Repository Layout

```
.
├── apps/
│   ├── web/            # Next.js — UI + REST API routes
│   └── realtime/       # Express — Socket.io + BullMQ workers
├── packages/
│   ├── db/             # Drizzle schema, migrations, seeds
│   └── shared/         # money helpers, zod schemas, redis, types, constants
├── architecture.md     # System design + EV math + concurrency strategy
├── assignment.md       # The brief
└── README.md           # ← you are here
```

---

## Quick Start

### 1. Prerequisites

- Node.js **20.10+** (a `.nvmrc` is provided)
- pnpm **9+** (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- A Supabase project (free tier is fine)
- An Upstash Redis database (free tier is fine)

### 2. Clone + install

```bash
pnpm install
cp .env.example .env
```

Fill in `.env` with your Supabase + Upstash credentials. Comments in `.env.example` walk you through each value.

### 3. Database

Generate migrations from the Drizzle schema, then apply them:

```bash
pnpm db:generate
pnpm db:migrate
```

Apply the post-migration SQL (RLS policies + auth-trigger to auto-create `profiles` rows). Easiest:

```bash
psql "$DIRECT_DATABASE_URL" -f packages/db/sql/post-migration.sql
```

Seed pack tiers:

```bash
pnpm db:seed
```

> The Pokemon card catalog is loaded into `cards` by an ETL run from the realtime server on first boot. Check the realtime server logs.

### 4. Run

```bash
# both processes in parallel
pnpm dev

# or individually
pnpm dev:web        # http://localhost:3000
pnpm dev:realtime   # http://localhost:4000  (Socket.io endpoint)
```

### 5. Health check

- Web:      `curl http://localhost:3000/api/health`
- Realtime: `curl http://localhost:4000/health`

---

## Common Commands

| Command                | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `pnpm dev`             | Run web + realtime in parallel.                 |
| `pnpm build`           | Build all workspaces.                            |
| `pnpm typecheck`       | Type-check all workspaces.                       |
| `pnpm lint`            | Lint all workspaces.                             |
| `pnpm format`          | Prettier on the whole repo.                      |
| `pnpm db:generate`     | Generate a new migration from the Drizzle schema.|
| `pnpm db:migrate`      | Apply migrations.                                |
| `pnpm db:push`         | Push schema directly (skip migrations; dev only).|
| `pnpm db:seed`         | Seed pack tiers.                                 |
| `pnpm db:studio`       | Open Drizzle Studio.                             |

---

## How To Add a Feature

End-to-end flow:

1. **DB** — add tables/columns to `packages/db/src/schema.ts`. `pnpm db:generate && pnpm db:migrate`.
2. **Domain** — write the service in `apps/web/src/services/<slice>.ts`. Pure-ish, takes a Drizzle handle.
3. **API** — wire it from `apps/web/src/app/api/<slice>/route.ts`. Validate with zod, return via `ok()` / `fail()`.
4. **Realtime** — if it needs to push, publish a Redis event from the API (after commit) and add a subscriber in `apps/realtime/src/subscribers/`.
5. **UI** — add a page under `apps/web/src/app/<slice>/` and call the API.
6. **Test** — verify behavior under concurrent usage (parallel purchases, bids, and listing buys) and confirm transactional consistency.

---

## Scope Cuts

See "Scope Cuts & Trade-offs" in [architecture.md §11](./architecture.md#11-scope-cuts--trade-offs).