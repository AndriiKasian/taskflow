import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session on every matched request and writes the
// updated auth cookies to both the request (for Server Components rendering
// this request) and the response (for the browser).
//
// The redirect below is only an optimistic check. Protected pages must still
// verify the user themselves (see requireUser in src/lib/auth.ts).
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // Cache-Control / Expires / Pragma: stops CDNs caching auth cookies.
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims: getClaims
  // refreshes an expiring session and triggers setAll above.
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;

  // No landing page: "/" goes straight to the app or to sign-in.
  if (pathname === "/") {
    return redirectTo(data?.claims ? "/dashboard" : "/login", request, response);
  }

  if (!data?.claims && pathname.startsWith("/dashboard")) {
    return redirectTo("/login", request, response);
  }

  // Signed-in users have no use for the auth pages. GET only, so Server
  // Action POSTs from these pages are never redirected.
  if (
    data?.claims &&
    request.method === "GET" &&
    (pathname === "/login" || pathname === "/signup")
  ) {
    return redirectTo("/dashboard", request, response);
  }

  return response;
}

// Redirect while keeping any cookie changes (e.g. a refreshed or cleared
// session) and the cache headers set by Supabase.
function redirectTo(path: string, request: NextRequest, from: NextResponse) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  ["cache-control", "expires", "pragma"].forEach((key) => {
    const value = from.headers.get(key);
    if (value) redirect.headers.set(key, value);
  });
  return redirect;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
