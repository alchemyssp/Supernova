-- ============================================================
-- Supernova v2 — WS report -> Data U outlet -> "Off-Take & Outlet Rebate Calculation" form
-- Run the whole file in the Supabase SQL Editor. It removes the v1 tables first (they hold no data).
-- ============================================================

drop view if exists public.form_lines cascade;
drop view if exists public.offtake_v cascade;
drop function if exists public.confirm_batch(bigint);
drop function if exists public.offtake_summary(date[], text, text, text, text);
drop function if exists public.offtake_options();
drop function if exists public.offtake_ws_months(date);
drop table if exists public.offtake, public.ws_lines, public.import_batches, public.product_map,
  public.customer_map, public.skus, public.outlets, public.wholesalers cascade;

-- Wholesalers, named as in the form's Wholesaler list (MAPPING sheet, column "Mapping")
create table public.wholesalers (
  name        text primary key,
  region      text,
  price_vat   text not null default 'exc' check (price_vat in ('inc', 'exc')),   -- WS price goes to K (inc) or L (exc)
  layout      text not null default 'table',                                    -- table | grouped | boozia
  config      jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Outlets from the Data U Excel (sheet "Outlet" + Area/Team from sheet "Filter")
create table public.outlets (
  code          text primary key,
  outlet_name   text,
  company_name  text,
  group_name    text,
  team          text,
  bde           text,
  current_bde   text,
  area          text,
  province      text,
  region        text,
  status        text,
  contract      text,
  updated_at    timestamptz not null default now()
);

-- WS customer -> Data U outlet (remembered)
create table public.customer_map (
  wholesaler    text not null references public.wholesalers(name) on update cascade on delete cascade,
  customer_key  text not null,
  raw_name      text,
  outlet_code   text,
  skip          boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (wholesaler, customer_key)
);

-- WS product -> SKU code of the form (factor = bottles per WS unit)
create table public.product_map (
  wholesaler   text not null references public.wholesalers(name) on update cascade on delete cascade,
  product_key  text not null,
  raw_name     text,
  sku_code     text,
  factor       numeric not null default 1,
  skip         boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (wholesaler, product_key)
);

-- One WS report for one month (uploading the same WS + month again replaces it)
create table public.import_batches (
  id          bigint generated always as identity primary key,
  wholesaler  text not null references public.wholesalers(name) on update cascade on delete cascade,
  month       date not null,
  file_name   text,
  line_count  int,
  qty         numeric,
  amount      numeric,
  created_at  timestamptz not null default now(),
  unique (wholesaler, month)
);

create table public.ws_lines (
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
create index ws_lines_batch_idx on public.ws_lines(batch_id);

-- Every matched line, ready to be put in an outlet's form
create view public.form_lines with (security_invoker = true) as
select cm.outlet_code, b.month, b.wholesaler, w.price_vat, pm.sku_code,
       l.qty * pm.factor as btls,
       coalesce(l.unit_price, l.amount / nullif(l.qty, 0)) / pm.factor as price_per_btl,
       l.amount, l.customer_raw, l.product_raw
from public.ws_lines l
join public.import_batches b on b.id = l.batch_id
join public.wholesalers w on w.name = b.wholesaler
join public.customer_map cm on cm.wholesaler = b.wholesaler and cm.customer_key = l.customer_key
join public.product_map pm on pm.wholesaler = b.wholesaler and pm.product_key = l.product_key
where not cm.skip and not pm.skip and cm.outlet_code is not null and pm.sku_code is not null;

-- Outlets that have off-take in a year, bottles per month (Off-take forms page)
create or replace function public.form_outlets(p_year int)
returns table (outlet_code text, month date, btls numeric, skus bigint)
language sql stable security invoker set search_path = public as $$
  select outlet_code, month, sum(btls), count(distinct sku_code)
  from public.form_lines
  where month >= make_date(p_year, 1, 1) and month < make_date(p_year + 1, 1, 1)
  group by 1, 2;
$$;

-- Security: signed-in users only (shared passcode account)
do $$
declare t text;
begin
  foreach t in array array['wholesalers','outlets','customer_map','product_map','import_batches','ws_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "signed in" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
revoke execute on function public.form_outlets(int) from anon, public;
grant execute on function public.form_outlets(int) to authenticated;

-- The wholesaler list of the form (MAPPING sheet) + direct sales / outlet summary
insert into public.wholesalers (name, region) values
  ('Ao Nang Whisky','SOUTH'),('Asia Liqour','BANGKOK'),('Asia Supply Group','CENTRAL-EAST'),('Best Supermarket','CENTRAL-EAST'),
  ('Best Wine And Spirit','NORTH'),('Boonchai Panit','CENTRAL-EAST'),('Boozia','BANGKOK'),('Chantaburi Pisan','CENTRAL-EAST'),
  ('Cherry Kansura','BANGKOK'),('C.D. Supply','NORTH'),('CN Liqueur','BANGKOK'),('Earh Seng Huad','SOUTH'),
  ('Friendship Supermarket','CENTRAL-EAST'),('Happy Goods','BANGKOK'),('King Store','BANGKOK'),('Koh Chang Wine Gallery','CENTRAL-EAST'),
  ('Kor Wiang Phing','NORTH'),('Mongkol Liquor','BANGKOK'),('Nam Heng Jan','SOUTH'),('P.B. Liqueur','BANGKOK'),
  ('Patong Mart','SOUTH'),('Patong Whiskey','SOUTH'),('Phattanasin Plus','SOUTH'),('Phongsap Wattana','BANGKOK'),
  ('Phuket Charoenprompan','SOUTH'),('Sadumnoen','NORTH'),('Sangsawat Somthawin','SOUTH'),('Sanphet','SOUTH'),
  ('Sereewat','NORTH-EAST'),('Smile Mart','SOUTH'),('Sompop','BANGKOK'),('Songsaengsawang','BANGKOK'),
  ('Sophon All','CENTRAL-EAST'),('Southern Brew','SOUTH'),('Sri Nakorn','SOUTH'),('Supamit Store','CENTRAL-EAST'),
  ('Supercheap','SOUTH'),('Suriwong Store','BANGKOK'),('Sutee Beverage','NORTH'),('Tang Yong Seng','CENTRAL-EAST'),
  ('Taweesin','SOUTH'),('Thaniya','BANGKOK'),('The One Beverage','CENTRAL-EAST'),('Trung Suratip','SOUTH'),
  ('Ubon Rungrueng','NORTH-EAST'),('Udontaweesak','NORTH-EAST'),('Unique Asset','BANGKOK'),
  ('Kiang', null), ('Direct sales', null), ('Outlet Summary', null)
on conflict (name) do nothing;
