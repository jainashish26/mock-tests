import Link from "next/link";
import { useState, useEffect } from "react";
import { BookOpen, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { motion, AnimatePresence } from "framer-motion";

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

  return (
    <>
      <header 
        className="fixed top-0 left-0 right-0 h-18 flex items-center justify-between px-6 lg:px-16 z-[1000] transition-all duration-250"
        style={{
          backdropFilter: `blur(${blurAmount}px) saturate(${1 + scrolled * 0.5})`,
          WebkitBackdropFilter: `blur(${blurAmount}px) saturate(${1 + scrolled * 0.5})`,
          background: `rgba(248, 250, 252, ${scrolled > 0 ? 0.8 : 0})`,
          borderBottom: `1px solid rgba(0, 0, 0, ${scrolled > 0 ? 0.05 : 0})`,
          boxShadow: scrolled > 0 ? `0 4px ${6 + scrolled * 10}px -1px rgba(0, 0, 0, ${scrolled * 0.1})` : 'none',
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent transition-opacity duration-300" style={{ opacity: scrolled }} />
        <Link href="/" className="flex items-center gap-3 no-underline text-foreground z-10">
          <div 
            className="w-10 h-10 bg-primary text-white rounded-md flex items-center justify-center transition-all duration-250"
            style={{ 
              transform: `scale(${1 - scrolled * 0.1})`,
              boxShadow: `0 ${4 + scrolled * 4}px ${8 + scrolled * 8}px -2px rgba(25, 75, 251, ${0.3 + scrolled * 0.2})`
            }}
          ><BookOpen size={20} /></div>
          <span className="text-xl font-extrabold">MockTests Pro</span>
        </Link>
        <nav className="hidden lg:flex gap-12 absolute left-1/2 -translate-x-1/2 z-5">
          <Link href="/features" className="no-underline text-muted-foreground font-semibold text-[0.9375rem] transition-all duration-150 relative hover:text-primary">Features</Link>
          <Link href="/pricing" className="no-underline text-muted-foreground font-semibold text-[0.9375rem] transition-all duration-150 relative hover:text-primary">Pricing</Link>
          <Link href="/tests" className="no-underline text-muted-foreground font-semibold text-[0.9375rem] transition-all duration-150 relative hover:text-primary">Paid Tests</Link>
          <Link href="/free" className="no-underline text-muted-foreground font-semibold text-[0.9375rem] transition-all duration-150 relative hover:text-primary">Free Tests</Link>
          <Link href="/about" className="no-underline text-muted-foreground font-semibold text-[0.9375rem] transition-all duration-150 relative hover:text-primary">About Us</Link>
          <Link href="/blog" className="no-underline text-muted-foreground font-semibold text-[0.9375rem] transition-all duration-150 relative hover:text-primary">Blog</Link>
        </nav>
        <div className="hidden lg:flex items-center gap-4 z-10">
          <Link href="/auth/login"><Button variant="ghost">Log In</Button></Link>
          <Link href="/auth/signup">
            <Button 
              className="font-bold px-6"
              style={{
                boxShadow: `0 ${2 + scrolled * 4}px ${4 + scrolled * 8}px -1px rgba(25, 75, 251, ${0.2 + scrolled * 0.2})`
              }}
            >Sign Up</Button>
          </Link>
        </div>
        
        <Button 
          variant="ghost" 
          className="flex lg:hidden z-10"
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
            className="fixed top-18 left-0 right-0 bg-white p-6 z-[999] shadow-lg border-t border-border lg:hidden"
          >
            <nav className="flex flex-col gap-4">
              <Link href="/features" onClick={() => setMobileMenuOpen(false)} className="text-lg font-bold text-foreground no-underline py-2">Features</Link>
              <Link href="/pricing" onClick={() => setMobileMenuOpen(false)} className="text-lg font-bold text-foreground no-underline py-2">Pricing</Link>
              <Link href="/tests" onClick={() => setMobileMenuOpen(false)} className="text-lg font-bold text-foreground no-underline py-2">Paid Tests</Link>
              <Link href="/free" onClick={() => setMobileMenuOpen(false)} className="text-lg font-bold text-foreground no-underline py-2">Free Tests</Link>
              <Link href="/about" onClick={() => setMobileMenuOpen(false)} className="text-lg font-bold text-foreground no-underline py-2">About Us</Link>
              <Link href="/blog" onClick={() => setMobileMenuOpen(false)} className="text-lg font-bold text-foreground no-underline py-2">Blog</Link>
              <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-border">
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
