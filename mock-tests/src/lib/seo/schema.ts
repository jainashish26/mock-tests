/**
 * schema.org JSON-LD builders.
 *
 * These produce the structured data that lets Google rich results, AI Overviews
 * and LLM-based answer engines understand and cite the site. All builders are
 * pure functions returning plain objects - `<JsonLd />` handles serialisation.
 *
 * Every value must be literal and accurate: Google's structured-data testing
 * tool and the Rich Results report will flag invented or missing required
 * properties.
 */

import type { FaqItem, TocItem } from './content-utils';
import {
  absoluteImageUrl,
  absoluteUrl,
  CONTACT,
  LOCALE,
  LOGO_IMAGE,
  MAIN_NAV,
  ORGANISATION_NAME,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  SOCIAL_PROFILES,
} from './site-config';
import { getAuthor, EDITORIAL_POLICY, type AuthorProfile } from './authors';

/** A JSON-LD node. Kept intentionally loose - schema.org is open-vocabulary. */
export type JsonLdObject = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * Organisation + WebSite  (site-wide entity identity)
 * ------------------------------------------------------------------ */

/** `Organization` node reused as `publisher` in article schema. */
export function organizationNode(): JsonLdObject {
  return {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: ORGANISATION_NAME,
    alternateName: SITE_NAME,
    url: SITE_URL,
    description: SITE_TAGLINE,
    logo: {
      '@type': 'ImageObject',
      url: LOGO_IMAGE,
      width: 512,
      height: 512,
    },
    ...(SOCIAL_PROFILES.length > 0 ? { sameAs: SOCIAL_PROFILES } : {}),
    areaServed: {
      '@type': 'Country',
      name: 'Australia',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: CONTACT.supportEmail,
      areaServed: 'AU',
      availableLanguage: ['English'],
    },
    knowsAbout: [
      'NAPLAN preparation',
      'Selective school entrance exams',
      'Academic scholarship exams',
      'Australian Curriculum literacy and numeracy',
      'EduTest, ACER and AAS assessment formats',
    ],
  };
}

/** `WebSite` with a `SearchAction` so Google can offer a sitelinks search box. */
export function websiteNode(): JsonLdObject {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_TAGLINE,
    inLanguage: LOCALE,
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/blog?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Root graph emitted once from the app layout. */
export function siteGraph(): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { ...organizationNode(), '@type': 'Organization' },
      websiteNode(),
      {
        '@type': 'SiteNavigationElement',
        name: 'Main navigation',
        hasPart: MAIN_NAV.map((item) => ({
          '@type': 'SiteNavigationElement',
          name: item.name,
          url: item.url,
        })),
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Breadcrumbs
 * ------------------------------------------------------------------ */

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/** `BreadcrumbList` - drives the breadcrumb trail in SERPs and AI citations. */
export function breadcrumbSchema(items: BreadcrumbItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.url),
    })),
  };
}

/** Standard Home > Blog > Article trail. */
export function postBreadcrumbs(postTitle: string, slug: string): BreadcrumbItem[] {
  return [
    { name: 'Home', url: '/' },
    { name: 'Blog', url: '/blog' },
    { name: postTitle, url: `/blog/${slug}` },
  ];
}

/* ------------------------------------------------------------------ *
 * Author node
 * ------------------------------------------------------------------ */

/**
 * Build the schema.org `author` node from the registry profile.
 *
 * Uses `Person` for named individuals and `Organization` for the editorial
 * team, with credentials attached via `knowsAbout` / `description` so AI
 * engines can evaluate authoritativeness.
 */
