/**
 * Authoritative primary sources, mapped by blog category.
 *
 * Citing verifiable third-party sources is a core GEO trust signal: Perplexity
 * always cites, and Google AI Overviews favours pages that link to primary
 * authorities. A single generic list on every article reads as boilerplate, so
 * each category points at the bodies that actually govern its subject matter.
 *
 * Every URL below was verified to resolve to the named organisation.
 */

export interface AuthoritySource {
  name: string;
  url: string;
}

/** Always relevant to Australian school-assessment content. */
export const CORE_SOURCES: AuthoritySource[] = [
  { name: 'NAPLAN \u2013 Australian Curriculum, Assessment and Reporting Authority', url: 'https://www.nap.edu.au/' },
  { name: 'ACARA \u2013 Australian Curriculum', url: 'https://www.acara.edu.au/' },
];

/** Category-specific authorities, keyed by blog category slug. */
export const CATEGORY_SOURCES: Record<string, AuthoritySource[]> = {
  naplan: [
    { name: 'NAPLAN test format and sample questions (ACARA)', url: 'https://www.nap.edu.au/naplan' },
    { name: 'Australian Curriculum \u2013 English (F\u201310)', url: 'https://v9.australiancurriculum.edu.au/' },
    { name: 'Victorian Department of Education', url: 'https://www.vic.gov.au/education' },
  ],

  'scholarship-exams': [
    { name: 'ACER \u2013 Australian Council for Educational Research', url: 'https://www.acer.com/au' },
    { name: 'EduTest \u2013 scholarship and entrance testing', url: 'https://www.edutest.com.au/' },
  ],

  'selective-schools': [
    { name: 'NSW Selective High Schools and Opportunity Classes', url: 'https://education.nsw.gov.au/public-schools/selective-high-schools-and-opportunity-classes' },
    { name: 'Victorian Department of Education \u2013 selective entry', url: 'https://www.vic.gov.au/education' },
    { name: 'EduTest \u2013 Selective Entry High Schools (NSW & VIC)', url: 'https://www.edutest.com.au/' },
  ],

  'english-writing': [
    { name: 'Australian Curriculum \u2013 English', url: 'https://v9.australiancurriculum.edu.au/' },
    { name: 'ACARA \u2013 NAPLAN writing assessment', url: 'https://www.nap.edu.au/naplan' },
  ],

  'maths-olympiad': [
    { name: 'Australian Maths Trust \u2013 AMC and Mathematics Olympiad', url: 'https://www.amt.edu.au/' },
    { name: 'Australian Curriculum \u2013 Mathematics', url: 'https://v9.australiancurriculum.edu.au/' },
  ],

  'parenting-wellbeing': [
    { name: 'Bullying. No Way! \u2013 Australian schools bullying prevention', url: 'https://bullyingnoway.gov.au/' },
    { name: 'Kids Helpline \u2013 24/7 counselling for young people', url: 'https://kidshelpline.com.au/' },
    { name: 'headspace \u2013 youth mental health foundation', url: 'https://headspace.org.au/' },
    { name: 'Australian Bureau of Statistics \u2013 education and wellbeing data', url: 'https://www.abs.gov.au/' },
  ],
};

/**
 * Extra authorities for specific subject matter that crosses categories
 * (e.g. food allergy guidance appears in a parenting article).
 * Matched case-insensitively against the article's tags and title.
 */
const KEYWORD_SOURCES: { match: RegExp; sources: AuthoritySource[] }[] = [
  {
    match: /allerg|nut[- ]free|food|lunch/i,
    sources: [
      { name: 'ASCIA \u2013 Australasian Society of Clinical Immunology and Allergy', url: 'https://www.allergy.org.au/' },
      { name: 'Food Standards Australia New Zealand \u2013 allergen labelling', url: 'https://www.foodstandards.gov.au/' },
    ],
  },
  {
    match: /bully/i,
    sources: [{ name: 'Bullying. No Way! \u2013 Australian schools bullying prevention', url: 'https://bullyingnoway.gov.au/' }],
  },
  {
    match: /gifted|twice-exceptional|high ability/i,
    sources: [{ name: 'Australian Curriculum \u2013 gifted and talented guidance', url: 'https://www.acara.edu.au/' }],
  },
  {
    match: /property|suburb|house price|real estate/i,
    sources: [{ name: 'Australian Bureau of Statistics \u2013 housing and population data', url: 'https://www.abs.gov.au/' }],
  },
];

/**
 * Resolve the authoritative source list for an article.
 *
 * Order: subject-matter keyword matches, then category authorities, then core
 * sources. De-duplicated by URL and capped so the block stays readable.
 */
export function sourcesForArticle(opts: {
  categorySlug: string;
  text: string;
  limit?: number;
}): AuthoritySource[] {
  const limit = opts.limit ?? 6;
  const seen = new Set<string>();
  const out: AuthoritySource[] = [];

  const push = (source: AuthoritySource) => {
    if (seen.has(source.url)) return;
    seen.add(source.url);
    out.push(source);
  };

  for (const entry of KEYWORD_SOURCES) {
    if (entry.match.test(opts.text)) entry.sources.forEach(push);
  }

  for (const source of CATEGORY_SOURCES[opts.categorySlug] ?? []) push(source);
  for (const source of CORE_SOURCES) push(source);

  return out.slice(0, limit);
}
