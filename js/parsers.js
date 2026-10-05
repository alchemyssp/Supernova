// ============================================================
// Reading the WS reports. Every WS sends a different layout:
//   table   – one sale per row (CN Liquor, Patong Whisky, Kiang, Somphop, Taweesin ...)
//   grouped – a customer name on its own row, its products on the rows below, "Total" rows between (VAT, Chiangmai CD)
//   boozia  – BOOZIA "Sales History by Customer" (customer row > product row > invoice rows)
// The column letters of a WS are saved in wholesalers.config the first time, so next month it just reads.
// ============================================================

const FIELDS = [
  ['date', 'Date'], ['invoice', 'Invoice'], ['customer_code', 'Customer code'], ['customer', 'Customer name'],
  ['outlet', 'Outlet / shop name'], ['product_code', 'Product code'], ['product', 'Product name'],
  ['qty', 'Quantity'], ['unit_price', 'Unit price'], ['amount', 'Amount'], ['salesman', 'Salesman']
];
const NEED = ['customer', 'product', 'qty'];

const colLetter = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = l => { if (!l) return -1; let n = 0; for (const c of String(l).toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
const cell = (row, l) => { const i = colIndex(l); return i < 0 || !row ? '' : row[i]; };
const txt = v => String(v == null ? '' : v)
  .replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]))
  .replace(/\s+/g, ' ').trim();
/* quantity; "1/1" with a unit like "กล12/ขว" (box of 12 / bottle) = 1 box + 1 bottle = 13 */
function qtyOf(v, row) {
  const n = toNum(v);
  if (n != null) return n;
  const m = txt(v).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const unit = (row || []).map(txt).join(' ').match(/กล\.?\s*(\d+)|\*\s*(\d+)/);
  const pack = unit ? +(unit[1] || unit[2]) : 0;
  return pack ? +m[1] * pack + +m[2] : null;
}
const isTotal = s => /^(total|grand total|รวม|ยอดรวม|sub ?total)\b/i.test(txt(s));

/* header words that tell which column is which (English + Thai) */
const HINTS = {
  date: /^(date|วันที่|period|doc ?date|invoice date)$/i,
  invoice: /invoice|document|doc ?#|เลขที่|di_ref/i,
  customer_code: /^(code|customer code|รหัส|ar_code|รหัสล\/น|cust\.? ?code)$/i,
  customer: /customer|accounting name|ลูกค้า|ลูกหนี้|department|ชื่อบัญชี|^name$/i,
  outlet: /outlet|shop/i,
  product_code: /stock code|รหัสสินค้า|item code|product code/i,
  product: /product|sku|description|สินค้า|รายการ/i,
  qty: /qty|quantity|จำนวน|amount \(btls|ขวด\)/i,
  unit_price: /unit price|price per|ราคา\/หน่วย|ราคาขายต่อหน่วย|per bottle/i,
  amount: /total amt|total price|^amount$|^total$|รวมเป็นเงิน|ราคารวม|net amount|ขายสุทธิ/i,
  salesman: /salesman|sales|พนง/i
};

