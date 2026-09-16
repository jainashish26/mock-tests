import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import styles from "@/app/page.module.css";
import { Sparkles, Zap, GraduationCap, Heart, CheckCircle2 } from "lucide-react";
import { SpatialCard } from "@/components/ui/SpatialCard";

export default function FeaturesPage() {
  const features = [
    { icon: <Sparkles />, title: "AI Essay Grading", desc: "Get instant, criterion-based feedback on your writing tasks based on official assessment markers.", color: "#194bfb" },
    { icon: <Zap />, title: "Adaptive Testing", desc: "Questions that adjust difficulty in real-time based on your previous answers to speed up learning.", color: "#a855f7" },
    { icon: <GraduationCap />, title: "Parent Dashboards", desc: "Comprehensive reports on your child's progress, strengths, and areas needing improvement.", color: "#d97706" },
    { icon: <Heart />, title: "Stress-Free Prep", desc: "Engaging, gamified elements that reduce exam anxiety and build genuine confidence.", color: "#e11d48" }
  ];

  return (
    <PublicLayout>
      <section className={styles.section} style={{ paddingTop: '8rem' }}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary">Platform Features</Badge>
          <h1 className={styles.sectionTitle}>Everything you need to excel</h1>
          <p className={styles.sectionSubtitle}>Explore our innovative features designed for modern education.</p>
        </div>
        
        <div className={styles.testGrid} style={{ marginTop: '4rem' }}>
          {features.map((f, i) => (
            <SpatialCard key={i} intensity={10}>
              <div className={styles.testItem} style={{ padding: '2.5rem', textAlign: 'center' }}>
                <div className={styles.resourceIcon} style={{ margin: '0 auto 1.5rem', background: f.color + '15', color: f.color }}>
                  {f.icon}
                </div>
                <h3 className={styles.testTitle}>{f.title}</h3>
                <p className={styles.testDescSmall}>{f.desc}</p>
                <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  <CheckCircle2 size={16} color="#059669" />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Available for all years</span>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
      </section>
    </PublicLayout>
  );
}
