import { BRAND_HOST_LABEL, SITE_NAME } from '@/lib/seo/site-config';

/**
 * Shared design for dynamically generated Open Graph images.
 *
 * Generating OG images at build time (rather than shipping static binaries)
 * means every article gets an accurate, branded 1200x630 card automatically -
 * no missing-image 404s, no manual design work per post. Social previews and
 * AI-answer thumbnails both use these.
 *
 * NOTE: `next/og` (Satori) supports only a subset of CSS - flexbox only, no
 * `gap` shorthand issues, no `box-shadow`, no CSS variables, no Tailwind.
 * All styling below is intentionally inline and conservative.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgTemplateProps {
  /** Kicker line above the title, e.g. a category or "Blog". */
  eyebrow?: string;
  /** Main headline. Kept to ~3 lines for legibility. */
  title: string;
  /** Optional supporting line, e.g. reading time or publication date. */
  subtitle?: string;
  /** Optional author byline. */
  author?: string;
}

export function OgTemplate({ eyebrow, title, subtitle, author }: OgTemplateProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0f172a',
        padding: '72px 80px',
        fontFamily: 'sans-serif',
        position: 'relative',
      }}
    >
      {/* Decorative gradient wash */}
      <div
        style={{
          position: 'absolute',
          top: '-180px',
          right: '-120px',
          width: '620px',
          height: '620px',
          borderRadius: '999px',
          background: 'radial-gradient(circle, rgba(25,75,251,0.55) 0%, rgba(25,75,251,0) 70%)',
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-220px',
          left: '-140px',
          width: '560px',
          height: '560px',
          borderRadius: '999px',
          background: 'radial-gradient(circle, rgba(168,85,247,0.40) 0%, rgba(168,85,247,0) 70%)',
          display: 'flex',
        }}
      />

      {/* Brand row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', position: 'relative' }}>
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '12px',
            background: '#194bfb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            fontSize: '28px',
            fontWeight: 700,
          }}
        >
          M
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            color: '#ffffff',
            fontSize: '26px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          {SITE_NAME}
        </div>
      </div>

      {/* Headline block */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
        {eyebrow ? (
          <div
            style={{
              display: 'flex',
              color: '#93b4ff',
              fontSize: '24px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {eyebrow}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            color: '#ffffff',
            fontSize: title.length > 78 ? '52px' : '64px',
            fontWeight: 800,
            lineHeight: 1.12,
            letterSpacing: '-0.03em',
            maxWidth: '1000px',
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              display: 'flex',
              color: '#cbd5e1',
              fontSize: '26px',
              lineHeight: 1.4,
              maxWidth: '940px',
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>

      {/* Footer row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'relative',
          borderTop: '1px solid rgba(255,255,255,0.14)',
          paddingTop: '28px',
        }}
      >
        <div style={{ display: 'flex', color: '#94a3b8', fontSize: '22px' }}>
          {author ? author : 'NAPLAN · Selective · Scholarship · Years 3–8'}
        </div>
        {/*
          Previously the literal `mocktestspro.com.au` — a placeholder domain from
          the original brief that was never purchased. This is the one place the
          address was rendered *to a person*: on an image that gets shared into
          WhatsApp groups and Facebook feeds, where a dead domain is a card telling
          a parent to go somewhere that does not resolve, and where they cannot
          click it to find out.

          It now prints the real hostname once one is configured, and nothing at
          all until then. Nothing is the correct interim answer: the deployment's
          `*.vercel.app` host is reachable but is not the brand, and printing a
          hashed platform hostname on a marketing card would be its own kind of
          fiction.
        */}
        {BRAND_HOST_LABEL && (
          <div style={{ display: 'flex', color: '#64748b', fontSize: '22px' }}>
            {BRAND_HOST_LABEL}
          </div>
        )}

      </div>
    </div>
  );
}
