-- 003_indexes.sql
-- Indexes for performance as specified in Mock Tests Schema

CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent ON public.parent_student_links(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_links_student ON public.parent_student_links(student_id);

CREATE INDEX IF NOT EXISTS idx_tests_status_exam ON public.tests(status, exam_type);
CREATE INDEX IF NOT EXISTS idx_questions_status_type ON public.questions(status, type);

CREATE INDEX IF NOT EXISTS idx_assignments_student ON public.assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_assignments_test ON public.assignments(test_id);

CREATE INDEX IF NOT EXISTS idx_attempts_student ON public.attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_test ON public.attempts(test_id);

CREATE INDEX IF NOT EXISTS idx_responses_attempt ON public.responses(attempt_id);
CREATE INDEX IF NOT EXISTS idx_responses_question ON public.responses(question_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_user ON public.purchases(user_id);

CREATE INDEX IF NOT EXISTS idx_entitlements_user ON public.entitlements(user_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_test ON public.entitlements(test_id);
