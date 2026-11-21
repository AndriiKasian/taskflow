// Server Actions are public endpoints: anyone signed in can call them with
// any arguments. These tests call the task actions directly, the way the
// browser does, and check that user B cannot change user A's tasks.
// See tests/README.md.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { BASE, cleanupUsers, signedInUser } from "../helpers.mjs";

const NAMES = ["updateTask", "setTaskStatus", "deleteTask"];
const NOT_FOUND = /no longer exists or you don't have access/;

// Action ids from the app's own client chunks:
// createServerReference("<id>", ..., "<exportName>").
async function findActionIds(s) {
  const html = await (await s.get("/dashboard")).text();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+\.js/g))];
  const ids = {};
  for (const chunk of chunks) {
    const js = await (await fetch(BASE + chunk)).text();
    for (const m of js.matchAll(/createServerReference\)\("([0-9a-f]+)",[^)]*?"(\w+)"\)/g)) {
      if (NAMES.includes(m[2])) ids[m[2]] = m[1];
    }
  }
  return ids;
}

// Calls action(prevState = {}, formData) with React's reply encoding: form
// fields as "_1_<name>" and the argument list as "0".
async function callAction(s, id, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(`_1_${k}`, v);
  body.append("0", '[{},"$K1"]');
  const res = await s.request("/dashboard", {
    method: "POST", body, headers: { "next-action": id, origin: BASE },
  });
  return { status: res.status, text: await res.text() };
}

const TASK = { title: "A original", description: "A details", status: "todo", due_date: "2026-05-01" };
const COLUMNS = "id, title, description, status, due_date, updated_at";
let a, b, ids, aTask, aSpare, original;

before(async () => {
  a = await signedInUser("sa-a", [TASK, { ...TASK, title: "A spare" }]);
  b = await signedInUser("sa-b");
  const { data } = await a.client.from("tasks").select(COLUMNS).order("title");
  [aTask, aSpare] = data; // "A original", "A spare"
  original = aTask;
  ids = await findActionIds(b.s);
});
after(cleanupUsers);

const readA = async (id) =>
  (await a.client.from("tasks").select(COLUMNS).eq("id", id).maybeSingle()).data;

test("action ids found in the client bundle", () => {
  assert.deepEqual(Object.keys(ids).sort(), [...NAMES].sort());
});

test("B cannot edit A's task", async () => {
  const r = await callAction(b.s, ids.updateTask, {
    id: aTask.id, title: "hacked", description: "", status: "done", due_date: "",
  });
  assert.equal(r.status, 200);
  assert.match(r.text, NOT_FOUND);
  assert.deepEqual(await readA(aTask.id), original);
});

test("B cannot change A's task status", async () => {
  const r = await callAction(b.s, ids.setTaskStatus, { id: aTask.id, status: "done" });
  assert.match(r.text, NOT_FOUND);
  assert.deepEqual(await readA(aTask.id), original);
});

test("B cannot delete A's task", async () => {
  const r = await callAction(b.s, ids.deleteTask, { id: aTask.id });
  assert.match(r.text, NOT_FOUND);
  assert.deepEqual(await readA(aTask.id), original);
});

test("B's attempts left all of A's data unchanged", async () => {
  const { data } = await a.client.from("tasks").select("title").order("title");
  assert.deepEqual(data.map((r) => r.title), ["A original", "A spare"]);
});

// Positive controls: the same calls work for the owner, so the rejections
// above come from authorization, not from a malformed request.
test("owner can use the same actions", async (t) => {
  await t.test("A changes own status", async () => {
    await callAction(a.s, ids.setTaskStatus, { id: aTask.id, status: "in_progress" });
    assert.equal((await readA(aTask.id)).status, "in_progress");
  });
  await t.test("A edits own task", async () => {
    await callAction(a.s, ids.updateTask, {
      id: aTask.id, title: "A edited", description: "", status: "done", due_date: "",
    });
    const row = await readA(aTask.id);
    assert.deepEqual([row.title, row.description, row.status, row.due_date], ["A edited", null, "done", null]);
  });
  await t.test("A deletes own task", async () => {
    await callAction(a.s, ids.deleteTask, { id: aSpare.id });
    assert.equal(await readA(aSpare.id), null);
  });
});
