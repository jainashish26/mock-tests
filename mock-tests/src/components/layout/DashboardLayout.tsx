"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, BookOpen, BarChart3, Settings, 
  Menu, X, Bell, User, Users, Sparkles, Upload, FileQuestion, ClipboardCheck, PenLine
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/layout/LogoutButton";


import { MeshGradientBackground } from "@/components/ui/MeshGradientBackground";

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
}

function SidebarItem({ icon, label, href, active }: SidebarItemProps) {
  return (
    <Link href={href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm no-underline transition-all duration-150 relative hover:bg-accent hover:text-foreground ${active ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"}`}>
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {active && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-l-full" />}
    </Link>
  );
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: "STUDENT" | "PARENT" | "ADMIN" | "CREATOR" | "TUTOR";
  userName?: string;
  hideSidebar?: boolean;
  /**
   * Optional page-supplied navigation bar. When present it replaces the floating
   * hamburger / sign-out control so the two never overlap.
   */
  topBar?: React.ReactNode;
}

export function DashboardLayout({ children, role, userName, hideSidebar = false, topBar }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const getLinks = () => {
    switch(role) {
      case "STUDENT":
        // Only real routes are listed. "My Results" used to point at
        // `/student/report`, which is not a route (only `/student/report/[attemptId]`
        // exists), so it always 404'd; "My Tests" just duplicated Overview.
        return [
          { icon: <LayoutDashboard size={20} />, label: "Overview", href: "/student" },
          { icon: <Sparkles size={20} />, label: "AI Practice", href: "/student/ai-practice" },
          { icon: <Settings size={20} />, label: "Account", href: "/student/settings" },
        ];
      case "PARENT":
        return [
          { icon: <LayoutDashboard size={20} />, label: "Children", href: "/parent" },
          { icon: <BookOpen size={20} />, label: "Test Store", href: "/tests" },
          { icon: <BarChart3 size={20} />, label: "Reports", href: "/parent" },
          { icon: <Settings size={20} />, label: "Settings", href: "/parent/settings" },
        ];
      case "TUTOR":
        return [
          { icon: <LayoutDashboard size={20} />, label: "Students", href: "/tutor" },
          { icon: <BookOpen size={20} />, label: "All Tests", href: "/tutor" },
          { icon: <BarChart3 size={20} />, label: "Reports", href: "/tutor" },
          { icon: <Settings size={20} />, label: "Settings", href: "/tutor/settings" },
        ];
      case "CREATOR":
        // Only routes that actually exist. "My Tests" and "Settings" both used to
        // point at `/creator`, and `/creator/settings` is not a route at all, so
        // the question bank is linked instead of a dead settings page.
        return [
          { icon: <LayoutDashboard size={20} />, label: "Dashboard", href: "/creator" },
          { icon: <BookOpen size={20} />, label: "My Tests", href: "/creator/tests" },
          { icon: <FileQuestion size={20} />, label: "Question Bank", href: "/creator/questions" },
          { icon: <PenLine size={20} />, label: "Writing Prompts", href: "/creator/writing-prompts" },
          { icon: <Upload size={20} />, label: "Upload CSV", href: "/creator/upload" },
        ];
      default:
        // Every href below is a real route under /app/admin. "Review Tests" and
        // "Review Questions" were previously only reachable from dashboard cards.
        return [
          { icon: <LayoutDashboard size={20} />, label: "Dashboard", href: "/admin" },
          { icon: <ClipboardCheck size={20} />, label: "Review Tests", href: "/admin/review/tests" },
          { icon: <FileQuestion size={20} />, label: "Review Questions", href: "/admin/review/questions" },
          { icon: <PenLine size={20} />, label: "Writing Prompts", href: "/creator/writing-prompts" },
          { icon: <Users size={20} />, label: "Users", href: "/admin/users" },
          { icon: <BarChart3 size={20} />, label: "Reports", href: "/admin/reports" },
          { icon: <Settings size={20} />, label: "Settings", href: "/admin/settings" },
        ];
    }
  };

  const navLinks = getLinks();

  /**
   * Highlights the most specific matching link, so `/creator/tests/:id` lights up
   * "My Tests" rather than the first item in the list (which is what `i === 0`
   * did, leaving the active marker wrong on every page but the first).
   */
  const pathname = usePathname() ?? "";
  const matchLength = (href: string) =>
    href === pathname || (href !== "/" && pathname.startsWith(`${href}/`)) ? href.length : -1;
  const bestMatch = Math.max(...navLinks.map((link) => matchLength(link.href)));
  const activeHref = navLinks.find((link) => matchLength(link.href) === bestMatch && bestMatch > 0)?.href;

  // Close the mobile drawer after any navigation, and lock body scroll while it is
  // open so the background cannot drift behind the overlay.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sidebarOpen]);

  /** Sidebar footer subtitle — was hardcoded "Premium Plan" for every role. */
  const accountLabel =
    role === "ADMIN" ? "Administrator" :
    role === "CREATOR" ? "Content creator" :
    role === "TUTOR" ? "Tutor account" :
    role === "PARENT" ? "Parent account" : "Student account";

  // `/creator/settings` does not exist; the creator area has no settings page yet.
  const settingsHref = role === "CREATOR" ? "/creator" : `/${role.toLowerCase()}/settings`;

  return (
    <div className="min-h-screen bg-background">
      <MeshGradientBackground />

      {/* Page-supplied navigation bar (e.g. the student top nav) */}
      {topBar}
      
      {/* Mobile / Top Bar */}
      <a href="#dashboard-main" className="absolute -top-full left-4 z-[200] px-6 py-3 bg-primary text-white font-semibold rounded-md no-underline transition-[top] duration-200 focus:top-4">Skip to main content</a>
      <div className={`fixed top-0 left-0 right-0 h-14 flex items-center justify-between px-4 bg-card/80 backdrop-blur-md border-b border-border z-40 lg:hidden ${topBar ? "hidden" : ""}`}>
        <div className="flex items-center gap-2 font-bold text-foreground">
          <BookOpen size={18} />
          <span>PRO</span>
        </div>
        {!hideSidebar ? (
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
        ) : (
          <LogoutButton variant="outline" size="sm" pill label="Log off" redirectTo={role === "STUDENT" ? "/auth/student-login" : "/auth/login"} />
        )}
      </div>

      {/* Mobile drawer backdrop — tapping it closes the sidebar */}
      {sidebarOpen && !hideSidebar && (
        <div
          className="fixed inset-0 z-20 bg-black/50 backdrop-blur-[2px] lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {!hideSidebar && (
        <aside className={`fixed top-0 left-0 bottom-0 w-64 bg-card border-r border-border flex flex-col z-30 -translate-x-full lg:translate-x-0 transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : ""}`}>
          <div className="p-6 border-b border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-primary text-white rounded-md flex items-center justify-center"><BookOpen size={20} /></div>
              <span className="text-lg font-extrabold text-foreground">MockTests Pro</span>
            </div>
            <Badge variant="secondary" className="">{role}</Badge>
          </div>

          <nav className="flex-1 overflow-y-auto p-4">
            <div className="mb-6">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 block px-3">Main Menu</span>
              {navLinks.map((link) => (
                <SidebarItem
                  key={`${link.href}-${link.label}`}
                  {...link}
                  active={link.href === activeHref}
                />
              ))}
            </div>
          </nav>

          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                {userName?.charAt(0) || "U"}
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-sm text-foreground">{userName || "User"}</span>
                <span className="text-xs text-muted-foreground">{accountLabel}</span>
              </div>
            </div>
            <LogoutButton
              variant="ghost"
              label="Log off"
              redirectTo={role === "STUDENT" ? "/auth/student-login" : "/auth/login"}
              className="w-full justify-start text-muted-foreground hover:text-foreground"
            />
          </div>
        </aside>
      )}

      <main id="dashboard-main" className="flex-1 px-4 pt-16 pb-10 transition-all duration-300 sm:px-6 lg:ml-64 lg:px-8 lg:pt-6" style={hideSidebar ? { paddingTop: topBar ? '1.5rem' : '6rem', paddingLeft: '1.5rem', paddingRight: '1.5rem', margin: '0 auto', maxWidth: '1200px', width: '100%' } : {}}>
        {!hideSidebar && (
          <header className="flex items-center justify-between mb-8">
            <div className="">
              <h1 className="text-2xl font-bold text-foreground m-0">Welcome back, {userName || "Student"}!</h1>
              <p className="text-muted-foreground text-sm mt-1">Here is what&apos;s happening today.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="">
                <Bell size={20} />
              </Button>
              <Link href={settingsHref}>
                <Button variant="ghost" size="icon" className="">
                  <User size={20} />
                </Button>
              </Link>
            </div>
          </header>
        )}
        
        <div className="">
          {children}
        </div>
      </main>
    </div>
  );
}
