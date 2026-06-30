"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, LayoutDashboard, Upload, Sparkles, Star, Receipt, Landmark, Layers, Coins, Wallet } from "lucide-react";
import UserMenu from "@/components/UserMenu";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: Layers },
  { href: "/dividends", label: "Dividends", icon: Coins },
  { href: "/fees", label: "Fees", icon: Wallet },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/tax", label: "Tax", icon: Landmark },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/insights", label: "AI Insights", icon: Sparkles },
];

export default function Nav({
  userName,
  userEmail,
  userAvatar,
}: {
  userName: string;
  userEmail: string;
  userAvatar?: string | null;
}) {
  const pathname = usePathname();

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
                  className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
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
        <div className="flex shrink-0 items-center gap-3">
          <UserMenu name={userName} email={userEmail} avatarUrl={userAvatar} />
        </div>
      </div>
    </header>
  );
}
