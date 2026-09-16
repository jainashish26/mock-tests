"use client";

import { useState, useRef, MouseEvent } from "react";
import { Card } from "./Card";

interface SpatialCardProps {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
  fullHeight?: boolean;
}

export function SpatialCard({ children, className = "", intensity = 20, fullHeight = false }: SpatialCardProps) {
  const [transform, setTransform] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const card = cardRef.current;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * intensity;
    const rotateY = ((centerX - x) / centerX) * intensity;

    setTransform(
      `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`
    );
  };

  const handleMouseLeave = () => {
    setTransform("perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)");
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform,
        transition: "transform 0.1s ease-out",
        transformStyle: "preserve-3d",
        height: fullHeight ? '100%' : undefined
      }}
      className={className}
    >
      <Card 
        style={{ 
          transition: 'box-shadow 0.3s ease',
          boxShadow: transform.includes('deg') ? 'var(--shadow-lg)' : 'var(--shadow-md)',
          height: fullHeight ? '100%' : undefined
        }}
      >
        {children}
      </Card>
    </div>
  );
}
