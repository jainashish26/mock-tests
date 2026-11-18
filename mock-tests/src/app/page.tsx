"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import utils from "@/styles/utils.module.css";
import { createClient } from '@/lib/supabase/client';
import { motion, useInView } from "framer-motion";
import { 
  Star, Trophy, Clock, CheckCircle2, Award, TrendingUp, 
  Users, Sparkles, Zap, FileText, GraduationCap, ArrowRight, 
  Target, ChevronRight, BookOpen, Brain, BarChart3, Shield, Heart
} from "lucide-react"
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Floating3DElement } from "@/components/ui/Floating3DElement";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { PageViewTracker } from "@/features/monetisation/PageViewTracker";

function useCounter(end: number, duration = 2) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = end / (duration * 60);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setCount(end); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 1000 / 60);
    return () => clearInterval(timer);
  }, [inView, end, duration]);
  return { count, ref };
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.15 });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 40 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }} className={className}>
      {children}
    </motion.div>
  );
}

export default function Home() {
  const [tests, setTests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTests = async () => {
      const supabase = createClient();
      const { data } = await supabase.from('tests').select('id, title, exam_type, is_free, time_limit_mins').eq('status', 'PUBLISHED').limit(3);
      if (data) setTests(data);
      setIsLoading(false);
    };
    fetchTests();
  }, []);

  const displayTests = tests && tests.length > 0 ? tests : [
    { id: '1', title: 'NAPLAN Year 3 Practice', exam_type: 'NAPLAN Reading', is_free: true, time_limit_mins: 45 },
    { id: '2', title: 'NSW Selective Entry', exam_type: 'Selective', is_free: false, time_limit_mins: 60 },
    { id: '3', title: 'Maths Olympiad Prep', exam_type: 'Maths Olympiad', is_free: false, time_limit_mins: 90 },
  ];

  const stat1 = useCounter(50000, 2);
  const stat2 = useCounter(95, 2);
  const stat3 = useCounter(23, 2);

  return (
    <PublicLayout>
      {/* Acquire-stage event. LANDING_VIEWED was in the catalogue but nothing
          fired it, so report A11 had no stage-1 denominator and every conversion
          rate below it was null. Mounted inside PublicLayout so it records every
          visit, once. */}
      <PageViewTracker event="LANDING_VIEWED" props={{ surface: 'landing' }} />
      <div className={styles.pageContainer}>

        {/* --- HERO --- */}
        <section className={styles.hero}>
          <div className={styles.heroBlob1} aria-hidden="true" />
          <div className={styles.heroBlob2} aria-hidden="true" />
          <div className={styles.heroGridBg} aria-hidden="true" />
          <div className={styles.heroInner}>
            <Reveal>
              <div className={styles.heroLeft}>
                <Badge variant="secondary" className={styles.heroBadge}>
                  <Sparkles size={12} className={utils['u-mr1']} />
                  AI-Powered Exam Preparation
                </Badge>
                <h1 className={styles.heroTitle}>
                  Help your child <span className={styles.heroTitleAccent}>ace every exam</span> with confidence
                </h1>
                <p className={styles.heroSubtitle}>
                  Adaptive practice tests, AI-graded essays, and real-time analytics  everything your child needs to excel in NAPLAN, Selective, and Olympiad exams.
                </p>
                <div className={styles.heroActions}>
                  <Link href="/free">
                    <Button size="lg" className={styles.heroCtaPrimary}>
                      Start Free Practice <ArrowRight size={18} />
                    </Button>
                  </Link>
                  <Link href="/pricing">
                    <Button size="lg" variant="outline" className={styles.heroCtaSecondary}>
                      View Plans <ChevronRight size={16} />
                    </Button>
                  </Link>
                </div>
                <div className={styles.heroTrust}>
                  <div className={styles.heroTrustAvatars}>
                    {["S", "M", "A", "J"].map((initial, i) => (
                      <div key={i} className={styles.heroTrustAvatar}>{initial}</div>
                    ))}
                  </div>
                  <div className={styles.heroTrustText}>
                    <div className={styles.heroTrustStars}>
                      {[1,2,3,4,5].map(i => <Star key={i} size={12} fill="#fbbf24" stroke="#fbbf24" />)}
                    </div>
                    <span>Trusted by <strong>50,000+</strong> Australian families</span>
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.15}>
              <div className={styles.heroRight}>
                <Floating3DElement depth={3}>
                  <div className={styles.heroMockup}>
                    <div className={styles.mockupHeader}>
                      <div className={styles.mockupDots}>
                        <span className={styles.mockupDot} style={{ background: '#ff5f57' }} />
                        <span className={styles.mockupDot} style={{ background: '#febc2e' }} />
                        <span className={styles.mockupDot} style={{ background: '#28c840' }} />
                      </div>
                      <span className={styles.mockupTitle}>NAPLAN Year 5 � Reading</span>
                      <div className={styles.mockupLiveBadge}><div className={styles.mockupLiveDot} />Live</div>
                    </div>
                    <div className={styles.mockupBody}>
                      <div className={styles.mockupPassage}>
                        <div className={styles.mockupPassageLabel}>Reading Passage</div>
                        <p className={styles.mockupPassageText}>&ldquo;The Great Barrier Reef, located off the coast of Queensland, is the world&apos;s largest coral reef system...&rdquo;</p>
                      </div>
                      <div className={styles.mockupQuestion}>
                        <span className={styles.mockupQNum}>Q12</span>
                        <p className={styles.mockupQText}>What is the main idea of the passage?</p>
                      </div>
                      <div className={styles.mockupOptions}>
                        {[
                          { text: "The author's opinion on climate change", correct: false },
                          { text: "A comparison of two marine ecosystems", correct: true },
                          { text: "The history of Australian wildlife", correct: false },
                          { text: "Steps to reduce ocean pollution", correct: false },
                        ].map((opt, i) => (
                          <div key={i} className={`${styles.mockupOption} ${opt.correct ? styles.mockupOptionCorrect : ''}`}>
                            <span className={styles.mockupOptionLetter}>{String.fromCharCode(65 + i)}</span>
                            <span className={styles.mockupOptionText}>{opt.text}</span>
                            {opt.correct && <CheckCircle2 size={14} className={styles.mockupCheck} />}
                          </div>
                        ))}
                      </div>
                      <div className={styles.mockupFooter}>
                        <span className={styles.mockupTimer}><Clock size={12} /> 32:15</span>
                        <div className={styles.mockupProgressBar}><div className={styles.mockupProgressFill} style={{ width: '30%' }} /></div>
                        <span className={styles.mockupProgress}>12/40</span>
                      </div>
                    </div>
                  </div>
                </Floating3DElement>
                <motion.div className={styles.heroFloatBadge} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9, duration: 0.6 }}>
                  <div className={styles.floatBadgeIcon} style={{ background: '#ecfdf5', color: '#059669' }}><TrendingUp size={16} /></div>
                  <div><div className={styles.floatBadgeLabel}>Score improved</div><div className={styles.floatBadgeValue}>+23%</div></div>
                </motion.div>
                <motion.div className={`${styles.heroFloatBadge} ${styles.heroFloatBadge2}`} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.2, duration: 0.6 }}>
                  <div className={styles.floatBadgeIcon} style={{ background: '#fef3c7', color: '#b45309' }}><Award size={16} /></div>
                  <div><div className={styles.floatBadgeLabel}>AI Graded</div><div className={styles.floatBadgeValue}>A+</div></div>
                </motion.div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* --- STATS --- */}
        <section className={styles.statsSection}>
          <div className={styles.statsGrid}>
            <Reveal><div className={styles.statCard}><div className={styles.statNumber}><span ref={stat1.ref}>{stat1.count.toLocaleString()}</span>+</div><div className={styles.statLabel}>Active Students</div></div></Reveal>
            <Reveal delay={0.1}><div className={styles.statCard}><div className={styles.statNumber}><span ref={stat2.ref}>{stat2.count}</span>%</div><div className={styles.statLabel}>Parent Satisfaction</div></div></Reveal>
            <Reveal delay={0.2}><div className={styles.statCard}><div className={styles.statNumber}>+<span ref={stat3.ref}>{stat3.count}</span>%</div><div className={styles.statLabel}>Average Score Improvement</div></div></Reveal>
          </div>
        </section>

        {/* --- BENTO GRID --- */}
        <section className={styles.section}>
          <Reveal>
            <div className={styles.sectionHeader}>
              <Badge variant="secondary" className={styles.sectionBadge}><Zap size={12} className={utils['u-mr1']} />Powerful Features</Badge>
              <h2 className={styles.sectionTitle}>Everything your child needs to succeed</h2>
              <p className={styles.sectionSubtitle}>Our AI-powered platform adapts to your child's learning style and provides instant feedback.</p>
            </div>
          </Reveal>
          <div className={styles.bentoGrid}>
            <Reveal><div className={`${styles.bentoCard} ${styles.bentoLarge}`}>
              <div className={styles.bentoIconWrap} style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}><Brain size={20} /></div>
              <h3 className={styles.bentoTitle}>AI-Powered Grading</h3>
              <p className={styles.bentoDesc}>Get instant, detailed feedback on essays and written responses. Our AI analyzes grammar, structure, and content quality.</p>
              <div className={styles.bentoVisual}>
                <div className={styles.aiGradeDemo}>
                  {[
                    { label: 'Grammar', score: 92 },
                    { label: 'Structure', score: 88 },
                    { label: 'Content', score: 95 },
                  ].map((item, i) => (
                    <div key={i} className={styles.aiGradeRow}>
                      <span className={styles.aiGradeLabel}>{item.label}</span>
                      <div className={styles.aiGradeBar}><div style={{ width: `${item.score}%` }} /></div>
                      <span className={styles.aiGradeScore}>{item.score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div></Reveal>
            <Reveal delay={0.1}><div className={`${styles.bentoCard} ${styles.bentoMed}`}>
              <div className={styles.bentoIconWrap} style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}><Target size={20} /></div>
              <h3 className={styles.bentoTitle}>Adaptive Difficulty</h3>
              <p className={styles.bentoDesc}>Questions automatically adjust to your child's skill level.</p>
              <div className={styles.bentoVisual}>
                <svg className={styles.adaptiveChart} viewBox="0 0 200 80" fill="none">
                  <path d="M 0 60 Q 50 20, 100 40 T 200 30" stroke="url(#gradient)" strokeWidth="3" fill="none" />
                  <defs><linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#f97316" /></linearGradient></defs>
                </svg>
              </div>
            </div></Reveal>
            <Reveal delay={0.2}><div className={`${styles.bentoCard} ${styles.bentoSmall}`}>
              <div className={styles.bentoIconWrap} style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}><Zap size={20} /></div>
              <h3 className={styles.bentoTitle}>Instant Feedback</h3>
              <p className={styles.bentoDesc}>Real-time results and explanations.</p>
            </div></Reveal>
            <Reveal delay={0.3}><div className={`${styles.bentoCard} ${styles.bentoSmall}`}>
              <div className={styles.bentoIconWrap} style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}><BarChart3 size={20} /></div>
              <h3 className={styles.bentoTitle}>Progress Analytics</h3>
              <p className={styles.bentoDesc}>Track improvement over time.</p>
            </div></Reveal>
            <Reveal delay={0.4}><div className={`${styles.bentoCard} ${styles.bentoSmall}`}>
              <div className={styles.bentoIconWrap} style={{ background: 'linear-gradient(135deg, #ec4899, #db2777)' }}><Trophy size={20} /></div>
              <h3 className={styles.bentoTitle}>Achievement Badges</h3>
              <p className={styles.bentoDesc}>Earn rewards for milestones.</p>
            </div></Reveal>
          </div>
        </section>

        {/* --- TESTIMONIALS --- */}
        <section className={styles.section}>
          <Reveal>
            <div className={styles.sectionHeader}>
              <Badge variant="secondary" className={styles.sectionBadge}><Heart size={12} className={utils['u-mr1']} />Success Stories</Badge>
              <h2 className={styles.sectionTitle}>Loved by families across Australia</h2>
            </div>
          </Reveal>
          <div className={styles.testimonialsGrid}>
            {[
              { name: "Sarah K.", achievement: "NAPLAN Band 6", quote: "My daughter's reading comprehension improved dramatically after just 3 months of practice. The AI essay feedback is incredibly detailed.", initial: "S" },
              { name: "Marcus T.", achievement: "Top 2% Selective School", quote: "Practicing under timed conditions with adaptive questions made the real exam feel easy. Got into my first-choice school!", initial: "M" },
              { name: "Elena R.", achievement: "NAPLAN Exceeding Band 6", quote: "I used to get anxious about maths, but the personalized paths helped me build confidence step-by-step.", initial: "E" },
            ].map((story, index) => (
              <Reveal key={index} delay={index * 0.1}>
                <div className={styles.testimonialCard}>
                  <div className={styles.testimonialStars}>
                    {[1,2,3,4,5].map(i => <Star key={i} size={14} fill="#fbbf24" stroke="#fbbf24" />)}
                  </div>
                  <p className={styles.testimonialQuote}>&ldquo;{story.quote}&rdquo;</p>
                  <div className={styles.testimonialAuthor}>
                    <div className={styles.testimonialAvatar}>{story.initial}</div>
                    <div>
                      <div className={styles.testimonialName}>{story.name}</div>
                      <div className={styles.testimonialRole}>{story.achievement}</div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* --- BLOG --- */}
        <section className={styles.section}>
          <Reveal>
            <div className={styles.sectionHeader}>
              <Badge variant="secondary" className={styles.sectionBadge}><BookOpen size={12} className={utils['u-mr1']} />Latest Insights</Badge>
              <h2 className={styles.sectionTitle}>From Our Blog</h2>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className={styles.blogStrip}>
              {[
                { title: "10 Study Tips for NAPLAN Success", date: "March 15, 2026" },
                { title: "How AI is Revolutionizing Essay Grading", date: "March 12, 2026" },
                { title: "Parent's Guide to Selective School Entry", date: "March 10, 2026" },
              ].map((post, index) => (
                <Link href="/blog" key={index} className={styles.blogStripItem}>
                  <div className={styles.blogStripLeft}>
                    <div className={styles.resourceIcon}><FileText size={16} /></div>
                    <span className={styles.blogStripDate}>{post.date}</span>
                    <span className={styles.blogStripTitle}>{post.title}</span>
                  </div>
                  <ArrowRight size={16} className={styles.blogStripArrow} />
                </Link>
              ))}
            </div>
          </Reveal>
        </section>

        {/* --- FINAL CTA --- */}
        <section className={styles.finalCta}>
          <div className={styles.finalCtaGlow} aria-hidden="true" />
          <Reveal>
            <div className={styles.finalCtaContent}>
              <h2 className={styles.finalCtaTitle}>Ready to unlock your child&apos;s potential?</h2>
              <p className={styles.finalCtaSubtitle}>Join 50,000+ families across Australia. Start with a free practice test � no credit card required.</p>
              <div className={styles.finalCtaActions}>
                <Link href="/free">
                  <Button size="lg" className={styles.ctaPrimary}>Start Free Practice <ArrowRight size={18} /></Button>
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </div>
    </PublicLayout>
  );
}
