'use client'

import { useState, useMemo } from 'react';
import { PublicLayout } from "@/components/layout/PublicLayout";
import { BookOpen, ChevronRight, Search, Calendar } from "lucide-react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import styles from "./blog.module.css";
import { BLOG_POSTS, BlogPost } from "@/data/blog-posts";

export default function BlogPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPosts = useMemo(() => {
    let posts = BLOG_POSTS;
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      posts = posts.filter(post => 
        post.title.toLowerCase().includes(query) || 
        post.excerpt.toLowerCase().includes(query) ||
        post.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    return posts;
  }, [searchQuery]);

  const featuredPost = BLOG_POSTS[0];
  const regularPosts = filteredPosts.slice(1);

  return (
    <PublicLayout>
      <div className={styles.pageContainer}>
        {/* --- HERO --- */}
        <section className={styles.hero}>
          <div className={styles.heroBlob1} aria-hidden="true" />
          <div className={styles.heroBlob2} aria-hidden="true" />
          
          <motion.div 
            className={styles.heroContent}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={styles.heroBadge}>
              <BookOpen size={14} />
              Insights & Resources
            </div>
            <h1 className={styles.heroTitle}>
              Explore our <span className={styles.heroTitleAccent}>latest articles</span>
            </h1>
            <p className={styles.heroSubtitle}>
              Expert tips, study guides, and insights to help your child succeed in exams.
            </p>
            
            <div className={styles.searchWrapper}>
              <Search size={20} className={styles.searchIcon} />
              <input 
                type="text" 
                placeholder="Search for articles, topics or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={styles.searchInput}
              />
            </div>
          </motion.div>
        </section>

        {/* --- SEARCH RESULTS --- */}
        {searchQuery.trim() && (
          <section className={styles.searchResults}>
            <div className={styles.searchResultsHeader}>
              <Search size={20} color="#6366f1" />
              <h2 className={styles.searchResultsTitle}>Search Results for "{searchQuery}"</h2>
              <span className={styles.searchResultsCount}>{filteredPosts.length} matches</span>
            </div>
            
            {filteredPosts.length > 0 ? (
              <div className={styles.postsGrid}>
                {filteredPosts.map((post, index) => (
                  <PostCard key={post.id} post={post} index={index} />
                ))}
              </div>
            ) : (
              <div className={styles.noResults}>
                <div className={styles.noResultsIcon}>
                  <Search size={32} />
                </div>
                <h3 className={styles.noResultsTitle}>No articles found</h3>
                <p className={styles.noResultsText}>Try a different keyword or browse by category.</p>
              </div>
            )}
          </section>
        )}

        {/* --- FEATURED POST --- */}
        {!searchQuery.trim() && featuredPost && (
          <section className={styles.featuredSection}>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              <Link href={`/blog/${featuredPost.slug}`} className={styles.featuredCard}>
                <div className={styles.featuredImage}>
                  <Image 
                    src={featuredPost.image} 
                    alt={featuredPost.imageAlt || featuredPost.title} 
                    width={800} 
                    height={500}
                    priority
                  />
                </div>
                <div className={styles.featuredContent}>
                  <div className={styles.featuredMeta}>
                    {featuredPost.tags && featuredPost.tags[0] && (
                      <span className={styles.featuredTag}>{featuredPost.tags[0]}</span>
                    )}
                    <span className={styles.featuredMetaItem}>
                      <Calendar size={14} />
                      {featuredPost.date}
                    </span>
                  </div>
                  <h2 className={styles.featuredTitle}>{featuredPost.title}</h2>
                  <p className={styles.featuredExcerpt}>{featuredPost.excerpt}</p>
                  <span className={styles.featuredReadMore}>
                    Read Article <ChevronRight size={16} />
                  </span>
                </div>
              </Link>
            </motion.div>
          </section>
        )}

        {/* --- POSTS GRID --- */}
        {!searchQuery.trim() && regularPosts.length > 0 && (
          <section className={styles.postsSection}>
            <div className={styles.postsHeader}>
              <h2 className={styles.postsTitle}>
                <BookOpen size={20} color="#6366f1" />
                More Articles
              </h2>
              <span className={styles.postsCount}>{regularPosts.length} articles</span>
            </div>
            
            <div className={styles.postsGrid}>
              {regularPosts.map((post, index) => (
                <PostCard key={post.id} post={post} index={index} />
              ))}
            </div>
          </section>
        )}
      </div>
    </PublicLayout>
  );
}

function PostCard({ post, index }: { post: BlogPost; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: index * 0.1 }}
    >
      <Link href={`/blog/${post.slug}`} className={styles.postCard}>
        <div className={styles.postCardImage}>
          <Image 
            src={post.image} 
            alt={post.imageAlt || post.title} 
            width={400} 
            height={250}
          />
          {post.tags && post.tags.length > 0 && (
            <div className={styles.postCardTags}>
              {post.tags.slice(0, 2).map((tag, i) => (
                <span key={i} className={styles.postCardTag}>{tag}</span>
              ))}
            </div>
          )}
        </div>
        <div className={styles.postCardBody}>
          <div className={styles.postCardMeta}>
            <Calendar size={14} />
            {post.date}
          </div>
          <h3 className={styles.postCardTitle}>{post.title}</h3>
          <p className={styles.postCardExcerpt}>{post.excerpt}</p>
          <div className={styles.postCardFooter}>
            <div className={styles.postCardAuthor}>
              <div className={styles.postCardAuthorAvatar}>
                {post.author.name.charAt(0)}
              </div>
              <span className={styles.postCardAuthorName}>{post.author.name}</span>
            </div>
            <span className={styles.postCardReadMore}>
              Read <ChevronRight size={14} />
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
