"use client";

import { useEffect, useState } from "react";

export function MeshGradientBackground() {
  const [mousePosition, setMousePosition] = useState({ x: 50, y: 50 });

  useEffect(() => {
    let rafId: number | null = null;
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
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
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Base mesh gradient */}
      <div
        className="absolute inset-0 transition-[background] duration-1000 ease-out"
        style={{
          background: `
            radial-gradient(at ${mousePosition.x}% ${mousePosition.y}%, rgba(25, 75, 251, 0.15) 0%, transparent 50%),
            radial-gradient(at ${100 - mousePosition.x}% ${100 - mousePosition.y}%, rgba(168, 85, 247, 0.12) 0%, transparent 50%),
            radial-gradient(at ${mousePosition.x}% ${100 - mousePosition.y}%, rgba(16, 185, 129, 0.1) 0%, transparent 50%),
            radial-gradient(at ${100 - mousePosition.x}% ${mousePosition.y}%, rgba(251, 191, 36, 0.08) 0%, transparent 50%),
            var(--background)
          `,
        }}
      />

      {/* Animated gradient orbs */}
      <div className="absolute w-96 h-96 rounded-full blur-[64px] opacity-5 animate-pulse top-0 right-0 bg-primary" style={{ animationDuration: '4s' }} />
      <div className="absolute w-96 h-96 rounded-full blur-[64px] opacity-5 animate-pulse bottom-0 left-0 bg-[#a855f7]" style={{ animationDuration: '6s', animationDelay: '1s' }} />
      <div className="absolute w-96 h-96 rounded-full blur-[64px] opacity-5 animate-pulse top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#10b981]" style={{ animationDuration: '5s', animationDelay: '2s' }} />

      {/* Noise texture overlay */}
      <div 
        className="absolute inset-0 opacity-[0.015] bg-repeat"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' /%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
