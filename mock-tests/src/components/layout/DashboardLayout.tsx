"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  LayoutDashboard, BookOpen, BarChart3, Settings, 
  LogOut, Menu, X, Bell, User, Users, Sparkles, Upload
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";


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
  hasActiveTests?: boolean;
  hasCompletedTests?: boolean;
  hideSidebar?: boolean;
}

export function DashboardLayout({ children, role, userName, hasActiveTests = true, hasCompletedTests = true, hideSidebar = false }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const getLinks = () => {
    switch(role) {
      case "STUDENT":
        const studentLinks = [
          { icon: <LayoutDashboard size={20} />, label: "Overview", href: "/student" }
        ];
        if (hasActiveTests) {
          studentLinks.push({ icon: <BookOpen size={20} />, label: "My Tests", href: "/student" });
        }
        if (hasCompletedTests) {
          studentLinks.push({ icon: <BarChart3 size={20} />, label: "My Results", href: "/student/report" });
        }
        studentLinks.push(
          { icon: <Sparkles size={20} />, label: "AI Practice", href: "/student/ai-practice" },
          { icon: <Settings size={20} />, label: "Account", href: "/student/settings" }
        );
        return studentLinks;
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
        return [
          { icon: <LayoutDashboard size={20} />, label: "Dashboard", href: "/creator" },
          { icon: <BookOpen size={20} />, label: "My Tests", href: "/creator" },
          { icon: <Upload size={20} />, label: "Upload CSV", href: "/creator/upload" },
          { icon: <Settings size={20} />, label: "Settings", href: "/creator" },
        ];
      default:
        return [
          { icon: <LayoutDashboard size={20} />, label: "Dashboard", href: "/admin" },
          { icon: <Users size={20} />, label: "Users", href: "/admin/users" },
          { icon: <Settings size={20} />, label: "Settings", href: "/admin/settings" },
        ];
    }
  };

  const navLinks = getLinks();

  return (
    <div className="min-h-screen bg-background">
      <MeshGradientBackground />
      
      {/* Mobile / Top Bar */}
      <a href="#dashboard-main" className="absolute -top-full left-4 z-[200] px-6 py-3 bg-primary text-white font-semibold rounded-md no-underline transition-[top] duration-200 focus:top-4">Skip to main content</a>
      <div className={`fixed top-0 left-0 right-0 h-14 flex items-center justify-between px-4 bg-card/80 backdrop-blur-md border-b border-border z-40 lg:hidden ${hideSidebar ? "" : ""}`}>
        <div className="flex items-center gap-2 font-bold text-foreground">
          <BookOpen size={18} />
          <span>PRO</span>
        </div>
        {!hideSidebar ? (
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
        ) : (
          <Link href="/">
            <Button variant="outline" size="sm" style={{ borderRadius: '2rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <LogOut size={16} /> <span>Sign Out</span>
            </Button>
          </Link>
        )}
      </div>

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
              {navLinks.map((link, i) => (
                <SidebarItem key={i} {...link} active={i === 0} />
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
                <span className="text-xs text-muted-foreground">Premium Plan</span>
              </div>
            </div>
            <Link href="/">
              <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-foreground">
                <LogOut size={18} className="mr-2" /> Sign Out
              </Button>
            </Link>
          </div>
        </aside>
      )}

      <main id="dashboard-main" className="flex-1 transition-all duration-300 lg:ml-64" style={hideSidebar ? { paddingTop: '6rem', paddingLeft: '1.5rem', paddingRight: '1.5rem', margin: '0 auto', maxWidth: '1200px', width: '100%' } : {}}>
        {!hideSidebar && (
          <header className="flex items-center justify-between mb-8">
            <div className="">
              <h1 className="text-2xl font-bold text-foreground m-0">Welcome back, {userName || "Student"}!</h1>
              <p className="text-muted-foreground text-sm mt-1">Here is what's happening today.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="">
                <Bell size={20} />
              </Button>
              <Link href={role === "PARENT" ? "/parent/settings" : `/${role.toLowerCase()}/settings`}>
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
