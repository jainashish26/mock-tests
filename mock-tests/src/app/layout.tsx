import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { JsonLd } from "@/components/seo/JsonLd";
import { siteGraph } from "@/lib/seo/schema";
import {
  absoluteUrl,
  DEFAULT_OG_IMAGE,
  INDEXABLE_ROBOTS,
  LOCALE,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  SOCIAL_PROFILES,
} from "@/lib/seo/site-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const HOME_TITLE =
  "MockTests Pro — NAPLAN, Selective School & Scholarship Exam Practice for Years 3–8";

/**
 * Site-wide metadata defaults.
 *
 * `metadataBase` is essential: without it every relative `openGraph.images` and
 * `alternates.canonical` value is emitted unresolved, which breaks social cards
 * and prevents Google from confirming the canonical URL.
 *
 * `title.template` appends the brand to child titles automatically. Pages that
 * need exact control (blog posts with pre-optimised meta titles) use
 * `title.absolute` to bypass it.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: HOME_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "education",
  keywords: [
    "NAPLAN practice tests",
    "NAPLAN preparation",
    "selective school entrance exam",
    "scholarship exam preparation",
    "EduTest practice",
    "ACER scholarship exam",
    "Year 3 5 7 9 mock tests",
    "AI essay grading",
    "Australian exam preparation",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: LOCALE,
    url: SITE_URL,
    siteName: SITE_NAME,
    title: HOME_TITLE,
    description:
      "Adaptive NAPLAN, Selective School and Scholarship exam practice for Years 3–8, with AI-powered essay grading, instant feedback and parent progress reports.",
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — exam practice for Years 3–8`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description:
      "Adaptive NAPLAN, Selective School and Scholarship exam practice for Years 3–8, with AI-powered essay grading and instant feedback.",
    images: [DEFAULT_OG_IMAGE],
  },
  ...(SOCIAL_PROFILES.length > 0 ? { other: { sameAs: SOCIAL_PROFILES } } : {}),
  /**
   * Indexability of every page that does not override it.
   *
   * The constant lives in `site-config.ts` rather than here because six pages
   * override `robots` at the page level, and a page-level declaration wins over
   * this one — so the layout alone can never be the place the decision is made.
   * See `INDEXABLE_ROBOTS` for the full history, including how the blog articles
   * stayed indexable after this line was changed and what caught it.
   */
  robots: INDEXABLE_ROBOTS,
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  icons: {
    icon: absoluteUrl("/favicon.ico"),
    shortcut: absoluteUrl("/favicon.ico"),
    apple: absoluteUrl("/apple-icon.png"),
  },
  manifest: absoluteUrl("/manifest.webmanifest"),
};

export const viewport: Viewport = {
  themeColor: "#194bfb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `en-AU` tells search engines and screen readers the content targets
    // Australian English (spelling, curriculum references, date formats).
    <html lang="en-AU">
      <body className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
        {/* Organisation + WebSite entity graph, emitted once site-wide so every
            page inherits a consistent entity identity for knowledge-graph and
            AI-citation purposes. */}
        <JsonLd data={siteGraph()} />
        {children}
      </body>
    </html>
  );
}

