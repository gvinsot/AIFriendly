"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LanguageSwitcher } from "./LanguageSwitcher";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/analyses", label: "Analyses" },
  { href: "/dashboard/availability", label: "Availability" },
  { href: "/dashboard/security", label: "Security" },
  { href: "/dashboard/billing", label: "Billing" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-luxe-border bg-luxe-bg/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link
          href="/dashboard"
          className="text-xl font-bold text-luxe-fg tracking-tight"
          title={`v${process.env.APP_VERSION}`}
        >
          AI Friendly
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded-md text-sm transition-colors ${
                pathname === item.href
                  ? "bg-luxe-accent/10 text-luxe-accent font-medium"
                  : "text-luxe-muted hover:text-luxe-fg hover:bg-luxe-card"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="text-sm text-luxe-muted hover:text-luxe-fg transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}