export function authorNode(authorName?: string | null): JsonLdObject {
  const profile: AuthorProfile = getAuthor(authorName);
  const base = {
    '@type': profile.type,
    name: profile.name,
    description: profile.bio,
    knowsAbout: profile.credentials,
    worksFor: {
      '@type': 'Organization',
      name: ORGANISATION_NAME,
      url: SITE_URL,
    },
    ...(profile.sameAs && profile.sameAs.length > 0 ? { sameAs: profile.sameAs } : {}),
  };

  if (profile.type === 'Person') {
    return {
      ...base,
      jobTitle: profile.role,
      ...(profile.avatar ? { image: absoluteImageUrl(profile.avatar) } : {}),
    };
  }
  return base;
}

/** Editorial review/standards note attached to article schema. */
export function editorialNote(): string {
  return `${EDITORIAL_POLICY.reviewProcess} ${EDITORIAL_POLICY.updateCadence}`;
}

/* ------------------------------------------------------------------ *
 * BlogPosting (article) schema
 * ------------------------------------------------------------------ */

/** Minimal shape needed to build article schema - keeps lib/seo decoupled. */
export interface PostSchemaInput {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  image: string;
  imageAlt?: string;
  /** ISO 8601 date (YYYY-MM-DD or full timestamp). */
  date: string;
  /** ISO 8601 date of the most recent substantive revision. */
  updatedDate?: string;
  tags?: string[];
  category?: string;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
  author?: { name: string; role: string; avatar?: string } | null;
  wordCount?: number;
  readingTime?: number;
  faqs?: FaqItem[];
  toc?: TocItem[];
  leadAnswer?: string;
  /**
   * Author-supplied ordered steps. Required for HowTo schema - deliberately
   * never auto-derived from headings. Omit and no HowTo is emitted.
   */
  steps?: { name: string; text: string }[];
  /** Authoritative sources cited, emitted as schema.org `citation`. */
  sources?: { name: string; url: string }[];
}

/** `FAQPage` node (no `@context` - callers add it or nest it in a graph). */
export function faqNode(faqs: FaqItem[], pageUrl?: string): JsonLdObject | null {
  if (!faqs || faqs.length === 0) return null;
  return {
    '@type': 'FAQPage',
    ...(pageUrl ? { mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl } } : {}),
    inLanguage: LOCALE,
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

/** Standalone `FAQPage` document for pages that only need the FAQ graph. */
export function faqPageSchema(faqs: FaqItem[], pageUrl?: string): JsonLdObject | null {
  const node = faqNode(faqs, pageUrl);
  return node ? { '@context': 'https://schema.org', ...node } : null;
}

/** `HowTo` node (no `@context`). Bing Copilot and Google favour step content. */
export function howToNode(input: PostSchemaInput, pageUrl: string): JsonLdObject | null {
  const steps = input.steps ?? [];
  if (steps.length < 3) return null;
  return {
    '@type': 'HowTo',
    name: input.title,
    description: input.metaDescription || input.excerpt,
    inLanguage: LOCALE,
    image: absoluteImageUrl(input.image),
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    step: steps.map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: step.name,
      text: step.text,
    })),
  };
}

/**
 * Full `@graph` for an article page: BlogPosting + WebPage + BreadcrumbList,
 * plus FAQPage and HowTo when the content supports them.
 *
 * `speakable` and `abstract` help voice/AEO surfaces; `dateModified` and
 * `hasPart` support freshness and section-level citation signals.
 */
