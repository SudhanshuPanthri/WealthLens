import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "wl_session";
const PROTECTED = ["/dashboard", "/import", "/insights", "/watchlist", "/stock", "/index", "/transactions", "/tax"];
const AUTH_PAGES = ["/login", "/signup"];

/**
 * Fast cookie-presence gate. Real session validation (DB lookup) happens in
 * the (app) layout and in every API route — this only handles redirects.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED.some((p) => pathname.startsWith(p)) && !hasSession) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (AUTH_PAGES.some((p) => pathname.startsWith(p)) && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/import/:path*",
    "/insights/:path*",
    "/watchlist/:path*",
    "/stock/:path*",
    "/index/:path*",
    "/transactions/:path*",
    "/tax/:path*",
    "/login",
    "/signup",
  ],
};
