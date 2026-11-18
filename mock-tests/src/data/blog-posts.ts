// Imported directly (not via the `@/lib/seo` barrel) to avoid a circular
// dependency: the barrel re-exports `post-seo`, which type-imports this file.
import { toIsoDate } from "@/lib/seo/content-utils";
import { deriveCategory } from "@/lib/seo/categories";

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  image: string;
  imageAlt?: string;
  /** Display date, e.g. "March 30, 2026". Normalised to ISO by `derivePostSeo`. */
  date: string;
  /**
   * Display date of the most recent substantive revision. Drives
   * `dateModified` in schema and the "Updated" label on page. Omit for posts
   * that have never been revised.
   */
  updatedDate?: string;
  tags: string[];
  /** Optional explicit category slug; auto-derived from tags when omitted. */
  category?: string;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
  /** Optional override; computed from word count when omitted. */
  readingTime?: number;
  /**
   * Author-written bullet summary rendered as the "Key takeaways" block and
   * used for schema `about` hints.
   *
   * Keep to 3-6 short bullets (each under ~170 characters). This is never
   * auto-generated: deriving bullets from article markup produced misleading
   * summaries, so an article without this field simply renders no takeaway block.
   */
  keyTakeaways?: string[];
  author: {
    name: string;
    role: string;
    avatar?: string;
  };
}


import { waysToAskHowWasSchool } from "./posts/10-ways-asking-how-was-school";
import { narrativeWritingPrompts } from "./posts/52-narrative-writing-prompts";
import { persuasiveWritingPrompts } from "./posts/52-persuasive-writing-prompts";
import { topVictoriaSuburbsSchoolsPropertyGuide } from "./posts/best-suburbs-victoria-schools-property-guide";
import { bullyingInSchools } from "./posts/bullying-in-schools-tips-tools";
import { commonWritingMistakes } from "./posts/common-writing-mistakes-students-guide";
import { positiveBehaviourWellbeing } from "./posts/cultivating-positive-behaviour-wellbeing";
import { doesNaplanScoreInfluencePrivateSchoolScholarship } from "./posts/does-naplan-score-influence-private-school-scholarship";
import { englishWritingTipsDosAndDontsNarrativeWriting } from "./posts/dos-and-donts-of-narrative-writing";
import { englishWritingTipsDosAndDontsPersuasiveWriting } from "./posts/dos-and-donts-of-persuasive-writing";
import { englishBooksPrimarySchoolGuide } from "./posts/english-books-guide-primary-school-students";
import { englishBooksSecondarySchoolGuide } from "./posts/english-books-guide-secondary-school-students";
import { englishGrammarToolkit } from "./posts/english-grammar-toolkit-complete-guide";
import { englishLiteraryTechniques } from "./posts/english-literary-techniques-complete-guide";
import { expertTipsMathsOlympiadPreparationAustralia } from "./posts/expert-tips-maths-olympiad-preparation-australia";
import { giftedStudents } from "./posts/gifted-students-signs-strategies";
import { howToInterpretNaplanResultsWhatDataTellsYou } from "./posts/how-to-interpret-naplan-results-what-data-tells-you";
import { howToMasterAasExams } from "./posts/how-to-master-aas-exams";
import { howToMasterAcerExams } from "./posts/how-to-master-acer-exams";
import { howToMasterEdutestExams } from "./posts/how-to-master-edutest-exams";
import { howToMasterSealProgramExams } from "./posts/how-to-master-seal-program-exams";
import { howToMaximiseBenefitsParentTeacherInterviews } from "./posts/how-to-maximise-benefits-parent-teacher-interviews";
import { importanceOfMentalMathsHowToImprove } from "./posts/importance-of-mental-maths-how-to-improve";
import { nonVerbalReasoningScholarship } from "./posts/improve-non-verbal-reasoning-scholarship-exams";
import { numericalReasoningScholarship } from "./posts/improve-numerical-reasoning-scholarship-exams";
import { mathsOlympiadProblemSolving } from "./posts/improve-problem-solving-maths-olympiad";
import { verbalReasoningScholarship } from "./posts/improve-verbal-reasoning-scholarship-exams";
import { linkBetweenScholarshipAndNaplanResults } from "./posts/link-between-scholarship-and-naplan-results";
import { mathsBooksPrimarySchoolGuide } from "./posts/maths-books-guide-primary-school-students";
import { mathsBooksSecondarySchoolGuide } from "./posts/maths-books-guide-secondary-school-students";
import { melbourneSelectiveSchoolEntryExamPastPapers } from "./posts/melbourne-selective-school-entry-exam-past-papers";
import { naplanPreparationBestTipsAndActivities } from "./posts/naplan-preparation-best-tips-and-activities";
import { naplanYear3EnglishPreparationGuide } from "./posts/naplan-year-3-english-preparation-guide";
import { naplanYear3MathsPreparationGuide } from "./posts/naplan-year-3-maths-preparation-guide";
import { naplanYear3Syllabus2026 } from "./posts/naplan-year-3-syllabus-2026";
import { naplanYear5EnglishPreparationGuide } from "./posts/naplan-year-5-english-preparation-guide";
import { naplanYear5MathsPreparationGuide } from "./posts/naplan-year-5-maths-preparation-guide";
import { naplanYear5Syllabus2026 } from "./posts/naplan-year-5-syllabus-2026";
import { naplanYear7EnglishPreparationGuide } from "./posts/naplan-year-7-english-preparation-guide";
import { naplanYear7MathsPreparationGuide } from "./posts/naplan-year-7-maths-preparation-guide";
import { naplanYear7Syllabus2026 } from "./posts/naplan-year-7-syllabus-2026";
import { naplanYear9EnglishPreparationGuide } from "./posts/naplan-year-9-english-preparation-guide";
import { naplanYear9MathsPreparationGuide } from "./posts/naplan-year-9-maths-preparation-guide";
import { naplanYear9Syllabus2026 } from "./posts/naplan-year-9-syllabus-2026";
import { reasonsPreviouslyMotivatedChildNotPerformingWellSchool } from "./posts/reasons-previously-motivated-child-not-performing-well-school";
import { schoolLunchIdeasAllergyFreeVegetarianFamilies } from "./posts/school-lunch-ideas-allergy-free-vegetarian-families";
import { selectiveScholarshipExamTypesEduTestAcerAas } from "./posts/selective-scholarship-exam-types-edutest-acer-aas";
import { selectiveSchoolEntranceExamVictoriaGuide } from "./posts/selective-school-entrance-exam-victoria-complete-guide-2026";
import { victorianSelectiveSchools4Percent10PercentCapsExplained } from "./posts/victorian-selective-schools-4-percent-10-percent-caps-explained";
import { whyNaplanIsImportantForYourChildsFuture } from "./posts/why-naplan-is-important-for-your-childs-future";