/* first rows that look like a header: most cells are text */
function findHeaderRow(aoa) {
  let best = 0, bestScore = -1;
  for (let r = 0; r < Math.min(aoa.length, 30); r++) {
    const row = aoa[r] || [];
    let score = 0;
    row.forEach(v => { const s = txt(v); if (!s) return; for (const k in HINTS) if (HINTS[k].test(s)) { score++; break; } });
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best + 1;   // 1-based like Excel
}

function guessColumns(aoa, headerRow) {
  const head = (aoa[headerRow - 1] || []).map(txt);
  const cols = {};
  const used = new Set();
  /* the most specific fields first so "Unit Price" is not taken as the product, "Customer Code" not as customer name */
  ['customer_code', 'product_code', 'unit_price', 'invoice', 'date', 'outlet', 'qty', 'amount', 'customer', 'product', 'salesman'].forEach(k => {
    for (let i = 0; i < head.length; i++) {
      if (used.has(i) || !head[i]) continue;
      if (HINTS[k].test(head[i])) { cols[k] = colLetter(i); used.add(i); break; }
    }
  });
  return cols;
}

/* which layout a sheet looks like */
function guessLayout(aoa) {
  const top = aoa.slice(0, 12).map(r => (r || []).map(txt).join(' ')).join(' ');
  if (/sales history by customer/i.test(top)) return { layout: 'boozia', config: {} };
  const headerRow = findHeaderRow(aoa);
  const cols = guessColumns(aoa, headerRow);
  const g = !cols.date && guessGrouped(aoa, headerRow, cols);
  if (g) return { layout: 'grouped', config: g };
  return { layout: 'table', config: { headerRow, cols } };
}

/* grouped: rows with one name only (the customer) followed by rows with a name + numbers (its products) */
function guessGrouped(aoa, headerRow, cols) {
  const most = list => { const c = {}; list.forEach(x => c[x] = (c[x] || 0) + 1); return +Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };
  const custCols = [], prodCols = [], qtyCols = [], lastNum = [];
  for (let r = headerRow; r < Math.min(aoa.length, headerRow + 80); r++) {
    const row = aoa[r] || [];
    const filled = row.map((v, i) => txt(v) ? i : -1).filter(i => i >= 0);
    if (!filled.length) continue;
    const nums = filled.filter(i => toNum(row[i]) != null);
    if (filled.length === 1 && !nums.length) { if (!isTotal(row[filled[0]])) custCols.push(filled[0]); continue; }
    const text = filled.find(i => toNum(row[i]) == null);
    if (text == null || isTotal(row[text]) || !nums.length) continue;
    prodCols.push(text);
    const after = nums.filter(i => i > text);
    if (after.length) { qtyCols.push(after[0]); lastNum.push(after[after.length - 1]); }
  }
  if (custCols.length < 3 || prodCols.length < 3 || !qtyCols.length) return null;
  const qty = most(qtyCols);
  const hinted = colIndex(cols.amount);
  const amount = hinted >= 0 && hinted !== qty ? hinted : most(lastNum);
  return { headerRow, customerCol: colLetter(most(custCols)), productCol: colLetter(most(prodCols)), qtyCol: colLetter(qty),
           amountCol: amount !== qty ? colLetter(amount) : '', priceCol: cols.unit_price && colIndex(cols.unit_price) !== qty ? cols.unit_price : '' };
}

/* month written on the report ("Period: 01/09/2026 to 30/09/2026", "Report as of SEP 2026", "1 ส.ค. 2569") */
function guessMonth(aoa, lines) {
  const top = aoa.slice(0, 8).map(r => (r || []).map(txt).join(' ')).join(' ');
  const ym = (y, mo) => { y = +y; if (y < 100) y += 2000; if (y > 2400) y -= 543; return `${y}-${String(mo).padStart(2, '0')}`; };
  /* "Date From 01/09/2026", "Period: 01/09/2026" (not the print date of the report) */
  let m = top.match(/(?:from|period)\s*:?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
  if (m) return ym(m[3], m[2]);
  /* the month most lines are dated in */
  const count = {};
  lines.forEach(l => { if (l.doc_date) { const k = l.doc_date.slice(0, 7); count[k] = (count[k] || 0) + 1; } });
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  const EN = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  m = top.toUpperCase().match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.? ?'?(\d{2,4})\b/);
  if (m) { let y = +m[2]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return `${y}-${String(EN.indexOf(m[1]) + 1).padStart(2, '0')}`; }
  const TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  for (let i = 0; i < 12; i++) {
    const r = new RegExp(TH[i].replace(/\./g, '\\.') + '\\s*(\\d{4})');
    const t = top.match(r);
    if (t) return ym(t[1], i + 1);
  }
  m = top.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  return m ? ym(m[3], m[2]) : '';
}

function lineKeyFields(l) {
  l.customer_key = normKey(l.customer_raw) + (l.outlet_raw ? ' | ' + normKey(l.outlet_raw) : '');
  l.product_key = normKey(l.product_raw);
  return l;
}

/* ── table ── */
function parseTable(aoa, config) {
  const c = config.cols || {};
  const out = [];
  for (let r = (config.headerRow || 1); r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const product = txt(cell(row, c.product));
    const customer = txt(cell(row, c.customer));
    const outlet = txt(cell(row, c.outlet));
    const qty = qtyOf(cell(row, c.qty), row);
    if (!product || qty == null || isTotal(customer) || isTotal(product)) continue;
    if (!customer && !outlet && !c.customer_code) continue;
    out.push(lineKeyFields({
      doc_date: toISODate(cell(row, c.date)),
      invoice: txt(cell(row, c.invoice)) || null,
      customer_code: txt(cell(row, c.customer_code)) || null,
      customer_raw: customer || txt(cell(row, c.customer_code)),
      outlet_raw: outlet || null,
      product_code: txt(cell(row, c.product_code)) || null,
      product_raw: product,
      qty,
      unit_price: toNum(cell(row, c.unit_price)),
      amount: toNum(cell(row, c.amount)),
      salesman: txt(cell(row, c.salesman)) || null
    }));
  }
  out.forEach(l => { if (l.amount == null && l.unit_price != null) l.amount = l.unit_price * l.qty; if (l.unit_price == null && l.amount != null && l.qty) l.unit_price = l.amount / l.qty; });
  return out;
}

/* ── grouped (VAT, CD) ── */
function parseGrouped(aoa, config) {
  const out = [];
  let customer = '';
  for (let r = (config.headerRow || 1); r < aoa.length; r++) {
    const row = aoa[r] || [];
    const cName = txt(cell(row, config.customerCol));
    const pName = txt(cell(row, config.productCol));
    const qty = qtyOf(cell(row, config.qtyCol), row);
    if (isTotal(cName) || isTotal(pName)) continue;
    if (qty == null) { if (cName) customer = cName; continue; }   // a customer header row
    if (!pName || !customer) continue;
    const amount = toNum(cell(row, config.amountCol));
    const price = toNum(cell(row, config.priceCol));
    out.push(lineKeyFields({
      doc_date: null, invoice: null, customer_code: null, customer_raw: customer, outlet_raw: null,
      product_code: null, product_raw: pName, qty,
      unit_price: price != null ? price : (amount != null && qty ? amount / qty : null),
      amount: amount != null ? amount : (price != null ? price * qty : null), salesman: null
    }));
  }
  return out;
}

/* ── BOOZIA "Sales History by Customer" ── */
function parseBoozia(aoa) {
  let h = aoa.findIndex(r => (r || []).some(v => /^customer name$/i.test(txt(v))));
  if (h < 0) throw new Error('This file has no "Customer Name" header — is it the BOOZIA Sales History report?');
  const head = aoa[h].map(txt);
  const ix = re => head.findIndex(v => re.test(v));
  const C = { name: ix(/^customer name$/i), code: ix(/^customer code$/i), desc: ix(/^description$/i), stock: ix(/^stock code$/i),
              date: ix(/^date$/i), doc: ix(/^document/i), qty: ix(/^qty$/i), price: ix(/^unit price$/i), amt: ix(/^total amt$/i) };
  const out = [];
  let cust = null, prod = null;
  for (let r = h + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const a = txt(row[C.name]), desc = txt(row[C.desc]), d = row[C.date], docTxt = txt(row[C.doc]);
    if (a && !isTotal(a)) { cust = { name: a, code: txt(row[C.code]) }; prod = null; continue; }
    if (desc) { prod = { name: desc, code: txt(row[C.stock]) }; continue; }
    if (isTotal(d) || /^invoice$/i.test(docTxt)) continue;
    const date = toISODate(d), qty = toNum(row[C.qty]);
    if (!cust || !prod || !date || qty == null) continue;
    out.push(lineKeyFields({
      doc_date: date, invoice: docTxt || null, customer_code: cust.code || null, customer_raw: cust.name, outlet_raw: null,
      product_code: prod.code || null, product_raw: prod.name, qty,
      unit_price: toNum(row[C.price]), amount: toNum(row[C.amt]), salesman: null
    }));
  }
  return out;
}

function parseSheet(aoa, layout, config) {
  if (layout === 'boozia') return parseBoozia(aoa);
  if (layout === 'grouped') return parseGrouped(aoa, config);
  return parseTable(aoa, config);
}
