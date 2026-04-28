---
name: create-feature
description: End-to-end workflow for adding a new vertical slice to PullVault — DB schema → service → API route → realtime event → UI page → manual concurrency test. Use when the user asks to add, build, implement, or scaffold a feature, endpoint, page, mutation, auction action, drop type, listing variant, or any other slice that crosses DB/API/realtime/UI.
---

# Create a Feature in PullVault

PullVault is a TypeScript monorepo with a strict layering. Every new feature touches the same set of files, in the same order. Follow the workflow below.

## Layered architecture (recap)

```
packages/db          — schema + migrations
packages/shared      — money / zod / constants / events
apps/web/services    — domain logic (pure-ish, takes db handle)
apps/web/api         — REST routes (validation + auth + ok/fail)
apps/web/app         — UI pages + components
apps/realtime/...    — Socket.io rooms + Redis subscribers + BullMQ workers
```

Read the rules under `.cursor/rules/` (`money.mdc`, `concurrency.mdc`, `realtime.mdc`, `schema-conventions.mdc`) before writing code.

## Workflow

Copy this checklist into your response and tick as you go:

```
Feature: <short name>
- [ ] 1. Schema: add tables/columns
- [ ] 2. Migration: generate + apply
- [ ] 3. Shared: constants / zod / event names
- [ ] 4. Service: domain function in apps/web/src/services
- [ ] 5. API route: validation + auth + transaction + publish
- [ ] 6. Realtime: subscriber and/or BullMQ handler if needed
- [ ] 7. UI: page or component under apps/web/src/app
- [ ] 8. Manual concurrency test (see test-project skill)
- [ ] 9. Update architecture.md if invariants or parameters changed
```

### Step 1 — Schema

Edit `packages/db/src/schema.ts`. Follow the conventions in `.cursor/rules/schema-conventions.mdc`:

- Money columns are `numeric(14, 2)`.
- Add `CHECK (... >= 0)` on non-negative money.
- Status enums via `pgEnum`.
- Partial UNIQUE indexes for "at most one active X per Y".
- Indexes on FK columns + `(status, created_at)` columns we filter by.

### Step 2 — Migration

```bash
pnpm db:generate
# Review the generated SQL in packages/db/migrations/.
pnpm db:migrate
```

If your change involves an `auth.users` trigger, RLS policy, or anything Drizzle can't express, edit `packages/db/sql/post-migration.sql` and re-run it.

### Step 3 — Shared

If you introduced a new parameter, put it in `packages/shared/src/constants.ts` and reference it everywhere (never hardcode the number in services).

If your feature has a request body, add a zod schema to `packages/shared/src/schemas.ts`. If it broadcasts realtime events, add the channel/room helpers in `packages/shared/src/constants.ts` and the event name in `packages/shared/src/events.ts`.

### Step 4 — Service

Create `apps/web/src/services/<slice>.ts`. The service:

- Takes the `db` handle from `@/lib/db`.
- Accepts already-validated, already-typed input (validation happens at the route layer).
- Runs all writes inside `db.transaction(async (tx) => { ... })`.
- Throws `ApiError(code, message)` from `@/lib/api` for known failure modes (`INSUFFICIENT_FUNDS`, `SOLD_OUT`, etc.).
- Returns plain data, no `Response` objects.

### Step 5 — API route

Create `apps/web/src/app/api/<slice>/route.ts`:

```ts
import { handler, ApiError } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import { ERROR_CODES } from '@pullvault/shared';
import { mySchema } from '@pullvault/shared';
import { doTheThing } from '@/services/<slice>';
import { publishInternal, INTERNAL_EVENTS } from '@/lib/realtime/publisher';
import { REDIS_KEYS } from '@pullvault/shared/constants';

export const POST = handler(async (req: Request) => {
  const userId = await requireUserId();
  const parsed = mySchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid request', parsed.error.flatten());
  }
  const result = await doTheThing(userId, parsed.data);
  // AFTER the commit:
  await publishInternal(REDIS_KEYS.channel.X(result.id), INTERNAL_EVENTS.X, result);
  return result;
});
```

### Step 6 — Realtime

If the feature pushes to clients, add a subscriber in `apps/realtime/src/subscribers/` that reads the channel and calls `io.to(<room>).emit(...)`. If it triggers a delayed/scheduled job, add a worker in `apps/realtime/src/queues/`.

### Step 7 — UI

Add a server component under `apps/web/src/app/<slice>/page.tsx`. For interactive components, mark `'use client'` and call the API via fetch. For live updates, import `getSocket()` from `@/lib/socket-client` and join the relevant room.

### Step 8 — Test

Use the `test-project` skill — at minimum, run the manual concurrency drill for any P0 path you touched.

### Step 9 — Document if invariants changed

If you altered fees, tier weights, anti-snipe parameters, or any of the EV math, update the corresponding section in `architecture.md`. The reviewers will ask.

## Don'ts

- Don't bypass the service layer — no direct DB calls from API routes.
- Don't publish a Redis event before the DB transaction commits.
- Don't skip the idempotency key on a mutation.
- Don't read a balance, decide in JS, then write. See `.cursor/rules/concurrency.mdc`.
