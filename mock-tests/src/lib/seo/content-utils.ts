/**
 * Pure string/HTML helpers used to derive SEO, GEO and AEO signals from the
 * blog post markup stored in `src/data/posts/*.ts`.
 *
 * Everything here is dependency-free and DOM-free so it can run in server
 * components, `generateMetadata`, `sitemap.ts` and route handlers alike.
 */

export interface FaqItem {
  question: string;
  answer: string;
}

export interface TocItem {
  /** Anchor id injected into the rendered HTML. */
  id: string;
  text: string;
  /** 2 for h2, 3 for h3. */
  level: number;
}

/* ------------------------------------------------------------------ *
 * Decoding + text helpers
 * ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  copy: '\u00A9', reg: '\u00AE', times: '\u00D7', divide: '\u00F7', deg: '\u00B0',
};

/** Decode HTML entities and collapse whitespace into a single clean string. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)
        ? NAMED_ENTITIES[key]
        : match;
    });
}

/** Strip all HTML tags and normalise whitespace. */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncate to a target length on a word boundary, appending an ellipsis. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice)
    .replace(/[,.:;\-\u2014]$/, '')}\u2026`;
}

/* ------------------------------------------------------------------ *
 * Dates - post data uses display strings such as "March 30, 2026",
 * which are NOT valid schema.org / ISO 8601 values. These helpers fix that.
 * ------------------------------------------------------------------ */

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Normalise any supported display or ISO date string to `YYYY-MM-DD`.
 * Returns `undefined` when unparseable so callers can omit the field rather
 * than emit an invalid schema value.
 */
export function toIsoDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // "March 30, 2026" | "Mar 30 2026"
  const monthFirst = raw.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (monthFirst) {
    const mm = MONTHS[monthFirst[1].toLowerCase()];
    if (mm) return `${monthFirst[3]}-${mm}-${monthFirst[2].padStart(2, '0')}`;
  }

  // "30 March 2026"
  const dayFirst = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (dayFirst) {
    const mm = MONTHS[dayFirst[2].toLowerCase()];
    if (mm) return `${dayFirst[3]}-${mm}-${dayFirst[1].padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

/** Full ISO 8601 timestamp for schema.org `datePublished` / `dateModified`. */
export function toIsoDateTime(value?: string | null): string | undefined {
  const date = toIsoDate(value);
  return date ? `${date}T09:00:00+11:00` : undefined;
}

/** Human-readable Australian format, e.g. "30 March 2026". */
export function formatDisplayDate(value?: string | null): string {
  const iso = toIsoDate(value);
  if (!iso) return value ?? '';
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

/* ------------------------------------------------------------------ *
 * Reading time
 * ------------------------------------------------------------------ */

/** Average adult silent-reading speed used for the "x min read" estimate. */
const WORDS_PER_MINUTE = 220;

export function countWords(html: string): number {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** Reading time in whole minutes, clamped to a minimum of 1. */
export function readingTimeMinutes(html: string): number {
  return Math.max(1, Math.round(countWords(html) / WORDS_PER_MINUTE));
}


/* ------------------------------------------------------------------ *
 * Headings / table of contents
 * ------------------------------------------------------------------ */

/** URL-safe slug from a heading string. */
export function slugify(text: string): string {
  return stripHtml(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** Extract h2/h3 headings in document order as TOC entries. */
export function extractHeadings(html: string, levels: number[] = [2, 3]): TocItem[] {
  const items: TocItem[] = [];
  const used = new Set<string>();
  const re = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const level = Number(match[1]);
    if (!levels.includes(level)) continue;
    const text = stripHtml(match[3]);
    if (!text) continue;

    const base = slugify(text) || `section-${items.length + 1}`;
    let unique = base;
    let n = 2;
    while (used.has(unique)) unique = `${base}-${n++}`;
    used.add(unique);

    items.push({ id: unique, text, level });
  }
  return items;
}

/**
 * Inject stable `id` attributes onto h2/h3 tags so the on-page table of
 * contents can deep-link into sections. Deep links matter for AEO because AI
 * engines prefer citing a specific section over an entire page.
 *
 * Existing ids are preserved; only headings without one are touched.
 */
export function addHeadingIds(html: string): string {
  const used = new Set<string>();
  return html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (full, level: string, attrs: string, inner: string) => {
      const lvl = Number(level);
      if (lvl !== 2 && lvl !== 3) return full;
      if (/\bid\s*=/i.test(attrs)) return full;

      const text = stripHtml(inner);
      if (!text) return full;

      const base = slugify(text) || `section-${used.size + 1}`;
      let unique = base;
      let n = 2;
      while (used.has(unique)) unique = `${base}-${n++}`;
      used.add(unique);

      return `<h${level}${attrs} id="${unique}">${inner}</h${level}>`;
    });
}

/* ------------------------------------------------------------------ *
 * FAQ extraction - drives FAQPage schema, the single biggest AEO lever
 * ------------------------------------------------------------------ */

/**
 * Matches the FAQ heading element.
 *
 * The lazy spans are explicitly forbidden from crossing any `</h1>`-`</h6>`
 * close tag. Without that guard the pattern can start at an unrelated heading
 * much earlier in a long document, skip forward to the FAQ heading, and bind the
 * `\1` level backreference to the WRONG heading - which was observed on the
 * 68,000-character property guide, where it matched from an early `<h3>` and
 * consumed the first question's `</h3>` as the heading close, yielding zero
 * question/answer pairs and silently dropping the FAQPage schema.
 */
const FAQ_HEADING_RE =
  /<h([2-4])[^>]*>(?:(?!<\/h[1-6]>)[\s\S])*?(?:Frequently Asked Questions?|Frequently Asked|FAQs?|Common Questions|Quick Answers)(?:(?!<\/h[1-6]>)[\s\S])*?<\/h\1>/i;

interface FaqHeading {
  text: string;
  start: number;
  end: number;
}

/**
 * Pull question/answer pairs out of a post's FAQ section.
 *
 * Supported markup: a heading containing "Frequently Asked Questions" (h2-h4)
 * followed by deeper sub-headings that are the questions, each followed by the
 * paragraph/list content that forms the answer.
 */
export function extractFaqs(html: string): FaqItem[] {
  const headingMatch = FAQ_HEADING_RE.exec(html);
  if (!headingMatch) return [];

  const faqLevel = Number(headingMatch[1]);
  let body = html.slice(headingMatch.index + headingMatch[0].length);

  // If the FAQ block is wrapped in a <section>, stop at its close so we never
  // absorb the following topic ("The Bottom Line", etc.).
  const nextSectionStart = body.search(/<section\b/i);
  const sectionClose = body.indexOf('</section>');
  if (sectionClose !== -1 && (nextSectionStart === -1 || sectionClose < nextSectionStart)) {
    body = body.slice(0, sectionClose);
  }

  const headings: FaqHeading[] = [];
  const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;

  while ((m = headingRe.exec(body)) !== null) {
    const level = Number(m[1]);
    const text = stripHtml(m[2]);
    if (!text) continue;
    // A heading at or above the FAQ level begins a new topic - stop there.
    if (level <= faqLevel) break;
    headings.push({ text, start: m.index, end: m.index + m[0].length });
  }

  const items: FaqItem[] = [];
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];
    const answer = stripHtml(body.slice(current.end, next ? next.start : body.length));
    if (!answer) continue;
    const question = current.text.replace(/\s*\?\s*$/, '').trim() + '?';
    items.push({ question, answer: truncate(answer, 600) });
  }

  // Google requires at least one pair; cap at 20 to keep the payload sane.
  return items.slice(0, 20);
}

/* ------------------------------------------------------------------ *
 * Answer-first extraction (AEO / "position zero" content)
 * ------------------------------------------------------------------ */

/**
 * Split an author-written excerpt into summary points.
 *
 * Accurate by construction: the excerpt is the author's own one-paragraph
 * summary, so its sentences can be presented as a summary without any risk of
 * misrepresenting the article.
 *
 * NOTE ON AVOIDED APPROACHES: earlier revisions tried to derive takeaways by
 * scraping `<li>` items, and by looking for headings such as "Key Points" or
 * "At a Glance". Both produced actively misleading output on this corpus - a
 * NAPLAN syllabus guide surfaced writing-assessment criteria from a deep
 * subsection, and a grammar guide surfaced its active/passive voice examples.
 * Markup alone cannot distinguish a summary list from a detail list. Authors who
 * want a bullet summary should set `keyTakeaways` explicitly on the post.
 *
 * Returns fewer than 2 points when the excerpt is a single sentence, in which
 * case the caller renders nothing rather than a one-item "summary".
 */
export function extractSummaryPoints(excerpt: string, max = 4): string[] {
  const points = excerpt
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => truncate(s.trim(), 170))
    .filter((s) => s.length > 25);

  return points.length >= 2 ? points.slice(0, max) : [];
}

