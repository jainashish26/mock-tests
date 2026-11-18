import { brandIcon } from '@/components/seo/brand-icon';

/** Serves `/apple-icon.png` - iOS home-screen bookmark for the PWA. */
export const dynamic = 'force-static';

export function GET() {
  return brandIcon(180);
}
