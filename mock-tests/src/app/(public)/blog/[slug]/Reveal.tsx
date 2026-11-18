'use client';

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Thin client wrapper that adds the site's scroll-reveal animation.
 *
 * Keeping animation in a dedicated client component lets the surrounding blog
 * post render as a server component, so all SEO/AEO content is emitted in the
 * initial HTML with no hydration dependency.
 */
interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Set to false for content that must never be hidden from crawlers. */
  disabled?: boolean;
}

export function Reveal({ children, className, delay = 0, disabled = false }: RevealProps) {
  if (disabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
