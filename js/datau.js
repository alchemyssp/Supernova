// ============================================================
// Data U Excel -> one row per outlet for public.outlets
//   sheet "Outlet": one row per outlet (Outlet Code, Outlet_Name, Company Name, Group Name, BDE, Current BDE, Province, Region, Status, Contract)
//   sheet "Filter": one row per outlet x SKU, used for Area / Team (and for outlets missing on "Outlet")
// ============================================================

function readDataU(buf) {
  const names = XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames;
  const want = names.filter(n => /^(outlet|filter)$/i.test(n.trim()));
  if (!want.length) throw new Error('This file has no "Outlet" or "Filter" sheet');
  const wb = XLSX.read(buf, { type: 'array', sheets: want, dense: true });
  const byCode = {};
  const put = (o, fillOnly) => {
    if (!o.code) return;
    const cur = byCode[o.code];
    if (!cur) { byCode[o.code] = o; return; }
    Object.keys(o).forEach(k => { if (o[k] != null && o[k] !== '' && (!fillOnly || cur[k] == null || cur[k] === '')) cur[k] = o[k]; });
  };
  const outletSheet = want.find(n => /^outlet$/i.test(n.trim())), filterSheet = want.find(n => /^filter$/i.test(n.trim()));
  if (outletSheet) readSheet(wb.Sheets[outletSheet], 'outlet').forEach(o => put(o, false));
  if (filterSheet) readSheet(wb.Sheets[filterSheet], 'filter').forEach(o => put(o, true));
  return Object.values(byCode);
}

function readSheet(ws, kind) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const key = v => String(v == null ? '' : v).toLowerCase().replace(/[\s_.]+/g, ' ').trim();
  const h = aoa.slice(0, 20).findIndex(r => r.some(v => key(v) === 'outlet code'));
  if (h < 0) return [];
  const head = aoa[h].map(key);
  const col = (...names) => { for (const n of names) { const i = head.lastIndexOf(n); if (i >= 0) return i; } return -1; };
  const C = {
    code: col('outlet code'), name: col('outlet name'), company: col('company name'), group: col('group name'),
    bde: col('bde'), cur: col('current bde'), area: col('area', 'area of bde'), team: col('team'),
    province: col('province'), region: col('region'),
    status: kind === 'filter' ? col('outlet status') : head.indexOf('status', 1),
    contract: kind === 'filter' ? col('current contract', 'contract') : col('contract')
  };
  const v = (r, i) => { if (i < 0) return null; const s = String(r[i] == null ? '' : r[i]).trim(); return s === '' ? null : s; };
  const out = [], seen = new Set();
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i], code = v(r, C.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, outlet_name: v(r, C.name), company_name: v(r, C.company), group_name: v(r, C.group), team: v(r, C.team),
      bde: v(r, C.bde), current_bde: v(r, C.cur), area: v(r, C.area), province: v(r, C.province), region: v(r, C.region),
      status: v(r, C.status), contract: v(r, C.contract) });
  }
  return out;
}