/**
 * The article's direct answer, taken from the first substantive paragraph.
 * Surfacing this near the top matches the AEO guideline "lead each section with
 * a clear definition or direct answer to the user's question".
 */
export function extractLeadAnswer(html: string, maxWords = 55): string {
  const paragraphs = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) ?? [];
  for (const p of paragraphs) {
    const text = stripHtml(p);
    if (text.split(/\s+/).filter(Boolean).length < 20) continue;
    const words = text.split(/\s+/);
    return words.length > maxWords
      ? truncate(words.slice(0, maxWords).join(' '), 400)
      : text;
  }
  return '';
}

/**
 * Extract external URLs referenced in the body. Citing primary sources is a
 * core GEO trust signal, so we surface them explicitly in a "Sources" block.
 */
export function extractExternalLinks(html: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ url, text: stripHtml(m[2]) || url });
  }
  return out;
}

/**
 * NOTE: HowTo schema is deliberately NOT emitted for this corpus.
 *
 * An earlier revision derived steps from headings matching `Step N`, `N.` or a
 * `How to` title prefix. Inspection of the built JSON-LD showed the results were
 * factually wrong: numbered *arguments* ("NAPLAN Doesn't Test Reasoning"), topic
 * areas ("Number Theory", "Combinatorics") and question types ("Odd One Out")
 * were all emitted as procedural HowToSteps.
 *
 * Publishing incorrect HowTo markup is worse than publishing none - it can
 * trigger structured-data manual actions in Search Console and it feeds false
 * procedural claims to answer engines. Re-introduce HowTo only when a post has
 * genuinely authored, ordered steps (see `PostSchemaInput.steps`).
 */

