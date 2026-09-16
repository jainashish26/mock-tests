-- 001_enums.sql
-- Enumerations (Postgres enum types) for Mock Tests Platform

DO $$ BEGIN
    CREATE TYPE public.user_role AS ENUM (
        'PARENT',
        'TUTOR',
        'STUDENT',
        'TEST_CREATOR',
        'ADMIN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.exam_type AS ENUM (
        'BENCHMARK',
        'NAPLAN_STYLE',
        'OLYMPIAD',
        'SELECTIVE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.content_status AS ENUM (
        'DRAFT',
        'PENDING_APPROVAL',
        'PUBLISHED',
        'ARCHIVED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.question_type AS ENUM (
        'MCQ',
        'SHORT_ANSWER',
        'WRITING'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.attempt_status AS ENUM (
        'IN_PROGRESS',
        'SUBMITTED',
        'WRITING_PENDING',
        'COMPLETE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
