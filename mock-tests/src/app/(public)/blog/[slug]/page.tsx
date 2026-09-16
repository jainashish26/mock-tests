import { BLOG_POSTS, BlogPost } from "@/data/blog-posts";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Calendar, User, Clock, Tag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import styles from "@/app/page.module.css";

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
      <article className={styles.section} style={{ paddingTop: '8rem', maxWidth: '800px' }}>
        <Link href="/blog" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none', marginBottom: '2rem' }}>
          <ArrowLeft size={18} /> Back to Insights
        </Link>

        <header style={{ marginBottom: '3rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {post.tags.map((tag, i) => (
              <Badge key={i} variant="secondary">{tag}</Badge>
            ))}
          </div>
          
          <h1 style={{ fontSize: '3rem', fontWeight: 800, lineHeight: 1.1, marginBottom: '1.5rem', color: 'var(--color-text)' }}>
            {post.title}
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {post.author.avatar ? (
                <Image src={post.author.avatar} alt={post.author.name} width={40} height={40} style={{ borderRadius: '50%' }} />
              ) : (
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {post.author.name.charAt(0)}
                </div>
              )}
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{post.author.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{post.author.role}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              <Calendar size={16} />
              <span>{post.date}</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              <Clock size={16} />
              <span>6 min read</span>
            </div>
          </div>
        </header>

        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '3rem', boxShadow: 'var(--shadow-lg)' }}>
          <Image 
            src={post.image} 
            alt={post.imageAlt || post.title} 
            fill 
            priority
            style={{ objectFit: 'cover' }}
          />
        </div>

        <div 
          style={{ 
            fontSize: '1.125rem', 
            lineHeight: 1.8, 
            color: 'var(--color-text)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem'
          }}
          dangerouslySetInnerHTML={{ __html: post.content }} 
        />

        <footer style={{ marginTop: '5rem', paddingTop: '3rem', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontWeight: 700 }}>Tags:</span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {post.tags.map((tag, i) => (
                <Link key={i} href={`/blog?search=${tag}`}>
                  <Badge variant="outline" style={{ cursor: 'pointer' }}>{tag}</Badge>
                </Link>
              ))}
            </div>
          </div>
          
          <div style={{ background: 'var(--color-surface)', padding: '2rem', borderRadius: 'var(--radius-lg)', display: 'flex', gap: '1.5rem', alignItems: 'center', border: '1px solid var(--color-border)' }}>
            {post.author.avatar && (
              <Image src={post.author.avatar} alt={post.author.name} width={80} height={80} style={{ borderRadius: '50%' }} />
            )}
            <div>
              <h4 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 800 }}>About {post.author.name}</h4>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                {post.author.name} is a {post.author.role.toLowerCase()} dedicated to helping students achieve their highest potential through effective study strategies and personalized learning.
              </p>
            </div>
          </div>
        </footer>
      </article>
    </PublicLayout>
  );
}
