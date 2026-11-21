// Authenticated smoke test for the deployed task-insights Edge Function.
//
//   node --env-file=.env.local scripts/insights-smoke.mjs
//
// Run it yourself in an interactive terminal from the project root. It asks
// for a TaskFlow user's email and password (the password is not echoed),
// signs in with the public URL and publishable key from .env.local, calls the
// function with that user's access token, and prints only the HTTP status,
// Cache-Control and the JSON body. Credentials and tokens are never printed.
// The session it created is signed out at the end, even on failure.
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Missing Supabase env. Run: node --env-file=.env.local scripts/insights-smoke.mjs");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run this in an interactive terminal (the password prompt needs a TTY).");
  process.exit(1);
}

async function askEmail() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question("Email: ")).trim();
  } finally {
    rl.close();
  }
}

// Reads a line in raw mode without echoing it. Enter submits, Backspace
// deletes, Ctrl+C aborts.
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    let value = "";
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new Error("Aborted"));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let signedIn = false;

try {
  const email = await askEmail();
  const password = await askHidden("Password: ");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed (${error.code ?? error.status ?? "unknown"})`);
  signedIn = true;

  const res = await fetch(`${url}/functions/v1/task-insights`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${data.session.access_token}` },
  });
  const body = await res.text();
  let json;
  try {
    json = JSON.stringify(JSON.parse(body));
  } catch {
    json = "(response was not JSON)";
  }
  console.log(`HTTP ${res.status}`);
  console.log(`Cache-Control: ${res.headers.get("cache-control")}`);
  console.log(json);
  if (!res.ok) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : "Unexpected error");
  process.exitCode = 1;
} finally {
  // Revokes only this script's session; other sign-ins stay active.
  if (signedIn) await supabase.auth.signOut({ scope: "local" });
}
