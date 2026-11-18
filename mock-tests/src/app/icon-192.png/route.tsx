import { brandIcon } from '@/components/seo/brand-icon';

/** Serves `/icon-192.png` - referenced by manifest.ts for PWA installation. */
export const dynamic = 'force-static';

export function GET() {
  return brandIcon(192);
}
