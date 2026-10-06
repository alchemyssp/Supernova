// ============================================================
// Shared helpers: sign-in guard, formatting, small UI bits
// ============================================================

/* every page except the login: no session -> back to the login */
async function requireLogin() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.replace('index.html'); return null; }
  return data.session;
}

/* ── formatting ── */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = v => (v == null || v === '' || isNaN(v)) ? '' : nf0.format(v);
const fmt2 = v => (v == null || v === '' || isNaN(v)) ? '' : nf2.format(v);
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/* '2026-09-01' -> 'Sep 26' */
function monthLabel(d) {
  if (!d) return '';
  const [y, m] = String(d).split('-');
  return MONTHS[+m - 1] + ' ' + y.slice(2);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* the key a WS name is remembered by: no case, single spaces */
function normKey(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[ ••]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── toast message ── */
function toast(msg, kind) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'show ' + (kind || '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = ''; }, kind === 'err' ? 7000 : 3500);
}

/* read every row of a query, 1,000 at a time (Supabase returns max 1,000 per call) */
async function fetchAll(build, pageSize = 1000) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < pageSize) return out;
    from += pageSize;
  }
}

/* insert / upsert in chunks */
async function writeChunks(table, rows, opts, onProgress, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    const q = opts && opts.onConflict ? sb.from(table).upsert(part, opts) : sb.from(table).insert(part);
    const { error } = await q;
    if (error) throw error;
    if (onProgress) onProgress(Math.min(i + size, rows.length), rows.length);
  }
}

/* ── similarity for match suggestions (word overlap + same bottle size) ── */
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(ml|cl|ltr|lt|litre|liter|l)\b\.?/;
function words(s) {
  return normKey(s)
    .replace(new RegExp(SIZE_RE.source, 'g'), ' ')        // bottle size is compared on its own (sizeOf)
    .replace(/\d+(\.\d+)?\s*%/g, ' ')                     // alcohol %
    .replace(/บริษัท|จำกัด|จํากัด|มหาชน|สำนักงานใหญ่|สาขา(ที่)?/g, ' ')
    .replace(/\b(co|ltd|limited|company|the|headquarter|branch)\b/g, ' ')
    .replace(/[^a-z0-9฀-๿]+/g, ' ')
    .split(' ').filter(w => w.length > 1 || /\d/.test(w));
}
function sizeOf(s) {
  const m = normKey(s).match(SIZE_RE);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'ml' ? n : m[2] === 'cl' ? n * 10 : n * 1000;
}
/* a name split once into words + bottle size, so it can be compared with thousands of others quickly */
function prep(s) { return { w: new Set(words(s)), size: sizeOf(s) }; }
function similarity(A, B) {
  if (!A.w.size || !B.w.size) return 0;
  let hit = 0;
  A.w.forEach(w => {
    if (B.w.has(w)) { hit++; return; }
    if (w.length > 3) for (const x of B.w) { if (x.length > 3 && (x.startsWith(w) || w.startsWith(x))) { hit += 0.7; break; } }
  });
  let score = (2 * hit) / (A.w.size + B.w.size);
  if (A.size && B.size) score += A.size === B.size ? 0.15 : -0.25;
  return score;
}
/* WS product names are short ("Campari", "Tito"): how much of the WS name is found in the SKU counts most;
   no size in the WS name = the usual 700 / 750 ml bottle */
function productScore(A, B) {
  if (!A.w.size || !B.w.size) return 0;
  let hit = 0;
  A.w.forEach(w => { if (B.w.has(w)) hit++; else if (w.length > 3) for (const x of B.w) { if (x.length > 3 && (x.startsWith(w) || w.startsWith(x))) { hit += 0.7; break; } } });
  let score = 0.6 * (hit / A.w.size) + 0.4 * (2 * hit) / (A.w.size + B.w.size);
  if (A.size && B.size) score += A.size === B.size ? 0.15 : -0.25;
  else if (!A.size && (B.size === 700 || B.size === 750)) score += 0.05;
  return score;
}
/* list items carry ._p = prep(name) */
function bestMatches(name, list, n = 5) {
  const P = prep(name), out = [];
  for (const x of list) { const s = similarity(P, x._p); if (s > 0.25) out.push({ x, s }); }
  return out.sort((p, q) => q.s - p.s).slice(0, n);
}

/* Excel serial / text date -> 'YYYY-MM-DD' (Thai Buddhist years are turned into AD) */
function toISODate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n < 20000 || n > 80000) return null;
    const d = new Date(Math.round((n - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);           // d/m/y
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000; if (y > 2400) y -= 543;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { let y = +m[1]; if (y > 2400) y -= 543; return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; }
  return null;
}
function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}
