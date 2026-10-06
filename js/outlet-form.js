// ============================================================
// One outlet = one "Off-Take & Outlet Rebate Calculation" file with all 12 months.
// The whole template is kept (INDEX, MAPPING for % Rebate, CASH REBATE claim form, FOC FORM,
// SUMMARY, WHOLESALE ...); only the input cells are written:
//   INDEX: C3 Outlet Name, C5 Legal Name, C7 BDE, C9 Area, C15 / C17 contract start / end (1 Jan – 31 Dec)
//   sheets 01..12, rows 13..500 (one per SKU): J Wholesaler, K Price Inc. VAT or L Price Ex. VAT, N Vol. (Btls.)
// Excel recalculates every formula when the file opens. Needs form-fill.js and JSZip.
// ============================================================

const XL_EPOCH = Date.UTC(1899, 11, 30);
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - XL_EPOCH) / 86400000;
let TEMPLATE_BUF = null;

async function templateBuffer() {
  if (location.protocol === 'file:') throw new Error('Export works on the website (vercel.app), not from the file on this computer');
  if (!TEMPLATE_BUF) {
    const r = await fetch('templates/offtake_form.xlsx?v=2');
    if (!r.ok) throw new Error('Template not found');
    TEMPLATE_BUF = await r.arrayBuffer();
  }
  return TEMPLATE_BUF;
}

async function editSheet(zip, path, fn) {
  const doc = new DOMParser().parseFromString(await zip.file(path).async('string'), 'application/xml');
  fn(doc, doc.getElementsByTagName('sheetData')[0]);
  zip.file(path, new XMLSerializer().serializeToString(doc));
}

/* outlet: row of public.outlets · rows: formRows() of that outlet for the year · returns a Blob */
async function buildOutletForm(outlet, year, rows, skus) {
  const zip = await JSZip.loadAsync(await templateBuffer());
  const paths = await sheetPaths(zip);
  const rowOf = {}; skus.forEach(s => rowOf[s.code] = s.row);

  await editSheet(zip, paths['INDEX'], (doc, sd) => {
    setCell(doc, sd, 'C3', outlet.outlet_name || outlet.code);
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

const formFileName = (o, year) => `Off-Take & Outlet Rebate Calculation - ${String(o.outlet_name || o.code).replace(/[\\/:*?"<>|]/g, ' ').trim()} - ${year}.xlsx`;

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
