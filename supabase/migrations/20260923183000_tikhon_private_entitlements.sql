-- Migration: 20260923183000_tikhon_private_entitlements.sql
-- Purpose: Create private student entitlement projection table for Tikhon Mini App (Batch 1 CORR1)
-- Security: Strict RLS enabled, anon revoked, service-role only access

CREATE TABLE IF NOT EXISTS public.tikhon_private_entitlements (
    subject_key VARCHAR(64) NOT NULL,
    course_id VARCHAR(64) NOT NULL,
    paid_options JSONB NOT NULL DEFAULT '[]'::jsonb,
    legacy_history_unverified BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_key, course_id)
);

-- Enable Row-Level Security
ALTER TABLE public.tikhon_private_entitlements ENABLE ROW LEVEL SECURITY;

-- Revoke all permissions from anon and authenticated
REVOKE ALL ON TABLE public.tikhon_private_entitlements FROM anon;
REVOKE ALL ON TABLE public.tikhon_private_entitlements FROM authenticated;

-- Grant permissions strictly to service_role and postgres
GRANT ALL ON TABLE public.tikhon_private_entitlements TO service_role;
GRANT ALL ON TABLE public.tikhon_private_entitlements TO postgres;

COMMENT ON TABLE public.tikhon_private_entitlements IS 'Private student entitlements projected from canonical SQLite database. Read via service role in authenticated API.';
