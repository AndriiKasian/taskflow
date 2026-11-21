// Integration tests for GET /api/tasks/summary (node:test, no extra deps).
//
// Runs against a LOCAL Supabase stack and the app connected to it:
//   1. corepack pnpm dlx supabase@3.2.0 start
//   2. Run the app with NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY set to the
//      local values from `supabase status` (e.g. `next build && next start`).
//   3. SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_PUBLISHABLE_KEY=<local key> \
//      BASE_URL=http://localhost:3000 corepack pnpm test:api
//
// Each run signs up fresh throwaway users with random passwords (email
// confirmation is off locally) and deletes them afterwards. The
// database-failure test temporarily revokes SELECT on public.tasks inside the
// local Docker database and always restores it. The suite refuses to run
// against a non-local Supabase URL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const DB_CONTAINER = "supabase_db_supabase-saas-dashboard";
const PATH = "/api/tasks/summary";

assert.ok(API && KEY, "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (local)");
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(API).hostname),
  "Refusing to run against a non-local Supabase project",
);

const psql = (sql) =>
  execFileSync("docker", [
    "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qtAX", "-c", sql,
  ]);

// Signs in through the real /login Server Action form and keeps its cookies.
async function login(email, password) {
  const html = await (await fetch(`${BASE}/login`)).text();
  const form = html.match(/<form[\s\S]*?<\/form>/)[0];
  const body = new FormData();
  for (const m of form.matchAll(
    /<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g,
  )) {
    body.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"'));
  }
  body.append("email", email);
  body.append("password", password);
  const res = await fetch(`${BASE}/login`, {
    method: "POST", body, redirect: "manual", headers: { origin: BASE },
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.match(cookie, /-auth-token/, "login did not set a session cookie");
  return cookie;
}

const created = [];

// A new user whose tasks are inserted with their own JWT (RLS applies).
async function newUser(tag, counts = {}) {
  const client = createClient(API, KEY, { auth: { persistSession: false } });
  const email = `${tag}-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  const id = data.user.id;
  created.push(id);
  const rows = Object.entries(counts).flatMap(([status, n]) =>
    Array.from({ length: n }, (_, i) => ({ user_id: id, status, title: `${status}-${i}` })),
  );
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await client.from("tasks").insert(rows.slice(i, i + 500));
    if (insertError) throw insertError;
  }
  return { client, id, cookie: await login(email, password) };
}

async function summary(cookie, path = PATH) {
  const res = await fetch(BASE + path, {
    redirect: "manual", headers: cookie ? { cookie } : {},
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { res, text, json };
}

const counts = (total, todo, in_progress, done) => ({ total, todo, in_progress, done });
let zero, a, b;

before(async () => {
  zero = await newUser("zero");
  a = await newUser("a", { todo: 3, in_progress: 2, done: 4 });
  b = await newUser("b", { todo: 1 });
});

test("zero tasks -> all zeros", async () => {
  const { res, json } = await summary(zero.cookie);
  assert.equal(res.status, 200);
  assert.deepEqual(json, counts(0, 0, 0, 0));
});

test("exact contract: only total/todo/in_progress/done", async () => {
  const { json } = await summary(zero.cookie);
  assert.deepEqual(Object.keys(json).sort(), ["done", "in_progress", "todo", "total"]);
});

test("Cache-Control: no-store on 200", async () => {
  const { res } = await summary(zero.cookie);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("JSON content type", async () => {
  const { res } = await summary(zero.cookie);
  assert.match(res.headers.get("content-type"), /^application\/json/);
});

test("counts across all statuses", async () => {
  assert.deepEqual((await summary(a.cookie)).json, counts(9, 3, 2, 4));
});

test("missing statuses return 0", async () => {
  const m = await newUser("m", { done: 5 });
  assert.deepEqual((await summary(m.cookie)).json, counts(5, 0, 0, 5));
});

test("isolation: each user sees only their own counts", async () => {
  assert.deepEqual((await summary(b.cookie)).json, counts(1, 1, 0, 0));
});

test("user_id query parameter is ignored", async () => {
  const { json } = await summary(a.cookie, `${PATH}?user_id=${b.id}`);
  assert.deepEqual(json, counts(9, 3, 2, 4));
});

test("saved dashboard filters and ?page= are ignored", async () => {
  const { error } = await a.client.from("user_preferences").upsert({
    user_id: a.id, status_filter: "done", date_from: "2030-01-01", date_to: "2030-12-31",
  });
  assert.ifError(error);
  const { json } = await summary(a.cookie, `${PATH}?page=2&status_filter=todo`);
  assert.deepEqual(json, counts(9, 3, 2, 4));
});

test("fresh data on the next request (no caching)", async () => {
  const { error } = await a.client
    .from("tasks")
    .insert({ user_id: a.id, title: "fresh", status: "in_progress" });
  assert.ifError(error);
  assert.deepEqual((await summary(a.cookie)).json, counts(10, 3, 3, 4));
});

test("more than 1000 tasks are counted exactly", async (t) => {
  const large = await newUser("large", { todo: 600, in_progress: 400, done: 205 });
  await t.test("baseline: a plain select is capped at 1000 rows", async () => {
    const { data } = await large.client.from("tasks").select("status");
    assert.equal(data.length, 1000);
  });
  await t.test("summary counts all 1205", async () => {
    assert.deepEqual((await summary(large.cookie)).json, counts(1205, 600, 400, 205));
  });
});

test("no session -> 401 JSON, not a redirect", async () => {
  const { res, json } = await summary(null);
  assert.equal(res.status, 401);
  assert.deepEqual(json, { error: "Unauthorized" });
  assert.equal(res.headers.get("location"), null);
});

test("Cache-Control: no-store on 401", async () => {
  const { res } = await summary(null);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("forged (unsigned) session cookie -> 401", async () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${enc({ alg: "ES256", typ: "JWT", kid: "x" })}.${enc({ sub: a.id, role: "authenticated", exp })}.AAAA`;
  const session = enc({
    access_token: token, refresh_token: "x", expires_at: exp,
    token_type: "bearer", user: { id: a.id },
  });
  const name = a.cookie.match(/sb-[^=.;]+-auth-token/)[0];
  const { res } = await summary(`${name}=base64-${session}`);
  assert.equal(res.status, 401);
});

test("database failure -> generic 500", async (t) => {
  try {
    psql("revoke select on public.tasks from authenticated;");
    const { res, json, text } = await summary(a.cookie);
    await t.test("500 with a generic JSON body", () => {
      assert.equal(res.status, 500);
      assert.deepEqual(json, { error: "Internal server error" });
    });
    await t.test("no database details leaked", () => {
      assert.doesNotMatch(text, /42501|permission|denied|tasks|postgres/i);
    });
    await t.test("Cache-Control: no-store on 500", () => {
      assert.equal(res.headers.get("cache-control"), "no-store");
    });
  } finally {
    psql("grant select on public.tasks to authenticated;");
  }
});

test("summary works again after privileges are restored", async () => {
  const { res, json } = await summary(a.cookie);
  assert.equal(res.status, 200);
  assert.equal(json.total, 10);
});

// Restore privileges (safety net) and delete this run's users; their tasks
// and preferences cascade.
after(() => {
  psql("grant select on public.tasks to authenticated;");
  if (created.length) {
    psql(`delete from auth.users where id in (${created.map((id) => `'${id}'`).join(",")});`);
  }
});
