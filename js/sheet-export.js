// ============================================================
// Off-take Excel: one sheet per outlet (and month), each a copy of sheet "01" of the
// "Off-Take & Outlet Rebate Calculation" form — same columns, colours and formulas.
// Formulas that read other sheets of the form (INDEX, MAPPING, CASH REBATE) become plain values;
// formulas inside the sheet (totals, rebate, summary at the top) stay and Excel recalculates on open.
// Needs form-fill.js (formRows, XML helpers) and JSZip.
// ============================================================

const MONTH_UP = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function safeSheetName(s, used) {
  let n = String(s || 'Outlet').replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Outlet';
  let k = n, i = 2;
  while (used.has(k.toLowerCase())) { const suf = ' (' + i++ + ')'; k = n.slice(0, 31 - suf.length) + suf; }
  used.add(k.toLowerCase());
  return k;
}

/* the sheet "01" XML with every link to other sheets turned into its value */
function standaloneSheet(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const fs = [...doc.getElementsByTagName('f')];
  const badShared = new Set();
  fs.forEach(f => { if (f.textContent.includes('!') && f.getAttribute('t') === 'shared') badShared.add(f.getAttribute('si')); });
  fs.forEach(f => {
    const shared = f.getAttribute('t') === 'shared' && badShared.has(f.getAttribute('si'));
    if (f.textContent.includes('!') || shared) f.parentNode.removeChild(f);
  });
  /* cell metadata (dynamic arrays) lives in a part this workbook does not have;
     a formula text result without its formula becomes plain text */
  [...doc.getElementsByTagName('c')].forEach(c => {
    c.removeAttribute('cm');
    if (c.getAttribute('t') === 'str' && !c.getElementsByTagName('f').length) {
      const v = c.getElementsByTagName('v')[0], text = v ? v.textContent : '';
      while (c.firstChild) c.removeChild(c.firstChild);
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't');
      t.textContent = text; is.appendChild(t); c.appendChild(is);
    }
  });
  [...doc.getElementsByTagName('dataValidation')].forEach(v => { if (v.textContent.includes('!')) v.parentNode.removeChild(v); });
  [...doc.getElementsByTagName('dataValidations')].forEach(v => {
    const n = v.getElementsByTagName('dataValidation').length;
    if (!n) v.parentNode.removeChild(v); else v.setAttribute('count', n);
  });
  /* drop-down lists that point at other sheets, and the printer settings link */
  [...doc.getElementsByTagName('ext')].forEach(e => { if (e.getElementsByTagName('x14:dataValidations').length || /dataValidations/.test(e.innerHTML || '')) e.parentNode.removeChild(e); });
  const ext = doc.getElementsByTagName('extLst')[0];
  if (ext && !ext.getElementsByTagName('ext').length) ext.parentNode.removeChild(ext);
  [...doc.getElementsByTagName('pageSetup')].forEach(p => p.removeAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
  [...doc.getElementsByTagName('sheetView')].forEach(v => v.removeAttribute('tabSelected'));
  return new XMLSerializer().serializeToString(doc);
}

/* sheets: [{ outlet, month (1-12), year, rows: formRows() of that outlet+month }] -> Blob */
async function buildOfftakeWorkbook(sheets, skus) {
  const buf = await fetch('templates/offtake_form.xlsx?v=2').then(r => { if (!r.ok) throw new Error('Template not found'); return r.arrayBuffer(); });
  const src = await JSZip.loadAsync(buf);
  const paths = await sheetPaths(src);
  const base = standaloneSheet(await src.file(paths['01']).async('string'));
  const rowOf = {}; skus.forEach(s => rowOf[s.code] = s.row);

  const out = new JSZip();
  for (const p of ['xl/styles.xml', 'xl/theme/theme1.xml', 'xl/sharedStrings.xml', 'docProps/core.xml']) {
    if (!src.file(p)) continue;
    let text = await src.file(p).async('string');
    /* cell styles point at xl/featurePropertyBag (not copied) — Excel refuses the file with those links */
    if (p === 'xl/styles.xml') text = text.replace(/<extLst><ext uri="\{C7286773-470A-42A8-94C5-96B5CB345126\}"[\s\S]*?<\/extLst>/g, '');
    out.file(p, text);
  }
  const used = new Set(), list = [];
  sheets.forEach((s, i) => {
    const doc = new DOMParser().parseFromString(base, 'application/xml');
    const sd = doc.getElementsByTagName('sheetData')[0];
    const o = s.outlet;
    setCell(doc, sd, 'C2', o.outlet_name || o.code);
    setCell(doc, sd, 'C3', o.company_name || '');
    setCell(doc, sd, 'C5', o.current_bde || o.bde || '');
    setCell(doc, sd, 'F2', o.area || o.province || '');
    setCell(doc, sd, 'F3', '');
    setCell(doc, sd, 'F5', '');
    setCell(doc, sd, 'C7', o.contract || '');
    setCell(doc, sd, 'B9', 'Outlet Code :');
    setCell(doc, sd, 'C9', o.code);
    setCell(doc, sd, 'C10', MONTH_UP[s.month - 1] + ' ' + String(s.year).slice(2));
    [...sd.getElementsByTagName('row')].forEach(row => {
      const r = +row.getAttribute('r');
      if (r < 13 || r > 500) return;
      [...row.getElementsByTagName('c')].forEach(c => { if (/^[JKLN]\d+$/.test(c.getAttribute('r'))) clearCell(c); });
    });
    s.rows.forEach(x => {
      const r = rowOf[x.code];
      if (!r) return;
      setCell(doc, sd, 'J' + r, x.ws);
      if (x.price != null) setCell(doc, sd, x.col + r, x.price);
      setCell(doc, sd, 'N' + r, x.btls);
    });
    if (i === 0) [...doc.getElementsByTagName('sheetView')].forEach(v => v.setAttribute('tabSelected', '1'));
    const name = safeSheetName((sheets.some(t => t.month !== s.month) ? String(s.month).padStart(2, '0') + ' ' : '') + (o.outlet_name || o.code), used);
    out.file(`xl/worksheets/sheet${i + 1}.xml`, new XMLSerializer().serializeToString(doc));
    list.push(name);
  });

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  out.file('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    list.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
    '<definedNames>' + list.map((n, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(n.replace(/'/g, "''"))}'!$B$12:$T$365</definedName>`).join('') + '</definedNames>' +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  const n = list.length;
  out.file('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` +
    `<Relationship Id="rId${n + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  out.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    (src.file('docProps/core.xml') ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' : '') +
    '</Relationships>');
  out.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    (src.file('docProps/core.xml') ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' : '') +
    '</Types>');
  Object.keys(out.files).forEach(k => { if (out.files[k].dir) delete out.files[k]; });   // no folder entries in the package
  return out.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}
