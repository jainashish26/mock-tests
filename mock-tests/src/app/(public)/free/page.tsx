import type { Metadata } from "next";
import Link from "next/link";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Badge } from "@/components/ui/Badge";
import { SpatialCard } from "@/components/ui/SpatialCard";
import { Zap, Sparkles, BookOpen, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { JsonLd } from "@/components/seo/JsonLd";
import { faqPageSchema } from "@/lib/seo/schema";
import { absoluteUrl } from "@/lib/seo/site-config";

const PAGE_TITLE = "Free NAPLAN & Exam Practice Tests for Years 3-8 (No Card Needed)";
const PAGE_DESCRIPTION =
  "Practise for free: a 20-minute diagnostic maths test, a Year 5 writing task marked by our AI essay marker, and a NAPLAN reading demo. No credit card needed.";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/free" },
  keywords: [
    "free NAPLAN practice tests",
    "free diagnostic maths assessment",
    "free Year 5 writing sample",
    "NAPLAN reading demo",
    "free exam practice Australia",
  ],
  openGraph: {
    type: "website",
    url: absoluteUrl("/free"),
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: PAGE_TITLE, description: PAGE_DESCRIPTION },
};

/**
 * Questions parents actually ask before signing up. Answers are drawn only from
 * what this page and the platform already state - no invented claims - because
 * FAQPage schema is required to match the visible content on the page.
 */
const FREE_FAQ = [
  {
    question: "Do I need a credit card to use the free tests?",
    answer:
      "No. The free practice tests on this page require no credit card. You can start the diagnostic maths assessment, the sample Year 5 writing task and the NAPLAN reading demo without entering any payment details.",
  },
  {
    question: "What year levels are the free tests suitable for?",
    answer:
      "MockTests Pro covers Years 3 to 8. The free resources include a diagnostic maths assessment that identifies year-level alignment, a Year 5 writing sample marked by the AI essay marker, and a NAPLAN reading demo using interactive question types.",
  },
  {
    question: "How does the free AI essay marking work?",
    answer:
      "You write a response to one prompt and the AI marker returns immediate, criterion-based feedback aligned to official assessment markers. It is the same writing analysis used in the paid packs, limited to a single prompt on the free tier.",
  },
  {
    question: "What do I get if I create a free account?",
    answer:
      "Registering lets you track your scores, review past attempt history and unlock additional diagnostic tools. It also gives parents access to progress reports on their child's strengths and areas needing improvement.",
  },
  {
    question: "Are the free tests aligned to the Australian Curriculum?",
    answer:
      "Yes. Practice content is aligned to the Australian Curriculum and mirrors the format of NAPLAN Online, including the interactive question types students encounter in the real assessment.",
  },
];

export default function FreeTestsPage() {
  const freeTests = [
    { title: "Diagnostic Math Assessment", desc: "A 20-minute test to identify your current year-level alignment and core knowledge gaps.", time: "20 mins", icon: <Zap />, color: "#194bfb" },
    { title: "Mock Writing - Sample Year 5", desc: "Try our AI essay marker for free! Get immediate results for one prompt.", time: "40 mins", icon: <Sparkles />, color: "#a855f7" },
    { title: "NAPLAN Reading Demo", desc: "Sample reading comprehension task with interactive question types as used in the real exam.", time: "30 mins", icon: <BookOpen />, color: "#d97706" }
  ];

  return (
    <PublicLayout>
      <JsonLd data={faqPageSchema(FREE_FAQ, absoluteUrl("/free"))} />
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

        {/* Visible FAQ - must match the FAQPage JSON-LD emitted for this route.
            Answers are always expanded so crawlers and answer engines can read
            them without interaction. */}
        <section
          aria-labelledby="free-faq-heading"
          className="max-w-3xl mx-auto"
          style={{ marginTop: '5rem' }}
        >
          <h2
            id="free-faq-heading"
            className="font-bold text-foreground tracking-tight"
            style={{ fontSize: '1.75rem', marginBottom: '1.5rem' }}
          >
            Frequently asked questions about our free tests
          </h2>

          <dl style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', margin: 0 }}>
            {FREE_FAQ.map((faq) => (
              <div
                key={faq.question}
                className="bg-card rounded-lg p-6"
                style={{ border: '1px solid var(--border)' }}
              >
                <dt className="font-bold text-foreground" style={{ marginBottom: '0.5rem' }}>
                  {faq.question}
                </dt>
                <dd className="text-muted-foreground" style={{ margin: 0, lineHeight: 1.7 }}>
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>

          <p className="text-muted-foreground" style={{ marginTop: '1.5rem', fontSize: '0.875rem' }}>
            Still have a question? Read our{' '}
            <Link href="/blog" style={{ color: 'var(--primary)', fontWeight: 600 }}>
              exam preparation guides
            </Link>{' '}
            or learn more{' '}
            <Link href="/about" style={{ color: 'var(--primary)', fontWeight: 600 }}>
              about how we build our tests
            </Link>
            .
          </p>
        </section>
      </section>
    </PublicLayout>
  );
}
