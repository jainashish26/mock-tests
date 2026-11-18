import { ImageResponse } from 'next/og';
import { OgTemplate, OG_HEIGHT, OG_WIDTH } from '@/components/seo/OgTemplate';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/seo/site-config';

/**
 * Site-wide default Open Graph image, rendered at request/build time.
 *
 * Replaces the previous situation where `og-default.png` was referenced but no
 * such asset existed - every social share and AI-answer thumbnail would have
 * 404'd.
 */

export const alt = `${SITE_NAME} — NAPLAN, Selective School and Scholarship exam practice for Years 3–8`;
export const size = { width: OG_WIDTH, height: OG_HEIGHT };
export const contentType = 'image/png';

// Static: the card never changes between deploys.
export const dynamic = 'force-static';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgTemplate
        eyebrow="Exam Practice Platform"
        title="NAPLAN, Selective School & Scholarship exam practice for Years 3–8"
        subtitle={SITE_TAGLINE}
        author="Adaptive tests · AI essay grading · Parent reports"
      />
    ),
    { ...size }
  );
}
