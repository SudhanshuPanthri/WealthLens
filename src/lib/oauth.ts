import { randomBytes } from "crypto";

/**
 * Lightweight, dependency-free OAuth 2.0 (Authorization Code) layer built on
 * top of WealthLens's own session system. Self-hosted: no per-user pricing, no
 * vendor lock-in, and nothing to break on bleeding-edge Next.js. Add a provider
 * by adding an entry to PROVIDERS and supplying its client id/secret in .env.
 */

export interface OAuthProfile {
  providerAccountId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

interface ProviderConfig {
  id: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  google: {
    id: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    clientId: () => process.env.GOOGLE_CLIENT_ID || undefined,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET || undefined,
    async fetchProfile(accessToken) {
      const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
      const data = (await res.json()) as {
        sub: string;
        email: string;
        name?: string;
        picture?: string;
      };
      return {
        providerAccountId: data.sub,
        email: data.email,
        name: data.name || data.email.split("@")[0],
        avatarUrl: data.picture,
      };
    },
  },
};

export function getProvider(id: string): ProviderConfig | null {
  return PROVIDERS[id] ?? null;
}

export function isConfigured(id: string): boolean {
  const p = PROVIDERS[id];
  return Boolean(p && p.clientId() && p.clientSecret());
}

/** Which providers are usable right now — drives which buttons the UI shows. */
export function configuredProviders(): { id: string; label: string }[] {
  return Object.values(PROVIDERS)
    .filter((p) => p.clientId() && p.clientSecret())
    .map((p) => ({ id: p.id, label: p.label }));
}

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(providerId: string): string {
  return `${appUrl()}/api/auth/oauth/${providerId}/callback`;
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(providerId: string, state: string): string {
  const p = PROVIDERS[providerId]!;
  const params = new URLSearchParams({
    client_id: p.clientId()!,
    redirect_uri: redirectUri(providerId),
    response_type: "code",
    scope: p.scope,
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

export async function exchangeCodeForProfile(
  providerId: string,
  code: string,
): Promise<OAuthProfile> {
  const p = PROVIDERS[providerId]!;
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: p.clientId()!,
      client_secret: p.clientSecret()!,
      redirect_uri: redirectUri(providerId),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const token = (await res.json()) as { access_token: string };
  return p.fetchProfile(token.access_token);
}
