import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Award, BadgeCheck, Calendar, ChevronRight,
  Clock, ExternalLink, FileText, History, ListTree, ShieldCheck, Sparkles,
} from "lucide-react";
import styles from "./page.module.css";
import { Reveal } from "./Reveal";
import type { AuthorProfile } from "@/lib/seo/authors";
import type { PostSeo, RelatedPostSummary } from "@/lib/seo/post-seo";


/**
 * Renders a single blog article.
 *
 * Server component: every SEO/AEO-critical block (breadcrumbs, direct answer,
 * key takeaways, table of contents, author credentials, related links) is
 * emitted into the initial HTML. Animation is delegated to the small `<Reveal />`
 * client wrapper so it never gates content visibility for crawlers that do not
 * execute JavaScript.
 *
 * Order follows answer-engine guidance:
 *   breadcrumb -> H1 -> direct answer -> key takeaways -> TOC -> body
 *   -> author credentials -> related reading.
 */

interface Props {
  seo: PostSeo;
  related: RelatedPostSummary[];
  authorProfile: AuthorProfile;
}

export function BlogPostContent({ seo, related, authorProfile }: Props) {
  const { post } = seo;

  // Authored takeaways win; otherwise fall back to the author's own excerpt.
  const hasAuthoredTakeaways = seo.keyTakeaways.length > 1;
  const summaryBullets = hasAuthoredTakeaways ? seo.keyTakeaways : seo.summaryPoints;
  const summaryHeading = hasAuthoredTakeaways ? 'Key takeaways' : 'In summary';

  return (
    <>
      {/* Breadcrumb trail - mirrors the BreadcrumbList JSON-LD emitted by the
          page, rendered as a semantic <nav> for crawlers and screen readers. */}
      <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
        <ol className={styles.breadcrumbList}>
          <li>
            <Link href="/" className={styles.breadcrumbLink}>Home</Link>
          </li>
          <li aria-hidden="true" className={styles.breadcrumbSep}><ChevronRight size={13} /></li>
          <li>
            <Link href="/blog" className={styles.breadcrumbLink}>Blog</Link>
          </li>
          <li aria-hidden="true" className={styles.breadcrumbSep}><ChevronRight size={13} /></li>
          <li>
            <Link href={`/blog/category/${seo.category.slug}`} className={styles.breadcrumbLink}>
              {seo.category.name}
            </Link>
          </li>
          <li aria-hidden="true" className={styles.breadcrumbSep}><ChevronRight size={13} /></li>
          <li aria-current="page" className={styles.breadcrumbCurrent}>{post.title}</li>
        </ol>
      </nav>

      <header className={styles.heroHeader}>
        <div className={styles.heroBlob1} aria-hidden="true" />
        <div className={styles.heroBlob2} aria-hidden="true" />

        <div className={styles.heroInner}>
          <Link href="/blog" className={styles.backLink}>
            <ArrowLeft size={16} />
            Back to Insights
          </Link>

          <p className={styles.categoryEyebrow}>{seo.category.name}</p>

          {seo.tags.length > 0 && (
            <div className={styles.tagsRow}>
              {seo.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/blog?search=${encodeURIComponent(tag.toLowerCase())}`}
                  className={styles.tag}
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}

          {/* Intent-based H1: mirrors how a parent would phrase the query. */}
          <h1 className={styles.postTitle}>{post.title}</h1>

          {/* Direct answer up front - the AEO "position zero" paragraph that
              answer engines lift most readily. */}
          {seo.leadAnswer && (
            <p className={styles.leadAnswer} data-speakable="lead">
              {seo.leadAnswer}
            </p>
          )}


          <div className={styles.metaRow}>
            <div className={styles.authorBlock}>
              {post.author.avatar ? (
                <Image
                  src={post.author.avatar}
                  alt={`${post.author.name}, ${post.author.role} at MockTests Pro`}
                  width={44}
                  height={44}
                  className={styles.authorAvatar}
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <div className={styles.authorAvatar} aria-hidden="true">
                  {post.author.name.charAt(0)}
                </div>
              )}
              <div style={{ textAlign: 'left' }}>
                <div className={styles.authorName}>{post.author.name}</div>
                <div className={styles.authorRole}>{post.author.role}</div>
              </div>
            </div>

            <div className={styles.metaDivider} />

            <div className={styles.metaItem}>
              <Calendar size={15} />
              <time dateTime={seo.publishedIso}>{seo.publishedDisplay}</time>
            </div>

            {post.updatedDate && (
              <>
                <div className={styles.metaDivider} />
                <div className={styles.metaItem} title="Last reviewed and updated">
                  <History size={15} />
                  <span>
                    Updated <time dateTime={seo.modifiedIso}>{seo.modifiedDisplay}</time>
                  </span>
                </div>
              </>
            )}

            <div className={styles.metaDivider} />

            {/* Computed from the real word count, replacing a hardcoded guess. */}
            <div className={styles.metaItem}>
              <Clock size={15} />
              <span>{seo.readingTime} min read</span>
            </div>

            <div className={styles.metaDivider} />

            <div className={styles.metaItem}>
              <FileText size={15} />
              <span>{seo.wordCount.toLocaleString('en-AU')} words</span>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.heroImageWrapper}>
        <div className={styles.heroImage}>
          <Image
            src={post.image}
            alt={seo.imageAlt}
            fill
            priority
            sizes="(max-width: 900px) 100vw, 900px"
            style={{ objectFit: 'cover' }}
          />
        </div>
      </div>

      {/* ── Answer-first summary ────────────────────────────────────────
          Authored bullets take priority and are labelled "Key takeaways";
          otherwise the article's own excerpt is shown under "In summary".
          Both sources are trustworthy - nothing here is scraped from body
          markup, which proved unreliable. ChatGPT and Perplexity lift
          structured lists like this far more readily than prose. */}
      {summaryBullets.length > 1 && (
        <section aria-labelledby="summary-heading" className={styles.takeawaysSection}>
          <h2 id="summary-heading" className={styles.takeawaysTitle}>
            <Sparkles size={18} aria-hidden="true" />
            {summaryHeading}
          </h2>
          <ul className={styles.takeawaysList}>
            {summaryBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Table of contents ───────────────────────────────────────────
          Anchors resolve against the ids injected by `addHeadingIds`, giving
          readers and AI engines section-level deep links into the article. */}
      {seo.toc.length > 3 && (
        <nav aria-labelledby="toc-heading" className={styles.tocNav}>
          <h2 id="toc-heading" className={styles.tocTitle}>
            <ListTree size={18} aria-hidden="true" />
            In this guide
          </h2>
          <ol className={styles.tocList}>
            {seo.toc.map((item) => (
              <li
                key={item.id}
                className={item.level === 3 ? styles.tocItemNested : styles.tocItem}
              >
                <a href={`#${item.id}`} className={styles.tocLink}>{item.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}


      {/* ── Article body ────────────────────────────────────────────────
          `seo.html` already carries stable heading ids. Long, coherent passages
          with supporting evidence are what Claude and Perplexity prefer to cite,
          so the body is left intact rather than chunked. */}
      <Reveal className={styles.articleWrapper}>
        <article className={styles.articleBody}>
          <div dangerouslySetInnerHTML={{ __html: seo.html }} />
        </article>
      </Reveal>

      <footer className={styles.postFooter}>
        <div className={styles.footerDivider} />

        {/* ── Author credentials (E-E-A-T) ──────────────────────────────
            Replaces the previous auto-generated boilerplate bio, which produced
            near-duplicate text across all 50 articles. Real, specific
            credentials are a primary trust signal for both Google's helpful
            content systems and AI citation decisions. */}
        <section aria-labelledby="about-author" className={styles.authorCard}>
          {authorProfile.avatar ? (
            <Image
              src={authorProfile.avatar}
              alt={`${authorProfile.name}, ${authorProfile.role}`}
              width={64}
              height={64}
              className={styles.authorCardAvatar}
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div className={styles.authorCardAvatarFallback} aria-hidden="true">
              {authorProfile.name.charAt(0)}
            </div>
          )}

          <div className={styles.authorCardBody}>
            <h2 id="about-author" className={styles.authorCardName}>
              About {authorProfile.name}
              <BadgeCheck size={16} className={styles.authorVerifiedIcon} aria-hidden="true" />
            </h2>
            <p className={styles.authorCardRole}>
              {authorProfile.role} · {authorProfile.affiliation}
            </p>
            <p className={styles.authorCardBio}>{authorProfile.bio}</p>

            <ul className={styles.authorCredentials}>
              {authorProfile.credentials.map((credential) => (
                <li key={credential}>
                  <Award size={14} aria-hidden="true" />
                  <span>{credential}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Editorial standards ───────────────────────────────────────
            Publishing the review process on-page reinforces trustworthiness,
            which the brand-authority guidance calls out explicitly. */}
        <p className={styles.editorialNote}>
          <ShieldCheck size={15} aria-hidden="true" />
          <span>
            Fact-checked against primary sources including ACARA and nap.edu.au.
            Published {seo.publishedDisplay}
            {post.updatedDate ? ` and last reviewed ${seo.modifiedDisplay}` : ''}.
          </span>
        </p>

        {/* ── Sources ───────────────────────────────────────────────────
            Makes citations explicit and machine-readable. Mirrors the
            `citation` property in the BlogPosting JSON-LD. */}
        {seo.sources.length > 0 && (
          <section aria-labelledby="sources-heading" className={styles.sourcesSection}>
            <h2 id="sources-heading" className={styles.sourcesTitle}>
              <ExternalLink size={16} aria-hidden="true" />
              Sources &amp; authoritative references
            </h2>
            <ul className={styles.sourcesList}>
              {seo.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sourcesLink}
                  >
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Related reading ───────────────────────────────────────────
            Contextual internal links. These distribute authority across the
            library and give AI engines a crawlable path to adjacent topics,
            which is how a site demonstrates topical depth. */}
        {related.length > 0 && (
          <section aria-labelledby="related-heading" className={styles.relatedSection}>
            <h2 id="related-heading" className={styles.relatedTitle}>
              Related reading
            </h2>
            <div className={styles.relatedGrid}>
              {related.map((item) => (
                <Link key={item.slug} href={item.path} className={styles.relatedCard}>
                  <span className={styles.relatedCategory}>{item.categoryName}</span>
                  <span className={styles.relatedCardTitle}>{item.title}</span>
                  <span className={styles.relatedExcerpt}>{item.description}</span>
                  <span className={styles.relatedMeta}>
                    <Clock size={13} aria-hidden="true" />
                    {item.readingTime} min read
                    <ArrowRight size={14} className={styles.relatedArrow} aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {seo.tags.length > 0 && (
          <div className={styles.footerTags}>
            <span className={styles.footerTagsLabel}>Tags:</span>
            {seo.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?search=${encodeURIComponent(tag.toLowerCase())}`}
                className={styles.footerTagLink}
              >
                <span className={styles.footerTagBadge}>{tag}</span>
              </Link>
            ))}
          </div>
        )}

        <div className={styles.footerCta}>
          <p className={styles.footerCtaText}>
            Ready to put this into practice? Try a free, curriculum-aligned mock
            test built for Years 3 to 8.
          </p>
          <div className={styles.footerCtaButtons}>
            <Link href="/free" className={styles.footerCtaPrimary}>
              Start free practice
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/blog" className={styles.footerCtaSecondary}>
              Browse all guides
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}

