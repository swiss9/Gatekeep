-- =====================================================================
-- Gatekeep Shop — migration 002
-- Superadmin hierarchy + one-time admin invites + atomic stock decrement.
-- Run after 001.
-- =====================================================================

-- ---------------------------------------------------------------------
-- admin_invites
-- One-time tokens embedded in a Telegram startapp link:
--   https://t.me/<bot>/app?startapp=inv_<TOKEN>
-- The auth endpoint redeems these on /api/auth/validate.
-- ---------------------------------------------------------------------
create table if not exists public.admin_invites (
  id            uuid primary key default gen_random_uuid(),
  token         text unique not null,
  created_by    uuid not null references public.profiles(id) on delete cascade,
  grants_role   text not null default 'admin'
                  check (grants_role in ('admin','superadmin')),
  expires_at    timestamptz not null,
  used_by       uuid references public.profiles(id) on delete set null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- Only unused invites need to be looked up by token — this partial index
-- keeps the redemption path fast even when the table grows.
create index if not exists idx_admin_invites_token_live
  on public.admin_invites(token) where used_by is null;

alter table public.admin_invites enable row level security;

-- Only admins see or manage invites. Redemption happens server-side
-- with the service role and is not subject to RLS.
create policy admin_invites_read on public.admin_invites
  for select using (public.is_admin(auth.uid()));

create policy admin_invites_write on public.admin_invites
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------
-- decrement_stock
--
-- Atomic compare-and-decrement for a single product line. Returns true
-- if the row was decremented, false if there was not enough stock at
-- the moment of the UPDATE.
--
-- Why this exists: a plain `select ... then update stock = N` from the
-- server is a lost-update race under concurrent checkouts. Doing the
-- arithmetic inside the UPDATE ... WHERE stock >= qty makes Postgres
-- take a row lock, evaluate the predicate, and write in one statement.
--
-- Called only by the server (service_role). We revoke execute from
-- anon and authenticated so PostgREST does not expose it as an RPC to
-- the public API surface.
-- ---------------------------------------------------------------------
create or replace function public.decrement_stock(
  p_product_id uuid,
  p_qty        int
)
returns boolean
language plpgsql
as $$
declare
  affected int;
begin
  if p_qty is null or p_qty <= 0 then
    return false;
  end if;

  update public.products
     set stock      = stock - p_qty,
         updated_at = now()
   where id = p_product_id
     and stock >= p_qty;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.decrement_stock(uuid, int)
  from public, anon, authenticated;
grant execute on function public.decrement_stock(uuid, int)
  to service_role;
