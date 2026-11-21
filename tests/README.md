# Integration tests

Node's built-in test runner against a **local** Supabase stack only. Every
suite refuses to run when `SUPABASE_URL` is not `127.0.0.1`/`localhost`,
signs up disposable users with random passwords, and deletes them (with
their tasks and preferences) through the local Docker database afterwards.

| Script | Suite | Needs |
| --- | --- | --- |
| `test:api` | `GET /api/tasks/summary` | app |
| `test:dashboard` | root redirect, pagination, filters, cross-user Server Actions | app |
| `test:database` | RLS and table constraints via the Data API | stack only |
| `test:functions` | `task-insights` Edge Function | `supabase functions serve` |

```sh
corepack pnpm dlx supabase@3.2.0 start      # local stack; note the publishable key
# App connected to the local stack (process env overrides .env.local):
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local key> \
  sh -c 'corepack pnpm build && corepack pnpm start'

export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<local key>
export BASE_URL=http://localhost:3000
corepack pnpm test:database && corepack pnpm test:api && corepack pnpm test:dashboard
```

For `test:functions`, run `corepack pnpm dlx supabase@3.2.0 functions serve`
instead of the app. Set `SUPABASE_JWT_SECRET` (local value from
`supabase status`) to include the expired-token case.

Run suites one at a time: the database-failure tests briefly revoke `SELECT`
on `public.tasks` from `authenticated` in the local database (always
restoring it), which would break suites running at the same moment.
