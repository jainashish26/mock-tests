import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllPostSlugs, getPostBySlug, getRelatedPosts } from "@/data/blog-posts";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { JsonLd } from "@/components/seo/JsonLd";
import { getAuthor } from "@/lib/seo/authors";
import { toIsoDateTime } from "@/lib/seo/content-utils";
import { derivePostSeo, toRelatedSummary, toSchemaInput } from "@/lib/seo/post-seo";
import { blogPostingGraph } from "@/lib/seo/schema";
import { absoluteUrl, LOCALE, SITE_NAME } from "@/lib/seo/site-config";
import styles from "./page.module.css";
import { ReadingProgressBar } from "./ReadingProgressBar";
import { BlogPostContent } from "./BlogPostContent";

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Prerender every article at build time.
 *
 * Without this each of the 50+ guides is rendered on demand, which inflates TTFB
 * and risks AI crawler timeouts (GPTBot, PerplexityBot and ClaudeBot all apply
 * short fetch budgets and silently drop slow pages).
 */
export function generateStaticParams() {
  return getAllPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return { title: "Post Not Found", robots: { index: false, follow: false } };
  }

  const seo = derivePostSeo(post);
  const canonical = absoluteUrl(seo.path);

  return {
    // `absolute` bypasses the root layout title template so the pre-optimised
    // meta title is emitted at its intended length (<=60 chars).
    title: { absolute: seo.title },
    description: seo.description,
    keywords: post.keywords,
    alternates: { canonical: seo.path },
    category: seo.category.name,
    authors: [{ name: post.author.name }],
    openGraph: {
      type: "article",
      locale: LOCALE,
      url: canonical,
      siteName: SITE_NAME,
      title: seo.title,
      description: seo.description,
      publishedTime: toIsoDateTime(seo.publishedIso),
      modifiedTime: toIsoDateTime(seo.modifiedIso),
      authors: [post.author.name],
      section: seo.category.name,
      tags: seo.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  // All SEO signals are derived once and shared between metadata, JSON-LD and
  // the rendered page so the three can never disagree.
  const seo = derivePostSeo(post);
  const schema = blogPostingGraph(toSchemaInput(seo));
  const related = getRelatedPosts(post, 4).map(toRelatedSummary);
  const authorProfile = getAuthor(post.author.name);

  return (
    <PublicLayout>
      <ReadingProgressBar />
      <JsonLd data={schema} />
      <div className={styles.pageWrapper}>
        <BlogPostContent
          seo={seo}
          related={related}
          authorProfile={authorProfile}
        />
      </div>
    </PublicLayout>
  );
}