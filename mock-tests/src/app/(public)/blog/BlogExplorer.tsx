'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { BookOpen, Calendar, ChevronRight, Clock, Search } from 'lucide-react';
import styles from './blog.module.css';
import type { BlogCard } from '@/lib/seo/post-seo';

/**
 * Interactive layer for the blog index.
 *
 * Deliberately narrow: it receives pre-computed `BlogCard` objects rather than
 * importing `BLOG_POSTS`, so article bodies are never shipped to the browser.
 * Everything here still server-renders on first paint, which keeps the grid
 * crawlable while the search box remains responsive.
 */

interface CategoryFilter {
  slug: string;
  name: string;
  count: number;
}

interface Props {
  cards: BlogCard[];
  categories: CategoryFilter[];
}

export function BlogExplorer({ cards, categories }: Props) {
  // Supports the existing `/blog?search=<tag>` deep links used across the site.
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('search') ?? '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const filtered = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return cards.filter((card) => {
      const matchesCategory =
        activeCategory === 'all' || card.categorySlug === activeCategory;
      if (!matchesCategory) return false;
      if (!query) return true;
      return (
        card.searchBlob.includes(query) ||
        card.title.toLowerCase().includes(query) ||
        card.excerpt.toLowerCase().includes(query)
      );
    });
  }, [cards, searchQuery, activeCategory]);

  const isFiltering = searchQuery.trim().length > 0 || activeCategory !== 'all';
  const featured = !isFiltering ? cards[0] : undefined;
  const gridCards = featured ? filtered.slice(1) : filtered;

  return (
    <>
      {/* --- Search + filters --- */}
      <section className={styles.hero}>
        <div className={styles.heroBlob1} aria-hidden="true" />
        <div className={styles.heroBlob2} aria-hidden="true" />

        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <BookOpen size={14} aria-hidden="true" />
            Insights &amp; Resources
          </div>

          <h1 className={styles.heroTitle}>
            NAPLAN, Selective &amp; Scholarship{' '}
            <span className={styles.heroTitleAccent}>exam guides for parents</span>
          </h1>

          <p className={styles.heroSubtitle}>
            Evidence-based preparation guides for Years 3 to 8, written by our
            education team and checked against ACARA and state department sources.
          </p>

          <div className={styles.searchWrapper}>
            <Search size={20} className={styles.searchIcon} aria-hidden="true" />
            <label htmlFor="blog-search" className={styles.searchLabel}>
              Search articles, topics or tags
            </label>
            <input
              id="blog-search"
              type="search"
              placeholder="Try &quot;NAPLAN Year 5&quot; or &quot;scholarship exam&quot;..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          {/* Crawlable category hubs. These are real links to server-rendered
              pages, so the taxonomy is discoverable without JavaScript. */}
          <nav aria-label="Article categories" className={styles.categoryNav}>
            <Link
              href="/blog"
              onClick={() => setActiveCategory('all')}
              className={
                activeCategory === 'all'
                  ? `${styles.categoryChip} ${styles.categoryChipActive}`
                  : styles.categoryChip
              }
              aria-current={activeCategory === 'all' ? 'true' : undefined}
            >
              All <span className={styles.categoryChipCount}>{cards.length}</span>
            </Link>
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/blog/category/${category.slug}`}
                onClick={(e) => {
                  // Keep in-page filtering when JS is available; the href still
                  // gives crawlers and no-JS users a real destination.
                  e.preventDefault();
                  setActiveCategory(category.slug);
                  setSearchQuery('');
                }}
                className={
                  activeCategory === category.slug
                    ? `${styles.categoryChip} ${styles.categoryChipActive}`
                    : styles.categoryChip
                }
                aria-current={activeCategory === category.slug ? 'true' : undefined}
              >
                {category.name}{' '}
                <span className={styles.categoryChipCount}>{category.count}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* --- Active filter summary --- */}
      {isFiltering && (
        <section className={styles.searchResults} aria-live="polite">
          <div className={styles.searchResultsHeader}>
            <Search size={20} color="#6366f1" aria-hidden="true" />
            <h2 className={styles.searchResultsTitle}>
              {searchQuery.trim() ? `Results for "${searchQuery.trim()}"` : 'Filtered results'}
            </h2>
            <span className={styles.searchResultsCount}>
              {filtered.length} {filtered.length === 1 ? 'article' : 'articles'}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className={styles.noResults}>
              <div className={styles.noResultsIcon}>
                <Search size={32} aria-hidden="true" />
              </div>
              <h3 className={styles.noResultsTitle}>No articles found</h3>
              <p className={styles.noResultsText}>
                Try a different keyword, or{' '}
                <button
                  type="button"
                  className={styles.resetLink}
                  onClick={() => {
                    setSearchQuery('');
                    setActiveCategory('all');
                  }}
                >
                  clear the filters
                </button>
                .
              </p>
            </div>
          ) : (
            <div className={styles.postsGrid}>
              {filtered.map((card, index) => (
                <PostCard key={card.slug} card={card} index={index} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* --- Featured article (unfiltered view only) --- */}
      {featured && (
        <section className={styles.featuredSection} aria-label="Featured article">
          <Link href={featured.path} className={styles.featuredCard}>
            <div className={styles.featuredImage}>
              <Image
                src={featured.image}
                alt={featured.imageAlt}
                width={800}
                height={500}
                priority
                sizes="(max-width: 900px) 100vw, 800px"
              />
            </div>
            <div className={styles.featuredContent}>
              <div className={styles.featuredMeta}>
                <span className={styles.featuredTag}>{featured.categoryName}</span>
                <span className={styles.featuredMetaItem}>
                  <Calendar size={14} aria-hidden="true" />
                  <time dateTime={featured.publishedIso}>{featured.publishedDisplay}</time>
                </span>
                <span className={styles.featuredMetaItem}>
                  <Clock size={14} aria-hidden="true" />
                  {featured.readingTime} min read
                </span>
              </div>
              <h2 className={styles.featuredTitle}>{featured.title}</h2>
              <p className={styles.featuredExcerpt}>{featured.excerpt}</p>
              <span className={styles.featuredReadMore}>
                Read article <ChevronRight size={16} aria-hidden="true" />
              </span>
            </div>
          </Link>
        </section>
      )}

      {/* --- Article grid --- */}
      {!isFiltering && gridCards.length > 0 && (
        <section className={styles.postsSection} aria-label="All articles">
          <div className={styles.postsHeader}>
            <h2 className={styles.postsTitle}>
              <BookOpen size={20} color="#6366f1" aria-hidden="true" />
              Latest guides
            </h2>
            <span className={styles.postsCount}>
              {gridCards.length} {gridCards.length === 1 ? 'article' : 'articles'}
            </span>
          </div>

          <div className={styles.postsGrid}>
            {gridCards.map((card, index) => (
              <PostCard key={card.slug} card={card} index={index} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function PostCard({ card, index }: { card: BlogCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: Math.min(index, 8) * 0.06 }}
    >
      <Link href={card.path} className={styles.postCard}>
        <div className={styles.postCardImage}>
          <Image
            src={card.image}
            alt={card.imageAlt}
            width={400}
            height={250}
            loading="lazy"
            sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
          />
          <div className={styles.postCardTags}>
            <span className={styles.postCardTag}>{card.categoryName}</span>
          </div>
        </div>
        <div className={styles.postCardBody}>
          <div className={styles.postCardMeta}>
            <Calendar size={14} aria-hidden="true" />
            <time dateTime={card.publishedIso}>{card.publishedDisplay}</time>
          </div>
          <h3 className={styles.postCardTitle}>{card.title}</h3>
          <p className={styles.postCardExcerpt}>{card.description}</p>
          <div className={styles.postCardFooter}>
            <div className={styles.postCardAuthor}>
              <div className={styles.postCardAuthorAvatar} aria-hidden="true">
                {card.authorName.charAt(0)}
              </div>
              <span className={styles.postCardAuthorName}>{card.authorName}</span>
            </div>
            <span className={styles.postCardReadMore}>
              Read <ChevronRight size={14} aria-hidden="true" />
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
