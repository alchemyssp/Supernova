-- ALREADY RUN on 2026-10-06 (safe to run again).
-- ============================================================
-- Supernova v4 — changes made in the Off-take preview
-- One row per outlet + month + SKU. It replaces what came from the WS reports for that row
-- (removed = the row is taken out of the form). Nothing existing is deleted.
-- Run once in the Supabase SQL Editor.
-- ============================================================

create table if not exists public.form_overrides (
  outlet_code  text not null,
  month        date not null,                 -- 1st day of the month
  sku_code     text not null,
  wholesaler   text,
  price        numeric,
  price_col    text not null default 'L' check (price_col in ('K', 'L')),   -- K = Price Inc. VAT, L = Price Ex. VAT
  btls         numeric,
  removed      boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (outlet_code, month, sku_code)
);

alter table public.form_overrides enable row level security;
drop policy if exists "signed in" on public.form_overrides;
create policy "signed in" on public.form_overrides for all to authenticated using (true) with check (true);
