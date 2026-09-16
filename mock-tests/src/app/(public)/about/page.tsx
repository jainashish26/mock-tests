import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import styles from "@/app/page.module.css";
import { Users, Trophy, Target } from "lucide-react";
import { SpatialCard } from "@/components/ui/SpatialCard";

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
      <section className={styles.section} style={{ paddingTop: '10rem' }}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary">About Us</Badge>
          <h1 className={styles.sectionTitle}>Our Mission & Vision</h1>
          <p className={styles.sectionSubtitle}>Empowering the next generation of Australian students through AI-driven adaptive learning.</p>
        </div>
        
        <div className={styles.stepsGrid} style={{ marginTop: '5rem' }}>
          {values.map((item, i) => (
            <SpatialCard key={i} intensity={10}>
              <div className={styles.stepCardContent}>
                <div className={styles.stepHeaderBg} style={{ background: item.bg, color: item.color }}>
                  <div className={styles.stepIconContainer}>
                    {item.icon}
                  </div>
                  <span className={styles.stepNumberOverlay}>0{i+1}</span>
                </div>
                <div className={styles.stepBody}>
                  <h3 className={styles.stepTitle}>{item.title}</h3>
                  <p className={styles.stepDesc}>{item.desc}</p>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
      </section>

      {/* Additional Mission Details */}
      <section className={styles.section} style={{ marginTop: '4rem' }}>
        <div className={styles.missionGrid}>
          <div className={styles.missionText}>
            <h2 className={styles.sectionTitle} style={{ fontSize: '2.5rem', textAlign: 'left' }}>Scaling Student Potential</h2>
            <p className={styles.sectionSubtitle} style={{ textAlign: 'left', marginLeft: 0 }}>
              At MockTests Pro, we believe that every student has a unique learning path. 
              Our technology is designed not just to test, but to provide the insights 
              needed to bridge gaps and build genuine confidence before stepping into the exam hall.
            </p>
          </div>
          <div className={styles.missionCard}>
            <div className={styles.missionList}>
              {[
                "100% Curriculum Aligned content",
                "Advanced AI Writing Analysis",
                "Stress-free environment for kids",
                "Instant feedback for rapid growth"
              ].map((text, i) => (
                <div key={i} className={styles.missionListItem}>
                  <div className={styles.checkIndicator}>✓</div>
                  <span style={{ fontWeight: 600 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
