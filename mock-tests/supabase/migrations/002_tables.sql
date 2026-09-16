-- 002_tables.sql
-- Tables (complete schema) for Mock Tests Platform

CREATE TABLE IF NOT EXISTS public.app_user_roles (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.user_role NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.student_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    year_level int NOT NULL CHECK (year_level BETWEEN 2 AND 8),
    username text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.parent_student_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    UNIQUE (parent_user_id, student_id)
);

CREATE TABLE IF NOT EXISTS public.tests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    exam_type public.exam_type NOT NULL,
    year_level_min int NOT NULL,
    year_level_max int NOT NULL,
    time_limit_mins int NOT NULL CHECK (time_limit_mins > 0),
    is_free boolean NOT NULL DEFAULT false,
    status public.content_status NOT NULL DEFAULT 'DRAFT',
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    approved_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    published_at timestamptz NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.test_sections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
    name text NOT NULL,
    section_order int NOT NULL,
    time_limit_mins int NULL,
    question_count int NOT NULL CHECK (question_count > 0),
    created_at timestamptz DEFAULT now(),
    UNIQUE (test_id, section_order)
);

CREATE TABLE IF NOT EXISTS public.questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type public.question_type NOT NULL,
    stem text NOT NULL,
    passage text NULL,
    image_url text NULL,
    options jsonb NULL,
    correct_answer jsonb NULL,
    explanation text NULL,
    explanation_steps jsonb NULL,
    tags jsonb NOT NULL,
    status public.content_status NOT NULL DEFAULT 'DRAFT',
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.test_questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE RESTRICT,
    section_name text NOT NULL,
    base_difficulty int NOT NULL CHECK (base_difficulty BETWEEN 1 AND 4),
    question_order int NULL,
    UNIQUE (test_id, question_id)
);

CREATE TABLE IF NOT EXISTS public.assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
    test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE RESTRICT,
    assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    assigned_at timestamptz DEFAULT now(),
    due_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS public.attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
    test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE RESTRICT,
    started_at timestamptz DEFAULT now(),
    submitted_at timestamptz NULL,
    status public.attempt_status DEFAULT 'IN_PROGRESS',
    score_out_of100 numeric(5,2) NULL,
    section_scores jsonb NULL,
    raw_accuracy numeric(5,2) NULL,
    weighted_score numeric(5,2) NULL,
    time_spent_seconds int NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE RESTRICT,
    section_name text NOT NULL,
    difficulty_served int NOT NULL CHECK (difficulty_served BETWEEN 1 AND 4),
    answer jsonb NOT NULL,
    is_correct boolean NULL,
    time_spent_seconds int NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS public.writing_evaluations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id uuid NOT NULL UNIQUE REFERENCES public.attempts(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'DeepSeek',
    score_out_of100 numeric(5,2) NOT NULL,
    strengths jsonb NULL,
    improvements jsonb NULL,
    improved_text text NULL,
    raw_response jsonb NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    link_url text NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text NULL,
    active boolean DEFAULT true,
    price_cents int NOT NULL CHECK (price_cents >= 0),
    currency text NOT NULL DEFAULT 'AUD',
    stripe_price_id text UNIQUE NULL,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_tests (
    product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
    test_id uuid REFERENCES public.tests(id) ON DELETE RESTRICT,
    PRIMARY KEY (product_id, test_id)
);

CREATE TABLE IF NOT EXISTS public.purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'Stripe',
    provider_ref text NULL,
    total_amount_cents int NOT NULL CHECK (total_amount_cents >= 0),
    currency text NOT NULL DEFAULT 'AUD',
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE RESTRICT,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT now(),
    UNIQUE (user_id, test_id)
);

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL DEFAULT 'Stripe',
    event_id text NOT NULL UNIQUE,
    processed_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.processed_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id text NOT NULL UNIQUE,
    job_type text NOT NULL,
    processed_at timestamptz DEFAULT now()
);
