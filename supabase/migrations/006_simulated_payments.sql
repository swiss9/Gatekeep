-- =====================================================================
-- Gatekeep Shop — migration 006
-- Adds a flag for admin-simulated payments (used by the "Mark as
-- simulated" test action). Distinguishes test confirmations from real
-- ones in the audit trail.
-- Run after 005. Safe to re-run.
-- =====================================================================

alter table public.orders
  add column if not exists payment_simulated boolean not null default false;
