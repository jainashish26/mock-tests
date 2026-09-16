"use client";

import { Header } from "./Header";
import { Footer } from "./Footer";
import { MeshGradientBackground } from "@/components/ui/MeshGradientBackground";
import styles from "@/app/page.module.css";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.pageContainer}>
      <MeshGradientBackground />
      <Header />
      <main className={styles.main}>
        {children}
      </main>
      <Footer />
    </div>
  );
}
