"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { TrendingUp, Loader2, Eye, EyeOff } from "lucide-react";

const OAUTH_ERRORS: Record<string, string> = {
  provider_unavailable: "That sign-in method isn't configured yet.",
  oauth_denied: "Sign-in was cancelled.",
  oauth_invalid: "Sign-in failed — missing authorization. Please try again.",
  oauth_state: "Sign-in session expired. Please try again.",
  oauth_failed: "Could not complete sign-in. Please try again.",
};

export default function AuthForm({
  mode,
  providers,
}: {
  mode: "login" | "signup";
  providers: { id: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const oauthError = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    oauthError ? OAUTH_ERRORS[oauthError] ?? "Sign-in failed. Please try again." : null,
  );
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    if (mode === "signup") body.name = String(form.get("name") ?? "");

    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      router.push(searchParams.get("next") ?? "/dashboard");
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Something went wrong. Please try again.");
    setPending(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-lg font-bold">
          <TrendingUp className="h-5 w-5 text-accent" />
          WealthLens
        </Link>
        <div className="rounded-2xl border border-border bg-surface p-8">
          <h1 className="text-xl font-bold">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {mode === "login"
              ? "Sign in to see your portfolio."
              : "Free to start — import your first portfolio in minutes."}
          </p>

          {providers.length > 0 && (
            <div className="mt-6 space-y-2">
              {providers.map((p) => (
                <a
                  key={p.id}
                  href={`/api/auth/oauth/${p.id}?next=${encodeURIComponent(next)}`}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 py-2.5 text-sm font-medium hover:border-accent/50"
                >
                  {p.id === "google" && <GoogleIcon />}
                  Continue with {p.label}
                </a>
              ))}
              <div className="flex items-center gap-3 pt-2 text-xs text-muted">
                <span className="h-px flex-1 bg-border" /> or {mode === "login" ? "sign in" : "sign up"} with email
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <Field label="Name" name="name" type="text" autoComplete="name" required />
            )}
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              labelAccessory={
                mode === "login" ? (
                  <Link href="/forgot-password" className="text-xs text-accent hover:underline">
                    Forgot password?
                  </Link>
                ) : undefined
              }
            />
            {error && <p className="text-sm text-loss">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 font-semibold text-bg hover:opacity-90 disabled:opacity-60"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="text-accent hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="text-accent hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

function Field({
  label,
  type,
  labelAccessory,
  ...props
}: { label: string; labelAccessory?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (reveal ? "text" : "password") : type;
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-muted">
        {label}
        {labelAccessory}
      </span>
      <div className="relative">
        <input
          {...props}
          type={inputType}
          className={`w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent ${
            isPassword ? "pr-11" : ""
          }`}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted transition-colors hover:text-ink"
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </label>
  );
}
