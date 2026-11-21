// Dashboard pagination: real /login, server-rendered /dashboard pages and the
// real filter Server Action (no-JS posts). See tests/README.md.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { cleanupUsers, session, signedInUser, titlesOf } from "../helpers.mjs";

// What a dashboard page shows. Server-side redirects arrive as a Location
// header or, once streaming started, as NEXT_REDIRECT in the HTML.
async function view(s, path) {
  const res = await s.get(path);
  const html = res.status >= 300 && res.status < 400 ? "" : await res.text();
  return {
    status: res.status,
    redirect:
      res.headers.get("location") ??
      html.match(/NEXT_REDIRECT;(?:replace|push);([^;]+);/)?.[1] ??
      null,
    titles: titlesOf(html),
    nav: html.includes('aria-label="Pagination"'),
    pageText: html.match(/Page <!-- -->(\d+)<!-- --> of <!-- -->(\d+)/)?.slice(1).join("/") ?? null,
    showing:
      html.match(/Showing <!-- -->(\d+)<!-- -->–<!-- -->(\d+)<!-- --> of <!-- -->(\d+)/)?.slice(1).join("-") ?? null,
    count: html.match(/>(\d+)<!-- --> <!-- -->(?:tasks|task|matching tasks|matching task)</)?.[1] ?? null,
    empty: html.includes("No tasks yet") || html.includes("No matching tasks"),
    prevLink: /<a [^>]*aria-label="Previous page[^"]*"[^>]*href="\/dashboard(?:\?page=\d+)?"/.test(html),
    nextLink: /<a [^>]*aria-label="Next page[^"]*"[^>]*href="\/dashboard\?page=\d+"/.test(html),
  };
}

const many = (tag, n, extra = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ title: `${tag}-${String(i).padStart(2, "0")}`, ...extra(i) }));
const pageUrl = (p) => (p === 1 ? "/dashboard" : `/dashboard?page=${p}`);

let u0, u1, u10, u11, u21, f;
before(async () => {
  u0 = await signedInUser("u0");
  u1 = await signedInUser("u1", many("one", 1));
  u10 = await signedInUser("u10", many("ten", 10));
  u11 = await signedInUser("u11", many("eleven", 11));
  // One INSERT = one transaction timestamp: all 21 share created_at.
  u21 = await signedInUser("u21", many("tw", 21));
  // 30 tasks alternating todo/done, due Jan 1..30.
  f = await signedInUser("f", many("f", 30, (i) => ({
    status: i % 2 ? "done" : "todo",
    due_date: `2026-01-${String(i + 1).padStart(2, "0")}`,
  })));
});
after(cleanupUsers);

// --- sizes 0, 1, 10, 11

test("0 tasks: empty state, no pagination", async () => {
  const v = await view(u0.s, "/dashboard");
  assert.ok(v.empty);
  assert.equal(v.nav, false);
  assert.equal(v.count, "0");
});

test("0 tasks: ?page=2 redirects to /dashboard", async () => {
  assert.equal((await view(u0.s, "/dashboard?page=2")).redirect, "/dashboard");
});

test("1 task: 1 row, no pagination", async () => {
  const v = await view(u1.s, "/dashboard");
  assert.equal(v.titles.length, 1);
  assert.equal(v.nav, false);
});

test("10 tasks: 10 rows, no pagination", async () => {
  const v = await view(u10.s, "/dashboard");
  assert.equal(v.titles.length, 10);
  assert.equal(v.nav, false);
  assert.equal(v.count, "10");
});

test("10 tasks: ?page=2 normalizes to /dashboard", async () => {
  assert.equal((await view(u10.s, "/dashboard?page=2")).redirect, "/dashboard");
});

test("11 tasks p1: 10 rows, Page 1 of 2, Next only", async () => {
  const v = await view(u11.s, "/dashboard");
  assert.deepEqual(
    [v.titles.length, v.pageText, v.showing, v.nextLink, v.prevLink],
    [10, "1/2", "1-10-11", true, false],
  );
});

test("11 tasks p2: 1 row, Page 2 of 2, Previous only", async () => {
  const v = await view(u11.s, "/dashboard?page=2");
  assert.deepEqual(
    [v.titles.length, v.pageText, v.showing, v.prevLink, v.nextLink],
    [1, "2/2", "11-11-11", true, false],
  );
});

// --- 21 tasks with identical created_at

