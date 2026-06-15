import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getProvider, isConfigured, buildAuthorizeUrl, newState } from "@/lib/oauth";

const STATE_COOKIE = "wl_oauth_state";

/** Starts the OAuth flow: set a CSRF state cookie and redirect to the provider. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!getProvider(provider) || !isConfigured(provider)) {
    return NextResponse.redirect(new URL("/login?error=provider_unavailable", request.url));
  }

  const state = newState();
  const next = request.nextUrl.searchParams.get("next") ?? "/dashboard";

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, `${state}:${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthorizeUrl(provider, state));
}