export function blogPostingGraph(input: PostSchemaInput): JsonLdObject {
  const url = absoluteUrl(`/blog/${input.slug}`);
  const authorName = input.author?.name;
  const faqs = input.faqs ?? [];
  const published = input.date;
  const modified = input.updatedDate || input.date;

  const imageNode = {
    '@type': 'ImageObject',
    url: absoluteImageUrl(input.image),
    caption: input.imageAlt || input.title,
  };

  const article: JsonLdObject = {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    headline: (input.metaTitle || input.title).slice(0, 110),
    name: input.title,
    description: input.metaDescription || input.excerpt,
    inLanguage: LOCALE,
    image: imageNode,
    author: authorNode(authorName),
    creator: authorNode(authorName),
    publisher: { '@id': `${SITE_URL}/#organization` },
    isPartOf: { '@id': `${SITE_URL}/#website` },
    // Editorial review statement - a direct trustworthiness signal.
    ...(editorialNote() ? { creditText: editorialNote() } : {}),
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['h1', '[data-speakable="lead"]'],
    },
  };

  if (input.leadAnswer) article.abstract = input.leadAnswer;
  if (input.category) article.articleSection = input.category;
  if (input.tags && input.tags.length > 0) {
    article.keywords = [...(input.category ? [input.category] : []), ...input.tags].join(', ');
  }
  if (typeof input.wordCount === 'number') article.wordCount = input.wordCount;
  if (input.readingTime) article.timeRequired = `PT${input.readingTime}M`;
  if (published) article.datePublished = published;
  if (modified) article.dateModified = modified;

  if (input.toc && input.toc.length > 0) {
    const parts = input.toc
      .filter((h) => h.level === 2)
      .map((h) => ({ '@type': 'WebPageElement', name: h.text, url: `${url}#${h.id}` }));
    if (parts.length > 0) article.hasPart = parts;
  }

  if (faqs.length > 0) {
    article.about = faqs.slice(0, 5).map((f) => ({ '@type': 'Thing', name: f.question }));
  }

  // Explicit citations. Perplexity and Google AI Overviews weight pages that
  // link out to verifiable primary sources.
  if (input.sources && input.sources.length > 0) {
    article.citation = input.sources.map((source) => ({
      '@type': 'WebPage',
      name: source.name,
      url: source.url,
    }));
  }

  const graph: JsonLdObject[] = [
    article,
    {
      '@type': 'WebPage',
      '@id': url,
      url,
      name: input.metaTitle || input.title,
      description: input.metaDescription || input.excerpt,
      inLanguage: LOCALE,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      primaryImageOfPage: imageNode,
      ...(published ? { datePublished: published } : {}),
      ...(modified ? { dateModified: modified } : {}),
      breadcrumb: { '@id': `${url}#breadcrumb` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: postBreadcrumbs(input.title, input.slug).map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.name,
        item: absoluteUrl(item.url),
      })),
    },
  ];

  const faq = faqNode(faqs, url);
  if (faq) graph.push({ ...faq, '@id': `${url}#faq` });

  // HowTo is emitted ONLY from author-supplied `steps`. It is never derived from
  // heading markup - see the note in content-utils.ts for why auto-derivation
  // produced factually wrong procedural claims on this corpus.
  const howTo = howToNode(input, url);
  if (howTo) graph.push({ ...howTo, '@id': `${url}#howto` });

  return { '@context': 'https://schema.org', '@graph': graph };
}

/* ------------------------------------------------------------------ *
 * Blog index / collection schema
 * ------------------------------------------------------------------ */

export interface CollectionEntry {
  title: string;
  url: string;
  description: string;
  image?: string;
  datePublished?: string;
  author?: string;
}

/**
 * `CollectionPage` + `ItemList` for the blog index. Gives AI engines a
 * structured map of the whole content library in one payload.
 */
