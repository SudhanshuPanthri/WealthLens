"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun } from "lucide-react";

/** "Sudhanshu Panthri" → "SP", "Alice" → "AL". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Account control: a circular initials (or photo) avatar that shows the full
 * name on hover and opens a menu with the user's identity + sign-out. Replaces
 * the inline name, which wrapped and misaligned the nav. New menu items (e.g.
 * settings) drop in as more <MenuItem>s.
 */
export default function UserMenu({
  name,
  email,
  avatarUrl,
}: {
  name: string;
  email: string;
  avatarUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState<boolean | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // private browsing — theme just won't persist
    }
  }

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const avatar = (size: string, text: string) =>
    avatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatarUrl} alt="" className={`${size} rounded-full object-cover`} />
    ) : (
      <span className={`${size} flex items-center justify-center rounded-full border border-border bg-surface-2 font-semibold text-ink ${text}`}>
        {initials(name)}
      </span>
    );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={name}
        aria-label={`Account: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex rounded-full ring-offset-2 ring-offset-bg transition hover:ring-2 hover:ring-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {avatar("h-8 w-8", "text-xs")}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            {avatar("h-9 w-9 shrink-0", "text-sm")}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted">{email}</p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            role="menuitem"
            className="flex w-full items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-ink"
          >
            <span className="flex items-center gap-2">
              {dark === null ? (
                <span className="h-4 w-4" />
              ) : dark ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
              {dark === null ? "Theme" : dark ? "Dark mode" : "Light mode"}
            </span>
            <span className="text-xs text-muted">{dark === null ? "" : dark ? "Switch to light" : "Switch to dark"}</span>
          </button>
          <button
            onClick={logout}
            role="menuitem"
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-ink"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
