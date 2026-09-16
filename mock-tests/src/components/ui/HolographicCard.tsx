"use client";

import { useState, useRef, MouseEvent, ReactNode } from "react";

interface HolographicCardProps {
  children: ReactNode;
  className?: string;
}

export function HolographicCard({ children, className = "" }: HolographicCardProps) {
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setPosition({ x, y });
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setPosition({ x: 50, y: 50 });
    setIsHovered(false);
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}
    >
      {/* Holographic gradient overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.3s duration',
          pointerEvents: 'none',
          zIndex: 1,
          background: `radial-gradient(circle at ${position.x}% ${position.y}%, 
            rgba(25, 75, 251, 0.2) 0%, 
            rgba(168, 85, 247, 0.15) 25%, 
            rgba(251, 191, 36, 0.1) 50%, 
            transparent 70%)`,
        }}
      />
      
      {/* Holographic border effect */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.3s duration',
          pointerEvents: 'none',
          zIndex: 2,
          padding: '2px',
          background: `linear-gradient(${position.x * 3.6}deg, 
            #194bfb, 
            #a855f7, 
            #10b981, 
            #fbbf24, 
            #194bfb)`,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />

      <div style={{ position: 'relative', zIndex: 0 }}>
        {children}
      </div>
    </div>
  );
}
