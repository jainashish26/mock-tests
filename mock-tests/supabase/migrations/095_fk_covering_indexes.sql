-- ============================================================================
-- 095 - Covering indexes for unindexed foreign keys (Supabase performance
-- advisor: unindexed_foreign_keys, 15 findings; 8 addressed, 7 deliberately
-- skipped - rationale below).
--
-- WHY THESE EIGHT
--   An FK without a covering index costs in two places: joins/filters on the
--   referencing column, and EVERY delete of a referenced row (RESTRICT/CASCADE
--   checks scan the referencing table). The eight below sit on paths the
--   application actually queries or on tables that grow without bound:
--
--   test_questions.question_id  - ON DELETE RESTRICT: deleting/merging a
--                                 question scans the whole link table; also the
--                                 bank-side "which tests use this item" lookup.
--                                 UNIQUE(test_id, question_id) does NOT cover it
--                                 (question_id is not the leading column).
--   questions.created_by        - creator dashboard filters by author.
--   funnel_events.student_id    - fastest-growing table; per-student funnel
--                                 queries and the lifecycle worker.
--   tests.created_by            - creator TestManager ("my tests").
--   tests.approved_by           - admin review history.
--   assignments.assigned_by     - T5's "work THIS tutor set" filter and
--                                 mv_assignment_progress, refreshed hourly.
--   entitlements.purchase_id    - refund/dispute path: charge.refunded must
--                                 find entitlements granted by a purchase.
--   purchases.product_id        - revenue-by-product reporting (A8 track);
--                                 idx_purchases_user_product leads with
--                                 user_id, so it does not cover this FK.
--
-- DELIBERATELY SKIPPED (audit-column FKs on tiny or near-static tables, where
-- the write cost of an index exceeds any read it could ever save):
--   referral_codes.referee_offer_id, enquiries.converted_order_id,
--   practice_rest_days.created_by, tutor_student_links.created_by,
--   consent_records.granted_by, consent_records.revoked_by,
--   product_tests.test_id (2-row catalogue table).
--   The advisor will keep listing these at INFO level; that is accepted.
--
-- Plain CREATE INDEX (not CONCURRENTLY): this migration runs inside a
-- transaction (management API / psql -f), where CONCURRENTLY is not allowed.
-- Every table here is small today, so the brief share-lock is a non-event;
-- IF NOT EXISTS keeps re-application safe.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_test_questions_question  ON public.test_questions (question_id);
CREATE INDEX IF NOT EXISTS idx_questions_created_by     ON public.questions (created_by);
CREATE INDEX IF NOT EXISTS idx_funnel_events_student    ON public.funnel_events (student_id);
CREATE INDEX IF NOT EXISTS idx_tests_created_by         ON public.tests (created_by);
CREATE INDEX IF NOT EXISTS idx_tests_approved_by        ON public.tests (approved_by);
CREATE INDEX IF NOT EXISTS idx_assignments_assigned_by  ON public.assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_entitlements_purchase    ON public.entitlements (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product        ON public.purchases (product_id);