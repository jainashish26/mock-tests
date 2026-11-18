import { ImageResponse } from 'next/og';

/**
 * Renders the MockTests Pro brand mark at an arbitrary size.
 *
 * The web app manifest references `/icon-192.png` and `/icon-512.png`, and the
 * Organization JSON-LD references the 512px variant as its logo. Neither binary
 * existed in `public/`, so both were 404ing - which breaks PWA installation and
 * leaves the knowledge-graph entity without a logo.
 *
 * Generating them keeps a single source of truth for the mark.
 */
export function brandIcon(size: number): ImageResponse {
  const radius = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.52);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#194bfb',
          borderRadius: `${radius}px`,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            fontSize: `${fontSize}px`,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.04em',
          }}
        >
          M
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
