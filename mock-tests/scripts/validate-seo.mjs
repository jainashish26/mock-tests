/**
 * Build-output SEO validator (development tool, not part of the app).
 *
 * Parses the prerendered HTML in .next/server/app and asserts the SEO, GEO and
 * AEO artefacts are present and well-formed: JSON-LD parses and carries the
 * expected @types, FAQPage pairs were extracted from article markup, canonical
 * and Open Graph tags are emitted, and breadcrumbs / key takeaways / TOC exist
 * in the server-rendered HTML.
 *
 * Run with:  node scripts/validate-seo.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(process.cwd(), ".next", "server", "app");
const BLOG_DIR = join(APP_DIR, "blog");

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) passed++;
  else { failed++; failures.push(label + (detail ? " -> " + detail : "")); }
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">");
    try { blocks.push(JSON.parse(raw)); }
    catch (err) { blocks.push({ __parseError: err.message, __raw: raw.slice(0, 160) }); }
  }
  return blocks;
}

function nodes(block) {
  if (block.__parseError) return [];
  return Array.isArray(block["@graph"]) ? block["@graph"] : [block];
}

/**
 * Collect every `@type` in a document, recursing into nested properties.
 *
 * Schema.org routinely nests nodes (Product > Offer, FAQPage > Question,
 * WebSite > SearchAction), so a top-level-only scan would report false
 * negatives for perfectly valid markup.
 */
function collectTypes(html) {
  const types = new Set();

  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const t = value['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => types.add(x));
    for (const key of Object.keys(value)) {
      if (key === '@type') continue;
      walk(value[key]);
    }
  };

  for (const block of extractJsonLd(html)) walk(block);
  return types;
}

function allNodesOf(html) {
  return extractJsonLd(html).flatMap(nodes);
}

function metaContent(html, selector) {
  const re = new RegExp("<meta[^>]+(?:name|property)=\"" + selector + "\"[^>]*content=\"([^\"]*)\"", "i");
  const m = html.match(re);
  return m ? m[1] : null;
}

function linkHref(html, rel) {
  const m = html.match(new RegExp("<link[^>]+rel=\"" + rel + "\"[^>]*href=\"([^\"]*)\"", "i"));
  return m ? m[1] : null;
}

function readIf(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/**
 * Remove HTML comments. React inserts `<!-- -->` between adjacent text nodes and
 * expressions, so `All {n} guides` renders as `All <!-- -->50<!-- --> guides`.
 * Stripping them lets text assertions match the real user-visible copy.
 */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Decode HTML entities so attribute lengths reflect the real text. */
function decodeAttr(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&hellip;/g, "\u2026");
}
console.log("\n=== MockTests Pro SEO / GEO / AEO build validation ===\n");
check("build output exists", existsSync(APP_DIR));

// ---- 1. Blog post pages -------------------------------------------------
const postFiles = existsSync(BLOG_DIR) ? readdirSync(BLOG_DIR).filter((f) => f.endsWith(".html")) : [];
console.log("Blog post HTML files found: " + postFiles.length);
check("at least 50 blog posts prerendered", postFiles.length >= 50, String(postFiles.length));

let withFaq = 0, totalFaqPairs = 0, totalTocLinks = 0, minWords = Infinity, maxWords = 0, withTakeaways = 0;
const parseErrors = [];

