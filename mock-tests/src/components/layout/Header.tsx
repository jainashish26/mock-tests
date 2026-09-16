import Link from "next/link";
import { useState, useEffect } from "react";
import { BookOpen, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./Layout.module.css";

interface HeaderProps {
  scrolled?: number;
}

export function Header() {
  const [scrolled, setScrolled] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      const maxScroll = 200;
      const scrollPercent = Math.min(scrollPosition / maxScroll, 1);
      setScrolled(scrollPercent);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const blurAmount = scrolled * 12;
  const opacity = 0.7 + scrolled * 0.3;

  return (
    <>
      <header 
        className={styles.header}
        style={{
          backdropFilter: `blur(${blurAmount}px) saturate(${1 + scrolled * 0.5})`,
          WebkitBackdropFilter: `blur(${blurAmount}px) saturate(${1 + scrolled * 0.5})`,
          background: `rgba(248, 250, 252, ${scrolled > 0 ? 0.8 : 0})`,
          borderBottom: `1px solid rgba(0, 0, 0, ${scrolled > 0 ? 0.05 : 0})`,
          boxShadow: scrolled > 0 ? `0 4px ${6 + scrolled * 10}px -1px rgba(0, 0, 0, ${scrolled * 0.1})` : 'none',
        }}
      >
        <div className={styles.headerGlow} style={{ opacity: scrolled }} />
        <Link href="/" className={styles.logoContainer}>
          <div 
            className={styles.logoIcon}
            style={{ 
              transform: `scale(${1 - scrolled * 0.1})`,
              boxShadow: `0 ${4 + scrolled * 4}px ${8 + scrolled * 8}px -2px rgba(25, 75, 251, ${0.3 + scrolled * 0.2})`
            }}
          ><BookOpen size={20} /></div>
          <span className={styles.logoText}>MockTests Pro</span>
        </Link>
        <nav className={styles.navLinks}>
          <Link href="/features" className={styles.navLink}>Features</Link>
          <Link href="/tests" className={styles.navLink}>Paid Tests</Link>
          <Link href="/free" className={styles.navLink}>Free Tests</Link>
          <Link href="/about" className={styles.navLink}>About Us</Link>
          <Link href="/blog" className={styles.navLink}>Blog</Link>
        </nav>
        <div className={styles.authButtons}>
          <Link href="/auth/login"><Button variant="ghost">Log In</Button></Link>
          <Link href="/auth/signup">
            <Button 
              className={styles.signUpBtn}
              style={{
                boxShadow: `0 ${2 + scrolled * 4}px ${4 + scrolled * 8}px -1px rgba(25, 75, 251, ${0.2 + scrolled * 0.2})`
              }}
            >Sign Up</Button>
          </Link>
        </div>
        
        <Button 
          variant="ghost" 
          className={styles.mobileMenuToggle}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </Button>
      </header>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={styles.mobileMenu}
          >
            <nav className={styles.mobileNav}>
              <Link href="/features" onClick={() => setMobileMenuOpen(false)}>Features</Link>
              <Link href="/tests" onClick={() => setMobileMenuOpen(false)}>Paid Tests</Link>
              <Link href="/free" onClick={() => setMobileMenuOpen(false)}>Free Tests</Link>
              <Link href="/about" onClick={() => setMobileMenuOpen(false)}>About Us</Link>
              <Link href="/blog" onClick={() => setMobileMenuOpen(false)}>Blog</Link>
              <div className={styles.mobileAuth}>
                <Link href="/auth/login" className="w-full"><Button variant="outline" className="w-full">Log In</Button></Link>
                <Link href="/auth/signup" className="w-full"><Button className="w-full">Sign Up</Button></Link>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
