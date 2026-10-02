-- =====================================================================
-- Gatekeep Shop — migration 007
-- Tracks when a buyer submitted proof of payment, so the order can
-- show as "Awaiting confirmation" without a new status value.
-- Run after 006. Safe to re-run.
-- =====================================================================

alter table public.orders
  add column if not exists payment_proof_submitted_at timestamptz;
