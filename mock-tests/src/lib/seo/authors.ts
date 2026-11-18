/**
 * Author registry for E-E-A-T (Experience, Expertise, Authoritativeness,
 * Trustworthiness).
 *
 * AI engines and Google both look for *named, credentialed* authors rather than
 * anonymous bylines. Each entry here supplies the credentials, bio and profile
 * links that feed `Person`/`Organization` JSON-LD and the on-page author card.
 *
 * IMPORTANT: keep `credentials`, `bio` and `sameAs` factual and verifiable.
 * Invent nothing - an unverifiable credential is worse for trust than a plain
 * role. Fill in real qualifications, real profile URLs and a real `email`
 * before launch.
 */

export interface AuthorProfile {
  name: string;
  /** Headline role shown under the byline. */
  role: string;
  /** Short, verifiable expertise credentials (qualifications, experience). */
  credentials: string[];
  /** 2-3 sentence bio used in the on-page author card and Person schema. */
  bio: string;
  avatar?: string;
  /** Author profile / external profiles for schema.org `sameAs`. */
  sameAs?: string[];
  /** schema.org type - a real individual should be `Person`. */
  type: 'Person' | 'Organization';
  /** Affiliation shown alongside the byline. */
  affiliation: string;
}

const SITE_OWNER = 'MockTests Pro';

export const AUTHORS: Record<string, AuthorProfile> = {
  'The Exam Success Team': {
    name: 'The Exam Success Team',
    role: 'Educational Content Specialists',
    type: 'Organization',
    affiliation: SITE_OWNER,
    credentials: [
      'Written by the MockTests Pro education team - practising teachers, curriculum specialists and assessment data analysts',
      'Every guide is aligned to the current Australian Curriculum (Version 9) and ACARA NAPLAN test specifications',
      'Fact-checked against primary sources including nap.edu.au, acara.edu.au and state education departments',
      'Reviewed and refreshed each testing cycle to reflect the latest exam format changes',
    ],
    bio:
      'The Exam Success Team is the editorial group behind MockTests Pro. We combine classroom teaching experience with assessment data analysis to produce evidence-based preparation guides for Australian families. Every article is checked against official ACARA and state department sources before publication and re-reviewed each testing cycle.',
    sameAs: [],
  },

  'Ashish Jain': {
    name: 'Ashish Jain',
    role: 'Test Mentor',
    type: 'Person',
    affiliation: SITE_OWNER,
    credentials: [
      'Test preparation mentor specialising in NAPLAN, Selective School and Scholarship exams',
      'Coaches students in reasoning, writing and exam-technique across Years 3-8',
      'Author of MockTests Pro practice frameworks for verbal, numerical and non-verbal reasoning',
    ],
    bio:
      'Ashish Jain is a test mentor at MockTests Pro, where he helps Years 3-8 students prepare for NAPLAN, Selective School entrance and Scholarship examinations. He writes about reasoning technique, exam strategy and building genuine test-day confidence.',
    sameAs: [],
  },
};

/** Fallback profile when a post's author name is not in the registry. */
export const DEFAULT_AUTHOR: AuthorProfile = AUTHORS['The Exam Success Team'];

/** Look up a full author profile by display name. */
export function getAuthor(name?: string | null): AuthorProfile {
  if (!name) return DEFAULT_AUTHOR;
  return AUTHORS[name] ?? { ...DEFAULT_AUTHOR, name, role: 'Contributor' };
}

/**
 * Editorial standards statement. Publishing a review policy is a direct
 * trustworthiness signal for both Google's helpful-content systems and AI
 * engines deciding whether to cite a page.
 */
export const EDITORIAL_POLICY = {
  publisher: SITE_OWNER,
  reviewProcess:
    'Every MockTests Pro guide is written by our education team, checked against primary sources (ACARA, nap.edu.au and state education departments), reviewed by a second editor, and re-verified each testing cycle.',
  factCheckSources: [
    'Australian Curriculum, Assessment and Reporting Authority (ACARA)',
    'NAPLAN official test specifications - nap.edu.au',
    'Victorian Department of Education',
    'NSW Department of Education',
  ],
  updateCadence:
    'Content is reviewed at least once per NAPLAN testing cycle (March) and whenever an exam board publishes a format change.',
};
