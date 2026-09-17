"use client";

import { Header } from "./Header";
import { Footer } from "./Footer";
import { MeshGradientBackground } from "@/components/ui/MeshGradientBackground";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      <a
        href="#main-content"
        className="absolute -top-full left-4 z-[200] px-6 py-3 bg-primary text-white font-semibold rounded-md no-underline transition-[top] duration-200 focus:top-4"
      >
        Skip to main content
      </a>
      <MeshGradientBackground />
      <Header />
      <main id="main-content" className="flex-1 pt-20">
        {children}
      </main>
      <Footer />
    </div>
  );
}
