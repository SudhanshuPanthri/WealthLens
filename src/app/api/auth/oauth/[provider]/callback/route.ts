import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getProvider, isConfigured, exchangeCodeForProfile } from "@/lib/oauth";
import { upsertOAuthUser, createSession, setSessionCookie } from "@/lib/auth";

const STATE_COOKIE = "wl_oauth_state";

/** OAuth callback: verify state, exchange code, provision user, start session. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const loginError = (code: string) =>
    NextResponse.redirect(new URL(`/login?error=${code}`, request.url));

  if (!getProvider(provider) || !isConfigured(provider)) return loginError("provider_unavailable");

  const url = request.nextUrl;
  if (url.searchParams.get("error")) return loginError("oauth_denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return loginError("oauth_invalid");

  const cookieStore = await cookies();
  const stored = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  if (!stored) return loginError("oauth_state");

  const [expectedState, next] = stored.split(":");
  if (state !== expectedState) return loginError("oauth_state");

  try {
    const profile = await exchangeCodeForProfile(provider, code);
    const userId = await upsertOAuthUser(provider, profile);
    const { token, expiresAt } = await createSession(userId);
    await setSessionCookie(token, expiresAt);
    const dest = next && next.startsWith("/") ? next : "/dashboard";
    return NextResponse.redirect(new URL(dest, request.url));
  } catch (err) {
    console.error(`OAuth callback failed for ${provider}:`, err);
    return loginError("oauth_failed");
  }
}
