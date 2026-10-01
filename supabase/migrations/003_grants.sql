-- =====================================================================
-- Gatekeep Shop — migration 003
-- Schema-level grants.
--
-- Supabase is phasing out the automatic grants that used to apply to
-- every new table in the public schema. Without these grants, the
-- service_role key used by the server cannot read or write the tables
-- created in 001 and 002, and every API call fails with
-- "permission denied for table X".
--
-- Run this after 001 and 002. Safe to re-run.
-- =====================================================================

grant usage on schema public
  to anon, authenticated, service_role;

grant all on all tables in schema public
  to anon, authenticated, service_role;

grant all on all sequences in schema public
  to anon, authenticated, service_role;

grant all on all functions in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
