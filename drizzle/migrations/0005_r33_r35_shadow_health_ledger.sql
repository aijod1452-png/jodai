ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','degraded','down'));
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS health_checked_at timestamptz;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS health_latency_ms integer;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS health_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS health_error text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS shadow_sample_rate numeric NOT NULL DEFAULT 0 CHECK (shadow_sample_rate >= 0 AND shadow_sample_rate <= 1);
ALTER TABLE public.usage_records ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'primary' CHECK (source IN ('primary','shadow'));
CREATE TABLE public.shadow_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  primary_model_id text NOT NULL,
  primary_latency_ms integer,
  primary_prompt_tokens integer NOT NULL DEFAULT 0,
  primary_completion_tokens integer NOT NULL DEFAULT 0,
  primary_cost numeric NOT NULL DEFAULT 0,
  primary_output text,
  shadow_model_id text,
  shadow_provider_id uuid,
  status text NOT NULL CHECK (status IN ('success','failed','skipped')),
  shadow_latency_ms integer,
  shadow_prompt_tokens integer NOT NULL DEFAULT 0,
  shadow_completion_tokens integer NOT NULL DEFAULT 0,
  shadow_cost numeric NOT NULL DEFAULT 0,
  shadow_output text,
  error text
);
GRANT ALL ON public.shadow_evaluations TO service_role;
ALTER TABLE public.shadow_evaluations ENABLE ROW LEVEL SECURITY;
CREATE INDEX shadow_evaluations_created_idx ON public.shadow_evaluations (created_at DESC);