const allPosts: BlogPost[] = [
  waysToAskHowWasSchool,
  narrativeWritingPrompts,
  persuasiveWritingPrompts,
  topVictoriaSuburbsSchoolsPropertyGuide,
  bullyingInSchools,
  commonWritingMistakes,
  positiveBehaviourWellbeing,
  doesNaplanScoreInfluencePrivateSchoolScholarship,
  englishWritingTipsDosAndDontsNarrativeWriting,
  englishWritingTipsDosAndDontsPersuasiveWriting,
  englishBooksPrimarySchoolGuide,
  englishBooksSecondarySchoolGuide,
  englishGrammarToolkit,
  englishLiteraryTechniques,
  expertTipsMathsOlympiadPreparationAustralia,
  giftedStudents,
  howToInterpretNaplanResultsWhatDataTellsYou,
  howToMasterAasExams,
  howToMasterAcerExams,
  howToMasterEdutestExams,
  howToMasterSealProgramExams,
  howToMaximiseBenefitsParentTeacherInterviews,
  importanceOfMentalMathsHowToImprove,
  nonVerbalReasoningScholarship,
  numericalReasoningScholarship,
  mathsOlympiadProblemSolving,
  verbalReasoningScholarship,
  linkBetweenScholarshipAndNaplanResults,
  mathsBooksPrimarySchoolGuide,
  mathsBooksSecondarySchoolGuide,
  melbourneSelectiveSchoolEntryExamPastPapers,
  naplanPreparationBestTipsAndActivities,
  naplanYear3EnglishPreparationGuide,
  naplanYear3MathsPreparationGuide,
  naplanYear3Syllabus2026,
  naplanYear5EnglishPreparationGuide,
  naplanYear5MathsPreparationGuide,
  naplanYear5Syllabus2026,
  naplanYear7EnglishPreparationGuide,
  naplanYear7MathsPreparationGuide,
  naplanYear7Syllabus2026,
  naplanYear9EnglishPreparationGuide,
  naplanYear9MathsPreparationGuide,
  naplanYear9Syllabus2026,
  reasonsPreviouslyMotivatedChildNotPerformingWellSchool,
  schoolLunchIdeasAllergyFreeVegetarianFamilies,
  selectiveScholarshipExamTypesEduTestAcerAas,
  selectiveSchoolEntranceExamVictoriaGuide,
  victorianSelectiveSchools4Percent10PercentCapsExplained,
  whyNaplanIsImportantForYourChildsFuture
] as BlogPost[];

