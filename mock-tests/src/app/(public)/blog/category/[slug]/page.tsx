import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { JsonLd } from '@/components/seo/JsonLd';
import { ChevronRight, Calendar, Clock, ArrowRight } from 'lucide-react';
import styles from '../../blog.module.css';
import { BLOG_CATEGORIES, getCategoryBySlug } from '@/lib/seo/categories';
import { getPostsByCategory } from '@/data/blog-posts';
import { toBlogCard } from '@/lib/seo/post-seo';
import { blogCollectionGraph, breadcrumbSchema } from '@/lib/seo/schema';
import { absoluteUrl, INDEXABLE_ROBOTS, SITE_NAME } from '@/lib/seo/site-config';

/**
 * Category hub pages.
 *
 * These give the blog a shallow Home > Blog > Category > Article hierarchy that
 * is fully crawlable without JavaScript. A clear taxonomy is how a site
 * demonstrates topical authority to both Google and AI answer engines, and each
 * hub carries its own CollectionPage + BreadcrumbList JSON-LD.
 */

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return BLOG_CATEGORIES.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  if (!category) return { title: 'Category Not Found', robots: { index: false, follow: false } };

  const count = getPostsByCategory(slug).length;
  const title = category.name + ' Guides & Preparation Resources';
  const description =
    category.description + ' ' + count + ' evidence-based guide' + (count === 1 ? '' : 's') +
    ' from the ' + SITE_NAME + ' education team.';

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: '/blog/category/' + slug },
    openGraph: {
      type: 'website',
      url: absoluteUrl('/blog/category/' + slug),
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: { card: 'summary_large_image', title, description },
    robots: INDEXABLE_ROBOTS,
  };
}
export default async function BlogCategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = getCategoryBySlug(slug);
  if (!category) notFound();

  const posts = getPostsByCategory(slug);
  const cards = posts.map(toBlogCard);
  const path = '/blog/category/' + slug;
  const url = absoluteUrl(path);

  const schema = [
    blogCollectionGraph(
      cards.map((card) => ({
        title: card.title,
        url: absoluteUrl(card.path),
        description: card.description,
        image: card.image,
        author: card.authorName,
      })),
      {
        url,
        name: category.name + ' | ' + SITE_NAME + ' Blog',
        description: category.description,
      }
    ),
    breadcrumbSchema([
      { name: 'Home', url: '/' },
      { name: 'Blog', url: '/blog' },
      { name: category.name, url: path },
    ]),
  ];

  return (
    <PublicLayout>
      <JsonLd data={schema} />

      <div className={styles.pageContainer}>
        <nav aria-label="Breadcrumb" className={styles.catBreadcrumbs}>
          <ol className={styles.catBreadcrumbList}>
            <li><Link href="/">Home</Link></li>
            <li aria-hidden="true"><ChevronRight size={13} /></li>
            <li><Link href="/blog">Blog</Link></li>
            <li aria-hidden="true"><ChevronRight size={13} /></li>
            <li aria-current="page">{category.name}</li>
          </ol>
        </nav>

        <header className={styles.catHeader}>
          <h1 className={styles.catTitle}>{category.name}</h1>
          <p className={styles.catDescription}>{category.description}</p>
          <p className={styles.catCount}>
            {posts.length} {posts.length === 1 ? 'guide' : 'guides'} in this topic
          </p>
        </header>

        <section aria-label={category.name + ' articles'} className={styles.postsSection}>
          <ul className={styles.catList}>
            {cards.map((card) => (
              <li key={card.slug}>
                <Link href={card.path} className={styles.catCard}>
                  <span className={styles.catCardTitle}>{card.title}</span>
                  <span className={styles.catCardExcerpt}>{card.description}</span>
                  <span className={styles.catCardMeta}>
                    <Calendar size={13} aria-hidden="true" />
                    <time dateTime={card.publishedIso}>{card.publishedDisplay}</time>
                    <Clock size={13} aria-hidden="true" />
                    {card.readingTime} min read
                    <ArrowRight size={14} className={styles.catCardArrow} aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <nav aria-label="Other topics" className={styles.catOtherNav}>
          <h2 className={styles.catOtherTitle}>Explore other topics</h2>
          <ul className={styles.catOtherList}>
            {BLOG_CATEGORIES.filter((c) => c.slug !== slug).map((c) => (
              <li key={c.slug}>
                <Link href={'/blog/category/' + c.slug}>{c.name}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </PublicLayout>
  );
}