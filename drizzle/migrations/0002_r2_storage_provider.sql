ALTER TABLE public.storage_connections ADD COLUMN storage_type text NOT NULL DEFAULT 'supabase';
ALTER TABLE public.storage_connections ADD COLUMN account_id text;
ALTER TABLE public.storage_connections ADD CONSTRAINT storage_provider_kind CHECK (storage_type IN ('supabase', 'r2'));
COMMENT ON COLUMN public.storage_connections.account_id IS 'Non-secret R2 account identifier; signing credentials remain encrypted in storage_secrets.';
COMMENT ON COLUMN public.storage_secrets.encrypted_secret IS 'AES-GCM encrypted Supabase key or R2 JSON credentials; never returned through client projections.';