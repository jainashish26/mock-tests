export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  image: string;
  imageAlt?: string;
  date: string;
  tags: string[];
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
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

// Automatically sort posts by date (Newest First)
export const BLOG_POSTS: BlogPost[] = [...allPosts].sort((a, b) => {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
});
