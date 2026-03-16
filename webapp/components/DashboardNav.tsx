"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface DashboardNavProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function DashboardNav({ user }: DashboardNavProps) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <header className="border-b border-luxe-border bg-luxe-bg-elevated/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-display text-xl font-bold tracking-tight">
            <span className="title-gradient title-glow">AI</span>
            <span className="text-luxe-fg"> Friendly</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/dashboard" active={pathname === "/dashboard" || pathname.startsWith("/dashboard/sites")}>
              {t.dashboard.nav.dashboard}
            </NavLink>
            <NavLink
              href="/dashboard/api-keys"
              active={pathname.startsWith("/dashboard/api-keys")}
            >
              {t.dashboard.nav.apiKeys}
            </NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-luxe-fg truncate max-w-[160px]">
              {user.name || user.email}
            </p>
          </div>
          {user.image && (
            <img
              src={user.image}
              alt=""
              className="size-8 rounded-full border border-luxe-border"
            />
          )}
          <LanguageSwitcher />
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="text-xs text-luxe-fg-muted hover:text-luxe-fg transition-colors border border-luxe-border rounded-lg px-3 py-1.5"
          >
            {t.dashboard.signOut}
          </button>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-luxe-gold/10 text-luxe-gold border border-luxe-gold/20"
          : "text-luxe-fg-muted hover:text-luxe-fg hover:bg-luxe-bg-muted"
      }`}
    >
      {children}
    </Link>
  );
}
