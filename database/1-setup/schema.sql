-- ============================================================
-- Supernova — the whole database as it is today (2026-10-06)
-- For a new Supabase project: run this file once in the SQL Editor.
-- It only creates what is missing; it never deletes tables or data, so running it again is safe.
--
--   wholesalers       the WS list, price Inc./Ex. VAT, saved file layout
--   outlets           Data U outlet master (uploaded from the Data U Excel)
--   customer_map      WS customer -> Data U outlet   (WS Database · Customers)
--   product_map       WS product  -> form SKU        (WS Database · Products)
--   import_batches    one WS report = one WS + one month
--   ws_lines          the lines read from that report
--   offtake_history   off-take filled in the team forms before the website
--   form_overrides    changes saved in the Off-take preview
--   form_lines (view) every line ready for an outlet's form
--   form_outlets()    bottles per outlet and month (Off-take page)
-- ============================================================

create table if not exists public.wholesalers (
  name        text primary key,
  region      text,
  price_vat   text not null default 'exc' check (price_vat in ('inc', 'exc')),
  layout      text not null default 'table',
  config      jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists public.outlets (
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

create table if not exists public.customer_map (
  wholesaler      text not null references public.wholesalers(name) on update cascade on delete cascade,
  customer_key    text not null,
  raw_name        text,
  outlet_code     text,
  skip            boolean not null default false,
  customer_code   text,
  customer_name   text,
  ws_outlet_name  text,
  updated_at      timestamptz not null default now(),
  primary key (wholesaler, customer_key)
);

create table if not exists public.product_map (
  wholesaler   text not null references public.wholesalers(name) on update cascade on delete cascade,
  product_key  text not null,
  raw_name     text,
  sku_code     text,
  factor       numeric not null default 1,
  skip         boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (wholesaler, product_key)
);

create table if not exists public.import_batches (
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

create table if not exists public.offtake_history (
  id            bigint generated always as identity primary key,
  outlet_code   text not null,
  month         date not null,
  wholesaler    text,
  sku_code      text not null,
  btls          numeric not null,
  price_per_btl numeric,
  price_vat     text not null default 'exc' check (price_vat in ('inc', 'exc')),
  source        text,
  created_at    timestamptz not null default now()
);
create index if not exists offtake_history_outlet_idx on public.offtake_history(outlet_code, month);
create index if not exists offtake_history_month_idx on public.offtake_history(month);

create table if not exists public.form_overrides (
  outlet_code  text not null,
  month        date not null,
  sku_code     text not null,
  wholesaler   text,
  price        numeric,
  price_col    text not null default 'L' check (price_col in ('K', 'L')),
  btls         numeric,
  removed      boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (outlet_code, month, sku_code)
);

-- uploaded WS reports + forms filled before; a WS report of a month replaces that WS's history of the month
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

create or replace function public.form_outlets(p_year int)
returns table (outlet_code text, month date, btls numeric, skus bigint)
language sql stable security invoker set search_path = public as $$
  select outlet_code, month, sum(btls), count(distinct sku_code)
  from public.form_lines
  where month >= make_date(p_year, 1, 1) and month < make_date(p_year + 1, 1, 1)
  group by 1, 2;
$$;

-- signed-in users only (the shared passcode account)
do $$
declare t text;
begin
  foreach t in array array['wholesalers','outlets','customer_map','product_map','import_batches','ws_lines','offtake_history','form_overrides'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "signed in" on public.%I', t);
    execute format('create policy "signed in" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
revoke execute on function public.form_outlets(int) from anon, public;
grant execute on function public.form_outlets(int) to authenticated;

-- the wholesaler list of the form (MAPPING sheet) + direct sales / outlet summary
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

-- descriptions shown in the Supabase Table Editor
comment on table public.wholesalers      is 'WS list · price in the report Inc./Ex. VAT (form column K / L) · saved file layout';
comment on table public.outlets          is 'Data U outlet master · uploaded from the Data U Excel on the Data U page';
comment on table public.customer_map     is 'WS Database · Customers: WS customer name -> Data U outlet (remembered)';
comment on table public.product_map      is 'WS Database · Products: WS product name -> SKU of the Off-take form (remembered)';
comment on table public.import_batches   is 'One uploaded WS report = one wholesaler + one month (uploading again replaces it)';
comment on table public.ws_lines         is 'Lines read from an uploaded WS report';
comment on table public.offtake_history  is 'Off-take filled in the team forms before the website (Load Forms page)';
comment on table public.form_overrides   is 'Changes saved in the Off-take preview · win over the WS data for that outlet + month + SKU';
comment on view  public.form_lines       is 'Every line ready for an outlet''s form: WS reports + forms before; a WS report replaces that WS''s history of the month';
comment on function public.form_outlets(int) is 'Bottles per outlet and month of a year (Off-take page)';

comment on column public.wholesalers.price_vat     is 'inc = price goes to column K (Inc. VAT) · exc = column L (Ex. VAT)';
comment on column public.customer_map.customer_key is 'customer name (+ shop) as written by the WS, lower case';
comment on column public.customer_map.customer_code is 'the WS''s own customer code';
comment on column public.customer_map.skip          is 'true = not an outlet (cash sale, staff ...)';
comment on column public.product_map.factor         is 'bottles per WS unit (6 or 12 when the WS counts cases)';
comment on column public.offtake_history.source     is 'where the lines came from, e.g. forms 2026';
comment on column public.form_overrides.removed     is 'true = this SKU is taken out of the form for that month';
