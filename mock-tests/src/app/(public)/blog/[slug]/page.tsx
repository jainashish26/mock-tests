import { BLOG_POSTS } from "@/data/blog-posts";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "./page.module.css";
import { ReadingProgressBar } from "./ReadingProgressBar";
import { BlogPostContent } from "./BlogPostContent";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = BLOG_POSTS.find(p => p.slug === slug);
  if (!post) return { title: 'Post Not Found' };

  return {
    title: post.metaTitle || `${post.title} | Mock Test Hub`,
    description: post.metaDescription || post.excerpt,
    keywords: post.keywords,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: [post.image],
      type: 'article',
      publishedTime: post.date,
      authors: [post.author.name],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
      images: [post.image],
    }
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = BLOG_POSTS.find(p => p.slug === slug);

  if (!post) {
    notFound();
  }

  return (
    <PublicLayout>
      <ReadingProgressBar />
      <div className={styles.pageWrapper}>
        <BlogPostContent post={post} />
      </div>
    </PublicLayout>
  );
}
