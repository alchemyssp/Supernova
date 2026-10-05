# Supernova — Off-take from wholesaler reports

Static site (HTML + vanilla JS, no build) on Vercel, data in Supabase project **Supernova**.

## Monthly flow
1. **Import WS report** (import.html) — choose the wholesaler + month, drop the WS file. The layout is read
   (table / grouped / BOOZIA report); the column letters are saved per WS so next month it just reads.
2. **Matching** (matching.html) — each WS customer -> Outlet Code, each WS product -> SKU Code (+ bottles per unit).
   Saved in customer_map / product_map and reused every month. Suggestions come from name similarity
   and from the same name already matched at another WS.
3. **Send to Off-take** — RPC confirm_batch(): matched lines -> offtake, priced with the SKU master
   (Price INC/EXC, Direct price, Liter). Replaces what that WS already had for that month.
4. **Off-take** (offtake.html) — filters + Export Excel in the 25 columns of "Data_Total Off-Take".
   Current Team / Current BDE always come from today's outlet master.

## Masters (masters.html)
Outlets, SKUs, wholesalers. "Load from Off-take file" reads sheet Data_Total Off-Take of
"Actual Off-Take by SKUs JAN 24 - <MON> 26.xlsx": updates outlets + SKUs (latest row wins) and,
optionally, replaces the history rows (offtake.batch_id is null).

## Setup
- database/schema.sql — tables, view offtake_v, RPCs, RLS (signed-in only)
- js/config.js — Supabase URL + anon key, SHARED_ACCOUNT_EMAIL (the passcode = that account's password)
