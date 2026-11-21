import { redirect } from "next/navigation";

// "/" has no page of its own. src/proxy.ts redirects it to /dashboard or
// /login based on the session; this is only a fallback, and /dashboard
// sends signed-out users on to /login.
export default function Home() {
  redirect("/dashboard");
}
