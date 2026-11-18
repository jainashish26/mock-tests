"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Sparkles, Settings, Menu, X, BookOpen } from "lucide-react";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { cn } from "@/lib/utils";

/**
 * Only real routes are listed here. The old dashboard menu pointed "My Results"
 * at `/student/report`, which does not exist (only `/student/report/[attemptId]`
 * does), so it always 404'd.
 */
const STUDENT_LINKS = [
  { href: "/student", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/student/ai-practice", label: "AI Practice", icon: Sparkles, exact: false },
  { href: "/student/settings", label: "Account", icon: Settings, exact: false },
] as const;

interface StudentNavBarProps {
  userName?: string;
}

/**
 * Top navigation bar for the student area: section links plus a working log off.
 * Responsive - collapses into a hamburger menu below the `md` breakpoint so the
 * controls stay tappable on the phones/tablets students actually use.
 */
export function StudentNavBar({ userName }: StudentNavBarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const initial = userName?.trim()?.charAt(0)?.toUpperCase() || "S";

  const links = (onNavigate?: () => void) =>
    STUDENT_LINKS.map(({ href, label, icon: Icon, exact }) => (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        aria-current={isActive(href, exact) ? "page" : undefined}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium no-underline transition-colors duration-150",
          isActive(href, exact)
            ? "bg-primary/10 text-primary font-semibold"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <Icon size={18} aria-hidden="true" />
        <span>{label}</span>
      </Link>
    ));

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
        {/* Brand */}
        <Link
          href="/student"
          className="flex shrink-0 items-center gap-2.5 no-underline"
          aria-label="MockTests home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white">
            <BookOpen size={18} aria-hidden="true" />
          </span>
          <span className="hidden text-base font-extrabold text-foreground sm:inline">
            MockTests
          </span>
        </Link>

        {/* Desktop links */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Student navigation">
          {links()}
        </nav>

        {/* Account + log off */}
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 sm:flex" aria-label={`Signed in as ${userName || "Student"}`}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {initial}
            </span>
            <span className="max-w-[8rem] truncate text-sm font-semibold text-foreground">
              {userName || "Student"}
            </span>
          </span>

          <LogoutButton
            variant="outline"
            size="sm"
            pill
            redirectTo="/auth/student-login"
            className="hidden md:inline-flex"
            label="Log off"
          />

          {/* Mobile menu trigger */}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="student-mobile-menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div
          id="student-mobile-menu"
          className="border-t border-border bg-card px-4 py-3 md:hidden"
        >
          <nav
            className="flex flex-col gap-1"
            aria-label="Student navigation"
            onClick={() => setMenuOpen(false)}
          >
            {links(() => setMenuOpen(false))}
          </nav>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {initial}
              </span>
              <span className="truncate text-sm font-semibold text-foreground">
                {userName || "Student"}
              </span>
            </span>
            <LogoutButton variant="outline" size="sm" pill redirectTo="/auth/student-login" label="Log off" />
          </div>
        </div>
      )}
    </header>
  );
}
