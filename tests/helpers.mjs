// Shared helpers for the dashboard integration tests (tests/dashboard).
// Local Supabase only; see tests/README.md for how to run.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const API = process.env.SUPABASE_URL;
export const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

assert.ok(API && KEY, "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (local)");
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(API).hostname),
  "Refusing to run against a non-local Supabase project",
);

const DB_CONTAINER = "supabase_db_supabase-saas-dashboard";
const created = [];

// Deletes every user created through newUser (tasks and preferences
// cascade). Runs as postgres inside the local Docker database only, and only
// for the exact ids this run created.
export function cleanupUsers() {
  if (!created.length) return;
  const ids = created.splice(0).map((id) => `'${id}'`).join(",");
  execFileSync("docker", [
    "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-qtAX",
    "-c", `delete from auth.users where id in (${ids});`,
  ]);
}

// A cookie-jar browser session against the app. `submit` posts a form the
// way a no-JS browser would, including the Server Action's hidden inputs.
export function session() {
  const jar = new Map();
  const store = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || attrs.some((a) => /max-age=0/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const get = async (path) => {
    const res = await fetch(BASE + path, { redirect: "manual", headers: { cookie: cookie() } });
    store(res);
    return res;
  };
  const submit = async (path, formMatch, fields) => {
    const html = await (await get(path)).text();
    const form = [...html.matchAll(/<form[\s\S]*?<\/form>/g)]
      .map((m) => m[0])
      .find((f) => formMatch.test(f));
    if (!form) throw new Error(`form not found on ${path}`);
    const body = new FormData();
    for (const m of form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g)) {
      body.append(m[1], (m[2] ?? "").replaceAll("&quot;", '"'));
    }
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    const res = await fetch(BASE + path, {
      method: "POST", body, redirect: "manual", headers: { cookie: cookie(), origin: BASE },
    });
    store(res);
    return res;
  };
  return { get, submit };
}

export const login = (s, user) =>
  s.submit("/login", /Sign in/, { email: user.email, password: user.password });

// A disposable user (random email and password) whose tasks are inserted
// with the user's own JWT, so RLS applies. `client` is that user's client.
export async function newUser(tag, tasks = []) {
  const client = createClient(API, KEY, { auth: { persistSession: false } });
  const email = `${tag}-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  created.push(data.user.id);
  if (tasks.length) {
    const { error: insertError } = await client
      .from("tasks")
      .insert(tasks.map((t) => ({ ...t, user_id: data.user.id })));
    if (insertError) throw insertError;
  }
  return { client, id: data.user.id, email, password };
}

// newUser plus a signed-in session.
export async function signedInUser(tag, tasks) {
  const user = await newUser(tag, tasks);
  const s = session();
  await login(s, user);
  return { ...user, s };
}

// Task titles rendered on a dashboard page (in page order).
export const titlesOf = (html) =>
  [...html.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
