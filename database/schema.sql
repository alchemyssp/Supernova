-- ============================================================
-- Supernova — Off-take from Wholesaler (WS) sales reports
-- Flow: WS file -> ws_lines (raw) -> customer_map / product_map -> offtake (final)
-- ============================================================

-- Wholesalers and the layout of their monthly report
create table if not exists public.wholesalers (
  name        text primary key,                 -- as written in the Off-take "Wholesaler" column
  layout      text not null default 'table',    -- table | grouped | boozia
  config      jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  note        text,
  updated_at  timestamptz not null default now()
);

-- Outlet master (Code, Outlets, Group, Current Team, Current BDE, Area)
create table if not exists public.outlets (
  code        text primary key,
  outlet_name text,
  group_name  text,
  team        text,
  bde         text,
  area        text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- SKU master with the price list used for the Off-take values
create table if not exists public.skus (
  sku_code          text primary key,
  sku_company       text,
  principle         text,
  category          text,
  brand             text,
  product           text,
  size              text,
  size_ml           numeric,
  packing           numeric,
  price_inc         numeric,
  price_exc         numeric,
  direct_price_exc  numeric,
  active            boolean not null default true,
  updated_at        timestamptz not null default now()
);

-- WS customer name -> outlet (remembered for next months)
create table if not exists public.customer_map (
  wholesaler    text not null references public.wholesalers(name) on update cascade on delete cascade,
  customer_key  text not null,
  raw_name      text,
  outlet_code   text references public.outlets(code) on update cascade on delete set null,
  skip          boolean not null default false,  -- not an outlet (cash sale, staff, ...)
  updated_at    timestamptz not null default now(),
  primary key (wholesaler, customer_key)
);

-- WS product name -> SKU (factor = bottles per WS unit, e.g. 6 when the WS reports cases of 6)
create table if not exists public.product_map (
  wholesaler   text not null references public.wholesalers(name) on update cascade on delete cascade,
  product_key  text not null,
  raw_name     text,
  sku_code     text references public.skus(sku_code) on update cascade on delete set null,
  factor       numeric not null default 1,
  skip         boolean not null default false,  -- not our product
  updated_at   timestamptz not null default now(),
  primary key (wholesaler, product_key)
);

-- One uploaded WS file for one month
create table if not exists public.import_batches (
  id            bigint generated always as identity primary key,
  wholesaler    text not null references public.wholesalers(name) on update cascade on delete cascade,
  month         date not null,                  -- 1st day of the month
  file_name     text,
  line_count    int,
  qty           numeric,
  amount        numeric,
  status        text not null default 'draft',  -- draft | confirmed
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  offtake_rows  int
);

-- Raw lines read from the WS file
create table if not exists public.ws_lines (
  id             bigint generated always as identity primary key,
  batch_id       bigint not null references public.import_batches(id) on delete cascade,
  doc_date       date,
  invoice        text,
  customer_raw   text,
  customer_code  text,
  outlet_raw     text,
  customer_key   text not null,
  product_raw    text,
  product_code   text,
  product_key    text not null,
  qty            numeric,
  unit_price     numeric,
  amount         numeric,
  salesman       text
);
create index if not exists ws_lines_batch_idx on public.ws_lines(batch_id);

-- Final Off-take (same columns as "Data_Total Off-Take")
create table if not exists public.offtake (
  id                bigint generated always as identity primary key,
  batch_id          bigint references public.import_batches(id) on delete cascade,  -- null = history from the Excel file
  code              text,
  outlets           text,
  group_name        text,
  current_team      text,
  current_bde       text,
  bde               text,
  area              text,
  wholesaler        text,
  sku_company       text,
  sku_code          text,
  principle         text,
  category          text,
  brand             text,
  product           text,
  size              text,
  packing           numeric,
  price_inc         numeric,
  price_exc         numeric,
  vol_btls          numeric,
  total_inc         numeric,
  total_exc         numeric,
  direct_price_exc  numeric,
  total_direct_exc  numeric,
  received_month    date,
  liter             numeric,
  customer_raw      text,
  product_raw       text,
  ws_qty            numeric,
  ws_amount         numeric
);
create index if not exists offtake_month_idx on public.offtake(received_month);
create index if not exists offtake_ws_month_idx on public.offtake(wholesaler, received_month);
create index if not exists offtake_batch_idx on public.offtake(batch_id);

-- Off-take with Current Team / Current BDE taken from today's Outlet master
-- ("if an outlet or area is updated, the full off-take is reassigned to the current salesperson")
create or replace view public.offtake_v with (security_invoker = true) as
select f.id, f.batch_id,
       f.code, coalesce(o.outlet_name, f.outlets) as outlets, coalesce(o.group_name, f.group_name) as group_name,
       coalesce(o.team, f.current_team) as current_team, coalesce(o.bde, f.current_bde) as current_bde,
       f.bde, coalesce(o.area, f.area) as area, f.wholesaler,
       f.sku_company, f.sku_code, f.principle, f.category, f.brand, f.product, f.size, f.packing,
       f.price_inc, f.price_exc, f.vol_btls, f.total_inc, f.total_exc, f.direct_price_exc, f.total_direct_exc,
       f.received_month, f.liter, f.customer_raw, f.product_raw, f.ws_qty, f.ws_amount
from public.offtake f
left join public.outlets o on o.code = f.code;

-- ------------------------------------------------------------
-- Confirm a batch: matched lines -> offtake.
-- Replaces whatever that wholesaler already has for that month
-- (older uploads and history rows), so uploading again is safe.
-- ------------------------------------------------------------
create or replace function public.confirm_batch(p_batch bigint)
returns int language plpgsql security invoker set search_path = public as $$
declare b public.import_batches; n int;
begin
  select * into b from public.import_batches where id = p_batch;
  if not found then raise exception 'Batch % not found', p_batch; end if;

  delete from public.offtake f
   where f.wholesaler = b.wholesaler and f.received_month = b.month;
  delete from public.import_batches x
   where x.wholesaler = b.wholesaler and x.month = b.month and x.id <> b.id;

  insert into public.offtake (batch_id, code, outlets, group_name, current_team, current_bde, bde, area, wholesaler,
         sku_company, sku_code, principle, category, brand, product, size, packing, price_inc, price_exc,
         vol_btls, total_inc, total_exc, direct_price_exc, total_direct_exc, received_month, liter,
         customer_raw, product_raw, ws_qty, ws_amount)
  select b.id, o.code, o.outlet_name, o.group_name, o.team, o.bde, o.bde, o.area, b.wholesaler,
         s.sku_company, s.sku_code, s.principle, s.category, s.brand, s.product, s.size, s.packing, s.price_inc, s.price_exc,
         v.btls, s.price_inc * v.btls, s.price_exc * v.btls, s.direct_price_exc, s.direct_price_exc * v.btls,
         b.month, v.btls * s.size_ml / 1000.0,
         v.customer_raw, v.product_raw, v.qty, v.amount
  from (
    select cm.outlet_code, pm.sku_code,
           sum(l.qty * pm.factor) as btls, sum(l.qty) as qty, sum(l.amount) as amount,
           min(l.customer_raw) as customer_raw, min(l.product_raw) as product_raw
    from public.ws_lines l
    join public.customer_map cm on cm.wholesaler = b.wholesaler and cm.customer_key = l.customer_key
    join public.product_map  pm on pm.wholesaler = b.wholesaler and pm.product_key  = l.product_key
    where l.batch_id = b.id and not cm.skip and not pm.skip
      and cm.outlet_code is not null and pm.sku_code is not null
    group by cm.outlet_code, pm.sku_code
  ) v
  join public.outlets o on o.code = v.outlet_code
  join public.skus s on s.sku_code = v.sku_code
  where v.btls <> 0;
  get diagnostics n = row_count;

  update public.import_batches set status = 'confirmed', confirmed_at = now(), offtake_rows = n where id = b.id;
  return n;
end $$;

-- Summary numbers for the Off-take page
create or replace function public.offtake_summary(
  p_months date[] default null, p_wholesaler text default null, p_bde text default null,
  p_team text default null, p_search text default null)
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'rows', count(*), 'btls', coalesce(sum(vol_btls), 0), 'value_exc', coalesce(sum(total_exc), 0),
    'value_inc', coalesce(sum(total_inc), 0), 'outlets', count(distinct code))
  from public.offtake_v
  where (p_months is null or received_month = any(p_months))
    and (p_wholesaler is null or wholesaler = p_wholesaler)
    and (p_bde is null or current_bde = p_bde)
    and (p_team is null or current_team = p_team)
    and (p_search is null or outlets ilike '%'||p_search||'%' or code ilike '%'||p_search||'%'
         or product ilike '%'||p_search||'%' or brand ilike '%'||p_search||'%');
