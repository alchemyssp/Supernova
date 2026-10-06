# Supernova — WS reports -> Off-take (sheet 01 layout of the Off-Take & Outlet Rebate Calculation form)

Static site (HTML + vanilla JS, no build) on Vercel, data in Supabase project **Supernova**.
index.html = passcode login, app.html = the whole site on one page:

1. **Data U** — upload "New Data Universe_<date>.xlsm" (sheets Outlet + Filter, js/datau.js) -> public.outlets.
2. **Upload WS report** — wholesaler (guessed from the file name) + "Price in the report" Inc./Ex. VAT (saved per WS).
   The layout is read (table / grouped / BOOZIA report, js/parsers.js) and saved per WS; same WS + month again
   replaces it. Each customer -> Data U outlet and product -> form SKU (js/match.js): remembered answers first,
   good name matches are kept straight away, only the ones not found are listed to pick or skip.
   "The columns look wrong?" opens the column / month settings.
3. **Off-take** — month + sales (BDE, from Data U Current BDE) -> one Excel, one sheet per outlet, each a copy of
   sheet "01" of the form (js/sheet-export.js): C2 outlet, C3 legal name, C5 BDE, F2 area, C9 outlet code,
   C10 month; per SKU row J Wholesaler, K or L price, N Vol. (Btls.) (js/form-fill.js formRows).
   Formulas reading other sheets of the form become values; the sheet's own totals stay and recalculate on open.

## Template
templates/offtake_form.xlsx = "Off-Take & Outlet Rebate Calculation - ALC_BBC - 22 SEP 26.xlsx"
(fix: WHOLESALE!L2836 '08' -> '09'). Only its sheet "01", styles, theme and shared strings are used; the style
links to xl/featurePropertyBag are removed when building (Excel refuses the file otherwise).
templates/form_skus.js = SKU rows 13–500 of the month sheets (code, product, size, direct price); rows after 394
are not added up by the form's formulas (calc = false).

## Setup
- database/schema.sql — tables, view form_lines, RPC form_outlets, RLS (signed-in only), wholesaler list
- js/config.js — Supabase URL + anon key, SHARED_ACCOUNT_EMAIL (the passcode = that account's password)
