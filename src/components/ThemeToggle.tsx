"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Light/dark toggle persisted to localStorage. Mirrors challan-check. */
export default function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // private browsing — theme just won't persist
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted transition-colors hover:text-ink"
    >
      <span className="transition-transform duration-200" style={{ transform: dark ? "rotate(0deg)" : "rotate(90deg)" }}>
        {dark === null ? <span className="block h-4 w-4" /> : dark ? <Moon size={16} /> : <Sun size={16} />}
      </span>
    </button>
  );
}
