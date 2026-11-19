-- 100_writing_improvements_detail.sql
-- Rich improvement objects ({ suggestion, estimated_score_gain, rewrite }) are
-- stored alongside the flattened `improvements` strings so the report can show
-- per-suggestion score gains and grammar rewrites without re-parsing the raw
-- DeepSeek response payload.
ALTER TABLE public.writing_evaluations
  ADD COLUMN IF NOT EXISTS improvements_detail jsonb;