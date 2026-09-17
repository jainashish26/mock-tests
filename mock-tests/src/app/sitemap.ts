import { MetadataRoute } from 'next';
import { BLOG_POSTS } from '@/data/blog-posts';

const BASE_URL = 'https://mocktestspro.com.au';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 1 },
    { url: `${BASE_URL}/tests`, lastModified: new Date(), changeFrequency: 'weekly' as const, priority: 0.9 },
    { url: `${BASE_URL}/free`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.8 },
    { url: `${BASE_URL}/features`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.7 },
    { url: `${BASE_URL}/about`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.6 },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 0.8 },
    { url: `${BASE_URL}/auth/login`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${BASE_URL}/auth/signup`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
  ];

  const blogPages = BLOG_POSTS.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: 'yearly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...blogPages];
}