"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  LayoutDashboard, BookOpen, BarChart3, Settings, 
  LogOut, Menu, X, Bell, User, Users, Sparkles, Upload
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import styles from "./DashboardLayout.module.css";
import { MeshGradientBackground } from "@/components/ui/MeshGradientBackground";

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  href: string;
  active?: boolean;
}

function SidebarItem({ icon, label, href, active }: SidebarItemProps) {
  return (
    <Link href={href} className={`${styles.sidebarItem} ${active ? styles.sidebarItemActive : ""}`}>
      <span className={styles.sidebarIcon}>{icon}</span>
      <span className={styles.sidebarLabel}>{label}</span>
      {active && <div className={styles.activeIndicator} />}
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
    <div className={styles.dashboardContainer}>
      <MeshGradientBackground />
      
      {/* Mobile / Top Bar */}
      <div className={`${styles.mobileTopBar} ${hideSidebar ? styles.topBarAlwaysVisible : ""}`}>
        <div className={styles.logoSmall}>
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
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarMobileOpen : ""}`}>
          <div className={styles.sidebarHeader}>
            <div className={styles.logoFull}>
              <div className={styles.logoIcon}><BookOpen size={20} /></div>
              <span className={styles.logoText}>MockTests Pro</span>
            </div>
            <Badge variant="secondary" className={styles.roleBadge}>{role}</Badge>
          </div>

          <nav className={styles.sidebarNav}>
            <div className={styles.navSection}>
              <span className={styles.navSectionLabel}>Main Menu</span>
              {navLinks.map((link, i) => (
                <SidebarItem key={i} {...link} active={i === 0} />
              ))}
            </div>
          </nav>

          <div className={styles.sidebarFooter}>
            <div className={styles.userProfile}>
              <div className={styles.userAvatarPlaceholder}>
                {userName?.charAt(0) || "U"}
              </div>
              <div className={styles.userInfo}>
                <span className={styles.userName}>{userName || "User"}</span>
                <span className={styles.userStatus}>Premium Plan</span>
              </div>
            </div>
            <Link href="/">
              <Button variant="ghost" className={styles.logoutBtn}>
                <LogOut size={18} className="mr-2" /> Sign Out
              </Button>
            </Link>
          </div>
        </aside>
      )}

      <main className={styles.dashboardMain} style={hideSidebar ? { paddingTop: '6rem', paddingLeft: '1.5rem', paddingRight: '1.5rem', margin: '0 auto', maxWidth: '1200px', width: '100%' } : {}}>
        {!hideSidebar && (
          <header className={styles.dashboardHeader}>
            <div className={styles.headerLeft}>
              <h1 className={styles.headerTitle}>Welcome back, {userName || "Student"}!</h1>
              <p className={styles.headerSubtitle}>Here is what's happening today.</p>
            </div>
            <div className={styles.headerRight}>
              <Button variant="ghost" size="icon" className={styles.headerActionBtn}>
                <Bell size={20} />
              </Button>
              <Link href={role === "PARENT" ? "/parent/settings" : `/${role.toLowerCase()}/settings`}>
                <Button variant="ghost" size="icon" className={styles.headerActionBtn}>
                  <User size={20} />
                </Button>
              </Link>
            </div>
          </header>
        )}
        
        <div className={styles.dashboardContent}>
          {children}
        </div>
      </main>
    </div>
  );
}
