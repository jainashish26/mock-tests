"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Floating3DElementProps {
  children: React.ReactNode;
  depth?: number;
  delay?: number;
  className?: string;
}

export function Floating3DElement({ 
  children, 
  depth = 1, 
  delay = 0,
  className = "" 
}: Floating3DElementProps) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let rafId: number | null = null;
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        setMousePosition({ x, y });
        rafId = null;
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <motion.div
      className={className}
      animate={{
        x: mousePosition.x * 20 * depth,
        y: mousePosition.y * 20 * depth,
        rotateX: -mousePosition.y * 5 * depth,
        rotateY: mousePosition.x * 5 * depth,
      }}
      transition={{
        type: "spring",
        stiffness: 150,
        damping: 20,
        delay: delay,
      }}
      style={{
        transformStyle: "preserve-3d",
      }}
    >
      {children}
    </motion.div>
  );
}