export function blogCollectionGraph(
  entries: CollectionEntry[],
  opts: { url: string; name: string; description: string }
): JsonLdObject {
  const listId = `${opts.url}#itemlist`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': opts.url,
        url: opts.url,
        name: opts.name,
        description: opts.description,
        inLanguage: LOCALE,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        publisher: { '@id': `${SITE_URL}/#organization` },
        mainEntity: { '@id': listId },
      },
      // Top-level ItemList so parsers that only walk the graph (rather than
      // recursing into nested properties) still discover the full inventory.
      {
        '@type': 'ItemList',
        '@id': listId,
        name: opts.name,
        numberOfItems: entries.length,
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        itemListElement: entries.map((entry, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: entry.url,
          name: entry.title,
        })),
      },
      {
        '@type': 'Blog',
        '@id': `${opts.url}#blog`,
        url: opts.url,
        name: opts.name,
        description: opts.description,
        inLanguage: LOCALE,
        publisher: { '@id': `${SITE_URL}/#organization` },
        blogPost: entries.slice(0, 20).map((entry) => ({
          '@type': 'BlogPosting',
          headline: entry.title.slice(0, 110),
          url: entry.url,
          description: entry.description,
          ...(entry.image ? { image: absoluteImageUrl(entry.image) } : {}),
          ...(entry.datePublished ? { datePublished: entry.datePublished } : {}),
          ...(entry.author ? { author: authorNode(entry.author) } : {}),
        })),
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Marketing pages
 * ------------------------------------------------------------------ */

/** `AboutPage` with the organisation as the primary subject. */
export function aboutPageGraph(url: string, description: string): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'AboutPage',
        '@id': url,
        url,
        name: `About ${ORGANISATION_NAME}`,
        description,
        inLanguage: LOCALE,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        about: { '@id': `${SITE_URL}/#organization` },
        mainEntity: { '@id': `${SITE_URL}/#organization` },
      },
      organizationNode(),
    ],
  };
}

/** `ContactPage` node describing how to reach the organisation. */
export function contactPageGraph(url: string, description: string): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    '@id': url,
    url,
    name: `Contact ${ORGANISATION_NAME}`,
    description,
    inLanguage: LOCALE,
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: { '@id': `${SITE_URL}/#organization` },
    mainEntity: {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: ORGANISATION_NAME,
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: CONTACT.supportEmail,
          areaServed: 'AU',
          availableLanguage: ['English'],
        },
        {
          '@type': 'ContactPoint',
          contactType: 'privacy',
          email: CONTACT.privacyEmail,
          areaServed: 'AU',
          availableLanguage: ['English'],
        },
      ],
    },
  };
}

/**
 * `EducationalOrganization` + `Service` graph for the features page.
 * Describes what the platform does in machine-readable form.
 */
export function featuresGraph(url: string, description: string, features: string[]): JsonLdObject {
  const serviceId = `${url}#service`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': url,
        url,
        name: `Features | ${SITE_NAME}`,
        description,
        inLanguage: LOCALE,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        mainEntity: { '@id': serviceId },
      },
      // Top-level Service node - keeps the offer discoverable without recursing
      // into nested WebPage properties.
      {
        '@type': 'Service',
        '@id': serviceId,
        name: `${SITE_NAME} exam preparation platform`,
        serviceType: 'Online exam preparation and adaptive practice testing',
        description,
        provider: { '@id': `${SITE_URL}/#organization` },
        areaServed: { '@type': 'Country', name: 'Australia' },
        audience: {
          '@type': 'EducationalAudience',
          educationalRole: 'student',
          suggestedMinAge: 8,
          suggestedMaxAge: 14,
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Platform features',
          itemListElement: features.map((f) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: f },
          })),
        },
      },
    ],
  };
}

export interface ProductSchemaInput {
  name: string;
  description: string;
  url: string;
  image?: string;
  price: number;
  currency?: string;
}

/**
 * `Product` + `Offer` for paid test packs. Enables price rich results and lets
 * comparison-oriented engines (Bing Copilot) extract offers.
 */
export function productGraph(products: ProductSchemaInput[]): JsonLdObject | null {
  if (products.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@graph': products.map((p) => ({
      '@type': 'Product',
      name: p.name,
      description: p.description,
      url: p.url,
      ...(p.image ? { image: absoluteImageUrl(p.image) } : {}),
      brand: { '@type': 'Brand', name: ORGANISATION_NAME },
      category: 'Educational test preparation',
      offers: {
        '@type': 'Offer',
        url: p.url,
        price: p.price.toFixed(2),
        priceCurrency: p.currency ?? 'AUD',
        availability: 'https://schema.org/InStock',
        seller: { '@id': `${SITE_URL}/#organization` },
      },
    })),
  };
}



