# SEO, GEO & AEO on MockTests Pro

How search, generative-engine and answer-engine optimisation are implemented in
this codebase, and how to extend them safely.

- **SEO** — organic visibility in traditional search results.
- **GEO** — visibility and citation in AI-generated answers (ChatGPT, Perplexity,
  Claude, Google AI Overviews, Bing Copilot).
- **AEO** — structuring content so it answers a user's question directly.

## Verify everything

```bash
npm run verify           # typecheck + unit tests + build + all validators
npm run test             # consent logic unit tests
npm run validate         # assertions over the built output (SEO + consent HTML)
npm run validate:seo     # SEO/GEO/AEO only (requires a prior `npm run build`)
npm run validate:consent # sign-up consent UI only (requires a prior `npm run build`)
```

Note: `npm run lint` currently reports pre-existing errors in unrelated areas
(`any` types in `lib/supabase`, `proxy.ts`, dashboard components). Every file
touched by the SEO work is lint-clean.

`scripts/validate-seo.mjs` parses the **built** HTML in `.next/server/app` and
asserts ~2,000 properties: that every JSON-LD block parses, that required
`BlogPosting` fields are present and ISO-formatted, that canonical/OG/meta tags
are emitted, that breadcrumbs, TOC anchors, lead answers and source blocks are
in the server-rendered HTML, and that `robots.txt` / `sitemap.xml` / `llms.txt`
are correct. It exits non-zero on any failure, so it is CI-safe.

## Architecture

All optimisation logic lives in `src/lib/seo/`:

| File | Responsibility |
| --- | --- |
| `site-config.ts` | Single source of truth: `SITE_URL`, brand name, locale, logo, social profiles, authoritative sources. Nothing else hardcodes the domain. |
| `content-utils.ts` | Dependency-free HTML parsing: ISO date normalisation, word count, reading time, FAQ extraction, heading ids, lead answer, summary points. |
| `categories.ts` | Blog taxonomy. Derives a category per post from its existing `tags`, so no content migration was needed. |
| `sources.ts` | Authoritative primary sources mapped by category and subject matter. Every URL was verified to resolve. |
| `authors.ts` | E-E-A-T author registry: credentials, bio, affiliation, editorial policy. |
| `schema.ts` | Typed JSON-LD builders (`Organization`, `WebSite`, `BlogPosting`, `FAQPage`, `BreadcrumbList`, `CollectionPage`, `ItemList`, `Blog`, `AboutPage`, `Service`, `Product`). |
| `post-seo.ts` | `derivePostSeo(post)` — computes every signal for one article, shared by `generateMetadata`, JSON-LD and the page so the three can never disagree. |

Rendering components: `src/components/seo/JsonLd.tsx` (server-only),
`src/components/seo/OgTemplate.tsx` and `src/components/seo/brand-icon.tsx`
(dynamic images via `next/og`).

## Data flow for one article

```
src/data/posts/<slug>.ts
        |
        v
derivePostSeo(post)  ->  PostSeo
        |                    |
        |                    +-> blogPostingGraph()  -> <JsonLd />
        |                    +-> <BlogPostContent /> (server component)
        v
generateMetadata()   -> canonical, OG, twitter, robots, article times
```

`generateStaticParams()` prerenders all articles at build time. This matters for
GEO: AI crawlers apply short fetch budgets and silently drop slow pages, so
on-demand rendering would risk exclusion from AI answers entirely.

## What ships per article

- `<link rel="canonical">` — absolute, per-post.
- `og:type=article` with `published_time` / `modified_time` as real ISO 8601.
- A generated 1200x630 branded OG card (`opengraph-image.tsx`) — no static
  binaries to keep in sync, no 404s.
- `BlogPosting` + `WebPage` + `BreadcrumbList` JSON-LD, plus `FAQPage` when the
  article has a real FAQ section and `citation` for its sources.
- Visible: breadcrumb nav, direct-answer lead paragraph, summary block,
  deep-linkable table of contents (heading `id`s are injected at build time),
  computed reading time and word count, author credentials, editorial note,
  topic-appropriate sources, related-reading links.
- Server-rendered throughout. Animation is isolated in `<Reveal />` so nothing
  an answer engine needs is hidden behind `opacity: 0`.

