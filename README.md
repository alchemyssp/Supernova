# Supernova — "Make your life easier"

WS (wholesaler) sales reports → which Data U outlet → the **Off-Take & Outlet Rebate Calculation** form of each outlet.
Static site (HTML + vanilla JS, no build) on Vercel · data in the Supabase project **Supernova** · login = one shared passcode.

Live: https://supernova-sand-seven.vercel.app · GitHub: alchemyssp/Supernova (push to `main` = deploy)

## Pages
| Page | File | What it does |
|---|---|---|
| Login | `index.html` | passcode → shared Supabase account (`js/config.js`) |
| Home | `home.html` | 6 cards in two rows |
| Data U | `datau.html` | outlet master table + upload the Data U Excel |
| Upload WS Report | `upload.html` | read a WS file → Identify Outlet / Identify Product |
| Off-take | `offtake.html` | outlets × months, Preview + edit, export 1 file per outlet (.zip for many) |
| WS Database | `wsdb.html` | per WS: customer → Data U outlet, product → form SKU |
| Reports | `reports.html` | months uploaded per WS, reports list, wholesaler settings (Inc./Ex. VAT) |
| Load Forms | `history.html` | load the 2026 forms filled before the website (CSV) |

## Folders
```
css/app.css            the look (dark grey + white glass)
img/                   Supernova's wordmark + icons
js/
  config.js            Supabase URL + anon key, shared account e-mail
  common.js            login guard, page header, formatting, name matching scores, saving helpers
  parsers.js           reading the WS layouts: table / grouped (VAT, CD) / BOOZIA report
  match.js             suggestions: WS customer → Data U outlet, WS product → form SKU
  datau.js             reading the Data U Excel (sheets Outlet + Filter)
  form-fill.js         WS lines → rows of the form (formRows), preview changes (applyOverrides), XML cell helpers
  outlet-form.js       fills templates/offtake_form.xlsx for one outlet (12 months)
templates/
  offtake_form.xlsx    the form (ALC_BBC 22 SEP 26; fix: WHOLESALE!L2836 '08' → '09')
  form_skus.js         SKU rows 13–500 of the month sheets (rows after 394 are not added up by the form)
database/
  1-setup/schema.sql   the whole database today — for a NEW project, run once (never deletes anything)
  2-updates/           what was run on the live project, in order (date_number_name.sql)
```

## Database (Supabase · Supernova)
| Table | Holds |
|---|---|
| `wholesalers` | WS list, price Inc./Ex. VAT, saved file layout |
| `outlets` | Data U outlets |
| `customer_map` / `product_map` | WS Database (remembered matches) |
| `import_batches` / `ws_lines` | uploaded WS reports (one per WS + month) |
| `offtake_history` | forms filled before the website |
| `form_overrides` | changes saved in the Off-take preview |
| `form_lines` (view) | everything ready for the forms; a WS report of a month replaces that WS's history |
