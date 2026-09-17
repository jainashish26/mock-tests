import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/creator/', '/api/'],
      },
    ],
    sitemap: 'https://mocktestspro.com.au/sitemap.xml',
  };
}