"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./page.module.css";
import { createClient } from '@/lib/supabase/client';
import { 
  Star, Trophy, Clock, CheckCircle2, Award, TrendingUp, 
  Users, Sparkles, Zap, FileText, Bookmark, GraduationCap, Heart, ArrowRight, 
  Target, ChevronRight, BookOpen
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SpatialCard } from "@/components/ui/SpatialCard";
import { Floating3DElement } from "@/components/ui/Floating3DElement";
import { PublicLayout } from "@/components/layout/PublicLayout";

export default function Home() {
  const [tests, setTests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTests = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('tests')
        .select('id, title, exam_type, is_free, time_limit_mins')
        .eq('status', 'PUBLISHED')
        .limit(3);
      if (data) setTests(data);
      setIsLoading(false);
    };
    fetchTests();
  }, []);

  const displayTests = tests && tests.length > 0 ? tests : [
    { id: '1', title: 'NAPLAN Year 3 Practice', exam_type: 'NAPLAN Reading', is_free: true, time_limit_mins: 45, image: 'https://images.unsplash.com/photo-1758685733737-71f8945decf1?w=600&h=400&fit=crop', badge: 'NAPLAN Style', description: 'Complete preparation for NAPLAN exams with real-style questions' },
    { id: '2', title: 'NSW Selective Entry', exam_type: 'Selective', is_free: false, time_limit_mins: 60, image: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?w=600&h=400&fit=crop', badge: 'Selective', description: 'Rigorous practice tests designed for high-achieving students' },
    { id: '3', title: 'Maths Olympiad Prep', exam_type: 'Maths Olympiad', is_free: false, time_limit_mins: 90, image: 'https://images.unsplash.com/photo-1560785472-2f186f554644?w=600&h=400&fit=crop', badge: 'Olympiad', description: 'Advanced mathematics for competitive students' },
  ];

  return (
    <PublicLayout>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <Floating3DElement depth={0.3}>
            <Badge variant="secondary" className={styles.heroBadge}>
              <Sparkles size={14} className="mr-2" />
              Trusted by 50,000+ Australian Families
            </Badge>
          </Floating3DElement>
          
          <h1 className={styles.heroTitle}>
            Master Your Exams <span className={styles.accentText}>with Confidence</span>
          </h1>
          
          <p className={styles.heroSubtitle}>
            Prepare smarter with adaptive testing, AI-powered essay grading, and personalized learning paths tailored for Years 3-8 students across Australia.
          </p>
          
          <div className={styles.heroActions}>
            <Link href="/free">
              <Button size="lg" className={`${styles.ctaBtn} ${styles.ctaPrimary} ${styles.ctaPulse}`}>
                Start Free Practice <ArrowRight size={20} className={styles.ctaArrow} />
              </Button>
            </Link>
            <Link href="/tests" className={styles.ctaSecondary}>
              Browse Tests
            </Link>
          </div>
          
          <div className={styles.trustIndicators} style={{ marginTop: '1.5rem', gap: '0.75rem' }}>
            <div className={styles.userAvatars}>
              {[1,2,3,4].map(i => <div key={i} className={styles.avatar} />)}
              <span className={styles.trustText}>50,000+ families trust us</span>
            </div>
            <div className={styles.ratingIndicators}>
              {[1,2,3,4,5].map(i => <Star key={i} size={14} fill="var(--color-warning)" stroke="none" />)}
              <span className={styles.trustText}>4.9/5 student rating</span>
            </div>
          </div>
        </div>

        <div className={styles.heroImageWrapper}>
          <Floating3DElement depth={0.5}>
            <div className={styles.heroImageContainer}>
              <Image 
                src="/hero.png" 
                alt="Student excelling"
                width={600}
                height={500}
                className={styles.heroImage}
                priority
              />
            </div>
          </Floating3DElement>

          <div className={styles.floatingTag1}>
            <Badge className={styles.heroGlassCard}>
              <Trophy size={16} className="mr-2 text-yellow-500" />
              <span>Top 5% Achievement</span>
            </Badge>
          </div>
        </div>
        
        <div className={styles.scrollIndicator}>
          <span>Scroll to explore</span>
          <ChevronRight size={16} className={styles.scrollChevron} style={{ transform: 'rotate(90deg)' }} />
        </div>
      </section>

      {/* 4 Steps Section */}
      <section id="features" className={styles.sectionAlt}>
        <div className={styles.sectionAltInner}>
          <div className={styles.sectionHeader}>
            <Badge variant="secondary" className={styles.sectionBadge}>
              <Zap size={12} className="mr-1" />
              Simple Workflow
            </Badge>
            <h2 className={styles.sectionTitle}>Four Steps to Exam Success</h2>
            <p className={styles.sectionSubtitle}>A proven methodology to boost your child's confidence and performance.</p>
          </div>
          <div className={styles.stepsContainer}>
            <div className={styles.stepsConnector}></div>
            <div className={styles.stepsGrid}>
              {[
                { step: "01", title: "Diagnostic Test", desc: "Identify strengths and specific gaps in core knowledge areas.", tooltip: "A 30-minute adaptive test to find your child's baseline level.", icon: <Target size={24} />, bg: "var(--color-primary-light)", color: "var(--color-primary)" },
                { step: "02", title: "AI Practice", desc: "Engage with adaptive mocks that target identified knowledge gaps.", tooltip: "Our AI adjusts question difficulty in real-time based on performance.", icon: <Sparkles size={24} />, bg: "#fef3c7", color: "#d97706" },
                { step: "03", title: "Expert Feedback", desc: "Review performance with instant AI analysis on writing tasks.", tooltip: "Get paragraph-by-paragraph grading on essays against actual exam criteria.", icon: <Award size={24} />, bg: "#ecfdf5", color: "#059669" },
                { step: "04", title: "Final Readiness", desc: "Take a full-length timed mock to ensure total exam confidence.", tooltip: "A complete simulation of test day conditions, including time limits.", icon: <CheckCircle2 size={24} />, bg: "#fce7f3", color: "#db2777" }
              ].map((item, idx) => (
                <SpatialCard key={idx} intensity={15} fullHeight={true}>
                  <div className={styles.stepCardContent}>
                    <div className={styles.stepHeaderBg}>
                      <div className={styles.stepIconContainer} style={{ background: item.bg, color: item.color }}>
                        {item.icon}
                      </div>
                      <span className={styles.stepNumberOverlay}>{item.step}</span>
                    </div>
                    <div className={styles.stepBody}>
                      <h3 className={styles.stepTitle}>{item.title}</h3>
                      <p className={styles.stepDesc}>{item.desc}</p>
                      <details className={styles.stepTooltip}>
                        <summary className="flex items-center gap-1 list-none cursor-pointer outline-none"><BookOpen size={12} /> How it works</summary>
                        <div className={styles.stepTooltipContent}>{item.tooltip}</div>
                      </details>
                    </div>
                  </div>
                </SpatialCard>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Free Practice Materials */}
      <section id="free" className={styles.section}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary" className={styles.sectionBadge}>
             Free Practice
          </Badge>
          <h2 className={styles.sectionTitle}>Try Our Free Demo Tests</h2>
          <p className={styles.sectionSubtitle}>Get a taste of our premium platform with these complimentary assessments.</p>
        </div>
        <div className={styles.resourcesGrid}>
          {[
            { title: "NAPLAN Mini-Mock", desc: "Quick evaluation of literacy and numeracy fundamentals.", icon: <FileText size={24} />, color: "var(--color-primary)" },
            { title: "NSW Selective Literacy", desc: "Sample thinking skills and reading comprehension.", icon: <TrendingUp size={24} />, color: "#a855f7" },
            { title: "Scholarship Essentials", desc: "A brief look into higher-level abstract reasoning.", icon: <Bookmark size={24} />, color: "#d97706" }
          ].map((resource, index) => (
            <SpatialCard key={index} intensity={5}>
              <div className={styles.testItem} style={{ padding: '2rem' }}>
                <div className={styles.resourceIcon} style={{ background: resource.color + '15', color: resource.color }}>
                  {resource.icon}
                </div>
                <h3 className={styles.testTitle}>{resource.title}</h3>
                <p className={styles.testDescSmall}>{resource.desc}</p>
                <div style={{ marginTop: 'auto', paddingTop: '1.5rem' }}>
                  <Link href="/free">
                    <Button variant="ghost" className="w-full flex justify-between group">
                      Try Now <ArrowRight size={14} className="group-hover:translate-x-1" />
                    </Button>
                  </Link>
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
      </section>

      {/* Premium Test Bundles */}
      <section id="tests" className={styles.section}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary" className={styles.sectionBadge}>
            <GraduationCap size={12} className="mr-1" />
            Premium Content
          </Badge>
          <h2 className={styles.sectionTitle}>High Impact Test Packs</h2>
          <p className={styles.sectionSubtitle}>Comprehensive practice bundles for Australia's most competitive exams.</p>
        </div>
        <div className={styles.testGrid}>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`${styles.skeleton} ${styles.skeletonCard}`} />
            ))
          ) : (
            displayTests.map((test, index) => (
              <SpatialCard key={index} intensity={10}>
                <div className={styles.testItem}>
                  <div className={styles.testImageContainer}>
                    <Image 
                      src={test.image || 'https://images.unsplash.com/photo-1758685733737-71f8945decf1?w=600&h=400&fit=crop'} 
                      alt={test.title}
                      width={400} 
                      height={200}
                      className={styles.testThumb}
                    />
                    <div className={styles.testBadgeOverlay}>
                      <Badge className={styles.glassBadge}>{test.badge}</Badge>
                    </div>
                    <div className={styles.testPremiumBadge}>
                      <Badge variant="warning"><Star size={10} fill="white" className="mr-1" /> Premium</Badge>
                    </div>
                  </div>
                  <div className={styles.testInfoBody}>
                    <h3 className={styles.testTitle}>{test.title}</h3>
                    <div className={styles.testMeta}><Clock size={14} /> {test.time_limit_mins} mins</div>
                    <p className={styles.testDescSmall}>{test.description}</p>
                    <Link href="/tests" className="mt-auto">
                      <Button className={styles.viewTestButton}>View Details <ArrowRight size={16} /></Button>
                    </Link>
                  </div>
                </div>
              </SpatialCard>
            ))
          )}
        </div>
        <div className={styles.viewAllLink}>
          <Link href="/tests" className={styles.viewAllBtn}>
            View All Tests <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Success Stories */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary" className={styles.sectionBadge}>
             Success Stories
          </Badge>
          <h2 className={styles.sectionTitle}>What Our Students Say</h2>
          <p className={styles.sectionSubtitle}>Join thousands of students who have unlocked their potential.</p>
        </div>
        <div className={styles.storiesGrid}>
          {[
            { name: "Sarah J.", achievement: "Scholarship Recipient", quote: "The AI feedback on my essays was a game-changer. I knew exactly where I was losing marks.", initial: "S" },
            { name: "Marcus T.", achievement: "Top 2% Selective School", quote: "Practicing under timed conditions with adaptive questions made the real exam feel easy.", initial: "M" },
            { name: "Elena R.", achievement: "NAPLAN Exceeding Band 8", quote: "I used to get anxious about maths, but the personalized paths helped me build confidence step-by-step.", initial: "E" }
          ].map((story, index) => (
            <SpatialCard key={index} intensity={5}>
              <div className={styles.storyCard}>
                <div className={styles.storyUser}>
                  <div className={styles.storyAvatarPlaceholder}>{story.initial}</div>
                  <div>
                    <div className={styles.storyName}>{story.name}</div>
                    <div className={styles.storyAchievement}>{story.achievement}</div>
                  </div>
                </div>
                <p className={styles.storyQuote}>"{story.quote}"</p>
                <div className={styles.ratingIndicators} style={{ marginTop: '1rem' }}>
                  {[1,2,3,4,5].map(i => <Star key={i} size={12} fill="var(--color-warning)" stroke="none" />)}
                </div>
              </div>
            </SpatialCard>
          ))}
        </div>
      </section>

      {/* Blog Posts */}
      <section id="blog" className={styles.section}>
        <div className={styles.sectionHeader}>
          <Badge variant="secondary" className={styles.sectionBadge}>
            <BookOpen size={12} className="mr-1" />
            Latest Insights
          </Badge>
          <h2 className={styles.sectionTitle}>From Our Blog</h2>
          <p className={styles.sectionSubtitle}>Expert tips and strategies for exam success</p>
        </div>
        <div className={styles.blogStrip}>
          {[
            {
              title: "10 Study Tips for NAPLAN Success",
              date: "March 15, 2026",
            },
            {
              title: "How AI is Revolutionizing Essay Grading",
              date: "March 12, 2026",
            },
            {
              title: "Parent's Guide to Selective School Entry",
              date: "March 10, 2026",
            },
          ].map((post, index) => (
            <Link href="/blog" key={index} className={styles.blogStripItem}>
              <div className={styles.blogStripLeft}>
                <div className={styles.resourceIcon} style={{ width: '2rem', height: '2rem', marginBottom: 0, flexShrink: 0 }}>
                  <FileText size={16} />
                </div>
                <span className={styles.blogStripDate}>{post.date}</span>
                <span className={styles.blogStripTitle}>{post.title}</span>
              </div>
              <ArrowRight size={16} className={styles.blogStripArrow} />
            </Link>
          ))}
        </div>
      </section>

      {/* Final CTA Banner */}
      <section className={styles.finalCta}>
        <div className={styles.finalCtaContent}>
          <h2 className={styles.finalCtaTitle}>Ready to unlock your child's potential?</h2>
          <p className={styles.finalCtaSubtitle}>
            Join thousands of families across Australia preparing smarter with MockTests Pro.
          </p>
          <Link href="/free">
            <Button size="lg" className={`${styles.ctaPrimary} ${styles.finalCtaBtn}`}>
              Start Free Practice
            </Button>
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
