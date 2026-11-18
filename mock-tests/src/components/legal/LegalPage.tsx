import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, Clock } from 'lucide-react';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbSchema, type JsonLdObject } from '@/lib/seo/schema';
import { formatDisplayDate } from '@/lib/seo/content-utils';

/**
 * Shared chrome for the legal / informational pages (Privacy Policy, Terms,
 * Contact).
 *
 * These pages are indexable trust signals - Google treats the presence of a real
 * privacy policy and contact route as an E-E-A-T factor, and for a product that
 * handles children's data it is close to mandatory. They are server-rendered with
 * their own metadata, canonical URL and BreadcrumbList JSON-LD.
 */

interface LegalPageProps {
  title: string;
  /** Short subtitle shown under the H1. */
  intro: string;
  /** ISO date of the current revision, shown as "Last updated". */
  updated: string;
  path: string;
  /**
   * Extra JSON-LD documents (e.g. ContactPage, FAQPage) emitted alongside the
   * breadcrumbs. Accepts a single node, an array, and `null` entries - schema
   * builders legitimately return `null` when there is nothing valid to emit, so
   * filtering happens here rather than at every call site.
   */
  extraSchema?: JsonLdObject | (JsonLdObject | null | undefined)[] | null;
  children: ReactNode;
}

export function LegalPage({ title, intro, updated, path, extraSchema, children }: LegalPageProps) {
  const crumbs = [
    { name: 'Home', url: '/' },
    { name: title, url: path },
  ];

  const extras: JsonLdObject[] =
    extraSchema == null
      ? []
      : Array.isArray(extraSchema)
        ? extraSchema.filter((s): s is JsonLdObject => s != null)
        : [extraSchema];

  const schemaDocs: JsonLdObject[] = [breadcrumbSchema(crumbs), ...extras];

  return (
    <PublicLayout>
      <JsonLd data={schemaDocs} />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 pt-32 pb-24">
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex flex-wrap items-center gap-1.5 list-none p-0 m-0 text-[0.8125rem] text-muted-foreground">
            <li>
              <Link href="/" className="text-inherit no-underline hover:text-primary">Home</Link>
            </li>
            <li aria-hidden="true" className="inline-flex items-center text-slate-300">
              <ChevronRight size={13} />
            </li>
            <li aria-current="page" className="font-semibold text-foreground">{title}</li>
          </ol>
        </nav>

        <header className="mb-10">
          <h1 className="text-3xl md:text-[2.5rem] font-bold text-foreground tracking-tight m-0 mb-4">
            {title}
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed m-0 mb-4">{intro}</p>
          <p className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-muted-foreground bg-slate-100 rounded-full px-3 py-1.5">
            <Clock size={13} aria-hidden="true" />
            Last updated <time dateTime={updated}>{formatDisplayDate(updated)}</time>
          </p>
        </header>

        {/* Tailwind-free prose styling is applied via the `legal-prose` class so
            heading/list rules stay in one place rather than per page. */}
        <div className="legal-prose">{children}</div>
      </div>
    </PublicLayout>
  );
}

/** A labelled contact/subsection block used by all three pages. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}
