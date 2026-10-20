CREATE TABLE IF NOT EXISTS public.settings (
    id TEXT PRIMARY KEY DEFAULT 'SYSTEM_CONFIG' CHECK (id = 'SYSTEM_CONFIG'),
    is_initialized BOOLEAN NOT NULL DEFAULT FALSE,
    passcode_hash TEXT, passcode_salt TEXT,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    master_pause BOOLEAN NOT NULL DEFAULT FALSE,
    max_steps_per_task INT NOT NULL DEFAULT 30,
    theme TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.settings (id, is_initialized) VALUES ('SYSTEM_CONFIG', FALSE) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    user_agent TEXT, ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    token_prefix TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_tokens_active_prefix_idx ON public.api_tokens (token_prefix) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS public.providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, type TEXT NOT NULL, base_url TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    custom_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_test_result TEXT, last_test_latency_ms INT, last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.provider_secrets (
    provider_id UUID PRIMARY KEY REFERENCES public.providers(id) ON DELETE CASCADE,
    api_key TEXT, encrypted_secret TEXT, encryption_iv TEXT,
    masked_key TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL, display_name TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    in_cooldown BOOLEAN NOT NULL DEFAULT FALSE,
    cooldown_until TIMESTAMPTZ,
    capabilities JSONB NOT NULL DEFAULT '{"text": true, "image": "unknown", "tools": "unknown", "long_context": "unknown"}'::jsonb,
    priority INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.router_state (
    id TEXT PRIMARY KEY DEFAULT 'GLOBAL_ROUTER' CHECK (id = 'GLOBAL_ROUTER'),
    fallback_order JSONB NOT NULL DEFAULT '[]'::jsonb,
    cooldown_duration_seconds INT NOT NULL DEFAULT 300,
    last_fallback_event TIMESTAMPTZ, last_fallback_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.router_state (id) VALUES ('GLOBAL_ROUTER') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, description TEXT NOT NULL, base_url TEXT NOT NULL,
    auth_header_type TEXT NOT NULL DEFAULT 'Bearer',
    custom_header_name TEXT, sample_request JSONB,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_result TEXT, last_test_latency_ms INT, last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tool_secrets (
    tool_id UUID PRIMARY KEY REFERENCES public.tools(id) ON DELETE CASCADE,
    api_key TEXT, encrypted_secret TEXT, encryption_iv TEXT,
    masked_key TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.storage_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, project_url TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_result TEXT, last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.storage_secrets (
    storage_id UUID PRIMARY KEY REFERENCES public.storage_connections(id) ON DELETE CASCADE,
    service_role_key TEXT, encrypted_secret TEXT, encryption_iv TEXT,
    masked_key TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT UNIQUE NOT NULL,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    target_reference JSONB,
    selected_model_id UUID REFERENCES public.models(id) ON DELETE SET NULL,
    model_selection_reason TEXT,
    total_steps INT NOT NULL DEFAULT 0,
    current_step INT NOT NULL DEFAULT 0,
    result_summary TEXT, failure_reason TEXT,
    lease_expires_at TIMESTAMPTZ, lease_token UUID,
    started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.task_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    step_number INT NOT NULL,
    action_type TEXT NOT NULL,
    target_id UUID,
    description TEXT NOT NULL,
    expected_output TEXT,
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_payload JSONB, checkpoint_state JSONB,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, command TEXT NOT NULL,
    cron_expression TEXT, run_once_at TIMESTAMPTZ,
    timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at TIMESTAMPTZ, last_run_status TEXT, next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.schedule_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS public.usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL,
    model_id TEXT NOT NULL,
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
    is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    tool_id UUID REFERENCES public.tools(id) ON DELETE SET NULL,
    model_id TEXT,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL, message TEXT NOT NULL, type TEXT NOT NULL,
    reference_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION public.claim_next_task(lease_seconds INT DEFAULT 120)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task public.tasks;
BEGIN
    IF EXISTS (SELECT 1 FROM public.settings WHERE id = 'SYSTEM_CONFIG' AND master_pause = TRUE) THEN
        RETURN;
    END IF;
    SELECT * INTO v_task FROM public.tasks
    WHERE status = 'QUEUED' OR (status = 'RUNNING' AND lease_expires_at < now())
    ORDER BY created_at ASC LIMIT 1
    FOR UPDATE SKIP LOCKED;
    IF v_task.id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = 'RUNNING',
            lease_expires_at = now() + (GREATEST(lease_seconds, 45) || ' seconds')::interval,
            lease_token = gen_random_uuid(),
            started_at = COALESCE(v_task.started_at, now()),
            updated_at = now()
        WHERE id = v_task.id
        RETURNING * INTO v_task;
        UPDATE public.task_steps
        SET status = 'PENDING', error_message = 'Recovered after worker lease expiry', started_at = NULL
        WHERE task_id = v_task.id AND status = 'RUNNING';
        RETURN NEXT v_task;
    END IF;
    RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_next_task(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_task(INT) TO service_role;

DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY[
        'settings','sessions','api_tokens','providers','provider_secrets',
        'models','router_state','tools','tool_secrets','storage_connections',
        'storage_secrets','tasks','task_steps','schedules','schedule_runs',
        'usage_records','activity_log','notifications','health_checks'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('GRANT ALL ON public.%I TO service_role;', tbl);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', tbl);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS deny_all_direct_access ON public.%I;', tbl);
        EXECUTE format('CREATE POLICY deny_all_direct_access ON public.%I FOR ALL TO anon, authenticated USING (false);', tbl);
    END LOOP;
END $$;