## Crawl surface

- `src/app/robots.ts` — explicitly **allows** AI crawlers (`GPTBot`,
  `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `Perplexity-User`,
  `ClaudeBot`, `Claude-Web`, `anthropic-ai`, `Google-Extended`,
  `Applebot-Extended`, `Amazonbot`, `cohere-ai`, `Bytespider`,
  `Meta-ExternalAgent`, `DuckAssistBot`, `CCBot`) while disallowing private app
  routes (`/admin/`, `/creator/`, `/api/`, `/student/`, `/parent/`, `/tutor/`,
  `/auth/`). Blocking AI crawlers is the single most common GEO mistake.
- `src/app/sitemap.ts` — real ISO `lastmod` per post (previously every URL
  claimed `new Date()`, which told crawlers the whole site changed each deploy).
- `src/app/llms.txt/route.ts` — a markdown map of the library grouped by
  category, with editorial standards and primary sources.
- `/blog/category/<slug>` hubs give a shallow `Home > Blog > Category > Article`
  hierarchy that is crawlable without JavaScript.

## Adding a blog post

1. Create `src/data/posts/<slug>.ts` exporting a `BlogPost`.
2. Register the import and add it to `allPosts` in `src/data/blog-posts.ts`.
3. Required for good results:
   - `date` — display string is fine (`"March 30, 2026"`); `toIsoDate` normalises
     it. **Never** rely on `new Date(displayString)`.
   - `metaTitle` — under 60 characters. Used verbatim via `title.absolute`, so
     the brand suffix is not appended.
   - `metaDescription` — 120-155 characters. Longer values are truncated on a
     word boundary.
   - `excerpt` — the author's own one-paragraph summary. If it has 2+ sentences
     it is rendered as the "In summary" block.
   - `imageAlt` — descriptive, not decorative.
   - `tags` — drive category derivation. See `BLOG_CATEGORIES` in
     `categories.ts` for recognised values.
   - `keywords` — used for related-post matching and meta keywords.
4. Everything else (canonical, schema, OG card, TOC, reading time, word count,
   breadcrumbs, related links, sitemap entry, llms.txt entry) is derived
   automatically. There is nothing to wire up.

Then run `npm run verify`.

## Optional per-post fields

| Field | Effect |
| --- | --- |
| `updatedDate` | Sets `dateModified` in schema and renders "Updated <date>". Set it only on genuine content revisions — inflated freshness dates are a known spam signal. |
| `keyTakeaways` | 3-6 short bullets rendered as "Key takeaways". Takes priority over the excerpt-derived summary. |
| `readingTime` | Overrides the word-count-derived estimate. |
| `category` | Overrides tag-derived category. Use a slug from `BLOG_CATEGORIES`. |

### Why `keyTakeaways` is authored, not derived

An earlier revision scraped bullets from article markup — first any `<li>`, then
only `<li><strong>` items, then only items in the opening 35% of the document.
All three produced **factually misleading** output on this corpus:

- a NAPLAN Year 3 syllabus guide surfaced writing-assessment criteria from a deep
  subsection;
- a grammar guide surfaced its active/passive voice examples;
- a persuasive-writing guide surfaced "Weak: / Strong:" example pairs.

Markup alone cannot distinguish a summary list from a detail list. The derived
path was therefore removed; only the author's own `keyTakeaways` or `excerpt`
are used now. If neither qualifies, no summary block renders — the lead answer
and TOC still serve AEO.

### Why HowTo schema is not emitted

`howToNode()` exists in `schema.ts` but is only reached when `PostSchemaInput.steps`
is populated, and nothing populates it. Auto-derivation from `Step N` / `N.` /
`How to` headings emitted arguments ("NAPLAN Doesn't Test Reasoning"), topic
areas ("Number Theory", "Combinatorics") and question types ("Odd One Out") as
procedural steps. Incorrect structured data can trigger manual actions in Search
Console, so it was removed. Supply genuine ordered steps per post to re-enable.

## Author registry (E-E-A-T)

`src/lib/seo/authors.ts` maps a byline to credentials, bio and affiliation, which
feed both the on-page author card and the `Person`/`Organization` schema node.

This replaced a template that generated `"<name> is a <role> dedicated to helping
students..."` for every article — near-duplicate boilerplate across 50 pages.

**Before launch, replace the placeholder credentials with real, verifiable
ones** and add real `sameAs` profile URLs. An unverifiable credential is worse
for trust than a plain role. Also add real social profile URLs to
`SOCIAL_PROFILES` in `site-config.ts` (which feeds schema `sameAs`) and to
`SOCIAL_LINKS` in `components/layout/Footer.tsx`.

## Sign-up consent

Parent registration (`/auth/signup`) captures two mandatory confirmations and one
optional preference, implemented in `src/features/auth/components/ConsentCheckboxes.tsx`
with shared logic in `src/lib/auth/consent.ts`:

1. **Mandatory** — "you confirm you have reached the age of 18 years old".
2. **Mandatory** — "you agree to the Terms of Service, and acknowledge our
   Privacy Policy", with working links to `/terms` and `/privacy-policy`
   (new tab, `rel="noopener noreferrer"`).
3. **Optional** — occasional emails about new practice tests, exam dates and
   study resources.

Design points worth knowing before changing any of it:

- **Nothing is pre-checked.** Consent has to be an affirmative act.
- **Both sign-up paths are gated.** "Continue with Google" is a plain anchor that
  leaves the page immediately, so a checkbox placed only in the email form would
  be trivially bypassed. `SocialAuthButtons` takes an optional `requireConsent`
  callback; the signup page supplies it, the login page does not, so existing
  account holders are never asked to re-confirm their age.
- **Native `required` plus JS validation.** The mandatory boxes use the HTML
  `required` attribute (works without JavaScript) and the submit handler
  re-reads them from `FormData` rather than trusting React state alone.
- **The consent is recorded, not just displayed.** `buildConsentMetadata()` is
  passed to `supabase.auth.signUp({ options: { data } })` and persisted as
  `auth.users.raw_user_meta_data`: `consent_version`, `consent_at`,
  `age_18_confirmed`, `terms_accepted`, `privacy_acknowledged`,
  `marketing_opt_in` and `consent_source`. `consent_version` comes from
  `LEGAL_LAST_UPDATED`, so a record can be read against the wording actually shown.
- **The Google path records consent too.** `signInWithOAuth` accepts no `data`
  payload, so the signup page writes a short-lived `mt_signup_consent` cookie and
  `/auth/callback` persists it via `updateUser` once a session exists, then
  clears the cookie. This is strictly additive — a missing or malformed cookie
  never blocks sign-in, because that route also serves login.

`CONSENT_VERSION` must be bumped whenever the wording or the linked legal
documents change materially; `parseConsentCookie` rejects any cookie carrying a
different version rather than treating it as current consent.

### Residual limitation

The cookie is written by the browser, so it records what the UI captured — it is
not tamper-proof evidence, and the email path has the same property since its
values also come from the client. Direct navigation to `/auth/oauth/google`
bypasses the UI gate entirely. Hard server-side enforcement was deliberately not
added because `/auth/oauth/[provider]` is shared with the login page, where age
confirmation must not be demanded of an existing account holder.

If enforceable proof of consent is needed, the correct fix is a dedicated
`consents` table written from an authenticated server action (or a sign-up-only
OAuth entry point that validates a signed consent token), not a client cookie.

### Tests

```bash
npm run test:consent     # 46 unit tests over validateConsent / metadata / cookie parsing
npm run validate:consent # 36 assertions over the BUILT signup HTML
```

The unit tests focus on `parseConsentCookie` rejection paths — tampered version,
missing or false `age`/`terms`, absent or unparseable timestamp, truncated
base64, non-JSON payloads, and a cookie carrying only the optional flag. The HTML
assertions also guard the reverse case: `/auth/login` and `/auth/student-login`
must **not** start demanding sign-up consent.

Both run inside `npm run verify`.

## Known gaps / follow-ups

Ordered by impact. Items 1-4 from the original audit are now closed (see
"Completed since the first pass" below).

1. **Author credentials are structured placeholders.** `src/lib/seo/authors.ts`
   holds real *roles* but the credentials must be replaced with verifiable
   qualifications, and `sameAs` needs real profile URLs. Also populate
   `SOCIAL_PROFILES` in `site-config.ts` and `SOCIAL_LINKS` in
   `components/layout/Footer.tsx` — both are intentionally empty rather than
   pointing at `href="#"`.
2. **Contact mailboxes must be real.** `CONTACT.supportEmail` and
   `CONTACT.privacyEmail` are `support@` / `privacy@mocktestspro.com.au`. The
   Privacy Policy names them, so they must be monitored before launch.
3. **Legal pages need review by a lawyer.** `/privacy-policy` and `/terms` are
   accurate to the real stack (Supabase, Stripe, Vercel, Upstash QStash,
   SendGrid, Google OAuth, DeepSeek) and reference the APPs, the Notifiable
   Data Breaches scheme and Australian Consumer Law — but they are a strong
   starting draft, not legal advice.
4. **DeepSeek processes student writing.** The Privacy Policy discloses this
   plainly. For an Australian product handling children's data, confirm the
   provider's terms and data-residency position, and consider whether an
   AU-hosted alternative is preferable.
5. **Home page is a client component** (`src/app/page.tsx`). It cannot export
   `metadata`, so it inherits the root layout defaults, and its test list is
   fetched client-side from Supabase (not in the initial HTML). Converting it to
   a server component with a client island would let it carry its own schema and
   server-rendered content.
6. **Third-party brand mentions** (Reddit, Quora, education forums) are off-page
   work and cannot be done in code — but they are a real GEO ranking factor.
7. **Original research** would strengthen authority considerably. The platform
   already collects attempt data; publishing an annual aggregated report (e.g.
   "How Australian students perform on NAPLAN numeracy by year level") would
   create a citable primary source that AI engines actively look for.

## Completed since the first pass

- **Legal/trust pages.** `/privacy-policy`, `/terms` and `/contact` are real,
  server-rendered routes with their own metadata, canonical URLs, breadcrumbs
  and JSON-LD (`ContactPage` + `FAQPage` on Contact). All three are in the
  sitemap, `llms.txt`, and linked from every page footer plus a new Legal column.
  `Organization` schema now carries a `contactPoint`.
- **FAQ coverage is 50/50** (300 Q&A pairs emitting `FAQPage`), up from 18/50.
  Every answer was written from the article's actual content — outlines were
  dumped per post first, and claims were kept to what the article states.
- **`keyTakeaways` on 50/50**, rendered as a "Key takeaways" block. These are
  authored, never scraped (see "Why keyTakeaways is authored, not derived").
- **Publication schedule.** Every post has a unique `date` on a 3-day grid from
  **1 August 2026 to 26 December 2026**, and `updatedDate` exactly two days
  later, so `dateModified` differs from `datePublished` on all 50 articles and
  the "Updated" label renders. Order follows the `allPosts` array in
  `src/data/blog-posts.ts`. Some dates are in the future, as requested.
- **`readingTime` and `category`** are now explicit fields on every post. Both
  were taken from the build output (the values `derivePostSeo` actually computes)
  rather than recalculated, so there is no second implementation to drift.
- **Repaired 80 mojibake sequences across 14 source files.** Double-encoded
  UTF-8 had garbled maths and punctuation: `Ã·`→`÷`, `Â½`→`½`, `Â¼`→`¼`,
  `Â¾`→`¾`, `Â±`→`±`, `Â°`→`°`, `Â²`→`²`, `Â³`→`³`, `Ã©`→`é`, `Å‘`→`ő`
  (Erdős), plus `→`, `−`, `≈`, `≠`, `√`, `⁵`, `⁶`, `×`, `⅓`, `⅕`, `⅛` and `☐`.
  Each repair was verified against surrounding sentence meaning, and a genuine
  `7²⁰²⁶` was correctly left untouched.
- **Fixed a latent extractor bug.** The FAQ heading regex used a lazy `[\s\S]*?`
  that could start at an unrelated heading and span 64,000+ characters, binding
  the level backreference to the wrong element. It silently produced zero FAQ
  pairs on the 68,000-character property guide, and its looser sibling caused
  three posts to be misreported as already having FAQs. The pattern now cannot
  cross any `</h1>`–`</h6>` tag.