// Automatically sort posts by date (Newest First).
// Uses `toIsoDate` rather than `new Date(displayString)` because post dates are
// stored as display strings such as "March 30, 2026", which parse inconsistently.
export const BLOG_POSTS: BlogPost[] = [...allPosts].sort((a, b) => {
  const aTime = toIsoDate(a.updatedDate ?? a.date) ?? '';
  const bTime = toIsoDate(b.updatedDate ?? b.date) ?? '';
  return bTime.localeCompare(aTime) || b.title.localeCompare(a.title);
});

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

/** Index posts by slug for O(1) lookup in `generateMetadata` and pages. */
const BY_SLUG = new Map<string, BlogPost>(BLOG_POSTS.map((p) => [p.slug, p]));

/** Get a post by slug, or `undefined` when it does not exist. */
export function getPostBySlug(slug: string): BlogPost | undefined {
  return BY_SLUG.get(slug);
}

/** All slugs - consumed by `generateStaticParams` to prerender every article. */
export function getAllPostSlugs(): string[] {
  return BLOG_POSTS.map((p) => p.slug);
}

/** Posts matching a category slug, newest first. */
export function getPostsByCategory(categorySlug: string): BlogPost[] {
  return BLOG_POSTS.filter((p) => deriveCategory(p.tags).slug === categorySlug);
}

/** Posts matching a tag (case-insensitive), newest first. */
export function getPostsByTag(tag: string): BlogPost[] {
  const needle = tag.trim().toLowerCase();
  if (!needle) return [];
  return BLOG_POSTS.filter((p) =>
    (p.tags ?? []).some((t) => t.toLowerCase() === needle)
  );
}

/**
 * Related posts for internal linking.
 *
 * Scored by shared category, then shared tags, then keyword overlap so every
 * article links out to genuinely relevant neighbours. Internal links are how
 * topical authority is passed and how AI engines discover the wider library.
 */
export function getRelatedPosts(post: BlogPost, limit = 4): BlogPost[] {
  const ownCategory = deriveCategory(post.tags).slug;
  const ownTags = new Set((post.tags ?? []).map((t) => t.toLowerCase()));
  const ownKeywords = new Set((post.keywords ?? []).map((k) => k.toLowerCase()));

  return BLOG_POSTS
    .filter((candidate) => candidate.slug !== post.slug)
    .map((candidate) => {
      let score = 0;
      if (deriveCategory(candidate.tags).slug === ownCategory) score += 5;
      for (const tag of candidate.tags ?? []) {
        if (ownTags.has(tag.toLowerCase())) score += 2;
      }
      for (const keyword of candidate.keywords ?? []) {
        if (ownKeywords.has(keyword.toLowerCase())) score += 1;
      }
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.candidate.title.localeCompare(a.candidate.title))
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** Distinct tag values across the library with post counts, most used first. */
export function getAllTagsWithCounts(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of BLOG_POSTS) {
    for (const tag of post.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Newest N posts, used on the home page and in llms.txt. */
export function getLatestPosts(limit: number): BlogPost[] {
  return BLOG_POSTS.slice(0, limit);
}

