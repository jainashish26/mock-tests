import { ImageResponse } from 'next/og';
import { OgTemplate, OG_HEIGHT, OG_WIDTH } from '@/components/seo/OgTemplate';
import { getAllPostSlugs, getPostBySlug } from '@/data/blog-posts';
import { deriveCategory } from '@/lib/seo/categories';
import { formatDisplayDate, readingTimeMinutes, truncate } from '@/lib/seo/content-utils';
import { SITE_NAME } from '@/lib/seo/site-config';

/**
 * Per-article Open Graph image.
 *
 * Each of the 50+ guides gets an accurately titled, branded card generated at
 * build time. This materially improves share click-through and gives AI
 * surfaces a real thumbnail to attach to a citation.
 */

export const alt = `Article from ${SITE_NAME}`;
export const size = { width: OG_WIDTH, height: OG_HEIGHT };
export const contentType = 'image/png';

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  // Mirrors the page's own `generateStaticParams` so the image is prerendered
  // alongside the HTML rather than computed on first request.
  return getAllPostSlugs().map((slug) => ({ slug }));
}

export default async function PostOpengraphImage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  // Fall back to the generic card rather than erroring on an unknown slug.
  const title = post ? post.title : 'MockTests Pro Blog';
  const eyebrow = post ? deriveCategory(post.tags).name : 'Blog';
  const subtitle = post ? truncate(post.excerpt, 150) : undefined;
  const author = post
    ? `${post.author.name} · ${formatDisplayDate(post.date)} · ${
        post.readingTime ?? readingTimeMinutes(post.content)
      } min read`
    : undefined;

  return new ImageResponse(
    (
      <OgTemplate
        eyebrow={eyebrow}
        title={truncate(title, 96)}
        subtitle={subtitle}
        author={author}
      />
    ),
    { ...size }
  );
}
