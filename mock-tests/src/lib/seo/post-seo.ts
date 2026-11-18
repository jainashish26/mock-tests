/**
 * Derives every SEO / GEO / AEO signal a blog post needs, in one place.
 *
 * Called from the server component and `generateMetadata` so both share
 * identical data. All parsing happens at build time (the post pages are
 * statically generated), so it costs nothing at request time.
 */

import type { BlogPost } from '@/data/blog-posts';
import {
  addHeadingIds,
  countWords,
  extractExternalLinks,
  extractFaqs,
  extractHeadings,
  extractLeadAnswer,
  extractSummaryPoints,
  formatDisplayDate,
  readingTimeMinutes,
  stripHtml,
  toIsoDate,
  toIsoDateTime,
  truncate,
  type FaqItem,
  type TocItem,
} from './content-utils';
import { deriveCategory, type BlogCategory } from './categories';
import { absoluteImageUrl } from './site-config';
import { sourcesForArticle } from './sources';
import type { PostSchemaInput } from './schema';

/** Fully-derived SEO bundle for a single post. */
export interface PostSeo {
  post: BlogPost;
  /** Canonical URL path, e.g. `/blog/my-post`. */
  path: string;
  /** Post markup with stable `id` attributes on h2/h3 for TOC deep links. */
  html: string;
  /** ISO `YYYY-MM-DD` publication date (schema-safe). */
  publishedIso: string;
  /** ISO `YYYY-MM-DD` last-modified date (schema-safe). */
  modifiedIso: string;
  /** Display strings, e.g. "30 March 2026". */
  publishedDisplay: string;
  modifiedDisplay: string;
  /** Title-cased tag list. */
  tags: string[];
  category: BlogCategory;
  /** `<title>` - kept under ~60 characters where possible. */
  title: string;
  /** Meta description trimmed to ~155 characters. */
  description: string;
  /** Absolute OG image URL. */
  image: string;
  imageAlt: string;
  wordCount: number;
  readingTime: number;
  faqs: FaqItem[];
  toc: TocItem[];
  /**
   * Author-written bullet summary from the post data. Empty unless the editor
   * supplied `keyTakeaways` - never auto-scraped, because markup alone cannot
   * distinguish a summary list from a detail list.
   */
  keyTakeaways: string[];
  /**
   * Summary points derived from the post's own excerpt. Accurate by
   * construction (the author's own words), rendered under an "In summary"
   * heading when `keyTakeaways` is empty.
   */
  summaryPoints: string[];
  leadAnswer: string;
  /** Plain-text version, used by llms.txt and search indexes. */
  plainText: string;
  /**
   * Authoritative sources cited in the article body plus topic-appropriate
   * references. Surfacing these on-page directly supports the GEO guideline
   * "cite primary sources and link to authoritative publications".
   */
  sources: { name: string; url: string }[];
}

/**
 * Merge sources actually cited in the article body with topic-appropriate
 * authoritative references. In-article citations come first because they are
 * specific to the argument being made; category and subject-matter authorities
 * follow so the list is never generic boilerplate.
 */
function buildSources(opts: {
  html: string;
  categorySlug: string;
  title: string;
  tags: string[];
  excerpt: string;
}): { name: string; url: string }[] {
  const seen = new Set<string>();
  const out: { name: string; url: string }[] = [];

  const push = (source: { name: string; url: string }) => {
    if (seen.has(source.url)) return;
    seen.add(source.url);
    out.push(source);
  };

  // 1. Links the author actually placed in the body.
  for (const link of extractExternalLinks(opts.html)) {
    push({ name: link.text, url: link.url });
  }

  // 2. Topic-appropriate authorities, resolved from title/tags/excerpt.
  const matchText = `${opts.title} ${opts.tags.join(' ')} ${opts.excerpt}`;
  for (const source of sourcesForArticle({ categorySlug: opts.categorySlug, text: matchText })) {
    push(source);
  }

  return out.slice(0, 8);
}

