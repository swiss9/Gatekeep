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
-- Grants are scoped to the four DML verbs. We deliberately do NOT
-- grant TRUNCATE / REFERENCES / TRIGGER to anon or authenticated:
-- RLS does not gate TRUNCATE, so a broader grant would be a foot-gun
-- if a direct SQL path ever existed. service_role keeps ALL because
-- the server is the only writer that needs it.
--
-- Run this after 001 and 002. Safe to re-run.
-- =====================================================================

grant usage on schema public
  to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;

grant all on all tables in schema public
  to service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated;

grant all on all sequences in schema public
  to service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

alter default privileges in schema public
  grant all on sequences to service_role;

alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
