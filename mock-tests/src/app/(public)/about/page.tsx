import type { Metadata } from "next";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import { Users, Trophy, Target } from "lucide-react";
import { SpatialCard } from "@/components/ui/SpatialCard";
import { JsonLd } from "@/components/seo/JsonLd";
import { aboutPageGraph } from "@/lib/seo/schema";
import { absoluteUrl } from "@/lib/seo/site-config";

const PAGE_TITLE = "About Us: Our Mission, Methodology & Editorial Standards";
const PAGE_DESCRIPTION =
  "Meet the MockTests Pro team of educators, data scientists and engineers, and see how every guide is fact-checked against ACARA and state sources.";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    url: absoluteUrl("/about"),
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: PAGE_TITLE, description: PAGE_DESCRIPTION },
};

export default function AboutPage() {
  const values = [
    { 
      title: "Who We Are", 
      desc: "We are a team of educators, data scientists, and engineers dedicated to making high-quality exam preparation accessible to everyone.", 
      icon: <Users size={24} />, 
      color: "var(--color-primary)", 
      bg: "var(--color-primary-light)" 
    },
    { 
      title: "Our Achievement", 
      desc: "Over 50,000 students have used MockTests Pro to prepare for NAPLAN, Selective Schools, and Scholarship exams with incredible results.", 
      icon: <Trophy size={24} />, 
      color: "#d97706", 
      bg: "#fef3c7" 
    },
    { 
      title: "Our Methodology", 
      desc: "We use proprietary AI algorithms to identify knowledge gaps and provide perfectly-timed practice to maximize retention.", 
      icon: <Target size={24} />, 
      color: "#059669", 
      bg: "#ecfdf5" 
    }
  ];

  return (
    <PublicLayout>
      <JsonLd data={aboutPageGraph(absoluteUrl("/about"), PAGE_DESCRIPTION)} />
      <section className="py-24 px-6" style={{ paddingTop: '10rem' }}>
        <div className="max-w-3xl mx-auto text-center mb-16">
          <Badge variant="secondary">About Us</Badge>
          <h1 className="text-3xl md:text-[2.5rem] font-bold text-foreground tracking-tight mt-4 mb-4">Our Mission & Vision</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">Empowering the next generation of Australian students through AI-driven adaptive learning.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto" style={{ marginTop: '5rem' }}>
          {values.map((item, i) => (
            <SpatialCard key={i} intensity={10}>
              <div className="overflow-hidden">
                <div className="flex items-center justify-center relative py-12 px-8" style={{ background: item.bg, color: item.color }}>
                  <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center relative z-[2] shadow-md">
                    {item.icon}
                  </div>
                  <span className="absolute right-6 top-4 text-[5rem] font-black opacity-[0.08] leading-none">0{i+1}</span>
                </div>
                <div className="p-8">
                  <h3 className="text-xl font-bold mb-3 text-foreground">{item.title}</h3>
                  <p className="text-muted-foreground leading-[1.7] m-0">{item.desc}</p>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
      </section>

      {/* Additional Mission Details */}
      <section className="py-24 px-6" style={{ marginTop: '4rem' }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 max-w-4xl mx-auto items-center">
          <div>
            <h2 className="text-3xl md:text-[2.5rem] font-bold text-foreground tracking-tight mt-4 mb-4" style={{ fontSize: '2.5rem', textAlign: 'left' }}>Scaling Student Potential</h2>
            <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed" style={{ textAlign: 'left', marginLeft: 0 }}>
              At MockTests Pro, we believe that every student has a unique learning path. 
              Our technology is designed not just to test, but to provide the insights 
              needed to bridge gaps and build genuine confidence before stepping into the exam hall.
            </p>
          </div>
          <div className="bg-card rounded-lg p-10 border border-border shadow-lg">
            <div className="flex flex-col gap-5">
              {[
                "100% Curriculum Aligned content",
                "Advanced AI Writing Analysis",
                "Stress-free environment for kids",
                "Instant feedback for rapid growth"
              ].map((text, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">✓</div>
                  <span className="font-semibold">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
