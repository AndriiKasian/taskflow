// Dashboard filters and saved preferences: real /login and the real filter
// Server Action (no-JS form posts). See tests/README.md.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { cleanupUsers, login, newUser, session, titlesOf } from "../helpers.mjs";

const titles = (html) => titlesOf(html).sort().join(",");
const dashboard = async (s) => (await s.get("/dashboard")).text();

// A fresh session; sign-in must redirect to the dashboard.
async function signIn(user) {
  const s = session();
  const res = await login(s, user);
  assert.equal(res.status, 303, "sign-in status");
  assert.equal(res.headers.get("location"), "/dashboard");
  return s;
}
const apply = (s, fields) =>
  s.submit("/dashboard", /aria-label="Task filters"/, {
    status_filter: "", date_from: "", date_to: "", ...fields,
  });

let a, b, sA;
before(async () => {
  a = await newUser("a", [
    { title: "A1", status: "todo", due_date: "2026-01-10" },
    { title: "A2", status: "in_progress", due_date: "2026-01-15" },
    { title: "A3", status: "done", due_date: "2026-01-20" },
    { title: "A4", status: "todo", due_date: null },
  ]);
  b = await newUser("b", [{ title: "B1", status: "todo", due_date: "2026-01-15" }]);
  sA = await signIn(a);
});
after(cleanupUsers);

test("default dashboard", async (t) => {
  const html = await dashboard(sA);
  await t.test("due date is formatted (Jan 10, 2026)", () => {
    assert.ok(html.includes(">Jan 10, 2026<"));
    assert.ok(!/>2026-01-10</.test(html));
  });
  await t.test("overdue shown for past-due open tasks, not for done", () => {
    assert.equal((html.match(/Overdue · /g) ?? []).length, 2);
  });
  await t.test("status badges rendered, no grouping", () => {
    assert.ok(html.includes(">In progress</span>") && html.includes(">Done</span>"));
    assert.ok(!html.includes('id="group-'));
  });
  await t.test("no task loading error", () => {
    assert.ok(!html.includes("load your tasks"));
  });
  await t.test("all of A's tasks, none of B's", () => {
    assert.equal(titles(html), "A1,A2,A3,A4");
  });
});

test("filters", async (t) => {
  const cases = [
    ["status=todo", { status_filter: "todo" }, "A1,A4"],
    ["range 01-10..01-15 inclusive, excludes no-date", { date_from: "2026-01-10", date_to: "2026-01-15" }, "A1,A2"],
    ["from 01-15 only", { date_from: "2026-01-15" }, "A2,A3"],
    ["to 01-10 only", { date_to: "2026-01-10" }, "A1"],
    ["single day 01-20..01-20", { date_from: "2026-01-20", date_to: "2026-01-20" }, "A3"],
    ["status=todo + range 01-10..01-15", { status_filter: "todo", date_from: "2026-01-10", date_to: "2026-01-15" }, "A1"],
    ["status=done + range with no match", { status_filter: "done", date_from: "2026-01-10", date_to: "2026-01-15" }, ""],
  ];
  let html = "";
  for (const [name, fields, want] of cases) {
    await t.test(name, async () => {
      await apply(sA, fields);
      html = await dashboard(sA);
      assert.equal(titles(html), want);
    });
  }
  await t.test("empty filtered state message", () => {
    assert.ok(html.includes("No matching tasks"));
  });
});

test("invalid input is rejected and saved filters stay unchanged", async (t) => {
  for (const [name, fields] of [
    ["from > to", { date_from: "2026-01-20", date_to: "2026-01-10" }],
    ["bad status", { status_filter: "bogus" }],
    ["bad date", { date_from: "2026-13-45" }],
  ]) {
    await t.test(`${name} -> field error`, async () => {
      const html = await (await apply(sA, fields)).text();
      assert.match(html, /\{"fieldErrors":\{[^}]+\}/);
    });
  }
  await t.test("saved filter unchanged (still the no-match filter)", async () => {
    assert.equal(titles(await dashboard(sA)), "");
  });
});

test("preferences persist per user", async (t) => {
  await apply(sA, { status_filter: "todo" });
  await t.test("filter persists in a new session", async () => {
    const html = await dashboard(await signIn(a));
    assert.equal(titles(html), "A1,A4");
    assert.match(html, /<option value="todo" selected/);
  });
  await t.test("B sees only own tasks with default filters", async () => {
    assert.equal(titles(await dashboard(await signIn(b))), "B1");
  });
  await t.test("reset persists: all tasks in a new session", async () => {
    await sA.submit("/dashboard", /aria-label="Task filters"/, {
      status_filter: "todo", date_from: "", date_to: "", intent: "reset",
    });
    assert.equal(titles(await dashboard(await signIn(a))), "A1,A2,A3,A4");
  });
  await t.test("A's preference row holds defaults (read with A's JWT)", async () => {
    const { data } = await a.client.from("user_preferences").select("status_filter, date_from, date_to");
    assert.deepEqual(data, [{ status_filter: null, date_from: null, date_to: null }]);
  });
  await t.test("B cannot see A's preference row", async () => {
    const { data } = await b.client.from("user_preferences").select("user_id");
    assert.deepEqual(data, []);
  });
});

test("unauthenticated /dashboard redirects", async () => {
  assert.equal((await session().get("/dashboard")).status, 307);
});
