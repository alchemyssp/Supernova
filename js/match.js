// ============================================================
// Which Data U outlet is each WS customer, which form SKU is each WS product.
// A saved answer is used again next month; otherwise the closest name is picked
// automatically ("Auto — check") when it is close enough.
// ============================================================

const AUTO_SCORE = { customer: 0.62, product: 0.6 };
const M = { outlets: [], skus: [], OUT: {}, SKU: {}, wsRegion: '' };

async function loadMatchLists() {
  const outlets = await fetchAll(() => sb.from('outlets').select('code, outlet_name, company_name, area, region, current_bde, bde, status').order('code'));
  const skus = window.FORM_SKUS || [];   // templates/form_skus.js
  outlets.forEach(o => {
    o._p = prep(o.outlet_name); o._c = prep(o.company_name);
    o._label = `${o.code} — ${o.outlet_name || ''}${o.area ? ' (' + o.area + ')' : ''}`;
    M.OUT[o.code] = o;
  });
  skus.forEach(s => {
    s._p = prep(s.product + ' ' + (s.size || ''));
    s._label = `${s.code} — ${s.product}${s.size ? ' · ' + s.size : ''}`;
    M.SKU[s.code] = s;
  });
  M.outlets = outlets; M.skus = skus;
  /* word -> outlets having it, so a customer is only compared with outlets sharing a word */
  M.idx = new Map();
  outlets.forEach(o => new Set([...o._p.w, ...o._c.w]).forEach(w => {
    if (!M.idx.has(w)) M.idx.set(w, []);
    M.idx.get(w).push(o);
  }));
}

/* best Data U outlets for a WS customer: compared with the outlet name and the company name */
function outletCandidates(g) {
  const names = [g.outlet, g.name].filter(Boolean).map(prep);
  const pool = new Set();
  names.forEach(P => P.w.forEach(w => (M.idx.get(w) || []).forEach(o => pool.add(o))));
  const region = normKey(M.wsRegion || '').replace(/[^a-z]/g, '');
  const out = [];
  for (const o of pool) {
    let s = 0;
    for (const P of names) s = Math.max(s, similarity(P, o._p), similarity(P, o._c) - 0.05);
    /* same name in two places (Rosewood Bangkok / Rosewood Phuket): the WS's own region wins */
    if (region && [o.region, o.area].some(x => normKey(x || '').replace(/[^a-z]/g, '') === region)) s += 0.08;
    if (s > 0.25) out.push({ x: o, s });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 4);
}
function skuCandidates(g) {
  const P = prep(g.name), out = [];
  for (const k of M.skus) { const s = productScore(P, k._p); if (s > 0.25) out.push({ x: k, s }); }
  return out.sort((a, b) => b.s - a.s).slice(0, 4);
}

/* one row per WS customer / product of the upload, with its current answer */
function buildGroups(lines, keyField, info) {
  const g = {};
  lines.forEach(l => {
    const k = l[keyField];
    if (!g[k]) g[k] = { key: k, lines: 0, qty: 0, amount: 0, ...info(l) };
    g[k].lines++; g[k].qty += +l.qty || 0; g[k].amount += +l.amount || 0;
  });
  return Object.values(g).sort((a, b) => b.qty - a.qty);
}

/* status: saved (remembered) · auto (picked by name, to check) · none (nothing close) */
function resolve(kind, g, saved, otherWs) {
  const m = saved[g.key];
  if (m) {
    g.value = kind === 'customer' ? m.outlet_code : m.sku_code;
    g.skip = !!m.skip; g.factor = m.factor || 1; g.status = 'saved';
    return;
  }
  g.skip = false; g.factor = 1;
  const byCode = kind === 'customer' ? M.OUT : M.SKU;
  const other = otherWs[g.key];
  g.cands = kind === 'customer' ? outletCandidates(g) : skuCandidates(g);
  if (other && byCode[other]) { g.value = other; g.status = 'auto'; return; }   // same name already matched at another WS
  const best = g.cands[0];
  if (best && best.s >= AUTO_SCORE[kind]) { g.value = best.x.code; g.status = 'auto'; }
  else { g.value = null; g.status = 'none'; }
}
