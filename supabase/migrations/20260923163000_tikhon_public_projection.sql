-- Migration: 20260923163000_tikhon_public_projection.sql
-- Purpose: Create materialized public courses read model for Tikhon Mini App (Batch 0)
-- Security: RLS enabled, least-privilege service-role access only

CREATE TABLE IF NOT EXISTS public.tikhon_public_projection (
    id VARCHAR(64) PRIMARY KEY DEFAULT 'current',
    as_of TIMESTAMPTZ NOT NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'RUB',
    currency_symbol VARCHAR(8) NOT NULL DEFAULT '₽',
    courses JSONB NOT NULL,
    projection_version INT NOT NULL DEFAULT 1,
    projected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_updated_at TIMESTAMPTZ NULL
);

-- Enable Row-Level Security (Least Privilege)
ALTER TABLE public.tikhon_public_projection ENABLE ROW LEVEL SECURITY;

-- Grant required permissions to service_role and postgres roles
GRANT ALL ON TABLE public.tikhon_public_projection TO service_role;
GRANT ALL ON TABLE public.tikhon_public_projection TO postgres;

-- Note: Without public/anon policies, anonymous web clients cannot directly query this table.
-- Access is restricted to trusted server-side execution via service-role key (Vercel Edge & VPS worker).
COMMENT ON TABLE public.tikhon_public_projection IS 'Materialized read-only course projection for Tikhon Mini App. UI = PROJECTION, NOT AUTHORITY.';
