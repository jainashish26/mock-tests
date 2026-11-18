/**
 * Blog taxonomy.
 *
 * Derived from the existing post `tags` so no content changes are required.
 * Categories give the blog a shallow, crawlable internal-linking structure
 * (Home > Blog > Category > Article), which helps both crawlers and AI engines
 * understand topical authority.
 */

export interface BlogCategory {
  /** URL-safe slug used in `/blog/category/[slug]`. */
  slug: string;
  /** Human-readable label. */
  name: string;
  /** One-sentence description used for metadata + schema. */
  description: string;
  /** Uppercase tag values that map into this category. */
  tags: string[];
}

export const BLOG_CATEGORIES: BlogCategory[] = [
  {
    slug: 'naplan',
    name: 'NAPLAN',
    description:
      'NAPLAN syllabus breakdowns, year-level preparation guides and result interpretation for Years 3, 5, 7 and 9.',
    tags: ['NAPLAN', 'NAPLAN PREPARATION', 'NAPLAN WRITING', 'LITERACY', 'NUMERACY',
      'YEAR 3', 'YEAR 5', 'YEAR 7', 'YEAR 9', 'PRIMARY SCHOOL', 'SECONDARY SCHOOL'],
  },
  {
    slug: 'scholarship-exams',
    name: 'Scholarship Exams',
    description:
      'Preparation guides for ACER, EduTest and AAS scholarship exams, including verbal, numerical and non-verbal reasoning.',
    tags: ['SCHOLARSHIP EXAMS', 'VERBAL REASONING', 'NON-VERBAL REASONING', 'NUMERICAL REASONING',
      'ABSTRACT REASONING', 'ACER', 'EDUTEST', 'AAS'],
  },
  {
    slug: 'selective-schools',
    name: 'Selective Schools',
    description:
      'Selective school entrance exam guides, SEAL program preparation, past papers and state entry requirements.',
    tags: ['SELECTIVE SCHOOL', 'SELECTIVE SCHOOLS', 'SEAL', 'SEAL PROGRAM', 'SELECTIVE ENTRY',
      'SCHOLARSHIP EXAMS', 'EXAM PREPARATION'],
  },
  {
    slug: 'english-writing',
    name: 'English & Writing',
    description:
      'Narrative and persuasive writing technique, grammar, literary devices, writing prompts and essay skills.',
    tags: ['CREATIVE WRITING', 'NARRATIVE WRITING', 'PERSUASIVE WRITING', 'WRITING PROMPTS',
      'WRITING SKILLS', 'GRAMMAR', 'ENGLISH GRAMMAR', 'ESSAY WRITING', 'ENGLISH TIPS',
      'ENGLISH LITERARY TECHNIQUES', 'FIGURATIVE LANGUAGE', 'TEXTUAL ANALYSIS', 'STUDY GUIDE'],
  },
  {
    slug: 'maths-olympiad',
    name: 'Maths & Olympiad',
    description:
      'Maths Olympiad preparation, mental maths, problem solving and mathematical reasoning for competition students.',
    tags: ['MATHS OLYMPIAD', 'PROBLEM SOLVING', 'MATHEMATICAL REASONING', 'MATHEMATICS', 'MATHS',
      'COMPETITION PREPARATION', 'MENTAL MATHS'],
  },
  {
    slug: 'parenting-wellbeing',
    name: 'Parenting & Wellbeing',
    description:
      'Practical guidance on child wellbeing, motivation, bullying, gifted learners and parent-school communication.',
    tags: ['PARENTING', 'WELLBEING', 'CHILD DEVELOPMENT', 'MENTAL HEALTH', 'BULLYING',
      'SCHOOL SAFETY', 'SCHOOL LIFE', 'COMMUNICATION', 'POSITIVE BEHAVIOUR',
      'SOCIAL-EMOTIONAL LEARNING', 'GIFTED EDUCATION', 'TWICE-EXCEPTIONAL'],
  },
];

const TAG_TO_CATEGORY = new Map<string, BlogCategory>();
for (const category of BLOG_CATEGORIES) {
  for (const tag of category.tags) {
    // First mapping wins, so more specific categories listed earlier take
    // precedence over broader ones.
    if (!TAG_TO_CATEGORY.has(tag)) TAG_TO_CATEGORY.set(tag, category);
  }
}

/**
 * Resolve the best-fit category for a post from its tags.
 * Falls back to the first category when nothing matches so every post has a
 * parent hub to link back to.
 */
export function deriveCategory(tags?: string[] | null): BlogCategory {
  if (!tags || tags.length === 0) return BLOG_CATEGORIES[0];

  const counts = new Map<string, number>();
  for (const rawTag of tags) {
    const category = TAG_TO_CATEGORY.get(rawTag.trim().toUpperCase());
    if (!category) continue;
    counts.set(category.slug, (counts.get(category.slug) ?? 0) + 1);
  }
  if (counts.size === 0) return BLOG_CATEGORIES[0];

  // Highest tag-match count wins; ties broken by category declaration order.
  let best = BLOG_CATEGORIES[0];
  let bestScore = -1;
  for (const category of BLOG_CATEGORIES) {
    const score = counts.get(category.slug) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

/** Find a category by slug. */
export function getCategoryBySlug(slug: string): BlogCategory | undefined {
  return BLOG_CATEGORIES.find((c) => c.slug === slug);
}

/** Convert an arbitrary tag into a URL-safe query value. */
export function tagToQuery(tag: string): string {
  return encodeURIComponent(tag.trim().toLowerCase());
}
