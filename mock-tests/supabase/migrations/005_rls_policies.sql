-- 005_rls_policies.sql
-- RLS policies for Mock Tests Platform

-- Enable RLS on sensitive tables
ALTER TABLE public.app_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.writing_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_jobs ENABLE ROW LEVEL SECURITY;

-- 1. app_user_roles
CREATE POLICY "Users can read own role" ON public.app_user_roles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admin can read all roles" ON public.app_user_roles FOR SELECT USING (public.has_role('ADMIN'));
CREATE POLICY "Admin can write roles" ON public.app_user_roles FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 2. student_profiles
CREATE POLICY "Parent can read linked students" ON public.student_profiles FOR SELECT USING (public.is_parent_of(id));
CREATE POLICY "Student can read own profile" ON public.student_profiles FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY "Admin can read all profiles" ON public.student_profiles FOR SELECT USING (public.has_role('ADMIN'));

CREATE POLICY "Parent can insert child profile" ON public.student_profiles FOR INSERT WITH CHECK (public.has_role('PARENT'));
CREATE POLICY "Admin can insert profile" ON public.student_profiles FOR INSERT WITH CHECK (public.has_role('ADMIN'));

CREATE POLICY "Parent can update linked child profile" ON public.student_profiles FOR UPDATE USING (public.is_parent_of(id)) WITH CHECK (public.is_parent_of(id));
CREATE POLICY "Admin can update profile" ON public.student_profiles FOR UPDATE USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 3. parent_student_links
CREATE POLICY "Parent can manage own links" ON public.parent_student_links FOR ALL USING (parent_user_id = auth.uid()) WITH CHECK (parent_user_id = auth.uid());
CREATE POLICY "Admin can manage all links" ON public.parent_student_links FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 4. tests
CREATE POLICY "Users can view published tests if accessible" ON public.tests FOR SELECT USING (public.can_access_published_test(id));
CREATE POLICY "Test Creator can view own drafts" ON public.tests FOR SELECT USING (created_by = auth.uid() AND public.has_role('TEST_CREATOR'));
CREATE POLICY "Admin can view all tests" ON public.tests FOR SELECT USING (public.has_role('ADMIN'));

CREATE POLICY "Test Creator can create drafts" ON public.tests FOR INSERT WITH CHECK (created_by = auth.uid() AND public.has_role('TEST_CREATOR'));
CREATE POLICY "Admin can create any test" ON public.tests FOR INSERT WITH CHECK (public.has_role('ADMIN'));

CREATE POLICY "Test Creator can update own drafts" ON public.tests FOR UPDATE USING (created_by = auth.uid() AND status IN ('DRAFT', 'PENDING_APPROVAL') AND public.has_role('TEST_CREATOR')) WITH CHECK (created_by = auth.uid() AND status IN ('DRAFT', 'PENDING_APPROVAL') AND public.has_role('TEST_CREATOR'));
CREATE POLICY "Admin can update any test" ON public.tests FOR UPDATE USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 5. test_sections
CREATE POLICY "Users can view published test sections" ON public.test_sections FOR SELECT USING (public.can_access_published_test(test_id));
CREATE POLICY "Admin can view all test sections" ON public.test_sections FOR SELECT USING (public.has_role('ADMIN'));
CREATE POLICY "Test Creator can view own test sections" ON public.test_sections FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = auth.uid()) AND public.has_role('TEST_CREATOR')
);

CREATE POLICY "Admin can write test sections" ON public.test_sections FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));
CREATE POLICY "Test Creator can write own test sections" ON public.test_sections FOR ALL USING (
  EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = auth.uid() AND t.status IN ('DRAFT', 'PENDING_APPROVAL')) AND public.has_role('TEST_CREATOR')
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = auth.uid() AND t.status IN ('DRAFT', 'PENDING_APPROVAL')) AND public.has_role('TEST_CREATOR')
);

-- 6. questions
-- Complex policy for published questions viewing: user must be logged in & question must be published 
-- AND part of at least one published test the user can access
CREATE POLICY "Users can view published questions if accessible" ON public.questions FOR SELECT USING (
  auth.uid() IS NOT NULL AND
  status = 'PUBLISHED' AND
  EXISTS (
    SELECT 1 FROM public.test_questions tq 
    WHERE tq.question_id = id AND public.can_access_published_test(tq.test_id)
  )
);
CREATE POLICY "Test Creator can view own drafts" ON public.questions FOR SELECT USING (created_by = auth.uid() AND public.has_role('TEST_CREATOR'));
CREATE POLICY "Admin can view all questions" ON public.questions FOR SELECT USING (public.has_role('ADMIN'));

CREATE POLICY "Test Creator can create questions" ON public.questions FOR INSERT WITH CHECK (created_by = auth.uid() AND public.has_role('TEST_CREATOR'));
CREATE POLICY "Admin can create any question" ON public.questions FOR INSERT WITH CHECK (public.has_role('ADMIN'));

