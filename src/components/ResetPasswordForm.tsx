"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TrendingUp, Loader2, Eye, EyeOff, MailCheck, CheckCircle2 } from "lucide-react";

type Step = "email" | "code" | "password" | "done";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function post(url: string, payload: Record<string, string>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data } as { ok: boolean; data: { error?: string; token?: string } };
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { ok, data } = await post("/api/auth/password/request", { email });
    setPending(false);
    if (!ok) return setError(data.error ?? "Something went wrong.");
    setStep("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { ok, data } = await post("/api/auth/password/verify", { email, code });
    setPending(false);
    if (!ok || !data.token) return setError(data.error ?? "Incorrect code.");
    setToken(data.token);
    setStep("password");
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const { ok, data } = await post("/api/auth/password/reset", { email, token, password });
    setPending(false);
    if (!ok) return setError(data.error ?? "Could not reset password.");
    setStep("done");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-lg font-bold">
          <TrendingUp className="h-5 w-5 text-accent" />
          WealthLens
        </Link>
        <div className="rounded-2xl border border-border bg-surface p-8">
          {step === "email" && (
            <form onSubmit={requestCode} className="space-y-4">
              <div>
                <h1 className="text-xl font-bold">Reset your password</h1>
                <p className="mt-1 text-sm text-muted">
                  Enter your account email and we&apos;ll send you a 6-digit code.
                </p>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-muted">Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
                />
              </label>
              {error && <p className="text-sm text-loss">{error}</p>}
              <SubmitButton pending={pending}>Send code</SubmitButton>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={verifyCode} className="space-y-4">
              <div className="flex items-center gap-3">
                <MailCheck className="h-6 w-6 shrink-0 text-accent" />
                <div>
                  <h1 className="text-xl font-bold">Check your email</h1>
                  <p className="mt-1 text-sm text-muted">
                    We sent a 6-digit code to <span className="text-ink">{email}</span>.
                  </p>
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-muted">Verification code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-center text-lg tracking-[0.4em] outline-none placeholder:tracking-normal placeholder:text-muted focus:border-accent"
                />
              </label>
              {error && <p className="text-sm text-loss">{error}</p>}
              <SubmitButton pending={pending}>Verify code</SubmitButton>
              <button
                type="button"
                onClick={requestCode}
                disabled={pending}
                className="w-full text-center text-sm text-accent hover:underline disabled:opacity-60"
              >
                Resend code
              </button>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={resetPassword} className="space-y-4">
              <div>
                <h1 className="text-xl font-bold">Set a new password</h1>
                <p className="mt-1 text-sm text-muted">Choose a password of at least 8 characters.</p>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-muted">New password</span>
                <div className="relative">
                  <input
                    type={reveal ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={8}
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 pr-11 text-sm outline-none placeholder:text-muted focus:border-accent"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted transition-colors hover:text-ink"
                  >
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              {error && <p className="text-sm text-loss">{error}</p>}
              <SubmitButton pending={pending}>Reset password</SubmitButton>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-gain" />
              <h1 className="text-xl font-bold">Password updated</h1>
              <p className="text-sm text-muted">
                Your password has been changed and other sessions were signed out. You can sign in now.
              </p>
              <button
                onClick={() => router.push("/login")}
                className="w-full rounded-lg bg-accent py-2.5 font-semibold text-bg transition-transform duration-200 hover:scale-[1.02] active:scale-95"
              >
                Go to sign in
              </button>
            </div>
          )}
        </div>

        {step !== "done" && (
          <p className="mt-4 text-center text-sm text-muted">
            Remembered it?{" "}
            <Link href="/login" className="text-accent hover:underline">
              Back to sign in
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 font-semibold text-bg transition-transform duration-200 hover:scale-[1.02] active:scale-95 disabled:opacity-60"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}
