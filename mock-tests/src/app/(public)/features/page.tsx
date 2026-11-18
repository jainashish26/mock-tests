import type { Metadata } from "next";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import { Sparkles, Zap, GraduationCap, Heart, CheckCircle2 } from "lucide-react";
import { SpatialCard } from "@/components/ui/SpatialCard";
import { JsonLd } from "@/components/seo/JsonLd";
import { featuresGraph } from "@/lib/seo/schema";
import { absoluteUrl } from "@/lib/seo/site-config";

const PAGE_TITLE = "Platform Features: AI Essay Grading & Adaptive Exam Practice";
const PAGE_DESCRIPTION =
  "Criterion-based AI essay grading, adaptive difficulty, parent progress dashboards and low-pressure exam practice for Australian students in Years 3 to 8.";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/features" },
  keywords: [
    "AI essay grading",
    "adaptive testing Australia",
    "NAPLAN practice platform",
    "parent progress dashboard",
    "exam preparation software",
  ],
  openGraph: {
    type: "website",
    url: absoluteUrl("/features"),
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: PAGE_TITLE, description: PAGE_DESCRIPTION },
};

export default function FeaturesPage() {
  const features = [
    { icon: <Sparkles />, title: "AI Essay Grading", desc: "Get instant, criterion-based feedback on your writing tasks based on official assessment markers.", color: "#194bfb" },
    { icon: <Zap />, title: "Adaptive Testing", desc: "Questions that adjust difficulty in real-time based on your previous answers to speed up learning.", color: "#a855f7" },
    { icon: <GraduationCap />, title: "Parent Dashboards", desc: "Comprehensive reports on your child's progress, strengths, and areas needing improvement.", color: "#d97706" },
    { icon: <Heart />, title: "Stress-Free Prep", desc: "Engaging, gamified elements that reduce exam anxiety and build genuine confidence.", color: "#e11d48" }
  ];

  return (
    <PublicLayout>
      <JsonLd
        data={featuresGraph(
          absoluteUrl("/features"),
          PAGE_DESCRIPTION,
          features.map((f) => f.title)
        )}
      />
      <section className="py-24 px-6" style={{ paddingTop: '8rem' }}>
        <div className="max-w-3xl mx-auto text-center mb-16">
          <Badge variant="secondary">Platform Features</Badge>
          <h1 className="text-3xl md:text-[2.5rem] font-bold text-foreground tracking-tight mt-4 mb-4">Everything you need to excel</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">Explore our innovative features designed for modern education.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto" style={{ marginTop: '4rem' }}>
          {features.map((f, i) => (
            <SpatialCard key={i} intensity={10}>
              <div className="bg-card rounded-lg p-10 border border-border text-left transition-all duration-300" style={{ padding: '2.5rem', textAlign: 'center' }}>
                <div className="w-14 h-14 rounded-md flex items-center justify-center mb-6" style={{ margin: '0 auto 1.5rem', background: f.color + '15', color: f.color }}>
                  {f.icon}
                </div>
                <h3 className="text-lg font-bold mb-2 text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-[1.6]">{f.desc}</p>
                <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  <CheckCircle2 size={16} color="#059669" />
                  <span className="text-[0.8125rem] font-semibold">Available for all years</span>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
