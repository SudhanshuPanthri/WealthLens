import Link from "next/link";
import { redirect } from "next/navigation";
import { TrendingUp, Upload, Sparkles, ShieldCheck, Activity } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import MarketPanel from "@/components/MarketPanel";
import ThemeToggle from "@/components/ThemeToggle";

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6">
      <div className="hero-glow pointer-events-none absolute left-1/2 top-0 -z-10 h-[480px] w-screen -translate-x-1/2" />
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <TrendingUp className="h-5 w-5 text-accent" />
          WealthLens
        </div>
        <nav className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login" className="rounded-lg px-4 py-2 text-sm text-muted hover:text-ink">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="flex flex-col items-center justify-center pt-12 text-center">
        <h1 className="max-w-3xl text-5xl font-extrabold leading-tight tracking-tight">
          One portfolio. Every broker.{" "}
          <span className="text-accent">AI that actually reads it.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          Drop in your holdings export from Zerodha, Groww, or any other platform. WealthLens
          merges them, prices them live, and runs a rigorous AI review — concentration risks,
          sector tilts, red flags, and what to do about them.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/signup"
            className="rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
          >
            Analyze my portfolio
          </Link>
        </div>

        <div className="mt-20 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              icon: Upload,
              title: "Import from anywhere",
              body: "Zerodha Console & Kite, Groww statements, or a simple CSV — auto-detected and merged into one view.",
            },
            {
              icon: Sparkles,
              title: "Insights that bite",
              body: "A health score plus specific, number-backed risks and suggestions — real AI analysis, not boilerplate.",
            },
            {
              icon: ShieldCheck,
              title: "Yours alone",
              body: "Your holdings live in your account. No broker passwords, no API keys to your money — just statement files.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-surface p-6 text-left">
              <f.icon className="h-6 w-6 text-accent" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-24 pt-24">
        <div className="mb-6 flex items-center gap-2">
          <Activity className="h-5 w-5 text-accent" />
          <h2 className="text-xl font-bold tracking-tight">Live markets</h2>
          <span className="text-sm text-muted">— NSE &amp; BSE indices, top movers, and mutual funds</span>
        </div>
        <MarketPanel />
      </section>
    </main>
  );
}