CREATE POLICY "Test Creator can update own drafts" ON public.questions FOR UPDATE USING (created_by = auth.uid() AND status IN ('DRAFT', 'PENDING_APPROVAL') AND public.has_role('TEST_CREATOR')) WITH CHECK (created_by = auth.uid() AND status IN ('DRAFT', 'PENDING_APPROVAL') AND public.has_role('TEST_CREATOR'));
CREATE POLICY "Admin can update any question" ON public.questions FOR UPDATE USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 7. test_questions
CREATE POLICY "Users can view published mapping" ON public.test_questions FOR SELECT USING (public.can_access_published_test(test_id));
CREATE POLICY "Test Creator can view own test mapping" ON public.test_questions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = auth.uid()) AND public.has_role('TEST_CREATOR')
);
CREATE POLICY "Admin can view all mapping" ON public.test_questions FOR SELECT USING (public.has_role('ADMIN'));

CREATE POLICY "Test Creator can write own test mapping" ON public.test_questions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = auth.uid() AND t.status IN ('DRAFT', 'PENDING_APPROVAL')) AND public.has_role('TEST_CREATOR')
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = auth.uid() AND t.status IN ('DRAFT', 'PENDING_APPROVAL')) AND public.has_role('TEST_CREATOR')
);
CREATE POLICY "Admin can write mapping" ON public.test_questions FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 8. assignments
CREATE POLICY "Parent can view student assignments" ON public.assignments FOR SELECT USING (public.is_parent_of(student_id));
CREATE POLICY "Student can view own assignments" ON public.assignments FOR SELECT USING (public.is_student_self(student_id));
CREATE POLICY "Admin can view all assignments" ON public.assignments FOR SELECT USING (public.has_role('ADMIN'));

CREATE POLICY "Parent can insert assignments" ON public.assignments FOR INSERT WITH CHECK (public.is_parent_of(student_id) AND assigned_by = auth.uid());
CREATE POLICY "Admin can insert assignments" ON public.assignments FOR INSERT WITH CHECK (public.has_role('ADMIN'));

-- 9. attempts
CREATE POLICY "Parent can view student attempts" ON public.attempts FOR SELECT USING (public.is_parent_of(student_id));
CREATE POLICY "Student can view own attempts" ON public.attempts FOR SELECT USING (public.is_student_self(student_id));
CREATE POLICY "Admin can view all attempts" ON public.attempts FOR SELECT USING (public.has_role('ADMIN'));

CREATE POLICY "Student can write own attempts" ON public.attempts FOR ALL USING (public.is_student_self(student_id)) WITH CHECK (public.is_student_self(student_id));
CREATE POLICY "Admin can write attempts" ON public.attempts FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 10. responses
CREATE POLICY "Parent can view student responses" ON public.responses FOR SELECT USING (public.is_attempt_owner(attempt_id));
CREATE POLICY "Student can view own responses" ON public.responses FOR SELECT USING (public.is_attempt_owner(attempt_id));
CREATE POLICY "Admin can view all responses" ON public.responses FOR SELECT USING (public.has_role('ADMIN'));

CREATE POLICY "Student can write own responses" ON public.responses FOR ALL USING (public.is_attempt_owner(attempt_id)) WITH CHECK (public.is_attempt_owner(attempt_id));
CREATE POLICY "Admin can write responses" ON public.responses FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 11. writing_evaluations
CREATE POLICY "Parent can view student evals" ON public.writing_evaluations FOR SELECT USING (public.is_attempt_owner(attempt_id));
CREATE POLICY "Student can view own evals" ON public.writing_evaluations FOR SELECT USING (public.is_attempt_owner(attempt_id));
CREATE POLICY "Admin can view all evals" ON public.writing_evaluations FOR SELECT USING (public.has_role('ADMIN'));
CREATE POLICY "Admin can write evals" ON public.writing_evaluations FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));
-- (Write mostly performed by service role which bypasses RLS)

-- 12. notifications
CREATE POLICY "User can read/update own notifications" ON public.notifications FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admin can view all notifications" ON public.notifications FOR SELECT USING (public.has_role('ADMIN'));
-- (Insert mostly performed by service role)

-- 13. products & product_tests
CREATE POLICY "Logged in users can view products" ON public.products FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can write products" ON public.products FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

CREATE POLICY "Logged in users can view product mapping" ON public.product_tests FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can write product mapping" ON public.product_tests FOR ALL USING (public.has_role('ADMIN')) WITH CHECK (public.has_role('ADMIN'));

-- 14. purchases & entitlements
CREATE POLICY "User can view own purchases" ON public.purchases FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admin can view all purchases" ON public.purchases FOR SELECT USING (public.has_role('ADMIN'));
-- (Write via service role)

CREATE POLICY "User can view own entitlements" ON public.entitlements FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admin can view all entitlements" ON public.entitlements FOR SELECT USING (public.has_role('ADMIN'));
-- (Write via service role)

-- 15. processed objects
CREATE POLICY "Admin can view processed events" ON public.processed_webhook_events FOR SELECT USING (public.has_role('ADMIN'));
CREATE POLICY "Admin can view processed jobs" ON public.processed_jobs FOR SELECT USING (public.has_role('ADMIN'));
-- (Write via service role)
