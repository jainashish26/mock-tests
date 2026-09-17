import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import { SpatialCard } from "@/components/ui/SpatialCard";
import { Clock, Star, ArrowRight, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Image from "next/image";

export default function TestsPage() {
  const tests = [
    { title: "NAPLAN Year 3 Premium Bundle", desc: "Complete 2026 preparation with 15 mock tests and detailed AI feedback on writing.", time: "45 mins each", type: "NAPLAN", price: "$49.99", image: "https://images.unsplash.com/photo-1627555011270-5555cddef231?w=600&h=400&fit=crop" },
    { title: "Selective High School Prep Pack", desc: "Targeted practice for Mathematical Reasoning and Thinking Skills.", time: "40 mins per test", type: "Selective", price: "$89.99", image: "https://images.unsplash.com/photo-1650525218265-d6fef4ada666?w=600&h=400&fit=crop" },
    { title: "Year 5 NSW OC Placement Mock", desc: "Designed for students seeking Opportunity Class placement in Sydney schools.", time: "30 mins check-ins", type: "OC Prep", price: "$34.99", image: "https://images.unsplash.com/photo-1758270704025-0e1a1793e1ca?w=600&h=400&fit=crop" },
    { title: "Victorian Selective Entry Pack", desc: "Complete reasoning and logic focused practice for Victoria students.", time: "45 mins", type: "Selective", price: "$79.99", image: "https://images.unsplash.com/photo-1763013259158-8a8370542ddb?w=600&h=400&fit=crop" },
  ];

  return (
    <PublicLayout>
      <section className="py-24 px-6" style={{ paddingTop: '8rem' }}>
        <div className="max-w-3xl mx-auto text-center mb-16">
          <Badge variant="secondary"><BookOpen size={12} className="mr-1" />Premium Assessments</Badge>
          <h1 className="text-3xl md:text-[2.5rem] font-bold text-foreground tracking-tight mt-4 mb-4">Prepare with the best</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">Purchase individual packs or a full subscription for comprehensive success.</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto" style={{ marginTop: '4rem' }}>
          {tests.map((test, index) => (
            <SpatialCard key={index} intensity={5}>
              <div className="bg-card rounded-lg border border-border text-left transition-all duration-300">
                <div className="relative aspect-[2/1] overflow-hidden rounded-t-lg">
                  <Image src={test.image} alt={test.title} width={400} height={200} className="h-full w-full object-cover" />
                  <div className="absolute top-3 left-3 flex gap-1 flex-wrap">
                    <Badge className="bg-white/90">{test.type}</Badge>
                  </div>
                  <div className="absolute top-3 right-3">
                    <Badge variant="warning"><Star size={10} fill="white" className="mr-1" /> Premium</Badge>
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-bold mb-2 text-foreground">{test.title}</h3>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2"><Clock size={14} /> {test.time}</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{test.desc}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>{test.price}</span>
                    <Button>Unlock Now <ArrowRight size={16} /></Button>
                  </div>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