test("21 tasks with identical created_at", async (t) => {
  const { data: rows } = await u21.client.from("tasks").select("id, title, created_at");
  const pages = [];
  for (const p of [1, 2, 3]) pages.push(await view(u21.s, pageUrl(p)));
  const all = pages.flatMap((p) => p.titles);

  await t.test("all share one created_at", () => {
    assert.equal(new Set(rows.map((r) => r.created_at)).size, 1);
  });
  await t.test("pages hold 10/10/1", () => {
    assert.deepEqual(pages.map((p) => p.titles.length), [10, 10, 1]);
  });
  await t.test("middle page shows Page 2 of 3 with Previous and Next", () => {
    assert.deepEqual([pages[1].pageText, pages[1].prevLink, pages[1].nextLink], ["2/3", true, true]);
  });
  await t.test("stable order: id DESC, no overlap or skip", () => {
    const expected = [...rows].sort((a, b) => (a.id < b.id ? 1 : -1)).map((r) => r.title);
    assert.deepEqual(all, expected);
    assert.equal(new Set(all).size, 21);
  });
  await t.test("refreshing page 2 returns the same rows", async () => {
    assert.deepEqual((await view(u21.s, "/dashboard?page=2")).titles, pages[1].titles);
  });
  await t.test("isolation: never shows another user's tasks", () => {
    assert.ok(!all.some((title) => title.startsWith("eleven")));
  });
});

// --- invalid / out-of-range ?page=

test("invalid ?page= redirects to /dashboard", async (t) => {
  for (const bad of ["0", "-1", "1.5", "abc", "1e3", "01", "9999999", "", "2&page=3", "%20%202"]) {
    await t.test(`?page=${bad}`, async () => {
      assert.equal((await view(u21.s, `/dashboard?page=${bad}`)).redirect, "/dashboard");
    });
  }
});

test("out-of-range ?page= redirects to the last page", async (t) => {
  for (const far of ["4", "99", "100000"]) {
    await t.test(`?page=${far}`, async () => {
      assert.equal((await view(u21.s, `/dashboard?page=${far}`)).redirect, "/dashboard?page=3");
    });
  }
});

// --- filters + pagination

test("filters combined with pagination", async (t) => {
  await t.test("Apply from page 2 redirects to page 1", async () => {
    const res = await f.s.submit("/dashboard?page=2", /aria-label="Task filters"/, {
      status_filter: "todo", date_from: "2026-01-01", date_to: "2026-01-26",
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/dashboard");
  });
  const p1 = await view(f.s, "/dashboard");
  const p2 = await view(f.s, "/dashboard?page=2");
  const titles = [...p1.titles, ...p2.titles];
  await t.test("count is filtered (13 of 30)", () => {
    assert.deepEqual([p1.count, p1.pageText, p1.showing], ["13", "1/2", "1-10-13"]);
  });
  await t.test("filtered page 2 has the remaining 3", () => {
    assert.equal(p2.titles.length, 3);
    assert.equal(new Set(titles).size, 13);
  });
  await t.test("every row matches status and inclusive date range", () => {
    for (const title of titles) {
      const i = Number(title.slice(2));
      assert.ok(i % 2 === 0 && i <= 25, title);
    }
  });
  await t.test("filtered ?page=3 normalizes to the last filtered page", async () => {
    assert.equal((await view(f.s, "/dashboard?page=3")).redirect, "/dashboard?page=2");
  });
  await t.test("Reset from page 2 redirects to page 1", async () => {
    const res = await f.s.submit("/dashboard?page=2", /aria-label="Task filters"/, { intent: "reset" });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/dashboard");
  });
  await t.test("after reset: 30 tasks, 3 pages", async () => {
    const v = await view(f.s, "/dashboard");
    assert.deepEqual([v.count, v.pageText], ["30", "1/3"]);
  });
});

// --- deleting the only task on the last page

test("deleting the final item on the last page", async (t) => {
  const { data: last } = await u11.client
    .from("tasks")
    .select("id")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(10, 10);
  const { error } = await u11.client.from("tasks").delete().eq("id", last[0].id);
  assert.ifError(error);
  await t.test("?page=2 goes back to page 1", async () => {
    assert.equal((await view(u11.s, "/dashboard?page=2")).redirect, "/dashboard");
  });
  await t.test("10 tasks remain, pagination hidden", async () => {
    const v = await view(u11.s, "/dashboard");
    assert.equal(v.titles.length, 10);
    assert.equal(v.nav, false);
  });
});

test("unauthenticated ?page=2 redirects to /login", async () => {
  const res = await session().get("/dashboard?page=2");
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "/login");
});
