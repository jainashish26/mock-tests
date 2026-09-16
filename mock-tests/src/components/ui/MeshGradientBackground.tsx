"use client";

import { useEffect, useState } from "react";
import styles from "./MeshGradient.module.css";

export function MeshGradientBackground() {
  const [mousePosition, setMousePosition] = useState({ x: 50, y: 50 });

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      setMousePosition({ x, y });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div className={styles.container}>
      {/* Base mesh gradient */}
      <div
        className={styles.mesh}
        style={{
          background: `
            radial-gradient(at ${mousePosition.x}% ${mousePosition.y}%, rgba(25, 75, 251, 0.15) 0%, transparent 50%),
            radial-gradient(at ${100 - mousePosition.x}% ${100 - mousePosition.y}%, rgba(168, 85, 247, 0.12) 0%, transparent 50%),
            radial-gradient(at ${mousePosition.x}% ${100 - mousePosition.y}%, rgba(16, 185, 129, 0.1) 0%, transparent 50%),
            radial-gradient(at ${100 - mousePosition.x}% ${mousePosition.y}%, rgba(251, 191, 36, 0.08) 0%, transparent 50%),
            var(--color-background)
          `,
        }}
      />

      {/* Animated gradient orbs */}
      <div className={`${styles.orb} ${styles.orb1}`} />
      <div className={`${styles.orb} ${styles.orb2}`} />
      <div className={`${styles.orb} ${styles.orb3}`} />

      {/* Noise texture overlay */}
      <div className={styles.noise} />
    </div>
  );
}