$$;

-- Lists for the filters
create or replace function public.offtake_options()
returns json language sql stable security invoker set search_path = public as $$
  select json_build_object(
    'months', (select coalesce(json_agg(m order by m desc), '[]') from (select distinct received_month m from public.offtake where received_month is not null) a),
    'wholesalers', (select coalesce(json_agg(w order by w), '[]') from (select distinct wholesaler w from public.offtake where wholesaler is not null) a),
    'bdes', (select coalesce(json_agg(x order by x), '[]') from (select distinct current_bde x from public.offtake_v where current_bde is not null) a),
    'teams', (select coalesce(json_agg(x order by x), '[]') from (select distinct current_team x from public.offtake_v where current_team is not null) a));
$$;

-- Bottles per wholesaler per month (status grid on the Import page)
create or replace function public.offtake_ws_months(p_from date)
returns table (wholesaler text, received_month date, btls numeric, rows bigint)
language sql stable security invoker set search_path = public as $$
  select wholesaler, received_month, sum(vol_btls), count(*)
  from public.offtake where received_month >= p_from
  group by 1, 2;
$$;

-- ------------------------------------------------------------
-- Security: signed-in users only (shared passcode account)
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['wholesalers','outlets','skus','customer_map','product_map','import_batches','ws_lines','offtake'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "signed in" on public.%I', t);
    execute format('create policy "signed in" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

revoke execute on function public.confirm_batch(bigint) from anon, public;
revoke execute on function public.offtake_summary(date[], text, text, text, text) from anon, public;
revoke execute on function public.offtake_options() from anon, public;
revoke execute on function public.offtake_ws_months(date) from anon, public;
grant execute on function public.confirm_batch(bigint) to authenticated;
grant execute on function public.offtake_summary(date[], text, text, text, text) to authenticated;
grant execute on function public.offtake_options() to authenticated;
grant execute on function public.offtake_ws_months(date) to authenticated;
