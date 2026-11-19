import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { JsonLd } from '@/components/seo/JsonLd';
import { BlogExplorer } from './BlogExplorer';
import styles from './blog.module.css';
import { BLOG_POSTS, getPostsByCategory } from '@/data/blog-posts';
import { BLOG_CATEGORIES, deriveCategory } from '@/lib/seo/categories';
import { toIsoDate } from '@/lib/seo/content-utils';
import { toBlogCard } from '@/lib/seo/post-seo';
import { blogCollectionGraph } from '@/lib/seo/schema';
import { absoluteUrl, INDEXABLE_ROBOTS, SITE_NAME } from '@/lib/seo/site-config';

/**
 * Blog index.
 *
 * Previously a client component, which meant the route could not export any
 * metadata at all - no title, description, canonical or Open Graph tags - and it
 * bundled every article body into client JavaScript. It is now a server
 * component: metadata and CollectionPage/ItemList JSON-LD are emitted here, the
 * grid is server-rendered from slim card data, and only the search/filter
 * interaction lives in BlogExplorer.
 */

const PAGE_TITLE = 'Exam Preparation Blog: NAPLAN, Selective & Scholarship Guides';
const PAGE_DESCRIPTION =
  'Evidence-based preparation guides for Australian families - NAPLAN year-level syllabuses, Selective School entrance, EduTest, ACER and AAS scholarship exams, writing technique and student wellbeing.';

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: '/blog' },
  keywords: [
    'NAPLAN preparation guide',
    'selective school entrance exam tips',
    'scholarship exam preparation Australia',
    'EduTest practice',
    'ACER scholarship exam guide',
    'NAPLAN Year 3 5 7 9 syllabus',
    'primary school English and maths resources',
  ],
  openGraph: {
    type: 'website',
    url: absoluteUrl('/blog'),
    siteName: SITE_NAME,
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  robots: INDEXABLE_ROBOTS,
};
export default function BlogPage() {
  // Slim cards only - article bodies stay on the server.
  const cards = BLOG_POSTS.map(toBlogCard);

  const categories = BLOG_CATEGORIES.map((category) => ({
    slug: category.slug,
    name: category.name,
    count: getPostsByCategory(category.slug).length,
  })).filter((category) => category.count > 0);

  const schema = blogCollectionGraph(
    BLOG_POSTS.map((post) => {
      const card = toBlogCard(post);
      return {
        title: post.title,
        url: absoluteUrl(card.path),
        description: card.description,
        image: card.image,
        datePublished: toIsoDate(post.date),
        author: post.author.name,
      };
    }),
    {
      url: absoluteUrl('/blog'),
      name: SITE_NAME + ' Blog',
      description: PAGE_DESCRIPTION,
    }
  );

  return (
    <PublicLayout>
      <JsonLd data={schema} />

      <div className={styles.pageContainer}>
        {/* useSearchParams inside BlogExplorer needs a Suspense boundary for the
            route to stay statically prerenderable. */}
        <Suspense fallback={<div className={styles.hero} />}>
          <BlogExplorer cards={cards} categories={categories} />
        </Suspense>

        {/* Server-rendered taxonomy. Real links mean the category hubs are
            discoverable without JavaScript - the client filter above is a
            progressive enhancement layered on top. */}
        <section className={styles.hubSection} aria-labelledby="browse-by-topic">
          <h2 id="browse-by-topic" className={styles.hubTitle}>
            Browse guides by topic
          </h2>
          <p className={styles.hubIntro}>
            Every guide is reviewed against official ACARA and state department
            sources before publication, and re-checked each NAPLAN testing cycle.
          </p>
          <ul className={styles.hubList}>
            {BLOG_CATEGORIES.map((category) => {
              const count = getPostsByCategory(category.slug).length;
              if (count === 0) return null;
              return (
                <li key={category.slug}>
                  <Link href={'/blog/category/' + category.slug} className={styles.hubCard}>
                    <span className={styles.hubCardName}>{category.name}</span>
                    <span className={styles.hubCardDesc}>{category.description}</span>
                    <span className={styles.hubCardCount}>
                      {count} {count === 1 ? 'guide' : 'guides'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
        {/* Plain-HTML index of the full library. Guarantees every article is one
            click from the index for crawlers that ignore interactive widgets. */}
        <section className={styles.indexSection} aria-labelledby="all-articles">
          <h2 id="all-articles" className={styles.hubTitle}>
            All {cards.length} guides
          </h2>
          <ol className={styles.indexList}>
            {BLOG_POSTS.map((post) => (
              <li key={post.slug}>
                <Link href={'/blog/' + post.slug}>
                  {post.title}
                  <span className={styles.indexMeta}>
                    {' \u2014 '}{deriveCategory(post.tags).name}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <p className={styles.indexNote}>
            Looking for something specific? View the{' '}
            <Link href="/sitemap.xml">full sitemap</Link> or read{' '}
            <Link href="/about">about our editorial standards</Link>.
          </p>
        </section>
      </div>
    </PublicLayout>
  );
}