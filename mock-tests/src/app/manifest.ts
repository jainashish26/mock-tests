import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MockTests Pro — Exam Practice for Years 3–8',
    short_name: 'MockTests Pro',
    description: 'Australia\'s trusted platform for NAPLAN, Selective School, and Scholarship exam preparation.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#194bfb',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}