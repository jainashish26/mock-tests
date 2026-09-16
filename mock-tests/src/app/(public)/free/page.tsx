import Link from "next/link";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import styles from "@/app/page.module.css";
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
      <section className={styles.section} style={{ paddingTop: '8rem' }}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary">Free Resources</Badge>
          <h1 className={styles.sectionTitle}>Start practicing for free</h1>
          <p className={styles.sectionSubtitle}>No credit card required. Experience the power of AI-driven mock testing today.</p>
        </div>
        
        <div className={styles.resourcesGrid} style={{ marginTop: '4rem' }}>
          {freeTests.map((resource, index) => (
            <SpatialCard key={index} intensity={8}>
              <div className={styles.testItem} style={{ padding: '2rem' }}>
                <div className={styles.resourceIcon} style={{ background: resource.color + '15', color: resource.color }}>
                  {resource.icon}
                </div>
                <h3 className={styles.testTitle}>{resource.title}</h3>
                <div className={styles.testMeta}><Clock size={12} /> {resource.time}</div>
                <p className={styles.testDescSmall}>{resource.desc}</p>
                <div style={{ marginTop: 'auto', paddingTop: '1.5rem' }}>
                  <Button variant="ghost" className="w-full flex justify-between group">
                    Start Free Practice <ArrowRight size={14} className="group-hover:translate-x-1" />
                  </Button>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
        
        <div className={styles.section} style={{ marginTop: '4rem', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', gap: '3rem', alignItems: 'center', padding: '2rem' }}>
            <div style={{ flex: 1 }}>
              <h2 className={styles.sectionTitle} style={{ fontSize: '1.75rem', textAlign: 'left' }}>Create an account for more free tests</h2>
              <p className={styles.sectionSubtitle} style={{ textAlign: 'left', margin: 0 }}>Register to track your scores, see history, and unlock more diagnostic tools.</p>
            </div>
            <Link href="/auth/signup"><Button className={styles.signUpBtn} style={{ height: '3.5rem', fontSize: '1.125rem' }}>Sign Up Free</Button></Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