/** Title-casing for ALL-CAPS tags stored in post data. */
function titleCaseTag(tag: string): string {
  const special: Record<string, string> = {
    naplan: 'NAPLAN', acer: 'ACER', edutest: 'EduTest', aas: 'AAS',
    seal: 'SEAL', nsw: 'NSW', vic: 'VIC', ai: 'AI',
  };
  return tag
    .toLowerCase()
    .split(/[\s-]+/)
    .map((word) => special[word] ?? (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * Build the complete SEO bundle for a post.
 *
 * Falls back gracefully: if a date cannot be parsed the ISO fields use today's
 * date so schema never emits an invalid value.
 */
export function derivePostSeo(post: BlogPost): PostSeo {
  const html = addHeadingIds(post.content);

  const publishedIso =
    toIsoDate(post.date) ?? new Date().toISOString().slice(0, 10);
  const modifiedIso =
    toIsoDate(post.updatedDate) ?? publishedIso;

  const rawTags = post.tags ?? [];
  const tags = rawTags.map(titleCaseTag);
  const category = post.category
    ? { slug: post.category, name: titleCaseTag(post.category), description: '', tags: rawTags }
    : deriveCategory(rawTags);

  const description = truncate(
    stripHtml(post.metaDescription || post.excerpt || ''),
    155
  );

  const title = truncate(post.metaTitle || post.title, 60) || post.title;

  const wordCount = countWords(post.content);
  const faqs = extractFaqs(post.content);

  // Author-written takeaways only. Sanitised so a stray empty or oversized entry
  // cannot ship to the page or into schema.
  const authoredTakeaways = (post.keyTakeaways ?? [])
    .map((t) => truncate(stripHtml(t), 170))
    .filter((t) => t.length >= 20)
    .slice(0, 6);

  return {
    post,
    path: `/blog/${post.slug}`,
    html,
    publishedIso,
    modifiedIso,
    publishedDisplay: formatDisplayDate(post.date),
    modifiedDisplay: formatDisplayDate(post.updatedDate ?? post.date),
    tags,
    category,
    title,
    description,
    image: absoluteImageUrl(post.image),
    imageAlt: post.imageAlt || post.title,
    wordCount,
    readingTime: post.readingTime ?? readingTimeMinutes(post.content),
    faqs,
    toc: extractHeadings(post.content, [2, 3]),
    keyTakeaways: authoredTakeaways,
    summaryPoints: extractSummaryPoints(post.excerpt, 4),
    leadAnswer: extractLeadAnswer(post.content),
    plainText: stripHtml(post.content),
    sources: buildSources({
      html: post.content,
      categorySlug: category.slug,
      title: post.title,
      tags: rawTags,
      excerpt: post.excerpt,
    }),
  };
}

/** Convert a derived bundle into the input shape expected by schema builders. */
export function toSchemaInput(seo: PostSeo): PostSchemaInput {
  return {
    slug: seo.post.slug,
    title: seo.post.title,
    excerpt: seo.post.excerpt,
    content: seo.post.content,
    image: seo.post.image,
    imageAlt: seo.imageAlt,
    date: toIsoDateTime(seo.publishedIso) ?? seo.publishedIso,
    updatedDate: toIsoDateTime(seo.modifiedIso) ?? seo.modifiedIso,
    tags: seo.tags,
    category: seo.category.name,
    metaTitle: seo.title,
    metaDescription: seo.description,
    keywords: seo.post.keywords,
    author: seo.post.author,
    wordCount: seo.wordCount,
    readingTime: seo.readingTime,
    faqs: seo.faqs,
    toc: seo.toc,
    leadAnswer: seo.leadAnswer,
    sources: seo.sources,
  };
}

/**
 * Lightweight card data for "related posts" internal linking.
 *
 * Deliberately excludes `html` - passing full `PostSeo` objects for related
 * articles would serialise four complete article bodies into the client payload
 * for no benefit.
 */
export interface RelatedPostSummary {
  slug: string;
  path: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  categoryName: string;
  publishedDisplay: string;
  readingTime: number;
}

/** Reduce a derived bundle to the fields a related-post card needs. */
export function toRelatedSummary(post: BlogPost): RelatedPostSummary {
  const seo = derivePostSeo(post);
  return {
    slug: post.slug,
    path: seo.path,
    title: post.title,
    description: seo.description,
    image: seo.image,
    imageAlt: seo.imageAlt,
    categoryName: seo.category.name,
    publishedDisplay: seo.publishedDisplay,
    readingTime: seo.readingTime,
  };
}

/**
 * Card payload for the blog index and category grids.
 *
 * The previous `/blog` page was a client component importing `BLOG_POSTS`
 * directly, which bundled the full HTML body of all 50 articles (well over
 * 1 MB) into client JavaScript. Cards carry only what the grid renders.
 */
export interface BlogCard extends RelatedPostSummary {
  excerpt: string;
  tags: string[];
  categorySlug: string;
  publishedIso: string;
  authorName: string;
  authorRole: string;
  /** Lowercase haystack used for client-side search. */
  searchBlob: string;
}

/** Build a lightweight, serialisable card for a post. */
export function toBlogCard(post: BlogPost): BlogCard {
  const seo = derivePostSeo(post);
  return {
    ...toRelatedSummary(post),
    excerpt: post.excerpt,
    tags: seo.tags,
    categorySlug: seo.category.slug,
    publishedIso: seo.publishedIso,
    authorName: post.author.name,
    authorRole: post.author.role,
    searchBlob: [
      post.title,
      post.excerpt,
      seo.tags.join(' '),
      seo.category.name,
      post.author.name,
      (post.keywords ?? []).join(' '),
    ]
      .join(' ')
      .toLowerCase(),
  };
}


