export type UserRole = 'PARENT' | 'TUTOR' | 'STUDENT' | 'TEST_CREATOR' | 'ADMIN'

export type ExamType = 
  | 'BENCHMARK'
  | 'NAPLAN_STYLE_READING' | 'NAPLAN_STYLE_NUMERACY' | 'NAPLAN_STYLE_LANGUAGE_CONVENTION'
  | 'MATHS_OLYMPIAD' | 'ENGLISH_OLYMPIAD'
  | 'SELECTIVE'
  | 'GRAMMAR' | 'VERBAL_REASONING' | 'NUMERICAL_REASONING' | 'SPELLING'
  | 'MENTAL_MATHS' | 'GEOMETRY' | 'WORD_PROBLEMS' | 'PROBLEM_SOLVING'
  | 'CRITICAL_THINKING' | 'VOCABULARY'

export type ContentStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'ARCHIVED'

export type QuestionType = 'MCQ' | 'SHORT_ANSWER' | 'WRITING'

export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'WRITING_PENDING' | 'COMPLETE'

export type AppUserRole = {
  user_id: string
  role: UserRole
  created_at: string
}
