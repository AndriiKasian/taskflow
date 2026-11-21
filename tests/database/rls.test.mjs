// Row Level Security and table constraints, exercised through the real Data
// API (gateway -> PostgREST) with real user JWTs and only the publishable
// key. Needs the local Supabase stack, not the app. See tests/README.md.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { API, KEY, cleanupUsers, newUser } from "../helpers.mjs";

const anon = createClient(API, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// PostgREST error code, or "ok".
const code = (r) => r.error?.code ?? "ok";

let a, b;
before(async () => {
  a = await newUser("rls-a");
  b = await newUser("rls-b");
});
after(cleanupUsers);

test("own tasks: insert, select, update", async (t) => {
  for (const [name, u] of [["A", a], ["B", b]]) {
    await t.test(`${name} inserts own task`, async () => {
      const r = await u.client.from("tasks").insert({ user_id: u.id, title: `${name} task` }).select().single();
      assert.equal(code(r), "ok");
      u.task = r.data.id;
    });
    await t.test(`${name} selects only own tasks`, async () => {
      const r = await u.client.from("tasks").select("id, user_id");
      assert.deepEqual(r.data, [{ id: u.task, user_id: u.id }]);
    });
    await t.test(`${name} updates own task`, async () => {
      const r = await u.client.from("tasks").update({ status: "in_progress" }).eq("id", u.task).select();
      assert.equal(code(r), "ok");
      assert.equal(r.data.length, 1);
    });
  }
});

test("cross-user task access is blocked", async (t) => {
  await t.test("A cannot read B's task", async () => {
    assert.deepEqual((await a.client.from("tasks").select("id").eq("id", b.task)).data, []);
  });
  await t.test("A cannot update B's task", async () => {
    assert.deepEqual((await a.client.from("tasks").update({ title: "hacked" }).eq("id", b.task).select()).data, []);
  });
  await t.test("A cannot delete B's task", async () => {
    assert.deepEqual((await a.client.from("tasks").delete().eq("id", b.task).select()).data, []);
  });
  await t.test("B's task is unchanged", async () => {
    const r = await b.client.from("tasks").select("title").eq("id", b.task).single();
    assert.equal(r.data.title, "B task");
  });
  await t.test("A cannot insert a task with B's user_id", async () => {
    assert.equal(code(await a.client.from("tasks").insert({ user_id: b.id, title: "spoof" })), "42501");
  });
  await t.test("A cannot transfer own task to B", async () => {
    assert.equal(code(await a.client.from("tasks").update({ user_id: b.id }).eq("id", a.task).select()), "42501");
  });
});

test("task constraints hold for direct API writes", async (t) => {
  const insert = (fields) => a.client.from("tasks").insert({ user_id: a.id, title: "x", ...fields }).select("id");
  await t.test("blank title rejected", async () => {
    assert.equal(code(await insert({ title: "   " })), "23514");
  });
  await t.test("invalid status rejected", async () => {
    assert.equal(code(await insert({ status: "blocked" })), "23514");
  });
  await t.test("201-character title rejected", async () => {
    assert.equal(code(await insert({ title: "x".repeat(201) })), "23514");
  });
  await t.test("title padded past 200 with whitespace rejected", async () => {
    assert.equal(code(await insert({ title: `${"x".repeat(150)}${" ".repeat(51)}` })), "23514");
  });
  await t.test("2001-character description rejected", async () => {
    assert.equal(code(await insert({ description: "d".repeat(2001) })), "23514");
  });
  await t.test("1,000,000-character title rejected", async () => {
    assert.equal(code(await insert({ title: "x".repeat(1_000_000) })), "23514");
  });
  await t.test("oversized update rejected", async () => {
    const r = await a.client.from("tasks").update({ title: "x".repeat(201) }).eq("id", a.task).select();
    assert.equal(code(r), "23514");
  });
  await t.test("exactly 200 / 2000 characters and NULL description accepted", async () => {
    assert.equal(code(await insert({ title: "t".repeat(200), description: "d".repeat(2000) })), "ok");
    assert.equal(code(await insert({ description: null })), "ok");
  });
  await t.test("200 emoji (400 UTF-16 units) accepted by the database", async () => {
    assert.equal(code(await insert({ title: "🙂".repeat(200) })), "ok");
  });
});

test("preferences: own rows only", async (t) => {
  for (const [name, u] of [["A", a], ["B", b]]) {
    await t.test(`${name} upserts own preferences`, async () => {
      const r = await u.client.from("user_preferences").upsert({ user_id: u.id, status_filter: "todo" }).select();
      assert.equal(code(r), "ok");
      assert.equal(r.data.length, 1);
    });
    await t.test(`${name} updates own preferences`, async () => {
      const r = await u.client.from("user_preferences").update({ status_filter: "done" }).eq("user_id", u.id).select();
      assert.equal(r.data[0]?.status_filter, "done");
    });
    await t.test(`${name} selects only own preferences`, async () => {
      assert.deepEqual((await u.client.from("user_preferences").select("user_id")).data, [{ user_id: u.id }]);
    });
  }
  await t.test("A cannot update B's preferences", async () => {
    const r = await a.client.from("user_preferences").update({ status_filter: "todo" }).eq("user_id", b.id).select();
    assert.deepEqual(r.data, []);
  });
  await t.test("A cannot upsert B's preferences", async () => {
    assert.equal(code(await a.client.from("user_preferences").upsert({ user_id: b.id, status_filter: "todo" })), "42501");
  });
  await t.test("A cannot reassign own preferences to B", async () => {
    const r = await a.client.from("user_preferences").update({ user_id: b.id }).eq("user_id", a.id).select();
    assert.notEqual(code(r), "ok");
  });
  await t.test("deleting preferences is not permitted (no grant)", async () => {
    assert.equal(code(await a.client.from("user_preferences").delete().eq("user_id", a.id)), "42501");
  });
  await t.test("invalid date range rejected", async () => {
    const r = await a.client.from("user_preferences").update({ date_from: "2026-03-01", date_to: "2026-01-01" }).eq("user_id", a.id);
    assert.equal(code(r), "23514");
  });
  await t.test("invalid status_filter rejected", async () => {
    const r = await a.client.from("user_preferences").update({ status_filter: "bogus" }).eq("user_id", a.id);
    assert.equal(code(r), "23514");
  });
});

test("anonymous requests are blocked", async (t) => {
  for (const table of ["tasks", "user_preferences"]) {
    await t.test(`anon cannot select ${table}`, async () => {
      assert.equal(code(await anon.from(table).select("*")), "42501");
    });
    await t.test(`anon cannot insert ${table}`, async () => {
      const row = table === "tasks" ? { user_id: a.id, title: "anon" } : { user_id: a.id };
      assert.equal(code(await anon.from(table).insert(row)), "42501");
    });
  }
  await t.test("anon cannot delete tasks", async () => {
    assert.equal(code(await anon.from("tasks").delete().eq("id", a.task)), "42501");
  });
});

test("own tasks: delete", async (t) => {
  for (const [name, u] of [["A", a], ["B", b]]) {
    await t.test(`${name} deletes own task`, async () => {
      const r = await u.client.from("tasks").delete().eq("id", u.task).select();
      assert.equal(code(r), "ok");
      assert.equal(r.data.length, 1);
    });
  }
});
