# Supernova — WS reports -> Off-Take & Outlet Rebate Calculation forms

Static site (HTML + vanilla JS, no build) on Vercel, data in Supabase project **Supernova**.

## Pages
1. **Import WS report** (import.html)
   - Step 1: wholesaler + month + file. The layout is read (table / grouped / BOOZIA report, js/parsers.js) and
     saved per WS. Uploading the same WS + month again replaces it.
   - Step 2: each WS customer -> Data U outlet, each WS product -> form SKU (js/match.js). Remembered answers
     are used again; otherwise the closest name is picked ("Auto — check") or left "Not found". Save keeps them.
2. **Off-take forms** (forms.html) — outlets with bottles per month; "Download form" fills
   templates/offtake_form.xlsx for that outlet and year (js/form-fill.js):
   INDEX C3/C5/C7/C9 (outlet, legal name, BDE, area), C15/C17 (1 Jan – 31 Dec), and on sheets 01–12 per SKU row
   J Wholesaler, K Price Inc. VAT or L Price Ex. VAT (per WS setting), N Vol. (Btls.). Formulas are untouched;
   Excel recalculates on open. Several WS for one SKU in a month: bottles added, the biggest WS named, price
   weighted. No WS price: the direct price of the MAPPING sheet goes in L.
3. **Settings** (settings.html) — upload Data U ("New Data Universe_<date>.xlsm", sheets Outlet + Filter,
   js/datau.js); per wholesaler: price Inc./Ex. VAT, saved layout, shown on Import.

## Template
templates/offtake_form.xlsx = "Off-Take & Outlet Rebate Calculation - ALC_BBC - 22 SEP 26.xlsx" with one fix:
WHOLESALE!L2836 read '08' (August twice, September never) -> '09'.
templates/form_skus.json = the SKU rows of the month sheets (row 13–500, code, product, size, direct price);
rows after 394 are not added up by the form's own formulas (calc = false).
If the form changes, copy the new file in and rebuild form_skus.json from sheet 01 column B + MAPPING.

## Setup
- database/schema.sql — tables, view form_lines, RPC form_outlets, RLS (signed-in only), wholesaler list
- js/config.js — Supabase URL + anon key, SHARED_ACCOUNT_EMAIL (the passcode = that account's password)
