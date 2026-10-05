// ============================================================
// Fill the "Off-Take & Outlet Rebate Calculation" template for one outlet and one year.
// Only the yellow input cells are written:
//   INDEX: C3 Outlet Name, C5 Legal Name, C7 BDE, C9 Area, C15 / C17 contract start / end
//   month sheets 01..12, rows 13..500 (one row per SKU): J Wholesaler, K Price Inc. VAT or L Price Ex. VAT, N Vol. (Btls.)
// Every formula, sheet and style of the template stays as it is; Excel recalculates when the file opens.
// ============================================================

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XL_EPOCH = Date.UTC(1899, 11, 30);
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - XL_EPOCH) / 86400000;

/* one value per month sheet row: lines of the same month + SKU from several WS are put together */
function formRows(lines, skuByCode) {
  const g = {};
  lines.forEach(l => {
    const k = l.month.slice(5, 7) + '|' + l.sku_code;
    (g[k] = g[k] || []).push(l);
  });
  return Object.entries(g).map(([k, ls]) => {
    const [mm, code] = k.split('|');
    const btls = ls.reduce((a, l) => a + (+l.btls || 0), 0);
    const byWs = {};
    ls.forEach(l => byWs[l.wholesaler] = (byWs[l.wholesaler] || 0) + (+l.btls || 0));
    const ws = Object.entries(byWs).sort((a, b) => b[1] - a[1])[0][0];
    /* price per bottle = weighted by bottles; one basis when all WS agree, else everything ex VAT */
    const priced = ls.filter(l => l.price_per_btl != null && +l.btls);
    const bases = new Set(priced.map(l => l.price_vat));
    let col = 'L', price = null, note = '';
    if (priced.length) {
      const pb = priced.reduce((a, l) => a + +l.btls, 0);
      if (bases.size === 1) {
        col = bases.has('inc') ? 'K' : 'L';
        price = priced.reduce((a, l) => a + l.price_per_btl * l.btls, 0) / pb;
      } else {
        price = priced.reduce((a, l) => a + (l.price_vat === 'inc' ? l.price_per_btl / 1.07 : l.price_per_btl) * l.btls, 0) / pb;
      }
    } else {
      const s = skuByCode[code];
      if (s && s.direct_price_exc) { price = s.direct_price_exc; note = 'no WS price — direct price used'; }
      else note = 'no price';
    }
    if (Object.keys(byWs).length > 1) note = (note ? note + '; ' : '') + 'from ' + Object.keys(byWs).join(' + ');
    return { month: +mm, code, btls, ws, col, price: price == null ? null : Math.round(price * 100) / 100, note };
  });
}

/* ── small XML helpers ── */
function colNum(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function getRow(doc, sheetData, r) {
  const rows = sheetData.getElementsByTagName('row');
  for (let i = 0; i < rows.length; i++) {
    const n = +rows[i].getAttribute('r');
    if (n === r) return rows[i];
    if (n > r) { const row = doc.createElementNS(NS, 'row'); row.setAttribute('r', r); sheetData.insertBefore(row, rows[i]); return row; }
  }
  const row = doc.createElementNS(NS, 'row'); row.setAttribute('r', r); sheetData.appendChild(row); return row;
}
function getCell(doc, row, ref) {
  const cs = row.getElementsByTagName('c'), want = colNum(ref);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i], n = colNum(c.getAttribute('r'));
    if (n === want) return c;
    if (n > want) { const nc = doc.createElementNS(NS, 'c'); nc.setAttribute('r', ref); row.insertBefore(nc, c); return nc; }
  }
  const nc = doc.createElementNS(NS, 'c'); nc.setAttribute('r', ref); row.appendChild(nc); return nc;
}
function clearCell(c) {
  if (c.getElementsByTagName('f').length) return false;   // never touch a formula
  while (c.firstChild) c.removeChild(c.firstChild);
  c.removeAttribute('t');
  return true;
}
function setCell(doc, sheetData, ref, value) {
  const c = getCell(doc, getRow(doc, sheetData, +ref.replace(/\D/g, '')), ref);
  if (!clearCell(c) || value == null || value === '') return;
  if (typeof value === 'number') {
    const v = doc.createElementNS(NS, 'v'); v.textContent = String(value); c.appendChild(v);
  } else {
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't');
    t.textContent = String(value); is.appendChild(t); c.appendChild(is);
  }
}

/* sheet name -> file path inside the xlsx */
async function sheetPaths(zip) {
  const wb = new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml');
  const rels = new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml');
  const target = {};
  [...rels.getElementsByTagName('Relationship')].forEach(r => target[r.getAttribute('Id')] = r.getAttribute('Target'));
  const out = {};
  [...wb.getElementsByTagName('sheet')].forEach(s => {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    let t = target[rid].replace(/^\//, '');
    out[s.getAttribute('name')] = t.startsWith('xl/') ? t : 'xl/' + t;
  });
  return out;
}

async function editSheet(zip, path, fn) {
  const doc = new DOMParser().parseFromString(await zip.file(path).async('string'), 'application/xml');
  fn(doc, doc.getElementsByTagName('sheetData')[0]);
  zip.file(path, new XMLSerializer().serializeToString(doc));
}

/* outlet: row of public.outlets · rows: from formRows() · returns a Blob */
async function buildOutletForm(outlet, year, rows, skus) {
  const buf = await fetch('templates/offtake_form.xlsx?v=1').then(r => { if (!r.ok) throw new Error('Template not found'); return r.arrayBuffer(); });
  const zip = await JSZip.loadAsync(buf);
  const paths = await sheetPaths(zip);
  const rowOf = {}; skus.forEach(s => rowOf[s.code] = s.row);

  await editSheet(zip, paths['INDEX'], (doc, sd) => {
    setCell(doc, sd, 'C3', outlet.outlet_name || '');
    setCell(doc, sd, 'C5', outlet.company_name || '');
    setCell(doc, sd, 'C7', outlet.current_bde || outlet.bde || '');
    setCell(doc, sd, 'C9', outlet.area || outlet.province || '');
    setCell(doc, sd, 'C11', '');
    setCell(doc, sd, 'C13', '');
    setCell(doc, sd, 'C15', serial(year, 1, 1));
    setCell(doc, sd, 'C17', serial(year, 12, 31));
  });

  for (let m = 1; m <= 12; m++) {
    const name = String(m).padStart(2, '0');
    if (!paths[name]) continue;
    const mine = rows.filter(r => r.month === m && rowOf[r.code]);
    await editSheet(zip, paths[name], (doc, sd) => {
      /* empty the input cells first (the template has a sample entry) */
      [...sd.getElementsByTagName('row')].forEach(row => {
        const r = +row.getAttribute('r');
        if (r < 13 || r > 500) return;
        [...row.getElementsByTagName('c')].forEach(c => { if (/^[JKLN]\d+$/.test(c.getAttribute('r'))) clearCell(c); });
      });
      mine.forEach(x => {
        const r = rowOf[x.code];
        setCell(doc, sd, 'J' + r, x.ws);
        if (x.price != null) setCell(doc, sd, x.col + r, x.price);
        setCell(doc, sd, 'N' + r, x.btls);
      });
    });
  }

  /* recalculate everything when Excel opens the file */
  const wbPath = 'xl/workbook.xml';
  let wbXml = await zip.file(wbPath).async('string');
  wbXml = /<calcPr\b/.test(wbXml)
    ? wbXml.replace(/<calcPr\b([^>]*?)\/?>/, (m, a) => '<calcPr' + a.replace(/\s*fullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"/>')
    : wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  zip.file(wbPath, wbXml);

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
