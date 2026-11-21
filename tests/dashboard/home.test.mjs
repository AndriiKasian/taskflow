// "/" has no landing page: the Proxy sends visitors to the app or to sign-in.
// See tests/README.md.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { cleanupUsers, session, signedInUser } from "../helpers.mjs";

after(cleanupUsers);

test("signed out: / redirects to /login", async () => {
  const res = await session().get("/");
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "/login");
});

test("signed in: / redirects to /dashboard", async () => {
  const user = await signedInUser("home");
  const res = await user.s.get("/");
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "/dashboard");
});

test("pages use the TaskFlow title", async () => {
  const html = await (await session().get("/login")).text();
  assert.match(html, /<title>Sign in · TaskFlow<\/title>/);
  assert.doesNotMatch(html, /Supabase SaaS Dashboard/);
});
