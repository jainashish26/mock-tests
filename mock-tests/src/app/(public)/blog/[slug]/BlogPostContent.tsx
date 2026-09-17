'use client';

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Calendar, Clock } from "lucide-react";
import { motion } from "framer-motion";
import styles from "./page.module.css";
import { BlogPost } from "@/data/blog-posts";

export function BlogPostContent({ post }: { post: BlogPost }) {
  return (
    <>
      <header className={styles.heroHeader}>
        <div className={styles.heroBlob1} aria-hidden="true" />
        <div className={styles.heroBlob2} aria-hidden="true" />

        <motion.div
          className={styles.heroInner}
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <Link href="/blog" className={styles.backLink}>
            <ArrowLeft size={16} />
            Back to Insights
          </Link>

          {post.tags && post.tags.length > 0 && (
            <div className={styles.tagsRow}>
              {post.tags.map((tag, i) => (
                <span key={i} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}

          <h1 className={styles.postTitle}>{post.title}</h1>

          <div className={styles.metaRow}>
            <div className={styles.authorBlock}>
              {post.author.avatar ? (
                <Image
                  src={post.author.avatar}
                  alt={post.author.name}
                  width={44}
                  height={44}
                  className={styles.authorAvatar}
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <div className={styles.authorAvatar}>
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
              <span>{post.date}</span>
            </div>

            <div className={styles.metaDivider} />

            <div className={styles.metaItem}>
              <Clock size={15} />
              <span>6 min read</span>
            </div>
          </div>
        </motion.div>
      </header>

      <motion.div
        className={styles.heroImageWrapper}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={styles.heroImage}>
          <Image
            src={post.image}
            alt={post.imageAlt || post.title}
            fill
            priority
            style={{ objectFit: 'cover' }}
          />
        </div>
      </motion.div>

      <motion.article
        className={styles.articleWrapper}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        <div
          className={styles.articleBody}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </motion.article>

      <footer className={styles.postFooter}>
        <div className={styles.footerDivider} />

        {post.tags && post.tags.length > 0 && (
          <div className={styles.footerTags}>
            <span className={styles.footerTagsLabel}>Tags:</span>
            {post.tags.map((tag, i) => (
              <Link key={i} href={`/blog?search=${tag}`} className={styles.footerTagLink}>
                <span className={styles.footerTagBadge}>{tag}</span>
              </Link>
            ))}
          </div>
        )}

        <div className={styles.authorCard}>
          {post.author.avatar ? (
            <Image
              src={post.author.avatar}
              alt={post.author.name}
              width={64}
              height={64}
              className={styles.authorCardAvatar}
            />
          ) : (
            <div className={styles.authorCardAvatarFallback}>
              {post.author.name.charAt(0)}
            </div>
          )}
          <div>
            <h4 className={styles.authorCardName}>About {post.author.name}</h4>
            <p className={styles.authorCardBio}>
              {post.author.name} is a {post.author.role.toLowerCase()} dedicated to helping students
              achieve their highest potential through effective study strategies and personalized learning.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
