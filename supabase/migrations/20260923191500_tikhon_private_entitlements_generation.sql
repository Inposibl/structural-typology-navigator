-- Migration: 20260923191500_tikhon_private_entitlements_generation.sql
-- Purpose: Add generation_id for atomic bounded safe reconciliation of student entitlements
-- Prevents stale rows and old subject-key records from surviving across projection runs

ALTER TABLE public.tikhon_private_entitlements 
ADD COLUMN IF NOT EXISTS generation_id VARCHAR(64) NOT NULL DEFAULT '';

COMMENT ON COLUMN public.tikhon_private_entitlements.generation_id IS 'Unique UUID per projection run for safe generation-based reconciliation.';
