-- ============================================================
-- Supernova v3
--  * WS customer details kept in the WS database (customer code + shop name as the WS writes them)
--  * offtake_history: off-take already filled before the website (e.g. Jan–Jul 2026)
-- Adds columns / one table and widens the form_lines view. Nothing existing is deleted.
-- Run once in the Supabase SQL Editor (after schema.sql).
-- ============================================================

alter table public.customer_map add column if not exists customer_code text;    -- the WS's own customer code (J0101, AR-0-001, A/0626 ...)
alter table public.customer_map add column if not exists ws_outlet_name text;   -- shop / outlet name in the WS report, when it has one
alter table public.customer_map add column if not exists customer_name text;    -- customer (company) name in the WS report

-- fill them for names already saved, from the uploaded lines
update public.customer_map cm set
  customer_code = coalesce(cm.customer_code, x.customer_code),
  ws_outlet_name = coalesce(cm.ws_outlet_name, x.outlet_raw),
  customer_name = coalesce(cm.customer_name, x.customer_raw)
from (
  select distinct on (b.wholesaler, l.customer_key) b.wholesaler, l.customer_key, l.customer_code, l.outlet_raw, l.customer_raw
  from public.ws_lines l join public.import_batches b on b.id = l.batch_id
  order by b.wholesaler, l.customer_key, b.month desc
) x
where x.wholesaler = cm.wholesaler and x.customer_key = cm.customer_key;

create table if not exists public.offtake_history (
  id            bigint generated always as identity primary key,
  outlet_code   text not null,
  month         date not null,                 -- 1st day of the month
  wholesaler    text,
  sku_code      text not null,
  btls          numeric not null,
  price_per_btl numeric,
  price_vat     text not null default 'exc' check (price_vat in ('inc', 'exc')),
  source        text,                          -- file it came from
  created_at    timestamptz not null default now()
);
create index if not exists offtake_history_outlet_idx on public.offtake_history(outlet_code, month);
create index if not exists offtake_history_month_idx on public.offtake_history(month);

alter table public.offtake_history enable row level security;
drop policy if exists "signed in" on public.offtake_history;
create policy "signed in" on public.offtake_history for all to authenticated using (true) with check (true);

-- Every line ready for an outlet's form: uploaded WS reports + history.
-- A WS report uploaded for a month replaces the history of that WS + month.
create or replace view public.form_lines with (security_invoker = true) as
select cm.outlet_code, b.month, b.wholesaler, w.price_vat, pm.sku_code,
       l.qty * pm.factor as btls,
       coalesce(l.unit_price, l.amount / nullif(l.qty, 0)) / pm.factor as price_per_btl,
       l.amount, l.customer_raw, l.product_raw
from public.ws_lines l
join public.import_batches b on b.id = l.batch_id
join public.wholesalers w on w.name = b.wholesaler
join public.customer_map cm on cm.wholesaler = b.wholesaler and cm.customer_key = l.customer_key
join public.product_map pm on pm.wholesaler = b.wholesaler and pm.product_key = l.product_key
where not cm.skip and not pm.skip and cm.outlet_code is not null and pm.sku_code is not null
union all
select h.outlet_code, h.month, h.wholesaler, h.price_vat, h.sku_code, h.btls, h.price_per_btl,
       null::numeric, null::text, null::text
from public.offtake_history h
where not exists (select 1 from public.import_batches b where b.wholesaler = h.wholesaler and b.month = h.month);
