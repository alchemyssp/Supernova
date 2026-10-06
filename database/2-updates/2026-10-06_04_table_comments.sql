-- Supernova · descriptions shown in the Supabase Table Editor (run once; can be run again)
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
