import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import styles from "@/app/page.module.css";
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
      <section className={styles.section} style={{ paddingTop: '8rem' }}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary"><BookOpen size={12} className="mr-1" />Premium Assessments</Badge>
          <h1 className={styles.sectionTitle}>Prepare with the best</h1>
          <p className={styles.sectionSubtitle}>Purchase individual packs or a full subscription for comprehensive success.</p>
        </div>
        
        <div className={styles.testGrid} style={{ marginTop: '4rem' }}>
          {tests.map((test, index) => (
            <SpatialCard key={index} intensity={5}>
              <div className={styles.testItem}>
                <div className={styles.testImageContainer}>
                  <Image src={test.image} alt={test.title} width={400} height={200} className={styles.testThumb} />
                  <div className={styles.testBadgeOverlay}>
                    <Badge className={styles.glassBadge}>{test.type}</Badge>
                  </div>
                  <div className={styles.testPremiumBadge}>
                    <Badge variant="warning"><Star size={10} fill="white" className="mr-1" /> Premium</Badge>
                  </div>
                </div>
                <div className={styles.testInfoBody}>
                  <h3 className={styles.testTitle}>{test.title}</h3>
                  <div className={styles.testMeta}><Clock size={14} /> {test.time}</div>
                  <p className={styles.testDescSmall}>{test.desc}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-primary)' }}>{test.price}</span>
                    <Button className={styles.viewTestButton}>Unlock Now <ArrowRight size={16} /></Button>
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
