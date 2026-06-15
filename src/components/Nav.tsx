"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { TrendingUp, LayoutDashboard, Upload, Sparkles, Star, Receipt, Landmark, Layers, LogOut } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: Layers },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/tax", label: "Tax", icon: Landmark },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/insights", label: "AI Insights", icon: Sparkles },
];

export default function Nav({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold tracking-tight">
            <TrendingUp className="h-5 w-5 text-accent" />
            WealthLens
          </Link>
          <nav className="flex items-center gap-1">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                    active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:block">{userName}</span>
          <ThemeToggle />
          <button
            onClick={logout}
            title="Sign out"
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
