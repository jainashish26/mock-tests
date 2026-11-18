import { brandIcon } from '@/components/seo/brand-icon';

/** Serves `/icon-512.png` - referenced by manifest.ts and Organization schema. */
export const dynamic = 'force-static';

export function GET() {
  return brandIcon(512);
}
