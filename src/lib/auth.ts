import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { OAuthProfile } from "./oauth";

export const SESSION_COOKIE = "wl_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Find or create a user from an OAuth profile, link the provider account, and
 * return the user id. If an email/password user already exists with the same
 * email, the provider is linked to that account rather than duplicating it.
 */
export async function upsertOAuthUser(provider: string, profile: OAuthProfile): Promise<string> {
  const existingLink = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId } },
  });
  if (existingLink) return existingLink.userId;

  const email = profile.email.toLowerCase();
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    await prisma.oAuthAccount.create({
      data: { userId: existingUser.id, provider, providerAccountId: profile.providerAccountId },
    });
    if (!existingUser.avatarUrl && profile.avatarUrl) {
      await prisma.user.update({ where: { id: existingUser.id }, data: { avatarUrl: profile.avatarUrl } });
    }
    return existingUser.id;
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      portfolios: { create: { name: "My Portfolio" } },
      oauthAccounts: { create: { provider, providerAccountId: profile.providerAccountId } },
    },
  });
  return user.id;
}

/** Returns the logged-in user (with default portfolio id) or null. */
export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { portfolios: { orderBy: { createdAt: "asc" }, take: 1 } } } },
  });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  const { user } = session;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    harvestReminderOptIn: user.harvestReminderOptIn,
    portfolioId: user.portfolios[0]?.id ?? null,
  };
}