for (const file of postFiles) {
  const html = readFileSync(join(BLOG_DIR, file), "utf8");
  const blocks = extractJsonLd(html);
  for (const b of blocks) if (b.__parseError) parseErrors.push(file + ": " + b.__parseError + " | " + b.__raw);

  const types = collectTypes(html);
  const list = allNodesOf(html);
  const article = list.find((n) => n["@type"] === "BlogPosting");
  const faq = list.find((n) => n["@type"] === "FAQPage");
  const crumb = list.find((n) => n["@type"] === "BreadcrumbList");
  const webpage = list.find((n) => n["@type"] === "WebPage");

  if (faq && faq.mainEntity && faq.mainEntity.length) { withFaq++; totalFaqPairs += faq.mainEntity.length; }

  const slug = file.replace(/\.html$/, "");
  check(slug + ": BlogPosting", Boolean(article));
  check(slug + ": BreadcrumbList", Boolean(crumb));
  check(slug + ": WebPage", Boolean(webpage));

  // HowTo must NOT be emitted: it is only ever produced from author-supplied
  // steps, and no post in this corpus has them. Auto-derived HowTo previously
  // emitted arguments and topic areas as procedural steps.
  check(slug + ": no auto-derived HowTo", !types.has("HowTo"), [...types].join(","));

  if (article) {
    const dp = article.datePublished || "";
    const dm = article.dateModified || "";
    check(slug + ": datePublished ISO", /^\d{4}-\d{2}-\d{2}T/.test(dp), dp);
    check(slug + ": dateModified ISO", /^\d{4}-\d{2}-\d{2}T/.test(dm), dm);
    check(slug + ": author name", Boolean(article.author && article.author.name), JSON.stringify(article.author));
    check(slug + ": author credentials", Boolean(article.author && Array.isArray(article.author.knowsAbout) && article.author.knowsAbout.length > 0));
    check(slug + ": publisher ref", Boolean(article.publisher && article.publisher["@id"]));
    check(slug + ": image url", Boolean(article.image && article.image.url));
    check(slug + ": wordCount > 200", typeof article.wordCount === "number" && article.wordCount > 200, String(article.wordCount));
    check(slug + ": timeRequired", /^PT\d+M$/.test(article.timeRequired || ""), String(article.timeRequired));
    check(slug + ": headline <= 110", (article.headline || "").length <= 110, (article.headline || "").length + " chars");
    check(slug + ": speakable", Boolean(article.speakable));
    check(slug + ": abstract (lead answer)", Boolean(article.abstract));
    check(slug + ": articleSection", Boolean(article.articleSection));
    check(slug + ": keywords", Boolean(article.keywords));
    check(slug + ": citation sources", Array.isArray(article.citation) && article.citation.length > 0,
      String((article.citation || []).length));
    if (typeof article.wordCount === "number") { minWords = Math.min(minWords, article.wordCount); maxWords = Math.max(maxWords, article.wordCount); }
  }

  const canonical = linkHref(html, "canonical");
  check(slug + ": canonical absolute", /^https:\/\/mocktestspro\.com\.au\/blog\//.test(canonical || ""), String(canonical));
  check(slug + ": og:title", Boolean(metaContent(html, "og:title")));
  check(slug + ": og:image", Boolean(metaContent(html, "og:image")), String(metaContent(html, "og:image")));
  check(slug + ": og:type=article", metaContent(html, "og:type") === "article", String(metaContent(html, "og:type")));
  const apt = metaContent(html, "article:published_time") || "";
  check(slug + ": article:published_time ISO", /^\d{4}-\d{2}-\d{2}T/.test(apt), apt);
  // Measure the decoded text, not the raw attribute: HTML entity encoding
  // (e.g. &#x27;) inflates the raw length without affecting what Google sees.
  const desc = decodeAttr(metaContent(html, "description") || "");
  check(slug + ": description 50-165 chars", desc.length >= 50 && desc.length <= 165, desc.length + " chars");
  check(slug + ": robots index,follow", /index/.test(metaContent(html, "robots") || "") && /follow/.test(metaContent(html, "robots") || ""), String(metaContent(html, "robots")));

  check(slug + ": breadcrumb nav", /aria-label="Breadcrumb"/.test(html));
  check(slug + ": h1", /<h1[^>]*>/.test(html));
  check(slug + ": lead answer block", /data-speakable="lead"/.test(html));
  // Not every article has an authored summary or a multi-sentence excerpt;
  // omitting the block is correct behaviour, so this is measured not asserted.
  if (/Key takeaways|In summary/.test(html)) withTakeaways++;
  check(slug + ": author card", /authorCredentials|About /.test(html));
  check(slug + ": related reading", /Related reading/.test(html));
  check(slug + ": editorial note", /Fact-checked against primary sources/.test(html));
  check(slug + ": sources block rendered", /Sources (&amp;|&) authoritative references/.test(html));
  const ogImg = metaContent(html, "og:image") || "";
  check(slug + ": og:image is generated card", /\/opengraph-image/.test(ogImg), ogImg);
  check(slug + ": og:image absolute", /^https:\/\//.test(ogImg), ogImg);
  check(slug + ": no boilerplate bio", !/dedicated to helping students/.test(html));
  check(slug + ": time element with dateTime", /<time dateTime="\d{4}-\d{2}-\d{2}"/.test(html));

  const tocLinks = (html.match(/tocLink/g) || []).length;
  totalTocLinks += tocLinks;
  check(slug + ": TOC rendered", tocLinks > 0, tocLinks + " links");
  const headingIds = (html.match(/<h[23][^>]*\bid="/g) || []).length;
  check(slug + ": heading ids injected", headingIds > 3, headingIds + " ids");
}

check("no JSON-LD parse errors", parseErrors.length === 0, parseErrors.slice(0, 3).join(" ; "));

console.log("\nPosts with FAQPage schema : " + withFaq + "/" + postFiles.length);
console.log("Posts with summary block  : " + withTakeaways + "/" + postFiles.length);
console.log("Total FAQ Q&A pairs       : " + totalFaqPairs);
console.log("Total TOC links rendered  : " + totalTocLinks);
console.log("Word count range          : " + minWords + " - " + maxWords);
// ---- 2. Blog index ------------------------------------------------------
const blogIndex = readIf(join(APP_DIR, "blog.html"));
if (blogIndex) {
  const types = collectTypes(blogIndex);
  check("blog index: CollectionPage", types.has("CollectionPage"));
  check("blog index: Blog", types.has("Blog"));
  check("blog index: ItemList", types.has("ItemList"));
  const bc = linkHref(blogIndex, "canonical");
  check("blog index: canonical", bc === "https://mocktestspro.com.au/blog", String(bc));
  check("blog index: og:title", Boolean(metaContent(blogIndex, "og:title")), String(metaContent(blogIndex, "og:title")));
  check("blog index: description > 50", (metaContent(blogIndex, "description") || "").length > 50);
  check("blog index: category hub links", /\/blog\/category\/naplan/.test(blogIndex));
  check("blog index: plain article index", /All \d+ guides/.test(stripComments(blogIndex)));
  const links = new Set((blogIndex.match(/href="\/blog\/[a-z0-9-]+"/g) || []));
  check("blog index: 50+ unique article links", links.size >= 50, links.size + " unique links");
} else { check("blog index html exists", false); }

// ---- 3. Category hubs ---------------------------------------------------
const catDir = join(BLOG_DIR, "category");
if (existsSync(catDir)) {
  const catFiles = readdirSync(catDir).filter((f) => f.endsWith(".html"));
  check("category hubs generated", catFiles.length >= 5, catFiles.length + " files");
  for (const file of catFiles) {
    const html = readFileSync(join(catDir, file), "utf8");
    const types = collectTypes(html);
    const name = file.replace(/\.html$/, "");
    check("category " + name + ": CollectionPage", types.has("CollectionPage"));
    check("category " + name + ": BreadcrumbList", types.has("BreadcrumbList"));
    check("category " + name + ": canonical", linkHref(html, "canonical") === "https://mocktestspro.com.au/blog/category/" + name, String(linkHref(html, "canonical")));
    check("category " + name + ": h1", /<h1[^>]*>/.test(html));
    check("category " + name + ": article links", (html.match(/href="\/blog\/[a-z0-9-]+"/g) || []).length > 0);
  }
} else { check("category dir exists", false); }

// ---- 4. Crawl infrastructure -------------------------------------------
const robots = readIf(join(APP_DIR, "robots.txt.body"));
check("robots: sitemap directive", /Sitemap:.*sitemap\.xml/.test(robots));
for (const bot of ["GPTBot", "OAI-SearchBot", "PerplexityBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "Googlebot", "Bingbot"]) {
  check("robots: names " + bot, robots.includes(bot));
}
for (const blocked of ["/admin/", "/creator/", "/api/", "/student/", "/parent/", "/tutor/"]) {
  check("robots: disallows " + blocked, robots.includes("Disallow: " + blocked));
}

const sitemap = readIf(join(APP_DIR, "sitemap.xml.body"));
const sitemapUrls = (sitemap.match(/<loc>/g) || []).length;
check("sitemap: 60+ URLs", sitemapUrls >= 60, sitemapUrls + " URLs");
check("sitemap: ISO lastmod", /<lastmod>\d{4}-\d{2}-\d{2}/.test(sitemap));
check("sitemap: no auth URLs", !sitemap.includes("/auth/"));
check("sitemap: includes category hubs", sitemap.includes("/blog/category/"));
check("sitemap: no Invalid Date", !/NaN|Invalid/.test(sitemap));

const llms = readIf(join(APP_DIR, "llms.txt.body"));
check("llms.txt: generated", llms.length > 1000, llms.length + " bytes");
check("llms.txt: title heading", /^# MockTests Pro$/m.test(llms));
const llmsEntries = (llms.match(/^- \[/gm) || []).length;
check("llms.txt: 55+ entries", llmsEntries >= 55, llmsEntries + " entries");
check("llms.txt: cites nap.edu.au", llms.includes("nap.edu.au"));
check("llms.txt: cites ACARA", llms.includes("ACARA") || llms.includes("acara.edu.au"));
check("llms.txt: has category sections", (llms.match(/^## /gm) || []).length >= 8);

const manifest = readIf(join(APP_DIR, "manifest.webmanifest.body"));
check("manifest: icon-192 referenced", manifest.includes("icon-192.png"));
check("manifest: icon-512 generated", existsSync(join(APP_DIR, "icon-512.png.body")));
check("manifest: icon-192 generated", existsSync(join(APP_DIR, "icon-192.png.body")));
check("opengraph-image generated", existsSync(join(APP_DIR, "opengraph-image.body")));

// ---- 4b. Static marketing pages ----------------------------------------
const STATIC_PAGES = [
  { file: "about.html", path: "/about", expectTypes: ["AboutPage", "Organization"] },
  { file: "features.html", path: "/features", expectTypes: ["WebPage", "Service", "OfferCatalog"] },
  { file: "tests.html", path: "/tests", expectTypes: ["Product", "Offer", "Brand"] },
  { file: "free.html", path: "/free", expectTypes: ["FAQPage", "Question", "Answer"] },
  // "Offer" is intentionally not asserted here: offers are only emitted once the
  // Stripe subscription prices exist, so requiring them would fail the suite on
  // any machine without Stripe keys configured.
  { file: "pricing.html", path: "/pricing", expectTypes: ["Product", "FAQPage", "Question", "Answer"] },
];

for (const page of STATIC_PAGES) {
  const html = readIf(join(APP_DIR, page.file));
  check(page.path + ": html generated", html.length > 0);
  if (!html) continue;

  const types = collectTypes(html);
  for (const t of page.expectTypes) {
    check(page.path + ": schema " + t, types.has(t), [...types].join(","));
  }
  const canonical = linkHref(html, "canonical");
  check(page.path + ": canonical", canonical === "https://mocktestspro.com.au" + page.path, String(canonical));
  const title = metaContent(html, "og:title") || "";
  check(page.path + ": og:title present", title.length > 10, title);
  const pageDesc = decodeAttr(metaContent(html, "description") || "");
  check(page.path + ": description 50-160", pageDesc.length >= 50 && pageDesc.length <= 160, pageDesc.length + " chars");
  check(page.path + ": h1 present", /<h1[^>]*>/.test(html));
}

// The free page must show the same questions it declares in FAQPage schema.
const freeHtml = readIf(join(APP_DIR, "free.html"));
if (freeHtml) {
  const faqNode = allNodesOf(freeHtml).find((n) => n["@type"] === "FAQPage");
  const questions = (faqNode && faqNode.mainEntity ? faqNode.mainEntity : []).map((q) => q.name);
  check("free: FAQPage has 4+ questions", questions.length >= 4, questions.length + " questions");
  // Every declared question must be visible in the page markup.
  const missing = questions.filter((q) => !freeHtml.includes(q.replace(/&/g, "&amp;")) && !freeHtml.includes(q));
  check("free: all FAQ questions visible on page", missing.length === 0, missing.slice(0, 2).join(" | "));
}

// ---- 4c. No dead internal links in the footer ---------------------------
// `/blog/ai-writing` never existed; it was linked from the site-wide footer.
for (const file of ["index.html", "about.html", "blog.html"]) {
  const html = readIf(join(APP_DIR, file));
  if (!html) continue;
  check(file + ": no /blog/ai-writing dead link", !html.includes("/blog/ai-writing"));
  check(file + ": no href='#' social placeholders", !html.includes('href="#"'));
}

// ---- 5. Home page -------------------------------------------------------
const home = readIf(join(APP_DIR, "index.html"));
if (home) {
  const types = collectTypes(home);
  check("home: Organization", types.has("Organization"));
  check("home: WebSite", types.has("WebSite"));
  check("home: SearchAction", types.has("SearchAction"));
  check("home: SiteNavigationElement", types.has("SiteNavigationElement"));
  check("home: lang=en-AU", /<html[^>]+lang="en-AU"/.test(home));
  check("home: canonical", /^https:\/\/mocktestspro\.com\.au\/?$/.test(linkHref(home, "canonical") || ""), String(linkHref(home, "canonical")));
  check("home: og:image", Boolean(metaContent(home, "og:image")), String(metaContent(home, "og:image")));
  check("home: og:site_name", metaContent(home, "og:site_name") === "MockTests Pro");
}

// ---- 6. Site-wide JSON-LD validity sweep --------------------------------
// Catches the class of bug where multiple JSON-LD documents get concatenated
// into one <script>, producing unparseable markup that silently loses ALL
// structured data on a page.
function walkHtml(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const allHtml = walkHtml(APP_DIR);
let scriptCount = 0;
const invalid = [];
for (const file of allHtml) {
  const html = readFileSync(file, 'utf8');
  const scripts = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  for (const s of scripts) {
    scriptCount++;
    const raw = s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '').replace(/\\u003c/g, '<').replace(/\\u003e/g, '>');
    try { JSON.parse(raw); }
    catch (err) { invalid.push(file.replace(APP_DIR, '') + ' :: ' + err.message + ' :: ' + raw.slice(0, 100)); }
  }
}

console.log('\nHTML documents scanned    : ' + allHtml.length);
console.log('JSON-LD script tags found : ' + scriptCount);
check('every JSON-LD script parses as valid JSON', invalid.length === 0,
  invalid.slice(0, 3).join(' | '));
check('JSON-LD emitted on 50+ documents', scriptCount >= 50, scriptCount + ' scripts');

// ---- 7. Editorial date schedule ----------------------------------------
// Requirement: unique publication dates three days apart starting 1 August 2026,
// with updatedDate exactly two days after publication.
const START = Date.UTC(2026, 7, 1);
const DAY = 86400000;
const seenPublished = new Map();
const dateErrors = [];

for (const file of postFiles) {
  const html = readFileSync(join(BLOG_DIR, file), 'utf8');
  const article = allNodesOf(html).find((n) => n['@type'] === 'BlogPosting');
  const slug = file.replace(/\.html$/, '');
  if (!article) continue;

  const pub = String(article.datePublished || '').slice(0, 10);
  const mod = String(article.dateModified || '').slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pub)) dateErrors.push(slug + ': bad datePublished ' + pub);
  if (seenPublished.has(pub)) dateErrors.push(slug + ': duplicate ' + pub + ' (also ' + seenPublished.get(pub) + ')');
  seenPublished.set(pub, slug);

  const pubMs = Date.parse(pub + 'T00:00:00Z');
  const modMs = Date.parse(mod + 'T00:00:00Z');
  if (Number.isNaN(pubMs) || Number.isNaN(modMs)) {
    dateErrors.push(slug + ': unparseable date ' + mod);
  } else {
    const diffDays = Math.round((modMs - pubMs) / DAY);
    if (diffDays !== 2) dateErrors.push(slug + ': updatedDate is +' + diffDays + ' days, expected +2');
  }

  const plain = html.replace(/<!--[\s\S]*?-->/g, '');
  check(slug + ': shows Updated label', /Updated\s*<time/.test(plain));
  check(slug + ': dateModified differs from datePublished', mod !== pub, mod + ' vs ' + pub);
}

// Every published date must land exactly on the 3-day grid from 1 Aug 2026.
for (const [pub, slug] of seenPublished) {
  const ms = Date.parse(pub + 'T00:00:00Z');
  if (Number.isNaN(ms)) { dateErrors.push(slug + ': unparseable ' + pub); continue; }
  if (ms < START) { dateErrors.push(slug + ': ' + pub + ' is before 1 Aug 2026'); continue; }
  const steps = (ms - START) / DAY;
  if (!Number.isInteger(steps) || steps % 3 !== 0) {
    dateErrors.push(slug + ': ' + pub + ' not on the 3-day grid (' + steps + ' days)');
  }
}

const sortedDates = [...seenPublished.keys()].sort();
console.log('\nPublication date range  : ' + sortedDates[0] + '  to  ' + sortedDates[sortedDates.length - 1]);
console.log('Unique published dates  : ' + seenPublished.size + '/' + postFiles.length);
check('all publication dates unique', seenPublished.size === postFiles.length, seenPublished.size + ' unique');
check('date schedule spans 1 Aug to 26 Dec 2026',
  sortedDates[0] === '2026-08-01' && sortedDates[sortedDates.length - 1] === '2026-12-26',
  sortedDates[0] + ' .. ' + sortedDates[sortedDates.length - 1]);
check('date schedule has no errors', dateErrors.length === 0, dateErrors.slice(0, 4).join(' | '));

// ---- 8. Full AEO coverage ----------------------------------------------
// Every article now has an authored FAQ section and authored keyTakeaways.
check('every post has FAQPage schema', withFaq === postFiles.length, withFaq + '/' + postFiles.length);
check('every post has a summary block', withTakeaways === postFiles.length, withTakeaways + '/' + postFiles.length);
check('FAQ pairs total >= 280', totalFaqPairs >= 280, String(totalFaqPairs));

// ---- 9. Legal / trust pages --------------------------------------------
const LEGAL_PAGES = [
  { file: 'privacy-policy.html', path: '/privacy-policy', types: ['BreadcrumbList'],
    needles: ['DeepSeek', 'Stripe', 'Supabase', 'Australian Privacy Principles', 'Notifiable Data Breaches'] },
  { file: 'terms.html', path: '/terms', types: ['BreadcrumbList'],
    needles: ['Australian Consumer Law', 'AI-generated writing feedback', 'Refunds'] },
  { file: 'contact.html', path: '/contact', types: ['BreadcrumbList', 'ContactPage', 'FAQPage'],
    needles: ['privacy@mocktestspro.com.au', 'support@mocktestspro.com.au'] },
];

for (const page of LEGAL_PAGES) {
  const html = readIf(join(APP_DIR, page.file));
  check(page.path + ': generated', html.length > 0);
  if (!html) continue;

  const types = collectTypes(html);
  for (const t of page.types) check(page.path + ': schema ' + t, types.has(t), [...types].join(','));
  check(page.path + ': canonical',
    linkHref(html, 'canonical') === 'https://mocktestspro.com.au' + page.path,
    String(linkHref(html, 'canonical')));
  check(page.path + ': h1', /<h1[^>]*>/.test(html));
  check(page.path + ': last-updated shown', /Last updated/.test(html));
  const pd = decodeAttr(metaContent(html, 'description') || '');
  check(page.path + ': description 50-160', pd.length >= 50 && pd.length <= 160, pd.length + ' chars');
  for (const needle of page.needles) {
    check(page.path + ': covers ' + JSON.stringify(needle), html.includes(needle));
  }
}

// Every public page footer must reach the legal pages.
for (const file of ['index.html', 'blog.html', 'about.html', 'free.html']) {
  const html = readIf(join(APP_DIR, file));
  if (!html) continue;
  check(file + ': links /privacy-policy', html.includes('/privacy-policy'));
  check(file + ': links /terms', html.includes('/terms'));
  check(file + ': links /contact', html.includes('/contact'));
}

const homeForContact = readIf(join(APP_DIR, 'index.html'));
if (homeForContact) {
  const org = allNodesOf(homeForContact).find((n) => n['@type'] === 'Organization');
  check('Organization: has contactPoint email',
    Boolean(org && org.contactPoint && org.contactPoint.email),
    JSON.stringify(org && org.contactPoint));
}

// ---- 10. Content encoding hygiene ---------------------------------------
// Double-encoded UTF-8 was present in 14 source files and repaired. Assert the
// built HTML is clean so garbled maths symbols never reach a reader or an AI
// engine that is extracting content.
const MOJIBAKE = [
  '\u00c3\u00a9', '\u00c3\u00b7', '\u00c2\u00bd', '\u00c2\u00bc', '\u00c2\u00be',
  '\u00c2\u00b1', '\u00c2\u00b0', '\u00c2\u00b2', '\u00c2\u00b3', '\u00c5\u2018',
  '\u2020\u2019', '\u02c6\u2019', '\u2030\u02c6', '\u02dc\u0090', '\u00c3\u002d',
];
const mojibakeFiles = [];
for (const file of allHtml) {
  const html = readFileSync(file, 'utf8');
  const hits = MOJIBAKE.filter((seq) => html.includes(seq));
  if (hits.length) mojibakeFiles.push(file.replace(APP_DIR, '') + ':' + hits.length);
}
check('no mojibake in built HTML', mojibakeFiles.length === 0, mojibakeFiles.slice(0, 4).join(' | '));

// ---- 11. FAQ schema must match visible content --------------------------
// Google requires FAQPage markup to correspond to content the user can actually
// see. Verify every declared question appears in the rendered HTML of its page.
function entityVariants(s) {
  return [
    s,
    s.replace(/&/g, '&amp;'),
    s.replace(/'/g, '&#x27;'),
    s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'),
    s.replace(/"/g, '&quot;'),
  ];
}

let faqPagesChecked = 0;
let faqQuestionsChecked = 0;
const faqMismatches = [];

for (const file of allHtml) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes('"@type":"FAQPage"')) continue;
  faqPagesChecked++;

  const visible = stripComments(html);
  for (const node of allNodesOf(html)) {
    if (node['@type'] !== 'FAQPage' || !Array.isArray(node.mainEntity)) continue;
    for (const q of node.mainEntity) {
      faqQuestionsChecked++;
      const name = String(q.name || '');
      const found = entityVariants(name).some((v) => visible.includes(v));
      if (!found) {
        faqMismatches.push(file.replace(APP_DIR, '') + ' :: ' + name.slice(0, 70));
      }
      const answer = String((q.acceptedAnswer && q.acceptedAnswer.text) || '');
      check('FAQ answer non-empty (' + name.slice(0, 30) + ')', answer.length > 40, answer.length + ' chars');
    }
  }
}

console.log('\nPages with FAQPage schema: ' + faqPagesChecked);
console.log('FAQ questions verified   : ' + faqQuestionsChecked);
check('every FAQPage question is visible on its page', faqMismatches.length === 0,
  faqMismatches.slice(0, 4).join(' | '));

// ---- Report -------------------------------------------------------------
console.log("\n" + "-".repeat(64));
console.log("PASSED: " + passed);
console.log("FAILED: " + failed);
if (failures.length) {
  console.log("\nFailures (first 30):");
  failures.slice(0, 30).forEach((f) => console.log("  x " + f));
}
console.log("-".repeat(64) + "\n");
process.exit(failed > 0 ? 1 : 0);