import Link from "next/link";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import { SpatialCard } from "@/components/ui/SpatialCard";
import { Zap, Sparkles, BookOpen, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function FreeTestsPage() {
  const freeTests = [
    { title: "Diagnostic Math Assessment", desc: "A 20-minute test to identify your current year-level alignment and core knowledge gaps.", time: "20 mins", icon: <Zap />, color: "#194bfb" },
    { title: "Mock Writing - Sample Year 5", desc: "Try our AI essay marker for free! Get immediate results for one prompt.", time: "40 mins", icon: <Sparkles />, color: "#a855f7" },
    { title: "NAPLAN Reading Demo", desc: "Sample reading comprehension task with interactive question types as used in the real exam.", time: "30 mins", icon: <BookOpen />, color: "#d97706" }
  ];

  return (
    <PublicLayout>
      <section className="py-24 px-6" style={{ paddingTop: '8rem' }}>
        <div className="max-w-3xl mx-auto text-center mb-16">
          <Badge variant="secondary">Free Resources</Badge>
          <h1 className="text-3xl md:text-[2.5rem] font-bold text-foreground tracking-tight mt-4 mb-4">Start practicing for free</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">No credit card required. Experience the power of AI-driven mock testing today.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto" style={{ marginTop: '4rem' }}>
          {freeTests.map((resource, index) => (
            <SpatialCard key={index} intensity={8}>
              <div className="bg-card rounded-lg border border-border p-8 transition-all duration-300">
                <div className="w-14 h-14 rounded-md flex items-center justify-center mb-6" style={{ background: resource.color + '15', color: resource.color }}>
                  {resource.icon}
                </div>
                <h3 className="text-lg font-bold mb-2 text-foreground">{resource.title}</h3>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2"><Clock size={12} /> {resource.time}</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{resource.desc}</p>
                <div style={{ marginTop: 'auto', paddingTop: '1.5rem' }}>
                  <Button variant="ghost" className="w-full justify-between">
                    Start Free Practice <ArrowRight size={14} className="ml-1 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
        
        <div className="py-24 px-6" style={{ marginTop: '4rem', background: 'oklch(0.95 0.01 248)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', gap: '3rem', alignItems: 'center', padding: '2rem' }}>
            <div style={{ flex: 1 }}>
              <h2 className="text-3xl md:text-[2.5rem] font-bold text-foreground tracking-tight mt-4 mb-4" style={{ fontSize: '1.75rem', textAlign: 'left' }}>Create an account for more free tests</h2>
              <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed" style={{ textAlign: 'left', margin: 0 }}>Register to track your scores, see history, and unlock more diagnostic tools.</p>
            </div>
            <Link href="/auth/signup"><Button style={{ height: '3.5rem', fontSize: '1.125rem' }}>Sign Up Free</Button></Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
