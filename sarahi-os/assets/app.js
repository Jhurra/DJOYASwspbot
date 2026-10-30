(function () {
/* SARAHI OS — núcleo: estado, utilidades, capa de datos, render y enrutado.
   Este código es idéntico en el artefacto y en el servidor; solo cambia window.SOS_ADAPTER. */
'use strict';
const A = window.SOS_ADAPTER;
const COLLECTIONS = ['meta', 'boards', 'items', 'updates', 'notes', 'transcripts'];
const S = {
  data: { meta: {}, boards: {}, items: {}, updates: {}, notes: {}, transcripts: {} },
  me: { id: null, name: '' },
  caps: {},
  names: {},
  route: { view: 'home' },
  panel: null,
  ui: { search: {}, filter: {}, sort: {}, collapsed: {}, selected: new Set(), more: {}, subOpen: {}, folders: {}, calMonth: null, myPerson: null, noteQ: '', noteClient: '', txQ: '', globalQ: '' },
  ready: false,
  editing: false,
  pending: false,
  idx: null,
  pop: null,
};

/* ---------- utilidades */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const nowISO = () => new Date().toISOString();
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  const out = isObj(a) ? a : {};
  for (const k of Object.keys(b || {})) {
    const v = b[k];
    if (isObj(v) && isObj(out[k])) out[k] = merge(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
function localISO(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const todayISO = () => localISO();
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); }
function mondayOf(iso) { const d = new Date((iso || todayISO()) + 'T12:00:00'); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return localISO(d); }
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MONTHS_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fmtDate(iso, withYear) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m) return esc(iso);
  const yr = withYear || y !== new Date().getFullYear() ? ' ' + y : '';
  return d + ' ' + MONTHS[m - 1] + yr;
}
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
  if (s < 172800) return 'ayer';
  if (s < 604800) return 'hace ' + Math.round(s / 86400) + ' días';
  return fmtDate(localISO(new Date(t)));
}
const NF = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
function fmtNum(n, unit) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  const s = NF.format(Number(n));
  if (!unit) return s;
  if (unit === 'CLP' || unit === '$') return '$' + s;
  if (unit === 'EUR' || unit === '€') return s + ' €';
  return s + ' ' + unit;
}
const PALETTE = ['#579bfc', '#00c875', '#fdab3d', '#df2f4a', '#9d50dd', '#037f4c', '#ff5ac4', '#784bd1', '#007eb5', '#ffcb00', '#9cd326', '#ff6d3b', '#7f5347', '#4eccc6', '#faa1f1', '#757575'];
const AV_COLORS = ['#c64d15', '#5a63d8', '#037f4c', '#9d50dd', '#007eb5', '#b8336a', '#6b7a1d', '#7f5347'];
function hashColor(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function initials(name) { const p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L > 0.66 ? '#1c1e29' : '#ffffff';
}
function debounce(fn, ms) { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = () => { clearTimeout(t); fn(); }; return f; }
function domain(u) { try { return new URL(/^https?:/.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch (e) { return String(u); } }
function safeUrl(u) { if (!u) return ''; const s = String(u).trim().split(/\s/)[0]; if (/^https?:\/\//i.test(s)) return s; if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s; return ''; }
function waLink(phone) { const d = String(phone || '').replace(/[^\d]/g, ''); return d.length >= 8 ? 'https://wa.me/' + d : ''; }

/* ---------- iconos (trazo 1.6, 16px) */
const IC = {
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  home: '<path d="M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H10V10H6v3.5H3a.5.5 0 0 1-.5-.5z"/>',
  work: '<rect x="2.5" y="3" width="11" height="10.5" rx="1.5"/><path d="M5.5 1.8v2.4M10.5 1.8v2.4M2.5 6.5h11M5 9.2l1.6 1.6L10 7.6"/>',
  note: '<path d="M3.5 2.5h6l3 3v8h-9z"/><path d="M9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5"/>',
  mic: '<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2.2"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  board: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6h12M6 6v7.5"/>',
  tpl: '<rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke-dasharray="2 1.6"/><path d="M5 6h6M5 9h4"/>',
  caret: '<path d="m4.5 6 3.5 3.5L11.5 6"/>',
  right: '<path d="m6 4 4 4-4 4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  dots: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  x: '<path d="m4 4 8 8M12 4l-8 8"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.3"/><path d="M10.5 5.5V3.3a.8.8 0 0 0-.8-.8H3.3a.8.8 0 0 0-.8.8v6.4c0 .4.4.8.8.8h2.2"/>',
  open: '<path d="M9 2.5h4.5V7M13.5 2.5 8 8M7 3.5H3.5v9h9V9"/>',
  chat: '<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>',
  table: '<rect x="2" y="3" width="12" height="10" rx="1.3"/><path d="M2 6.5h12M2 9.8h12M6 3v10"/>',
  kanban: '<rect x="2" y="2.5" width="3.4" height="11" rx="1"/><rect x="6.3" y="2.5" width="3.4" height="7" rx="1"/><rect x="10.6" y="2.5" width="3.4" height="9" rx="1"/>',
  cal: '<rect x="2.5" y="3" width="11" height="10.5" rx="1.5"/><path d="M5.5 1.8v2.4M10.5 1.8v2.4M2.5 6.5h11"/>',
  upload: '<path d="M8 10.5V2.5M5 5.5l3-3 3 3M3 10v3h10v-3"/>',
  download: '<path d="M8 2.5v8M5 7.5l3 3 3-3M3 10v3h10v-3"/>',
  spark: '<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12"/>',
  user: '<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5c.7-2.6 2.6-4 5-4s4.3 1.4 5 4"/>',
  out: '<path d="M6.5 13.5h-3v-11h3M10.5 5l3 3-3 3M13.5 8h-7"/>',
  menu: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
  link: '<path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/>',
  filter: '<path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5z"/>',
  sort: '<path d="M5 3v10M2.8 10.8 5 13l2.2-2.2M11 13V3M8.8 5.2 11 3l2.2 2.2"/>',
  pin: '<path d="M9.8 2.5 13.5 6.2l-2 .8-2.4 2.4.3 2.6-1.2 1.2-2.4-2.4L3 13.5l-.5-.5 2.7-2.8L2.8 7.8 4 6.6l2.6.3L9 4.5z"/>',
  wa: '<path d="M3 13l.8-2.6A5 5 0 1 1 5.6 12.3z" fill="currentColor" stroke="none"/>',
  folder: '<path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3A1 1 0 0 0 2 4.5z"/>',
  check: '<path d="m3.5 8.5 3 3 6-6.5"/>',
  arrowUp: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  arrowDown: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  move: '<path d="M8 2v12M2 8h12M5.5 4.5 8 2l2.5 2.5M5.5 11.5 8 14l2.5-2.5M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5"/>',
  refresh: '<path d="M13 3.5V7H9.5M3 12.5V9h3.5"/><path d="M12.6 7A5 5 0 0 0 3.8 5M3.4 9a5 5 0 0 0 8.8 2"/>',
  chart: '<path d="M2.5 13.5h11"/><path d="M4.5 11V8M8 11V4.5M11.5 11V6.5"/>',
  star: '<path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/>',
  alert: '<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.4v.1"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  pulse: '<path d="M1.5 8.5h3l1.8-4 3 8 1.9-4h3.3"/>',
};
function ic(name, size, extra) {
  const s = size || 16;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + (IC[name] || '') + '</svg>';
}

/* ---------- índices derivados */
function idx() {
  if (S.idx) return S.idx;
  const byBoard = new Map(), children = new Map(), upd = new Map(), notesBy = new Map(), txBy = new Map();
  for (const [id, it] of Object.entries(S.data.items)) {
    if (!it || !it.board) continue;
    if (it.parent) { if (!children.has(it.parent)) children.set(it.parent, []); children.get(it.parent).push(Object.assign({ id }, it)); continue; }
    if (!byBoard.has(it.board)) byBoard.set(it.board, []);
    byBoard.get(it.board).push(Object.assign({ id }, it));
  }
  const byPos = (a, b) => (a.pos || 0) - (b.pos || 0) || String(a.created || '').localeCompare(String(b.created || ''));
  for (const l of byBoard.values()) l.sort(byPos);
  for (const l of children.values()) l.sort(byPos);
  for (const [id, u] of Object.entries(S.data.updates)) {
    if (!u || !u.item) continue;
    if (!upd.has(u.item)) upd.set(u.item, []);
    upd.get(u.item).push(Object.assign({ id }, u));
  }
  for (const l of upd.values()) l.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  for (const [id, n] of Object.entries(S.data.notes)) { const k = n && n.link && n.link.item; if (k) { if (!notesBy.has(k)) notesBy.set(k, []); notesBy.get(k).push(Object.assign({ id }, n)); } }
  for (const [id, t] of Object.entries(S.data.transcripts)) { const k = t && t.link && t.link.item; if (k) { if (!txBy.has(k)) txBy.set(k, []); txBy.get(k).push(Object.assign({ id }, t)); } }
  S.idx = { byBoard, children, upd, notesBy, txBy };
  return S.idx;
}
const meta = () => S.data.meta.main || {};
const settings = () => meta().settings || {};
const team = () => meta().team || [];
/* ---------- permisos: en el artefacto siempre eres administrador; en el subdominio manda el rol del usuario */
const myRole = () => (S.caps.server ? (S.me.role || 'member') : 'admin');
const isAdmin = () => myRole() === 'admin';
const canSales = () => myRole() === 'admin';
const canStructure = () => myRole() !== 'clients';
const ROLE_NAMES = { admin: 'Administrador', member: 'Equipo', clients: 'Solo clientes' };
const boardItems = (bid) => idx().byBoard.get(bid) || [];
const childrenOf = (iid) => idx().children.get(iid) || [];
const getItem = (id) => (S.data.items[id] ? Object.assign({ id }, S.data.items[id]) : null);
const getBoard = (id) => (S.data.boards[id] ? Object.assign({ id }, S.data.boards[id]) : null);
function boardsSorted() { return Object.entries(S.data.boards).map(([id, b]) => Object.assign({ id }, b)).sort((a, b) => (a.pos || 0) - (b.pos || 0) || String(a.name).localeCompare(String(b.name))); }
function colsFor(board, item) { return item && item.parent ? (board.subColumns || []) : (board.columns || []); }
function colById(board, cid, sub) { return (sub ? board.subColumns : board.columns || []).find((c) => c.id === cid) || (board.subColumns || []).find((c) => c.id === cid); }
function labelOf(col, id) { return (col && col.labels || []).find((l) => String(l.id) === String(id)); }
const CLOSED_RE = /perdid|no califica|descart|cancel/i;
function isDone(board, item) {
  if (!board || !item) return false;
  const cols = colsFor(board, item);
  for (const c of cols) {
    if (c.type !== 'status') continue;
    const l = labelOf(c, item.values && item.values[c.id]);
    if (l && (l.done || CLOSED_RE.test(l.label))) return true;
  }
  return false;
}
function primaryStatus(board) { return (board.columns || []).find((c) => c.id === (board.views || {}).kanbanCol) || (board.columns || []).find((c) => c.type === 'status'); }
function dateCols(board) { const all = (board.columns || []).filter((c) => c.type === 'date'); const f = all.filter((c) => c.followup); return f.length ? f : all; }

/* ---------- escritura (optimista, luego adaptador) */
function dirty() { S.idx = null; render(); }
function fail(e) { console.error(e); toast('No se pudo guardar: ' + ((e && (e.message || e.code)) || 'error de conexión') + '. Revisa tu conexión y vuelve a intentarlo.'); }
function put(c, id, doc) { S.data[c][id] = doc; dirty(); return Promise.resolve(A.set(c, id, doc)).catch(fail); }
function patch(c, id, p) { const cur = S.data[c][id]; if (!cur) return Promise.resolve(); S.data[c][id] = merge(clone(cur), p); dirty(); return Promise.resolve(A.update(c, id, p)).catch(fail); }
function del(c, id) { delete S.data[c][id]; dirty(); return Promise.resolve(A.remove(c, id)).catch(fail); }
async function batch(ops) {
  for (const o of ops) {
    if (o.op === 'set') S.data[o.c][o.id] = o.d;
    else if (o.op === 'update') { if (S.data[o.c][o.id]) S.data[o.c][o.id] = merge(clone(S.data[o.c][o.id]), o.d); }
    else if (o.op === 'del') delete S.data[o.c][o.id];
  }
  dirty();
  try { await A.batch(ops); } catch (e) { fail(e); }
}
function onRemote(c, id, doc) {
  if (!S.data[c]) return;
  if (doc == null) delete S.data[c][id]; else S.data[c][id] = doc;
  S.idx = null;
  render();
}
function patchMeta(p) {
  if (!S.data.meta.main) return put('meta', 'main', merge({ workspaces: [], folders: [], team: [], settings: {} }, p));
  return patch('meta', 'main', p);
}

/* ---------- toasts */
function toast(msg, action) {
  let wrap = $('.toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toasts'; wrap.setAttribute('role', 'status'); document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action.label) + '</button>' : '');
  if (action) t.querySelector('button').onclick = () => { action.run(); t.remove(); };
  wrap.appendChild(t);
  setTimeout(() => t.remove(), action ? 7000 : 4200);
}

/* ---------- render */
let rq = false;
function render() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; doRender(); }); }
function live(region) { const ae = document.activeElement; return !!(ae && region && region.contains(ae) && ae.matches('[data-live]')); }
function setHTML(el, html) { if (!el) return false; if (live(el)) { S.pending = true; return false; } el.innerHTML = html; return true; }
function doRender() {
  if (!S.ready) return;
  S.pending = false;
  renderSidebar();
  if (S.editing || S.pop) { S.pending = true; } else renderMain();
  renderPanel();
  renderBulk();
}
document.addEventListener('focusout', () => { setTimeout(() => { if (S.pending && !S.editing && !S.pop) render(); }, 30); });

/* ---------- enrutado */
function go(route) {
  S.route = route;
  S.ui.selected.clear();
  closePop();
  $('#app').classList.remove('sb-open');
  let h = route.view;
  if (route.view === 'board') h = 'b-' + route.id;
  try { if (location.hash.slice(1) !== h) history.replaceState(null, '', '#' + h); } catch (e) { /* vista sin URL */ }
  const body = $('#main-body'); if (body) body.scrollTop = 0;
  render();
}
function routeFromHash() {
  const h = (location.hash || '').slice(1);
  if (h.startsWith('b-') && S.data.boards[h.slice(2)]) return { view: 'board', id: h.slice(2) };
  if (h === 'sales' && !canSales()) return { view: 'home' };
  if (h === 'settings' && !isAdmin()) return { view: 'home' };
  if (['home', 'sales', 'mywork', 'notes', 'transcripts', 'settings'].includes(h)) return { view: h };
  return { view: 'home' };
}

/* ---------- carcasa */
function shell() {
  return '<header class="appbar">' +
    '<button class="icon-btn sb-tgl" data-a="sb-toggle" aria-label="Abrir menú">' + ic('menu', 18) + '</button>' +
    '<div class="brand"><div class="logo">S</div><b>SARAHI</b><span>OS</span></div>' +
    '<b id="tb-title" class="tb-title">SARAHI OS</b>' +
    '<label class="g-search"><span class="sr">Buscar en todo</span>' + ic('search', 15) + '<input id="g-search" type="search" placeholder="Buscar en todo" autocomplete="off" data-live></label>' +
    '<button class="icon-btn g-search-btn" data-a="search-open" aria-label="Buscar">' + ic('search', 17) + '</button>' +
    '<div class="app-user" id="app-user"></div>' +
    '</header>' +
    '<aside class="sb" aria-label="Navegación"><nav class="sb-nav" id="sb-nav"></nav><div class="sb-list" id="sb-list"></div><div class="sb-foot" id="sb-foot"></div></aside>' +
    '<main class="main" id="main">' +
    '<div class="main-head" id="main-head"></div><div class="main-body" id="main-body"><div class="boot"><div class="spin"></div><div>Cargando tableros…</div></div></div>' +
    '</main>' +
    '<div id="panel-root"></div><div id="bulk-root"></div>';
}

function renderSidebar() {
  const r = S.route;
  const nOver = overdueCount();
  const link = (view, icon, label, extra) => '<button class="sb-link' + (r.view === view ? ' on' : '') + '" data-a="go" data-v="' + view + '">' + ic(icon) + '<span>' + label + '</span>' + (extra || '') + '</button>';
  setHTML($('#sb-nav'),
    link('home', 'home', 'Inicio') +
    (canSales() ? link('sales', 'chart', 'Ventas') : '') +
    link('mywork', 'work', 'Mi trabajo', nOver ? '<span class="count" title="Vencidos">' + nOver + '</span>' : '') +
    link('notes', 'note', 'Notas', '<span class="count">' + Object.keys(S.data.notes).length + '</span>') +
    link('transcripts', 'mic', 'Transcripciones', '<span class="count">' + Object.keys(S.data.transcripts).length + '</span>'));

  const m = meta();
  const boards = boardsSorted();
  const wss = (m.workspaces || []).slice();
  for (const b of boards) if (b.ws && !wss.find((w) => w.id === b.ws)) wss.push({ id: b.ws, name: 'Espacio' });
  if (!wss.length) wss.push({ id: 'w-main', name: 'Mi espacio' });
  let html = '';
  for (const w of wss) {
    const wb = boards.filter((b) => (b.ws || wss[0].id) === w.id);
    if (!wb.length && !isAdmin()) continue;
    html += '<div class="ws-head"><span>' + esc(w.name) + '</span>' + (canStructure() ? '<button data-a="new-board" data-ws="' + esc(w.id) + '" title="Nuevo tablero en ' + esc(w.name) + '" aria-label="Nuevo tablero">' + ic('plus', 14) + '</button>' : '') + '</div>';
    for (const b of wb.filter((x) => !x.folder)) html += bdLink(b, false);
    for (const f of (m.folders || []).filter((f) => f.ws === w.id)) {
      const fb = wb.filter((b) => b.folder === f.id);
      if (!fb.length && !isAdmin()) continue;
      const closed = S.ui.folders[f.id] === true;
      html += '<button class="folder' + (closed ? ' closed' : '') + '" data-a="folder" data-id="' + esc(f.id) + '">' + ic('caret', 14, ' class="car"') + ic('folder', 15) + '<span>' + esc(f.name) + '</span><span class="count" style="margin-left:auto;font-size:11px;font-family:var(--mono)">' + fb.length + '</span></button>';
      if (!closed) for (const b of fb) html += bdLink(b, true);
    }
  }
  setHTML($('#sb-list'), html);
  const role = S.caps.server ? (ROLE_NAMES[myRole()] || myRole()) : '';
  const who = S.me.name || settings().ownerName || 'Tú';
  setHTML($('#sb-foot'), isAdmin() ? link('settings', 'gear', 'Ajustes') : '');
  setHTML($('#app-user'),
    '<span class="me-chip" title="' + esc(who + (role ? ' · ' + role : '')) + '"><span class="av" style="--avc:' + hashColor(S.me.name || 'Yo') + '">' + esc(initials(S.me.name || settings().ownerName || 'Yo')) + '</span><span class="me-n">' + esc(who.split(' ')[0]) + (role ? '<small>' + esc(role) + '</small>' : '') + '</span></span>' +
    (S.caps.server ? '<button class="icon-btn" data-a="logout" title="Cerrar sesión" aria-label="Cerrar sesión">' + ic('out') + '</button>' : ''));
}
function bdLink(b, nested) {
  const on = S.route.view === 'board' && S.route.id === b.id;
  return '<button class="bd-link' + (nested ? ' nested' : '') + (on ? ' on' : '') + '" data-a="open-board" data-id="' + esc(b.id) + '">' + ic(b.isTemplate ? 'tpl' : 'board', 15) + '<span>' + esc(b.name) + '</span></button>';
}

function renderMain() {
  const r = S.route;
  const head = $('#main-head'), body = $('#main-body');
  const tt = $('#tb-title');
  if (r.view === 'board') {
    const b = getBoard(r.id);
    if (!b) { go({ view: 'home' }); return; }
    if (tt) tt.textContent = b.name;
    head.hidden = false;
    renderBoardHead(b);
    renderBoardBody(b);
    return;
  }
  head.hidden = true;
  if (tt) tt.textContent = { home: 'Inicio', sales: 'Ventas', mywork: 'Mi trabajo', notes: 'Notas', transcripts: 'Transcripciones', settings: 'Ajustes', search: 'Búsqueda' }[r.view] || 'SARAHI OS';
  const views = { home: viewHome, sales: viewSales, mywork: viewMyWork, notes: viewNotes, transcripts: viewTranscripts, settings: viewSettings, search: viewSearch };
  if ((r.view === 'sales' && !canSales()) || (r.view === 'settings' && !isAdmin())) { viewHome(body); return; }
  (views[r.view] || viewHome)(body);
}

/* ---------- popovers y modales */
function closePop() {
  if (S.pop) { S.pop.el.remove(); const after = S.pop.onClose; S.pop = null; if (after) after(); }
  if (S.pending) render();
}
function openPop(anchor, html, handlers, opts) {
  closePop();
  const el = document.createElement('div');
  el.className = 'pop';
  el.setAttribute('role', 'dialog');
  el.innerHTML = html;
  if (opts && opts.width) el.style.minWidth = opts.width + 'px';
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = r.top - h - 4 >= 8 ? r.top - h - 4 : Math.max(8, window.innerHeight - h - 8);
  el.style.left = left + 'px'; el.style.top = top + 'px';
  S.pop = { el, anchor, onClose: opts && opts.onClose };
  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-pa]');
    if (!t || !handlers || !handlers[t.dataset.pa]) return;
    ev.preventDefault();
    handlers[t.dataset.pa](t, ev, el);
  });
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && handlers && handlers.enter && ev.target.matches('input')) { ev.preventDefault(); handlers.enter(ev.target, ev, el); } });
  if (handlers && handlers.mount) handlers.mount(el);
  const f = el.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 0);
  return el;
}
function menu(anchor, entries) {
  const h = {};
  let html = '';
  entries.forEach((e, i) => {
    if (!e) return;
    if (e === '-') { html += '<div class="sep"></div>'; return; }
    if (e.head) { html += '<h4>' + esc(e.head) + '</h4>'; return; }
    h['m' + i] = () => { closePop(); e.run(); };
    html += '<button class="opt' + (e.danger ? ' danger' : '') + '" data-pa="m' + i + '">' + (e.icon ? ic(e.icon) : '') + '<span>' + esc(e.label) + '</span></button>';
  });
  return openPop(anchor, html, h);
}
function openModal(o) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
    '<div class="modal-h"><h2>' + esc(o.title) + '</h2><button class="icon-btn" data-ma="close" aria-label="Cerrar">' + ic('x') + '</button></div>' +
    '<form class="modal-form" novalidate><div class="modal-b">' + o.body + '</div>' +
    '<div class="modal-f">' + (o.foot || '<button type="button" class="btn" data-ma="close">Cancelar</button><button type="submit" class="btn primary">' + esc(o.ok || 'Guardar') + '</button>') + '</div></form></div>';
  document.body.appendChild(wrap);
  S.modal = wrap;
  if (o.onOpen) o.onOpen(wrap);
  const form = wrap.querySelector('form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!o.submit) return closeModal();
    const btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
    try { const keep = await o.submit(new FormData(form), wrap); if (keep !== true) closeModal(); }
    finally { if (btn) btn.disabled = false; }
  });
  wrap.addEventListener('click', (ev) => {
    if (ev.target === wrap) return closeModal();
    const t = ev.target.closest('[data-ma]');
    if (!t) return;
    if (t.dataset.ma === 'close') return closeModal();
    if (o.handlers && o.handlers[t.dataset.ma]) { ev.preventDefault(); o.handlers[t.dataset.ma](t, ev, wrap); }
  });
  if (o.mount) o.mount(wrap);
  const f = wrap.querySelector('[autofocus]') || wrap.querySelector('input:not([type=hidden]),textarea,select');
  if (f) setTimeout(() => f.focus(), 30);
  return wrap;
}
function closeModal() { if (S.modal) { S.modal.remove(); S.modal = null; } if (S.pending) render(); }
function confirmBox(title, text, okLabel, run) {
  openModal({ title, body: '<p style="margin:0;color:var(--muted)">' + esc(text) + '</p>', ok: okLabel || 'Confirmar', foot: '<button type="button" class="btn" data-ma="close">Cancelar</button><button type="submit" class="btn primary">' + esc(okLabel || 'Confirmar') + '</button>', submit: run });
}

/* ---------- eventos globales */
const ACT = {};
document.addEventListener('click', (ev) => {
  if (S.pop && !S.pop.el.contains(ev.target) && !(S.pop.anchor && S.pop.anchor.contains(ev.target))) closePop();
  const a = ev.target.closest('a[href]');
  if (a && !a.dataset.a) return;
  const t = ev.target.closest('[data-a]');
  if (!t || (S.modal && S.modal.contains(t))) return;
  const fn = ACT[t.dataset.a];
  if (fn) { ev.preventDefault(); fn(t, ev); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (S.pop) { closePop(); return; }
    if (S.modal) { closeModal(); return; }
    if (S.panel) { S.panel = null; render(); }
  }
});
ACT['sb-toggle'] = () => $('#app').classList.toggle('sb-open');
ACT.go = (t) => go({ view: t.dataset.v });
ACT['search-open'] = () => { const bar = $('.appbar'); bar.classList.add('searching'); const i = $('#g-search'); i.focus(); i.addEventListener('blur', () => { if (!i.value) bar.classList.remove('searching'); }, { once: true }); };
ACT['open-board'] = (t) => { S.panel = null; go({ view: 'board', id: t.dataset.id, mode: null }); };
ACT.folder = (t) => { const id = t.dataset.id; S.ui.folders[id] = !S.ui.folders[id]; render(); };
ACT.logout = async () => { try { await A.call('logout'); } catch (e) { /* sin sesión */ } location.reload(); };

function wireGlobalSearch() {
  const inp = $('#g-search');
  const run = debounce(() => { S.ui.globalQ = inp.value; if (inp.value.trim()) { if (S.route.view !== 'search') go({ view: 'search' }); else render(); } }, 200);
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); run.flush(); } });
}

/* ---------- automatizaciones */
async function runAutomations() {
  const mon = mondayOf(todayISO());
  for (const b of boardsSorted()) {
    const wr = b.automations && b.automations.weeklyReset;
    if (!wr || !wr.enabled || !(wr.columns || []).length) continue;
    if ((wr.lastReset || '') >= mon) continue;
    await weeklyReset(b, mon);
  }
}
async function weeklyReset(b, mon) {
  const vals = {}; for (const c of b.automations.weeklyReset.columns) vals[c] = null;
  const ops = boardItems(b.id).filter((it) => b.automations.weeklyReset.columns.some((c) => it.values && it.values[c] != null && it.values[c] !== false)).map((it) => ({ op: 'update', c: 'items', id: it.id, d: { values: vals, updated: nowISO() } }));
  ops.push({ op: 'update', c: 'boards', id: b.id, d: { automations: { weeklyReset: { lastReset: mon || mondayOf(todayISO()) } } } });
  await batch(ops);
  return ops.length - 1;
}

/* ---------- arranque */
async function boot() {
  document.getElementById('app').innerHTML = shell();
  wireGlobalSearch();
  wireDnD();
  try {
    const info = await A.init(onRemote);
    S.me = info.me || S.me;
    S.caps = info.caps || {};
    document.body.dataset.role = myRole();
  } catch (e) {
    $('#main-body').innerHTML = '<div class="boot"><b>No se pudo abrir SARAHI OS</b><div>' + esc((e && e.message) || e) + '</div></div>';
    return;
  }
  S.ready = true;
  S.route = routeFromHash();
  S.idx = null;
  doRender();
  if (A.names) resolveNames();
  if (S.data.meta.main) runAutomations().catch(console.error);
  autoImportMeetings();
}
async function resolveNames() {
  const ids = new Set();
  for (const u of Object.values(S.data.updates)) if (u && u.authorId) ids.add(u.authorId);
  for (const n of Object.values(S.data.notes)) if (n && n.authorId) ids.add(n.authorId);
  if (!ids.size) return;
  try { const m = await A.names(Array.from(ids)); Object.assign(S.names, m || {}); render(); } catch (e) { /* sin nombres */ }
}
function authorName(o) { return (o.authorId && S.names[o.authorId]) || o.author || (o.authorId && o.authorId === S.me.id ? (S.me.name || 'Tú') : 'Equipo'); }
function overdueCount() {
  if (!S.ready) return 0;
  const t = todayISO(); let n = 0;
  for (const b of boardsSorted()) {
    if (b.isTemplate) continue;
    const dc = dateCols(b); if (!dc.length) continue;
    for (const it of boardItems(b.id)) { if (isDone(b, it)) continue; if (dc.some((c) => it.values && it.values[c.id] && it.values[c.id] < t)) n++; }
  }
  return n;
}

/* SARAHI OS — tableros: tabla por grupos, celdas por tipo, editores, kanban, calendario y menús. */

const TYPES = {
  status: { label: 'Estado', w: 140 },
  text: { label: 'Texto', w: 170 },
  long_text: { label: 'Texto largo', w: 220 },
  people: { label: 'Personas', w: 100 },
  date: { label: 'Fecha', w: 118 },
  timeline: { label: 'Cronograma', w: 180 },
  numbers: { label: 'Números', w: 124 },
  dropdown: { label: 'Etiquetas', w: 170 },
  email: { label: 'Email', w: 200 },
  phone: { label: 'Teléfono', w: 160 },
  link: { label: 'Enlace', w: 170 },
  checkbox: { label: 'Casilla', w: 76 },
};
const DEFAULT_STATUS = () => [{ id: '0', label: 'En curso', color: '#fdab3d' }, { id: '1', label: 'Listo', color: '#00c875', done: true }, { id: '2', label: 'Detenido', color: '#df2f4a' }];
const colW = (c) => (c.width || (TYPES[c.type] || TYPES.text).w);
const gtcFor = (cols) => '6px 34px var(--namew) ' + cols.map((c) => colW(c) + 'px').join(' ') + ' 44px';
const newLabel = (b) => { const l = (b.itemLabel || 'elemento').toLowerCase(); return (/a$/.test(l) ? 'Nueva ' : 'Nuevo ') + l; };
const modeOf = (b) => {
  const m = S.route.mode || (b.views && b.views.default) || (isClientBoard(b) ? 'week' : 'table');
  if (m === 'week' && !isClientBoard(b)) return 'table';
  // En los tableros de clientes no se usan Kanban ni Calendario
  if ((m === 'kanban' || m === 'calendar') && isClientBoard(b)) return 'table';
  return m;
};

/* ---------- valores como texto */
function valText(col, v) {
  if (v == null || v === '') return '';
  switch (col.type) {
    case 'status': { const l = labelOf(col, v); return l ? l.label : ''; }
    case 'dropdown': return (Array.isArray(v) ? v : [v]).map((x) => (labelOf(col, x) || {}).label || '').filter(Boolean).join(', ');
    case 'people': return (Array.isArray(v) ? v : [v]).join(', ');
    case 'timeline': return v && (v.from || v.to) ? (v.from || '') + ' → ' + (v.to || '') : '';
    case 'checkbox': return v ? 'Sí' : '';
    case 'numbers': return String(v);
    default: return String(v);
  }
}
function matchItem(b, it, q) {
  if (norm(it.name).includes(q)) return true;
  for (const c of b.columns || []) { const t = valText(c, it.values && it.values[c.id]); if (t && norm(t).includes(q)) return true; }
  return false;
}
function personMatch(b, it, person) {
  const p = norm(person);
  for (const c of colsFor(b, it)) {
    const v = it.values && it.values[c.id];
    if (c.type === 'people' && Array.isArray(v) && v.some((x) => norm(x) === p)) return true;
    if (c.type === 'status' && /responsable|owner|encargad/i.test(c.title)) { const l = labelOf(c, v); if (l && norm(l.label).split(/\s+y\s+|,\s*/).includes(p)) return true; }
  }
  return false;
}
function visibleItems(b) {
  let list = boardItems(b.id);
  const q = norm(S.ui.search[b.id] || '');
  if (q) list = list.filter((it) => matchItem(b, it, q) || childrenOf(it.id).some((ch) => norm(ch.name).includes(q)));
  const f = S.ui.filter[b.id];
  if (f && f.col && f.vals && f.vals.length) {
    const col = colById(b, f.col);
    if (col) list = list.filter((it) => {
      const v = it.values && it.values[f.col];
      if (col.type === 'people') return (v || []).some((p) => f.vals.includes(p));
      if (col.type === 'dropdown') return (v || []).some((x) => f.vals.includes(String(x)));
      return f.vals.includes(v == null || v === '' ? '__none' : String(v));
    });
  }
  if (f && f.person) list = list.filter((it) => personMatch(b, it, f.person));
  const so = S.ui.sort[b.id];
  if (so && so.col) {
    const col = so.col === 'name' ? { id: 'name', type: 'text' } : colById(b, so.col);
    if (col) {
      const key = (it) => {
        if (col.id === 'name') return norm(it.name);
        const v = it.values && it.values[col.id];
        if (v == null || v === '') return null;
        if (col.type === 'numbers') return Number(v);
        if (col.type === 'status') { const i = (col.labels || []).findIndex((l) => String(l.id) === String(v)); return i < 0 ? null : i; }
        if (col.type === 'timeline') return v.from || '';
        return norm(valText(col, v));
      };
      list = list.slice().sort((a, b2) => {
        const x = key(a), y = key(b2);
        if (x === y) return 0; if (x == null) return 1; if (y == null) return -1;
        return (x < y ? -1 : 1) * (so.dir === 'desc' ? -1 : 1);
      });
    }
  }
  return list;
}

/* ---------- celdas */
function cellInner(b, col, v, it) {
  switch (col.type) {
    case 'status': {
      const l = labelOf(col, v);
      return l ? '<div class="st" style="--c:' + esc(l.color) + ';--ct:' + inkFor(l.color) + '">' + esc(l.label) + '</div>' : '<div class="st none"></div>';
    }
    case 'dropdown': {
      const ls = (Array.isArray(v) ? v : v != null ? [v] : []).map((x) => labelOf(col, x)).filter(Boolean);
      return '<div class="cell">' + ls.slice(0, 2).map((l) => '<span class="chip">' + esc(l.label) + '</span>').join('') + (ls.length > 2 ? '<span class="chip">+' + (ls.length - 2) + '</span>' : '') + '</div>';
    }
    case 'people': {
      const ps = Array.isArray(v) ? v : v ? [v] : [];
      if (!ps.length) return '<div class="cell"><span class="av ghost">' + ic('user', 13) + '</span></div>';
      return '<div class="cell" title="' + esc(ps.join(', ')) + '">' + ps.slice(0, 3).map((p) => '<span class="av" style="--avc:' + hashColor(p) + '">' + esc(initials(p)) + '</span>').join('') + (ps.length > 3 ? '<span class="av" style="--avc:#676b82">+' + (ps.length - 3) + '</span>' : '') + '</div>';
    }
    case 'date': {
      if (!v) return '<div class="cell"></div>';
      const t = todayISO(); const done = isDone(b, it) || !(it.parent || dateCols(b).some((c) => c.id === col.id));
      const cls = !done && v < t ? ' over' : !done && v === t ? ' today' : '';
      return '<div class="cell"><span class="dt' + cls + '">' + fmtDate(v) + '</span></div>';
    }
    case 'timeline': return v && (v.from || v.to) ? '<div class="cell"><span class="tl">' + fmtDate(v.from) + ' – ' + fmtDate(v.to) + '</span></div>' : '<div class="cell"></div>';
    case 'numbers': return '<div class="cell"><span class="num">' + esc(fmtNum(v, col.unit)) + '</span></div>';
    case 'checkbox': return '<div class="cell"><span class="cb' + (v ? ' on' : '') + '">' + (v ? ic('check', 13) : '') + '</span></div>';
    case 'link': { const u = safeUrl(v); return '<div class="cell left">' + (u ? '<a class="lnk" href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(domain(u)) + '</a>' : '<span class="tx">' + esc(v || '') + '</span>') + '</div>'; }
    case 'phone': { const w = waLink(v); return '<div class="cell left">' + (v ? '<span class="tx mono">' + esc(v) + '</span>' : '') + (w ? '<a class="wa" href="' + esc(w) + '" target="_blank" rel="noopener" title="Abrir WhatsApp">' + ic('chat', 11) + '</a>' : '') + '</div>'; }
    case 'email': return '<div class="cell left"><span class="tx">' + esc(v || '') + '</span></div>';
    case 'long_text': return '<div class="cell left"><span class="tx">' + esc(String(v || '').split('\n')[0]) + '</span></div>';
    default: return '<div class="cell left"><span class="tx">' + esc(v == null ? '' : v) + '</span></div>';
  }
}

/* ---------- cabecera del tablero */
function renderBoardHead(b) {
  const head = $('#main-head');
  const mode = modeOf(b);
  const n = boardItems(b.id).length;
  const f = S.ui.filter[b.id] || {};
  const so = S.ui.sort[b.id];
  const filterCol = f.col ? colById(b, f.col) : null;
  const tab = (m, icon, label) => '<button class="tab' + (mode === m ? ' on' : '') + '" data-a="mode" data-m="' + m + '">' + ic(icon, 15) + label + '</button>';
  let chips = '';
  if (filterCol && f.vals && f.vals.length) chips += '<span class="pill lime">' + esc(filterCol.title) + ': ' + f.vals.length + ' <button class="icon-btn" style="width:18px;height:18px" data-a="clear-filter" aria-label="Quitar filtro">' + ic('x', 11) + '</button></span>';
  if (f.person) chips += '<span class="pill lime">' + esc(f.person) + ' <button class="icon-btn" style="width:18px;height:18px" data-a="clear-person" aria-label="Quitar persona">' + ic('x', 11) + '</button></span>';
  if (so) { const sc = so.col === 'name' ? 'Nombre' : (colById(b, so.col) || {}).title; chips += '<span class="pill">Orden: ' + esc(sc || '') + (so.dir === 'desc' ? ' ↓' : ' ↑') + ' <button class="icon-btn" style="width:18px;height:18px" data-a="clear-sort" aria-label="Quitar orden">' + ic('x', 11) + '</button></span>'; }
  const statusCols = (b.columns || []).filter((c) => c.type === 'status');
  const dCols = (b.columns || []).filter((c) => c.type === 'date' || c.type === 'timeline');
  let modeSel = '';
  if (mode === 'kanban' && statusCols.length > 1) modeSel = '<select class="btn sm" id="kb-col" data-live aria-label="Columna del kanban">' + statusCols.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === (primaryStatus(b) || {}).id ? ' selected' : '') + '>Agrupar por: ' + esc(c.title) + '</option>').join('') + '</select>';
  if (mode === 'calendar' && dCols.length > 1) modeSel = '<select class="btn sm" id="cal-col" data-live aria-label="Columna del calendario">' + dCols.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === calCol(b) ? ' selected' : '') + '>Fecha: ' + esc(c.title) + '</option>').join('') + '</select>';
  const html =
    '<div class="h-title"><input class="title-in" id="bd-title" data-live value="' + esc(b.name) + '" aria-label="Nombre del tablero"' + (canStructure() ? '' : ' readonly') + '>' +
    (canStructure() ? '<button class="icon-btn" data-a="board-menu" aria-label="Opciones del tablero">' + ic('dots', 18) + '</button>' : '') +
    (b.isTemplate ? '<span class="pill lime">Plantilla</span>' : '') + '<span class="pill">' + n + ' ' + (n === 1 ? 'elemento' : 'elementos') + '</span>' +
    (b.clientItem && S.data.items[b.clientItem] ? '<button class="btn sm ghost" data-a="open-item" data-id="' + esc(b.clientItem) + '">' + ic('user', 14) + 'Ficha del cliente</button>' : '') + '</div>' +
    (b.description ? '<p class="h-desc">' + esc(b.description) + '</p>' : '') +
    '<div class="tabs" role="tablist">' + (isClientBoard(b) ? tab('week', 'pulse', 'La semana') : '') + tab('table', 'table', 'Tabla principal') + (isClientBoard(b) ? '' : tab('kanban', 'kanban', 'Kanban') + tab('calendar', 'cal', 'Calendario')) + '</div>' +
    '<div class="toolbar"' + (mode === 'week' ? ' style="display:none"' : '') + '>' +
    '<button class="btn primary" data-a="new-item">' + ic('plus', 14) + '<span class="lbl-t">' + esc(newLabel(b)) + '</span></button>' +
    '<label class="tb-search"><span class="sr">Buscar en el tablero</span>' + ic('search', 15) + '<input id="bd-search" type="search" data-live placeholder="Buscar" value="' + esc(S.ui.search[b.id] || '') + '"></label>' +
    '<button class="btn ghost' + (f.person ? ' on' : '') + '" data-a="person-filter">' + ic('user', 15) + '<span class="lbl-t">Persona</span></button>' +
    '<button class="btn ghost' + (filterCol ? ' on' : '') + '" data-a="filter">' + ic('filter', 15) + '<span class="lbl-t">Filtrar</span></button>' +
    '<button class="btn ghost' + (so ? ' on' : '') + '" data-a="sort">' + ic('sort', 15) + '<span class="lbl-t">Ordenar</span></button>' +
    modeSel + chips + '</div>';
  if (!setHTML(head, html)) return;
  const ti = $('#bd-title');
  ti.addEventListener('change', () => { const v = ti.value.trim(); if (canStructure() && v && v !== b.name) patch('boards', b.id, { name: v }); });
  ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') ti.blur(); });
  const si = $('#bd-search');
  si.addEventListener('input', debounce(() => { S.ui.search[b.id] = si.value; renderBoardBody(getBoard(b.id)); }, 120));
  const kc = $('#kb-col'); if (kc) kc.addEventListener('change', () => { patch('boards', b.id, { views: { kanbanCol: kc.value } }); kc.blur(); });
  const cc = $('#cal-col'); if (cc) cc.addEventListener('change', () => { patch('boards', b.id, { views: { calendarCol: cc.value } }); cc.blur(); });
}

function renderBoardBody(b) {
  const body = $('#main-body');
  const mode = modeOf(b);
  const list = visibleItems(b);
  let html;
  if (mode === 'week') html = renderClientWeek(b);
  else if (mode === 'kanban') html = renderKanban(b, list);
  else if (mode === 'calendar') html = renderCalendar(b, list);
  else html = renderTable(b, list);
  setHTML(body, html);
}

/* ---------- tabla */
function renderTable(b, list) {
  const cols = b.columns || [];
  const groups = b.groups && b.groups.length ? b.groups : [{ id: 'g-default', title: 'Elementos', color: '#579bfc' }];
  const known = new Set(groups.map((g) => g.id));
  const filtered = !!(S.ui.search[b.id] || (S.ui.filter[b.id] && ((S.ui.filter[b.id].vals || []).length || S.ui.filter[b.id].person)));
  let html = '<div class="tbl-scroll" style="--gtc:' + gtcFor(cols) + '"><div class="tbl">';
  groups.forEach((g, gi) => {
    const items = list.filter((it) => it.group === g.id || (gi === 0 && !known.has(it.group)));
    if (filtered && !items.length) return;
    const key = b.id + ':' + g.id;
    const collapsed = !!S.ui.collapsed[key];
    html += '<section class="grp' + (collapsed ? ' collapsed' : '') + '" style="--g:' + esc(g.color || '#579bfc') + '" data-g="' + esc(g.id) + '">';
    html += '<div class="grp-head" data-drop-group="' + esc(g.id) + '"><button class="icon-btn" data-a="grp-toggle" data-g="' + esc(g.id) + '" aria-label="' + (collapsed ? 'Expandir' : 'Contraer') + ' grupo">' + ic('caret', 16, ' class="car"') + '</button>' +
      '<button class="grp-title" data-a="grp-menu" data-g="' + esc(g.id) + '">' + esc(g.title) + '</button><span class="grp-count">' + items.length + ' ' + (items.length === 1 ? 'elemento' : 'elementos') + '</span></div>';
    if (!collapsed) {
      const allSel = items.length && items.every((it) => S.ui.selected.has(it.id));
      html += '<div class="row hd"><div class="c strip"></div><div class="c chk"><input type="checkbox" data-selgroup="' + esc(g.id) + '"' + (allSel ? ' checked' : '') + ' aria-label="Seleccionar grupo"></div><div class="c name"><button class="col-head" data-a="sort-name" style="justify-content:flex-start"><span>' + esc(b.itemLabel || 'Elemento') + '</span></button></div>' +
        cols.map((c) => '<div class="c"><button class="col-head" data-a="col-menu" data-col="' + esc(c.id) + '" title="' + esc(c.title) + (c.private ? ' · solo administradores' : '') + '">' + (c.private ? ic('lock', 12) : '') + '<span>' + esc(c.title) + '</span></button></div>').join('') +
        '<div class="c add-col"><button class="col-head" data-a="add-col" aria-label="Agregar columna">' + ic('plus', 15) + '</button></div></div>';
      const limit = S.ui.more[key] || 150;
      items.slice(0, limit).forEach((it) => { html += rowHTML(b, it, cols, false); html += subRows(b, it); });
      if (items.length > limit) html += '<div class="more-row"><button class="btn sm" data-a="more" data-k="' + esc(key) + '">Mostrar ' + Math.min(150, items.length - limit) + ' más de ' + (items.length - limit) + '</button></div>';
      html += '<div class="row add"><div class="c strip"></div><div class="c chk"></div><div class="c name"><input data-live data-addgroup="' + esc(g.id) + '" placeholder="+ Agregar ' + esc((b.itemLabel || 'elemento').toLowerCase()) + '" aria-label="Agregar elemento a ' + esc(g.title) + '"></div>' + cols.map(() => '<div class="c"></div>').join('') + '<div class="c"></div></div>';
      html += '<div class="row foot"><div class="c strip"></div><div class="c chk"></div><div class="c name"></div>' + cols.map((c) => '<div class="c">' + summary(c, items) + '</div>').join('') + '<div class="c"></div></div>';
    }
    html += '</section>';
  });
  html += '</div></div>';
  if (!filtered) html += '<div style="margin-top:20px"><button class="btn" data-a="add-group">' + ic('plus', 14) + 'Agregar grupo</button></div>';
  if (!list.length && filtered) html += '<div class="empty-state" style="margin-top:16px"><b>Nada coincide con la búsqueda o el filtro.</b><button class="btn sm" data-a="clear-all-filters">Limpiar búsqueda y filtros</button></div>';
  return html;
}
function rowHTML(b, it, cols, sub) {
  const nU = (idx().upd.get(it.id) || []).length;
  const kids = sub ? [] : childrenOf(it.id);
  const open = S.ui.subOpen[it.id];
  const sel = S.ui.selected.has(it.id);
  return '<div class="row' + (sub ? ' sub' : '') + (sel ? ' sel' : '') + '"' + (sub ? '' : ' draggable="true"') + ' data-item="' + esc(it.id) + '">' +
    '<div class="c strip"></div><div class="c chk">' + (sub ? '' : '<input type="checkbox" data-sel="' + esc(it.id) + '"' + (sel ? ' checked' : '') + ' aria-label="Seleccionar">') + '</div>' +
    '<div class="c name">' +
    (!sub && (kids.length || (b.subColumns || []).length) ? '<button class="sub-tog' + (open ? ' open' : '') + '" data-a="sub-tog" data-id="' + esc(it.id) + '" title="Subelementos" aria-label="Subelementos">' + (kids.length ? '<span class="n">' + kids.length + '</span>' : ic('right', 12)) + '</button>' : '') +
    '<span class="nm" data-a="edit-name" data-id="' + esc(it.id) + '" title="' + esc(it.name) + '">' + esc(it.name || 'Sin nombre') + '</span>' +
    '<button class="open-btn" data-a="open-item" data-id="' + esc(it.id) + '" title="Abrir" aria-label="Abrir ' + esc(it.name) + '">' + ic('open', 12) + '<span>Abrir</span></button>' +
    '<button class="upd-btn' + (nU ? ' has' : '') + '" data-a="open-item" data-tab="updates" data-id="' + esc(it.id) + '" title="' + (nU ? nU + (nU === 1 ? ' actualización' : ' actualizaciones') : 'Escribir una actualización') + '" aria-label="Actualizaciones de ' + esc(it.name) + '">' + ic('chat', 17) + (nU ? '<span class="n">' + (nU > 99 ? '99+' : nU) + '</span>' : '<span class="plus">+</span>') + '</button>' +
    '<button class="icon-btn" style="width:24px;height:24px" data-a="item-menu" data-id="' + esc(it.id) + '" aria-label="Opciones">' + ic('dots', 14) + '</button>' +
    '</div>' +
    cols.map((c) => '<div class="c' + (c.type === 'status' ? ' st-cell' : '') + '" data-a="cell" data-id="' + esc(it.id) + '" data-col="' + esc(c.id) + '">' + cellInner(b, c, it.values && it.values[c.id], it) + '</div>').join('') +
    '<div class="c"></div></div>';
}
function subRows(b, it) {
  if (!S.ui.subOpen[it.id]) return '';
  const sc = b.subColumns && b.subColumns.length ? b.subColumns : [];
  const kids = childrenOf(it.id);
  let h = '<div style="--gtc:' + gtcFor(sc) + '">';
  h += '<div class="row hd sub"><div class="c strip"></div><div class="c chk"></div><div class="c name">Subelemento</div>' + sc.map((c) => '<div class="c"><button class="col-head" data-a="col-menu" data-col="' + esc(c.id) + '" data-sub="1"><span>' + esc(c.title) + '</span></button></div>').join('') + '<div class="c add-col"><button class="col-head" data-a="add-col" data-sub="1" aria-label="Agregar columna a subelementos">' + ic('plus', 14) + '</button></div></div>';
  kids.forEach((k) => { h += rowHTML(b, k, sc, true); });
  h += '<div class="row add sub"><div class="c strip"></div><div class="c chk"></div><div class="c name"><input data-live data-addsub="' + esc(it.id) + '" placeholder="+ Agregar subelemento" aria-label="Agregar subelemento"></div>' + sc.map(() => '<div class="c"></div>').join('') + '<div class="c"></div></div>';
  return h + '</div>';
}
function summary(c, items) {
  if (!items.length) return '';
  if (c.type === 'status') {
    const counts = {}; let none = 0;
    for (const it of items) { const v = it.values && it.values[c.id]; if (v == null || v === '' || !labelOf(c, v)) none++; else counts[v] = (counts[v] || 0) + 1; }
    const total = items.length;
    const segs = (c.labels || []).filter((l) => counts[l.id]).map((l) => '<i style="width:' + (counts[l.id] / total * 100) + '%;background:' + esc(l.color) + '" title="' + esc(l.label) + ': ' + counts[l.id] + '"></i>').join('');
    return '<div class="batt" title="' + (total - none) + ' de ' + total + ' con estado">' + segs + '</div>';
  }
  if (c.type === 'numbers') { const s = items.reduce((a, it) => a + (Number(it.values && it.values[c.id]) || 0), 0); return '<div class="sum"><b>' + esc(fmtNum(s, c.unit)) + '</b> suma</div>'; }
  if (c.type === 'checkbox') { const n = items.filter((it) => it.values && it.values[c.id]).length; return '<div class="sum"><b>' + n + '</b>/' + items.length + '</div>'; }
  if (c.type === 'date') { const ds = items.map((it) => it.values && it.values[c.id]).filter(Boolean).sort(); return ds.length ? '<div class="sum">' + fmtDate(ds[0]) + (ds.length > 1 ? ' – ' + fmtDate(ds[ds.length - 1]) : '') + '</div>' : ''; }
  return '';
}

/* ---------- kanban */
function renderKanban(b, list) {
  const col = primaryStatus(b);
  if (!col) return '<div class="empty-state"><b>Este tablero no tiene una columna de estado.</b><span>Agrega una columna de tipo Estado para ver el kanban.</span><button class="btn sm" data-a="add-status-col">Agregar columna de estado</button></div>';
  const numCol = (b.columns || []).find((c) => c.type === 'numbers' && c.unit) || null;
  const lanes = (col.labels || []).map((l) => ({ id: String(l.id), label: l.label, color: l.color }));
  lanes.push({ id: '__none', label: 'Sin estado', color: '#9a9db0' });
  let html = '<div class="kb">';
  for (const ln of lanes) {
    const items = list.filter((it) => { const v = it.values && it.values[col.id]; return ln.id === '__none' ? (v == null || v === '' || !labelOf(col, v)) : String(v) === ln.id; });
    if (ln.id === '__none' && !items.length) continue;
    const sum = numCol ? items.reduce((a, it) => a + (Number(it.values && it.values[numCol.id]) || 0), 0) : 0;
    html += '<div class="kb-col" data-lane="' + esc(ln.id) + '"><div class="kb-head" style="--c:' + esc(ln.color) + ';--ct:' + inkFor(ln.color) + '"><span class="dot"></span><b>' + esc(ln.label) + '</b><span class="n">' + items.length + '</span></div>' +
      (numCol && sum ? '<div class="kb-sum">' + esc(fmtNum(sum, numCol.unit)) + '</div>' : '') +
      '<div class="kb-cards">' + items.slice(0, 200).map((it) => cardHTML(b, it, col)).join('') + '</div>' +
      '<button class="kb-add" data-a="kb-add" data-v="' + esc(ln.id) + '">' + ic('plus', 13) + ' Agregar</button></div>';
  }
  return html + '</div>';
}
function cardHTML(b, it, kcol) {
  const parts = [];
  for (const c of b.columns || []) {
    if (c.id === kcol.id) continue;
    const v = it.values && it.values[c.id];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (c.type === 'people') parts.push('<span>' + v.slice(0, 3).map((p) => '<span class="av" style="--avc:' + hashColor(p) + ';width:22px;height:22px;font-size:10px">' + esc(initials(p)) + '</span>').join('') + '</span>');
    else if (c.type === 'date') { const t = todayISO(); const done = isDone(b, it) || !dateCols(b).some((x) => x.id === c.id); parts.push('<span class="dt' + (!done && v < t ? ' over' : !done && v === t ? ' today' : '') + '">' + fmtDate(v) + '</span>'); }
    else if (c.type === 'numbers' && c.unit) parts.push('<span class="num">' + esc(fmtNum(v, c.unit)) + '</span>');
    else if (c.type === 'status') { const l = labelOf(c, v); if (l && parts.length < 5) parts.push('<span class="chip" style="background:' + esc(l.color) + ';color:' + inkFor(l.color) + '">' + esc(l.label) + '</span>'); }
    if (parts.length >= 5) break;
  }
  const nU = (idx().upd.get(it.id) || []).length;
  if (nU) parts.push('<span>' + ic('chat', 12) + ' ' + nU + '</span>');
  return '<button class="card" draggable="true" data-item="' + esc(it.id) + '" data-a="open-item" data-id="' + esc(it.id) + '"><b>' + esc(it.name || 'Sin nombre') + '</b>' + (parts.length ? '<div class="meta">' + parts.join('') + '</div>' : '') + '</button>';
}

/* ---------- calendario */
function calCol(b) { const v = (b.views || {}).calendarCol; const cols = (b.columns || []).filter((c) => c.type === 'date' || c.type === 'timeline'); return (cols.find((c) => c.id === v) || dateCols(b)[0] || cols[0] || {}).id; }
function renderCalendar(b, list) {
  const cid = calCol(b);
  if (!cid) return '<div class="empty-state"><b>Este tablero no tiene columnas de fecha.</b><span>Agrega una columna Fecha para ver el calendario.</span></div>';
  const col = colById(b, cid);
  const ym = S.ui.calMonth || todayISO().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const ps = primaryStatus(b);
  const byDate = {};
  for (const it of list) {
    const v = it.values && it.values[cid];
    const d = col.type === 'timeline' ? v && (v.from || v.to) : v;
    if (!d) continue;
    (byDate[d] = byDate[d] || []).push(it);
  }
  const ev = (it) => { const l = ps && labelOf(ps, it.values && it.values[ps.id]); return '<button class="ev" data-a="open-item" data-id="' + esc(it.id) + '"' + (l ? ' style="--c:' + esc(l.color) + ';--ct:' + inkFor(l.color) + '"' : '') + ' title="' + esc(it.name) + '">' + esc(it.name) + '</button>'; };
  let html = '<div class="cal-nav"><button class="btn sm" data-a="cal-move" data-d="-1" aria-label="Mes anterior">' + ic('right', 14, ' style="transform:rotate(180deg)"') + '</button><h2>' + MONTHS_L[m - 1] + ' ' + y + '</h2><button class="btn sm" data-a="cal-move" data-d="1" aria-label="Mes siguiente">' + ic('right', 14) + '</button><button class="btn sm" data-a="cal-today">Hoy</button><span class="muted" style="font-size:13px">Según «' + esc(col.title) + '»</span></div>';
  html += '<div class="cal">' + ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => '<div class="dow">' + d + '</div>').join('');
  const t = todayISO();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = localISO(d);
    const items = byDate[iso] || [];
    html += '<div class="day' + (d.getMonth() !== m - 1 ? ' out' : '') + (iso === t ? ' today' : '') + '"><span class="dn">' + d.getDate() + '</span>' + items.slice(0, 4).map(ev).join('') + (items.length > 4 ? '<span class="muted" style="font-size:11.5px">+' + (items.length - 4) + ' más</span>' : '') + '</div>';
    if (i === 34 && d.getMonth() !== m - 1) break;
  }
  html += '</div>';
  const monthItems = Object.keys(byDate).filter((d) => d.startsWith(ym)).sort();
  html += '<div class="agenda">' + (monthItems.length ? monthItems.map((d) => '<div class="box" style="padding:10px 12px"><div class="mono muted" style="font-size:12px;margin-bottom:6px">' + fmtDate(d) + '</div><div style="display:grid;gap:4px">' + byDate[d].map(ev).join('') + '</div></div>').join('') : '<div class="empty-state">Sin elementos con fecha este mes.</div>') + '</div>';
  return html;
}

/* ---------- crear, mover, borrar */
function nextPos(bid, top) {
  const all = Object.values(S.data.items).filter((i) => i && i.board === bid);
  if (!all.length) return 1;
  const ps = all.map((i) => i.pos || 0);
  return top ? Math.min(...ps) - 1 : Math.max(...ps) + 1;
}
function newItemDoc(b, group, name, values, parent) {
  return { board: b.id, group: group || (b.groups && b.groups[0] ? b.groups[0].id : 'g-default'), parent: parent || null, name: name || 'Nuevo elemento', values: values || {}, pos: nextPos(b.id), created: nowISO(), updated: nowISO(), by: S.me.id || null };
}
function createItem(b, group, name, values, parent) {
  const id = uid('i');
  const doc = newItemDoc(b, group, name, values, parent);
  if (b.stageSync && values && values[b.stageSync.col] != null && !parent) { const g = b.stageSync.map[String(values[b.stageSync.col])]; if (g) doc.group = g; }
  const ps = primaryStatus(b);
  if (!parent && ps && values && values[ps.id] != null) { const sp = { values: {} }; stagePatch(b, null, ps.id, values[ps.id], sp); if (sp.stageLog) doc.stageLog = sp.stageLog; if (sp.closedAt) doc.closedAt = sp.closedAt; Object.assign(doc.values, sp.values); }
  put('items', id, doc);
  return id;
}
function setVal(it, cid, v) {
  const b = getBoard(it.board);
  const p = { values: {}, updated: nowISO() };
  p.values[cid] = v;
  if (b && b.stageSync && cid === b.stageSync.col && !it.parent) {
    const g = b.stageSync.map[String(v)];
    if (g && (b.groups || []).some((x) => x.id === g)) p.group = g;
  }
  if (b) stagePatch(b, it, cid, v, p);
  return patch('items', it.id, p);
}
function snapshotItems(ids) {
  const out = [];
  for (const id of ids) {
    if (S.data.items[id]) out.push({ c: 'items', id, d: clone(S.data.items[id]) });
    for (const ch of childrenOf(id)) out.push({ c: 'items', id: ch.id, d: clone(S.data.items[ch.id]) });
    for (const u of idx().upd.get(id) || []) out.push({ c: 'updates', id: u.id, d: clone(S.data.updates[u.id]) });
  }
  return out;
}
function deleteItems(ids) {
  const snap = snapshotItems(ids);
  if (S.panel && ids.includes(S.panel.id)) S.panel = null;
  ids.forEach((id) => S.ui.selected.delete(id));
  batch(snap.map((s) => ({ op: 'del', c: s.c, id: s.id })));
  const n = ids.length;
  toast(n === 1 ? 'Elemento eliminado' : n + ' elementos eliminados', { label: 'Deshacer', run: () => batch(snap.map((s) => ({ op: 'set', c: s.c, id: s.id, d: s.d }))) });
}
function duplicateItems(ids) {
  const ops = [];
  for (const id of ids) {
    const it = getItem(id); if (!it) continue;
    const nid = uid('i');
    const d = clone(S.data.items[id]); d.name = (d.name || '') + ' (copia)'; d.pos = (d.pos || 0) + 0.001; d.created = nowISO(); d.updated = nowISO();
    ops.push({ op: 'set', c: 'items', id: nid, d });
    for (const ch of childrenOf(id)) { const cd = clone(S.data.items[ch.id]); cd.parent = nid; cd.created = nowISO(); ops.push({ op: 'set', c: 'items', id: uid('i'), d: cd }); }
  }
  batch(ops);
  toast(ids.length === 1 ? 'Elemento duplicado' : ids.length + ' elementos duplicados');
}
function moveToBoard(ids, target) {
  const ops = [];
  for (const id of ids) {
    const it = getItem(id); if (!it) continue;
    const src = getBoard(it.board);
    const vals = mapValues(src.columns || [], target.columns || [], it.values || {});
    ops.push({ op: 'set', c: 'items', id, d: Object.assign(clone(S.data.items[id]), { board: target.id, group: (target.groups[0] || {}).id || 'g-default', values: vals, pos: nextPos(target.id), updated: nowISO() }) });
    for (const ch of childrenOf(id)) {
      const cv = mapValues(src.subColumns || [], target.subColumns || [], ch.values || {});
      ops.push({ op: 'set', c: 'items', id: ch.id, d: Object.assign(clone(S.data.items[ch.id]), { board: target.id, values: cv }) });
    }
  }
  ids.forEach((id) => S.ui.selected.delete(id));
  batch(ops);
  toast((ids.length === 1 ? 'Movido a ' : ids.length + ' elementos movidos a ') + target.name, { label: 'Abrir', run: () => go({ view: 'board', id: target.id }) });
}
function mapValues(fromCols, toCols, values) {
  const out = {};
  for (const fc of fromCols) {
    const v = values[fc.id]; if (v == null || v === '') continue;
    const tc = toCols.find((c) => c.id === fc.id && c.type === fc.type) || toCols.find((c) => norm(c.title) === norm(fc.title) && c.type === fc.type) || toCols.find((c) => c.type === fc.type && ['email', 'phone'].includes(c.type));
    if (!tc) continue;
    if (fc.type === 'status' || fc.type === 'dropdown') {
      const conv = (x) => { const l = labelOf(fc, x); const tl = l && (tc.labels || []).find((q) => norm(q.label) === norm(l.label)); return tl ? tl.id : null; };
      out[tc.id] = fc.type === 'status' ? conv(v) : (v || []).map(conv).filter((x) => x != null);
      if (out[tc.id] == null) delete out[tc.id];
    } else out[tc.id] = clone(v);
  }
  return out;
}

/* ---------- editores de celda */
function itemFromEl(el) { return getItem(el.dataset.id); }
function colOf(b, it, cid) { return colsFor(b, it).find((c) => c.id === cid); }
ACT.cell = (el, ev) => {
  const it = itemFromEl(el); if (!it) return;
  const b = getBoard(it.board); const col = colOf(b, it, el.dataset.col); if (!col) return;
  editCell(el, b, it, col);
};
function editCell(el, b, it, col, onDone) {
  const v = it.values && it.values[col.id];
  const set = (nv) => { setVal(it, col.id, nv); if (onDone) onDone(); };
  switch (col.type) {
    case 'status': return statusPop(el, b, col, v, set, it);
    case 'dropdown': return dropdownPop(el, b, col, v, set, it);
    case 'people': return peoplePop(el, v, set);
    case 'date': return datePop(el, v, set);
    case 'timeline': return timelinePop(el, v, set);
    case 'checkbox': return set(!v);
    case 'long_text': return longTextModal(col.title, v, set);
    default: return inlineEdit(el, col, v, set);
  }
}
function parseNum(s) {
  s = String(s).trim().replace(/[$€\s]|UF|CLP/gi, '');
  if (s === '') return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}
function inlineEdit(el, col, cur, set) {
  S.editing = true;
  el.innerHTML = '<div class="cell"><input class="in" data-live type="' + (col.type === 'email' ? 'email' : col.type === 'phone' ? 'tel' : 'text') + '" aria-label="' + esc(col.title) + '"></div>';
  const inp = el.querySelector('input');
  inp.value = cur == null ? '' : String(cur);
  inp.focus(); inp.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true; S.editing = false;
    if (save) {
      let v = inp.value.trim();
      if (col.type === 'numbers') { v = parseNum(v); if (Number.isNaN(v)) { toast('Escribe un número, por ejemplo 1.500.000 o 2,5'); v = cur; } }
      if ((v === '' ? null : v) !== (cur == null ? null : cur)) set(v === '' ? null : v);
    }
    render();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}
ACT['edit-name'] = (el) => {
  const it = itemFromEl(el); if (!it) return;
  S.editing = true;
  const wrap = el.parentElement;
  const inp = document.createElement('input');
  inp.className = 'nm-in'; inp.value = it.name || ''; inp.setAttribute('data-live', ''); inp.setAttribute('aria-label', 'Nombre');
  el.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (save) => { if (done) return; done = true; S.editing = false; const v = inp.value.trim(); if (save && v && v !== it.name) patch('items', it.id, { name: v, updated: nowISO() }); render(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  void wrap;
};
function statusPop(anchor, b, col, cur, set, it) {
  const html = '<div class="lbls">' + (col.labels || []).map((l) => '<button class="lbl" data-pa="pick" data-v="' + esc(l.id) + '" style="--c:' + esc(l.color) + ';--ct:' + inkFor(l.color) + '">' + esc(l.label) + '</button>').join('') +
    '<button class="lbl none" data-pa="pick" data-v="">Sin estado</button></div><div class="sep"></div><button class="opt" data-pa="edit">' + ic('gear') + 'Editar etiquetas</button>';
  openPop(anchor, html, {
    pick: (t) => { closePop(); set(t.dataset.v === '' ? null : t.dataset.v); },
    edit: () => labelsEditor(anchor, b, col, it && it.parent),
  }, { width: Math.max(180, anchor.offsetWidth) });
}
function labelsEditor(anchor, b, col, sub) {
  let labels = clone(col.labels || []);
  let paletteFor = null;
  const draw = (el) => {
    el.innerHTML = '<h4>Etiquetas de «' + esc(col.title) + '»</h4>' + labels.map((l, i) =>
      '<div class="lbl-edit"><button class="swatch" data-pa="sw" data-i="' + i + '" style="--c:' + esc(l.color) + '" aria-label="Color"></button><input type="text" data-i="' + i + '" value="' + esc(l.label) + '" aria-label="Nombre de etiqueta"><button class="icon-btn" data-pa="rm" data-i="' + i + '" aria-label="Eliminar etiqueta">' + ic('trash', 14) + '</button></div>' +
      (paletteFor === i ? '<div class="swatches">' + PALETTE.map((c) => '<button class="swatch" data-pa="col" data-c="' + c + '" style="--c:' + c + '" aria-label="' + c + '"></button>').join('') + '</div>' : '')).join('') +
      (col.type === 'status' ? '<label class="opt" style="font-size:12.5px"><input type="checkbox" id="lbl-done-hint" disabled checked> Las etiquetas «Listo», «Hecho» o «Ganado» cuentan como terminadas</label>' : '') +
      '<div class="row2" style="margin-top:6px"><button class="btn sm" data-pa="add">' + ic('plus', 13) + 'Nueva etiqueta</button><button class="btn sm primary" data-pa="save" style="margin-left:auto">Guardar</button></div>';
    el.querySelectorAll('input[type=text]').forEach((inp) => inp.addEventListener('input', () => { labels[Number(inp.dataset.i)].label = inp.value; }));
  };
  const el = openPop(anchor, '', {
    sw: (t, e, p) => { paletteFor = paletteFor === Number(t.dataset.i) ? null : Number(t.dataset.i); draw(p); },
    col: (t, e, p) => { labels[paletteFor].color = t.dataset.c; paletteFor = null; draw(p); },
    rm: (t, e, p) => { labels.splice(Number(t.dataset.i), 1); draw(p); },
    add: (t, e, p) => { const ids = labels.map((l) => Number(l.id)).filter((n) => !isNaN(n)); labels.push({ id: String(ids.length ? Math.max(...ids) + 1 : 0), label: 'Nueva', color: PALETTE[labels.length % PALETTE.length] }); draw(p); const ins = p.querySelectorAll('input[type=text]'); ins[ins.length - 1].focus(); ins[ins.length - 1].select(); },
    save: () => { labels = labels.filter((l) => l.label.trim()).map((l) => Object.assign(l, { label: l.label.trim(), done: l.done || /^(listo|hecho|ganado|completado|terminado)$/i.test(l.label.trim()) || undefined })); updateColumn(b, col.id, { labels }, sub); closePop(); },
  }, { width: 280 });
  draw(el);
}
function updateColumn(b, cid, p, sub) {
  const key = sub ? 'subColumns' : 'columns';
  const cols = clone(getBoard(b.id)[key] || []).map((c) => (c.id === cid ? merge(c, p) : c));
  const o = {}; o[key] = cols;
  return patch('boards', b.id, o);
}
function dropdownPop(anchor, b, col, cur, set, it) {
  let sel = new Set((Array.isArray(cur) ? cur : cur != null ? [cur] : []).map(String));
  const draw = (el) => {
    el.innerHTML = '<input type="search" placeholder="Buscar o crear etiqueta" aria-label="Buscar etiqueta" autofocus><div class="sep"></div><div class="dd-list">' + (getBoard(b.id).columns.concat(getBoard(b.id).subColumns || []).find((c) => c.id === col.id).labels || []).map((l) => '<label class="opt"><input type="checkbox" data-v="' + esc(l.id) + '"' + (sel.has(String(l.id)) ? ' checked' : '') + '> ' + esc(l.label) + '</label>').join('') + '</div><div class="sep"></div><div class="row2"><button class="btn sm primary" data-pa="ok" style="margin-left:auto">Listo</button></div>';
    el.querySelectorAll('.dd-list input').forEach((c) => c.addEventListener('change', () => { if (c.checked) sel.add(c.dataset.v); else sel.delete(c.dataset.v); }));
    const s = el.querySelector('input[type=search]');
    s.addEventListener('input', () => { const q = norm(s.value); el.querySelectorAll('.dd-list label').forEach((l) => { l.hidden = q && !norm(l.textContent).includes(q); }); });
  };
  const el = openPop(anchor, '', {
    ok: () => { closePop(); set(Array.from(sel)); },
    enter: async (inp, e, p) => {
      const v = inp.value.trim(); if (!v) return;
      const live = getBoard(b.id); const lc = (it && it.parent ? live.subColumns : live.columns).find((c) => c.id === col.id);
      let l = (lc.labels || []).find((x) => norm(x.label) === norm(v));
      if (!l) { const ids = (lc.labels || []).map((x) => Number(x.id)).filter((n) => !isNaN(n)); l = { id: String(ids.length ? Math.max(...ids) + 1 : 1), label: v }; await updateColumn(b, col.id, { labels: (lc.labels || []).concat([l]) }, it && it.parent); }
      sel.add(String(l.id)); draw(p);
    },
  }, { width: 240 });
  draw(el);
}
function peoplePop(anchor, cur, set) {
  let sel = new Set(Array.isArray(cur) ? cur : cur ? [cur] : []);
  const draw = (el) => {
    const names = Array.from(new Set(team().concat(Array.from(sel))));
    el.innerHTML = '<h4>Personas</h4>' + names.map((n) => '<label class="opt"><input type="checkbox" data-n="' + esc(n) + '"' + (sel.has(n) ? ' checked' : '') + '><span class="av" style="--avc:' + hashColor(n) + ';width:22px;height:22px;font-size:10px">' + esc(initials(n)) + '</span>' + esc(n) + '</label>').join('') +
      '<div class="sep"></div><input type="text" placeholder="Agregar persona al equipo" aria-label="Nueva persona"><div class="row2" style="margin-top:8px"><button class="btn sm primary" data-pa="ok" style="margin-left:auto">Listo</button></div>';
    el.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => { if (c.checked) sel.add(c.dataset.n); else sel.delete(c.dataset.n); }));
  };
  const el = openPop(anchor, '', {
    ok: () => { closePop(); set(Array.from(sel)); },
    enter: (inp, e, p) => { const v = inp.value.trim(); if (!v) return; if (!team().includes(v) && myRole() !== 'clients') patchMeta({ team: team().concat([v]) }); sel.add(v); draw(p); },
  }, { width: 230 });
  draw(el);
}
function datePop(anchor, cur, set) {
  const t = todayISO();
  openPop(anchor, '<h4>Fecha</h4><input type="date" value="' + esc(cur || '') + '" aria-label="Fecha" autofocus><div class="row2" style="margin-top:8px"><button class="btn sm" data-pa="q" data-v="' + t + '">Hoy</button><button class="btn sm" data-pa="q" data-v="' + addDays(t, 1) + '">Mañana</button><button class="btn sm" data-pa="q" data-v="' + addDays(mondayOf(t), 7) + '">Próx. lunes</button><button class="btn sm danger" data-pa="q" data-v="">Borrar</button></div>', {
    q: (b) => { closePop(); set(b.dataset.v || null); },
    mount: (el) => { const i = el.querySelector('input'); i.addEventListener('change', () => { if (i.value) { closePop(); set(i.value); } }); },
  }, { width: 250 });
}
function timelinePop(anchor, cur, set) {
  const c = cur || {};
  openPop(anchor, '<h4>Cronograma</h4><div style="display:grid;gap:6px"><label class="fld"><span>Desde</span><input type="date" id="tl-from" value="' + esc(c.from || '') + '"></label><label class="fld"><span>Hasta</span><input type="date" id="tl-to" value="' + esc(c.to || '') + '"></label></div><div class="row2" style="margin-top:8px"><button class="btn sm danger" data-pa="clr">Borrar</button><button class="btn sm primary" data-pa="ok" style="margin-left:auto">Guardar</button></div>', {
    ok: (b, e, el) => { const f = el.querySelector('#tl-from').value, to = el.querySelector('#tl-to').value; closePop(); set(f || to ? { from: f || to, to: to || f } : null); },
    clr: () => { closePop(); set(null); },
  }, { width: 240 });
}
function longTextModal(title, cur, set) {
  openModal({ title, body: '<label class="fld"><span>Texto</span><textarea name="t" rows="10">' + esc(cur || '') + '</textarea></label>', submit: (fd) => { const v = String(fd.get('t') || ''); if (v !== (cur || '')) set(v.trim() ? v : null); } });
}

/* ---------- acciones del tablero */
const curBoard = () => (S.route.view === 'board' ? getBoard(S.route.id) : null);
ACT.mode = (t) => { S.route = Object.assign({}, S.route, { mode: t.dataset.m }); render(); };
ACT['grp-toggle'] = (t) => { const b = curBoard(); const k = b.id + ':' + t.dataset.g; S.ui.collapsed[k] = !S.ui.collapsed[k]; render(); };
ACT.more = (t) => { S.ui.more[t.dataset.k] = (S.ui.more[t.dataset.k] || 150) + 150; render(); };
ACT['open-item'] = (t) => openItem(t.dataset.id, t.dataset.tab || undefined);
ACT['open-item'] = (t) => openItem(t.dataset.id);
ACT['clear-filter'] = () => { const b = curBoard(); S.ui.filter[b.id] = Object.assign({}, S.ui.filter[b.id], { col: null, vals: [] }); render(); };
ACT['clear-person'] = () => { const b = curBoard(); S.ui.filter[b.id] = Object.assign({}, S.ui.filter[b.id], { person: null }); render(); };
ACT['clear-sort'] = () => { const b = curBoard(); delete S.ui.sort[b.id]; render(); };
ACT['clear-all-filters'] = () => { const b = curBoard(); delete S.ui.filter[b.id]; S.ui.search[b.id] = ''; const s = $('#bd-search'); if (s) s.value = ''; render(); };
ACT['sort-name'] = () => { const b = curBoard(); const so = S.ui.sort[b.id]; S.ui.sort[b.id] = { col: 'name', dir: so && so.col === 'name' && so.dir === 'asc' ? 'desc' : 'asc' }; render(); };
ACT['cal-move'] = (t) => { const ym = S.ui.calMonth || todayISO().slice(0, 7); const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + Number(t.dataset.d), 1); S.ui.calMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); render(); };
ACT['cal-today'] = () => { S.ui.calMonth = null; render(); };
ACT['new-item'] = () => {
  const b = curBoard(); if (!b) return;
  const mode = modeOf(b);
  const g = b.groups && b.groups[0] ? b.groups[0].id : null;
  const id = createItem(b, g, newLabel(b));
  if (mode === 'table') { const k = b.id + ':' + g; S.ui.collapsed[k] = false; }
  openItem(id, 'info', true);
};
ACT['kb-add'] = (t) => {
  const b = curBoard(); const col = primaryStatus(b);
  const vals = {}; if (t.dataset.v !== '__none') vals[col.id] = t.dataset.v;
  const id = createItem(b, null, newLabel(b), vals);
  openItem(id, 'info', true);
};
ACT['person-filter'] = (t) => {
  const b = curBoard(); const f = S.ui.filter[b.id] || {};
  const names = new Set(team());
  for (const it of boardItems(b.id)) for (const c of b.columns || []) { const v = it.values && it.values[c.id]; if (c.type === 'people' && Array.isArray(v)) v.forEach((p) => names.add(p)); }
  menu(t, [{ head: 'Filtrar por persona' }].concat(Array.from(names).map((n) => ({ label: n + (f.person === n ? ' ✓' : ''), icon: 'user', run: () => { S.ui.filter[b.id] = Object.assign({}, f, { person: f.person === n ? null : n }); render(); } }))));
};
ACT.filter = (t) => {
  const b = curBoard(); const f = S.ui.filter[b.id] || {};
  const fcols = (b.columns || []).filter((c) => ['status', 'dropdown', 'people'].includes(c.type));
  if (!fcols.length) return toast('Este tablero no tiene columnas de estado, etiquetas o personas para filtrar.');
  filterPop(t, b, f.col && fcols.find((c) => c.id === f.col) ? f.col : fcols[0].id);
};
function filterPop(anchor, b, cid) {
  const f = S.ui.filter[b.id] || {};
  const fcols = (b.columns || []).filter((c) => ['status', 'dropdown', 'people'].includes(c.type));
  const col = colById(b, cid);
  let vals = new Set(f.col === cid ? f.vals || [] : []);
  let opts;
  if (col.type === 'people') { const ns = new Set(team()); for (const it of boardItems(b.id)) (it.values && it.values[cid] || []).forEach((p) => ns.add(p)); opts = Array.from(ns).map((n) => ({ id: n, label: n })); }
  else opts = (col.labels || []).map((l) => ({ id: String(l.id), label: l.label, color: l.color })).concat(col.type === 'status' ? [{ id: '__none', label: 'Sin estado', color: '#c9cbd6' }] : []);
  const counts = {};
  for (const it of boardItems(b.id)) { const v = it.values && it.values[cid]; const arr = Array.isArray(v) ? v.map(String) : [v == null || v === '' ? '__none' : String(v)]; arr.forEach((x) => { counts[x] = (counts[x] || 0) + 1; }); }
  openPop(anchor, '<h4>Filtrar</h4><select id="flt-col" aria-label="Columna">' + fcols.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === cid ? ' selected' : '') + '>' + esc(c.title) + '</option>').join('') + '</select><div class="sep"></div>' +
    opts.map((o) => '<label class="opt"><input type="checkbox" data-v="' + esc(o.id) + '"' + (vals.has(o.id) ? ' checked' : '') + '>' + (o.color ? '<span style="width:12px;height:12px;border-radius:3px;background:' + esc(o.color) + ';flex:none"></span>' : '') + '<span style="flex:1">' + esc(o.label) + '</span><span class="mono muted" style="font-size:11.5px">' + (counts[o.id] || 0) + '</span></label>').join('') +
    '<div class="sep"></div><div class="row2"><button class="btn sm" data-pa="clr">Limpiar</button><button class="btn sm primary" data-pa="ok" style="margin-left:auto">Aplicar</button></div>', {
    mount: (el) => {
      el.querySelector('#flt-col').addEventListener('change', (e) => filterPop(anchor, b, e.target.value));
      el.querySelectorAll('input[type=checkbox]').forEach((c) => c.addEventListener('change', () => { if (c.checked) vals.add(c.dataset.v); else vals.delete(c.dataset.v); }));
    },
    ok: () => { S.ui.filter[b.id] = Object.assign({}, f, { col: cid, vals: Array.from(vals) }); closePop(); render(); },
    clr: () => { S.ui.filter[b.id] = Object.assign({}, f, { col: null, vals: [] }); closePop(); render(); },
  }, { width: 250 });
}
ACT.sort = (t) => {
  const b = curBoard(); const so = S.ui.sort[b.id] || {};
  const entries = [{ head: 'Ordenar por' }, { label: 'Nombre', icon: 'sort', run: () => { S.ui.sort[b.id] = { col: 'name', dir: 'asc' }; render(); } }];
  for (const c of b.columns || []) if (['status', 'date', 'numbers', 'text', 'people', 'timeline'].includes(c.type)) entries.push({ label: c.title + (so.col === c.id ? (so.dir === 'desc' ? ' ↓' : ' ↑') : ''), icon: 'sort', run: () => { S.ui.sort[b.id] = { col: c.id, dir: so.col === c.id && so.dir === 'asc' ? 'desc' : 'asc' }; render(); } });
  menu(t, entries);
};
ACT['col-menu'] = (t) => {
  const b = curBoard(); const sub = !!t.dataset.sub;
  const cols = sub ? b.subColumns || [] : b.columns || [];
  const col = cols.find((c) => c.id === t.dataset.col); if (!col) return;
  const i = cols.indexOf(col);
  const move = (d) => { const arr = clone(cols); const [x] = arr.splice(i, 1); arr.splice(i + d, 0, x); const o = {}; o[sub ? 'subColumns' : 'columns'] = arr; patch('boards', b.id, o); };
  menu(t, [
    { head: TYPES[col.type] ? TYPES[col.type].label : col.type },
    { label: 'Renombrar', icon: 'note', run: () => renameModal('Renombrar columna', col.title, (v) => updateColumn(b, col.id, { title: v }, sub)) },
    (col.type === 'status' || col.type === 'dropdown') && { label: 'Editar etiquetas', icon: 'gear', run: () => labelsEditor(t, b, col, sub) },
    col.type === 'numbers' && { label: 'Unidad (' + (col.unit || 'ninguna') + ')', icon: 'gear', run: () => renameModal('Unidad de la columna', col.unit || '', (v) => updateColumn(b, col.id, { unit: v || null }, sub), 'Por ejemplo CLP, UF, EUR o %. Déjalo vacío para no mostrar unidad.') },
    col.type === 'date' && { label: col.followup ? 'Quitar de seguimientos' : 'Usar para seguimientos', icon: 'cal', run: () => updateColumn(b, col.id, { followup: !col.followup }, sub) },
    S.caps.server && isAdmin() && { label: col.private ? 'Mostrar al equipo' : 'Ocultar al equipo (solo administradores)', icon: 'lock', run: () => { updateColumn(b, col.id, { private: !col.private }, sub); toast(col.private ? 'Ahora el equipo ve «' + col.title + '»' : '«' + col.title + '» queda visible solo para administradores'); } },
    !sub && { label: 'Ordenar ascendente', icon: 'arrowUp', run: () => { S.ui.sort[b.id] = { col: col.id, dir: 'asc' }; render(); } },
    !sub && { label: 'Ordenar descendente', icon: 'arrowDown', run: () => { S.ui.sort[b.id] = { col: col.id, dir: 'desc' }; render(); } },
    !sub && ['status', 'dropdown', 'people'].includes(col.type) && { label: 'Filtrar por esta columna', icon: 'filter', run: () => filterPop(t, b, col.id) },
    { label: 'Ancho: ' + (col.width ? col.width + ' px' : 'automático'), icon: 'move', run: () => renameModal('Ancho de la columna (px)', String(col.width || colW(col)), (v) => { const n = Math.max(60, Math.min(600, Number(v) || 0)); updateColumn(b, col.id, { width: n }, sub); }) },
    i > 0 && { label: 'Mover a la izquierda', icon: 'right', run: () => move(-1) },
    i < cols.length - 1 && { label: 'Mover a la derecha', icon: 'right', run: () => move(1) },
    '-',
    { label: 'Eliminar columna', icon: 'trash', danger: true, run: () => confirmBox('Eliminar columna', 'Se borrará «' + col.title + '» y sus valores en todos los elementos del tablero.', 'Eliminar', () => { const o = {}; o[sub ? 'subColumns' : 'columns'] = cols.filter((c) => c.id !== col.id); patch('boards', b.id, o); }) },
  ]);
};
ACT['add-col'] = (t) => {
  const b = curBoard(); const sub = !!t.dataset.sub;
  const h = {};
  const html = '<h4>Nueva columna</h4><div class="type-grid">' + Object.entries(TYPES).map(([k, v]) => { h['t_' + k] = () => addColumn(b, k, sub); return '<button class="opt" data-pa="t_' + k + '">' + esc(v.label) + '</button>'; }).join('') + '</div>';
  openPop(t, html, h, { width: 260 });
};
ACT['add-status-col'] = () => addColumn(curBoard(), 'status', false);
function addColumn(b, type, sub) {
  closePop();
  const col = { id: uid('c'), title: TYPES[type].label, type };
  if (type === 'status') col.labels = DEFAULT_STATUS();
  if (type === 'dropdown') col.labels = [];
  const key = sub ? 'subColumns' : 'columns';
  const o = {}; o[key] = (getBoard(b.id)[key] || []).concat([col]);
  patch('boards', b.id, o);
  renameModal('Nombre de la columna', col.title, (v) => updateColumn(b, col.id, { title: v }, sub));
}
function renameModal(title, cur, save, hint) {
  openModal({ title, body: '<label class="fld"><span>' + esc(hint || 'Nombre') + '</span><input name="v" value="' + esc(cur || '') + '" autofocus></label>', submit: (fd) => { const v = String(fd.get('v') || '').trim(); if (v !== cur) save(v); } });
  setTimeout(() => { const i = S.modal && S.modal.querySelector('input[name=v]'); if (i) i.select(); }, 40);
}
ACT['grp-menu'] = (t) => {
  const b = curBoard(); const groups = b.groups || [];
  const g = groups.find((x) => x.id === t.dataset.g); if (!g) return;
  const i = groups.indexOf(g);
  const setGroups = (arr) => patch('boards', b.id, { groups: arr });
  const n = boardItems(b.id).filter((it) => it.group === g.id).length;
  menu(t, [
    { label: 'Renombrar grupo', icon: 'note', run: () => renameModal('Renombrar grupo', g.title, (v) => v && setGroups(groups.map((x) => (x.id === g.id ? Object.assign({}, x, { title: v }) : x)))) },
    { label: 'Cambiar color', icon: 'star', run: () => { const h = {}; const html = '<h4>Color del grupo</h4><div class="swatches">' + PALETTE.map((c, k) => { h['c' + k] = () => { closePop(); setGroups(groups.map((x) => (x.id === g.id ? Object.assign({}, x, { color: c }) : x))); }; return '<button class="swatch" data-pa="c' + k + '" style="--c:' + c + '" aria-label="' + c + '"></button>'; }).join('') + '</div>'; openPop(t, html, h); } },
    { label: 'Agregar grupo debajo', icon: 'plus', run: () => { const ng = { id: uid('g'), title: 'Nuevo grupo', color: PALETTE[groups.length % PALETTE.length] }; const arr = groups.slice(); arr.splice(i + 1, 0, ng); setGroups(arr); } },
    i > 0 && { label: 'Mover arriba', icon: 'arrowUp', run: () => { const arr = groups.slice(); arr.splice(i, 1); arr.splice(i - 1, 0, g); setGroups(arr); } },
    i < groups.length - 1 && { label: 'Mover abajo', icon: 'arrowDown', run: () => { const arr = groups.slice(); arr.splice(i, 1); arr.splice(i + 1, 0, g); setGroups(arr); } },
    { label: 'Contraer los demás grupos', icon: 'caret', run: () => { groups.forEach((x) => { S.ui.collapsed[b.id + ':' + x.id] = x.id !== g.id; }); render(); } },
    '-',
    groups.length > 1 && { label: 'Eliminar grupo', icon: 'trash', danger: true, run: () => confirmBox('Eliminar grupo', n ? 'Se eliminará «' + g.title + '» y sus ' + n + ' elementos. Puedes deshacerlo justo después.' : 'Se eliminará el grupo vacío «' + g.title + '».', 'Eliminar', () => { const ids = boardItems(b.id).filter((it) => it.group === g.id).map((it) => it.id); setGroups(groups.filter((x) => x.id !== g.id)); if (ids.length) deleteItems(ids); }) },
  ]);
};
ACT['add-group'] = () => { const b = curBoard(); const groups = b.groups || []; patch('boards', b.id, { groups: [{ id: uid('g'), title: 'Nuevo grupo', color: PALETTE[groups.length % PALETTE.length] }].concat(groups) }); toast('Grupo agregado arriba. Haz clic en su nombre para renombrarlo.'); };
ACT['item-menu'] = (t) => {
  const it = getItem(t.dataset.id); if (!it) return;
  const b = getBoard(it.board);
  itemMenu(t, b, it);
};
function itemMenu(anchor, b, it) {
  const isSub = !!it.parent;
  menu(anchor, [
    { label: 'Abrir', icon: 'open', run: () => openItem(it.id) },
    { label: 'Duplicar', icon: 'copy', run: () => duplicateItems([it.id]) },
    !isSub && (b.groups || []).length > 1 && { label: 'Mover a grupo…', icon: 'move', run: () => menu(anchor, [{ head: 'Mover a grupo' }].concat(b.groups.filter((g) => g.id !== it.group).map((g) => ({ label: g.title, icon: 'right', run: () => patch('items', it.id, { group: g.id, updated: nowISO() }) })))) },
    !isSub && { label: 'Mover a otro tablero…', icon: 'board', run: () => menu(anchor, [{ head: 'Mover a tablero' }].concat(boardsSorted().filter((x) => x.id !== b.id).map((x) => ({ label: x.name, icon: 'board', run: () => moveToBoard([it.id], x) })))) },
    '-',
    { label: 'Eliminar', icon: 'trash', danger: true, run: () => deleteItems([it.id]) },
  ]);
}
ACT['board-menu'] = (t) => {
  const b = curBoard();
  const wr = (b.automations || {}).weeklyReset || {};
  menu(t, [
    { label: 'Editar descripción', icon: 'note', run: () => openModal({ title: 'Descripción del tablero', body: '<label class="fld"><span>Descripción</span><textarea name="d" rows="4">' + esc(b.description || '') + '</textarea></label><label class="fld"><span>Nombre de cada elemento (singular)</span><input name="l" value="' + esc(b.itemLabel || 'Elemento') + '"></label>', submit: (fd) => patch('boards', b.id, { description: String(fd.get('d') || '').trim(), itemLabel: String(fd.get('l') || '').trim() || 'Elemento' }) }) },
    { label: 'Duplicar tablero', icon: 'copy', run: () => duplicateBoardModal(b) },
    { label: b.isTemplate ? 'Dejar de usar como plantilla' : 'Usar como plantilla', icon: 'tpl', run: () => patch('boards', b.id, { isTemplate: !b.isTemplate }) },
    { label: 'Mover a carpeta…', icon: 'folder', run: () => moveBoardModal(b) },
    { label: 'Reinicio semanal' + (wr.enabled ? ' (activo)' : ''), icon: 'refresh', run: () => weeklyResetModal(b) },
    '-',
    { label: 'Importar CSV', icon: 'upload', run: () => importCSVModal(b) },
    { label: 'Exportar CSV', icon: 'download', run: () => exportCSV(b) },
    '-',
    { label: 'Eliminar tablero', icon: 'trash', danger: true, run: () => confirmBox('Eliminar tablero', 'Se borrará «' + b.name + '» con sus ' + boardItems(b.id).length + ' elementos. Esta acción no se puede deshacer.', 'Eliminar tablero', () => deleteBoard(b)) },
  ]);
};
function deleteBoard(b) {
  const ops = [];
  for (const [id, it] of Object.entries(S.data.items)) if (it && it.board === b.id) { ops.push({ op: 'del', c: 'items', id }); for (const u of idx().upd.get(id) || []) ops.push({ op: 'del', c: 'updates', id: u.id }); }
  ops.push({ op: 'del', c: 'boards', id: b.id });
  go({ view: 'home' });
  batch(ops);
  toast('Tablero eliminado');
}
function weeklyResetModal(b) {
  const wr = (b.automations || {}).weeklyReset || {};
  const cols = (b.columns || []).filter((c) => ['checkbox', 'status', 'date', 'people', 'text'].includes(c.type));
  openModal({
    title: 'Reinicio semanal',
    body: '<p style="margin:0;color:var(--muted)">Cada lunes, al abrir SARAHI OS, se vacían las columnas que elijas en todos los elementos de este tablero.</p>' +
      '<label class="opt" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="on"' + (wr.enabled ? ' checked' : '') + '> Activar reinicio semanal</label>' +
      '<div class="fld"><span>Columnas a vaciar</span>' + cols.map((c) => '<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" name="c" value="' + esc(c.id) + '"' + ((wr.columns || []).includes(c.id) ? ' checked' : '') + '> ' + esc(c.title) + ' <span class="muted" style="font-size:12px">' + esc(TYPES[c.type].label) + '</span></label>').join('') + '</div>' +
      (wr.lastReset ? '<p class="muted" style="margin:0;font-size:12.5px">Último reinicio: semana del ' + fmtDate(wr.lastReset, true) + '</p>' : ''),
    foot: '<button type="button" class="btn" data-ma="now">Reiniciar ahora</button><button type="button" class="btn" data-ma="close">Cancelar</button><button type="submit" class="btn primary">Guardar</button>',
    handlers: { now: async () => { closeModal(); const n = await weeklyReset(getBoard(b.id)); toast(n + ' elementos reiniciados'); } },
    submit: (fd) => patch('boards', b.id, { automations: { weeklyReset: { enabled: !!fd.get('on'), columns: fd.getAll('c'), lastReset: wr.lastReset || mondayOf(todayISO()) } } }),
  });
}
function folderOptions(sel, ws) {
  const m = meta();
  let h = '<option value="">Sin carpeta</option>';
  for (const f of m.folders || []) if (!ws || f.ws === ws) h += '<option value="' + esc(f.id) + '"' + (f.id === sel ? ' selected' : '') + '>' + esc(f.name) + '</option>';
  return h;
}
function wsOptions(sel) { return (meta().workspaces || []).map((w) => '<option value="' + esc(w.id) + '"' + (w.id === sel ? ' selected' : '') + '>' + esc(w.name) + '</option>').join(''); }
function moveBoardModal(b) {
  openModal({
    title: 'Mover tablero',
    body: '<label class="fld"><span>Espacio</span><select name="ws">' + wsOptions(b.ws) + '</select></label><label class="fld"><span>Carpeta</span><select name="f">' + folderOptions(b.folder) + '</select></label><label class="fld"><span>O crea una carpeta nueva</span><input name="nf" placeholder="Nombre de la carpeta"></label>',
    submit: (fd) => {
      let f = String(fd.get('f') || ''); const ws = String(fd.get('ws') || b.ws || '');
      const nf = String(fd.get('nf') || '').trim();
      if (nf) { f = uid('f'); patchMeta({ folders: (meta().folders || []).concat([{ id: f, ws, name: nf }]) }); }
      const fo = (meta().folders || []).find((x) => x.id === f);
      patch('boards', b.id, { ws: fo ? fo.ws : ws, folder: f || null });
    },
  });
}

/* ---------- duplicar y crear tableros */
function cloneBoardOps(src, o) {
  const nb = uid('b');
  const doc = clone(S.data.boards[src.id]);
  doc.name = o.name; doc.folder = o.folder === undefined ? doc.folder : o.folder; doc.ws = o.ws || doc.ws; doc.isTemplate = !!o.isTemplate; doc.created = nowISO(); doc.pos = (doc.pos || 0) + 0.5;
  delete doc.clientItem; delete doc.stageSync;
  if (o.clientItem) doc.clientItem = o.clientItem;
  if (doc.automations && doc.automations.weeklyReset) doc.automations.weeklyReset.lastReset = mondayOf(todayISO());
  const ops = [{ op: 'set', c: 'boards', id: nb, d: doc }];
  if (o.withItems) {
    for (const it of boardItems(src.id)) {
      const nid = uid('i');
      const d = clone(S.data.items[it.id]); d.board = nb; d.created = nowISO(); d.updated = nowISO();
      if (o.blankValues) d.values = Object.fromEntries(Object.entries(d.values || {}).filter(([k]) => { const c = colById(src, k); return c && c.type === 'text'; }));
      ops.push({ op: 'set', c: 'items', id: nid, d });
      for (const ch of childrenOf(it.id)) { const cd = clone(S.data.items[ch.id]); cd.board = nb; cd.parent = nid; cd.created = nowISO(); ops.push({ op: 'set', c: 'items', id: uid('i'), d: cd }); }
    }
  }
  return { id: nb, ops };
}
function duplicateBoardModal(b) {
  openModal({
    title: 'Duplicar tablero',
    body: '<label class="fld"><span>Nombre</span><input name="n" value="' + esc(b.name + ' (copia)') + '"></label><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="items" checked> Copiar también los elementos</label>',
    ok: 'Duplicar',
    submit: async (fd) => { const r = cloneBoardOps(b, { name: String(fd.get('n') || b.name).trim(), withItems: !!fd.get('items') }); await batch(r.ops); go({ view: 'board', id: r.id }); },
  });
}
ACT['new-board'] = (t) => newBoardModal(t.dataset.ws);
function newBoardModal(ws) {
  const tpls = boardsSorted().filter((b) => b.isTemplate);
  ws = ws || ((meta().workspaces || [])[0] || {}).id || 'w-main';
  openModal({
    title: 'Nuevo tablero',
    body: '<label class="fld"><span>Nombre</span><input name="n" placeholder="Por ejemplo: Contenidos noviembre" required></label>' +
      '<div class="radio-cards"><label><input type="radio" name="from" value="blank" checked><span><b>En blanco</b><br><small class="muted">Estado, persona y fecha</small></span></label>' +
      (tpls.length ? '<label><input type="radio" name="from" value="tpl"><span><b>Desde plantilla</b><br><small class="muted">Copia grupos, columnas y tareas</small></span></label>' : '') + '</div>' +
      (tpls.length ? '<label class="fld"><span>Plantilla</span><select name="tpl">' + tpls.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + '</select></label>' : '') +
      '<label class="fld"><span>Espacio</span><select name="ws">' + wsOptions(ws) + '</select></label><label class="fld"><span>Carpeta</span><select name="f">' + folderOptions('', null) + '</select></label>',
    ok: 'Crear tablero',
    submit: async (fd) => {
      const name = String(fd.get('n') || '').trim();
      if (!name) { toast('Escribe un nombre para el tablero'); return true; }
      const f = String(fd.get('f') || ''); const fo = (meta().folders || []).find((x) => x.id === f);
      const w = fo ? fo.ws : String(fd.get('ws') || ws);
      if (fd.get('from') === 'tpl') {
        const r = cloneBoardOps(getBoard(String(fd.get('tpl'))), { name, folder: f || null, ws: w, withItems: true });
        await batch(r.ops); go({ view: 'board', id: r.id }); return;
      }
      const id = uid('b');
      await put('boards', id, { name, ws: w, folder: f || null, pos: boardsSorted().length + 1, description: '', itemLabel: 'Elemento', created: nowISO(),
        columns: [{ id: uid('c'), title: 'Responsable', type: 'people' }, { id: uid('c'), title: 'Estado', type: 'status', labels: DEFAULT_STATUS() }, { id: uid('c'), title: 'Fecha', type: 'date', followup: true }],
        groups: [{ id: uid('g'), title: 'Pendientes', color: '#579bfc' }, { id: uid('g'), title: 'Hecho', color: '#00c875' }] });
      if (!S.data.meta.main) await patchMeta({ workspaces: [{ id: w, name: 'Mi espacio' }] });
      go({ view: 'board', id });
    },
  });
}

/* ---------- CSV */
function csvCell(s) { s = String(s == null ? '' : s); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function exportCSV(b) {
  const cols = b.columns || [];
  const groups = Object.fromEntries((b.groups || []).map((g) => [g.id, g.title]));
  const rows = [['Nombre', 'Grupo'].concat(cols.map((c) => c.title))];
  for (const it of boardItems(b.id)) rows.push([it.name, groups[it.group] || ''].concat(cols.map((c) => valText(c, it.values && it.values[c.id]))));
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  await saveFile(b.name.replace(/[^\w\-áéíóúñ ]+/gi, '').trim() + '.csv', csv, 'text/csv');
}
async function saveFile(name, content, mime) {
  try {
    if (A.save) { await A.save(name, content, mime); return; }
    const url = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast('No se pudo descargar el archivo: ' + ((e && (e.message || e.code)) || 'cancelado')); }
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const d = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}
function parseDateLoose(s) {
  s = String(s || '').trim(); if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  return null;
}
function importCSVModal(b) {
  openModal({
    title: 'Importar CSV a «' + b.name + '»', wide: true,
    body: '<p style="margin:0;color:var(--muted)">Sube un CSV (exporta tu hoja o tu tablero de monday como CSV). La primera fila debe tener los títulos de las columnas; los que coincidan con columnas del tablero se asignan solos.</p><div class="dropzone" id="csv-dz"><input type="file" id="csv-file" accept=".csv,.txt,text/csv"><div style="margin-top:6px;font-size:12.5px">o arrastra el archivo aquí</div></div><div id="csv-map"></div>',
    ok: 'Importar',
    mount: (w) => {
      const show = (text) => {
        const rows = parseCSV(text);
        if (rows.length < 2) { w.querySelector('#csv-map').innerHTML = '<p class="muted">El archivo no tiene filas para importar.</p>'; return; }
        w._rows = rows;
        const hdr = rows[0];
        const opts = (h, i) => {
          const n = norm(h);
          let pick = '';
          const c = (b.columns || []).find((c2) => norm(c2.title) === n);
          if (c) pick = c.id; else if (/^(nombre|name|empresa|elemento|item|lead|prospecto|tarea)$/.test(n) || (i === 0 && !hdr.some((x) => /^(nombre|name)$/.test(norm(x))))) pick = '__name'; else if (/^(grupo|group)$/.test(n)) pick = '__group'; else pick = '__new';
          return '<option value="__skip"' + (pick === '__skip' ? ' selected' : '') + '>No importar</option><option value="__name"' + (pick === '__name' ? ' selected' : '') + '>Nombre del elemento</option><option value="__group"' + (pick === '__group' ? ' selected' : '') + '>Grupo (por nombre)</option>' + (b.columns || []).map((c2) => '<option value="' + esc(c2.id) + '"' + (pick === c2.id ? ' selected' : '') + '>' + esc(c2.title) + ' · ' + esc(TYPES[c2.type].label) + '</option>').join('') + '<option value="__new"' + (pick === '__new' ? ' selected' : '') + '>Crear columna de texto</option>';
        };
        w.querySelector('#csv-map').innerHTML = '<p style="margin:0 0 6px"><b>' + (rows.length - 1) + '</b> filas detectadas.</p><div style="overflow-x:auto"><table class="tbl-simple"><thead><tr><th>Columna del CSV</th><th>Ejemplo</th><th>Importar como</th></tr></thead><tbody>' +
          hdr.map((h, i) => '<tr><td>' + esc(h) + '</td><td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((rows[1] || [])[i] || '') + '</td><td><select name="map' + i + '">' + opts(h, i) + '</select></td></tr>').join('') +
          '</tbody></table></div><label class="fld" style="margin-top:10px"><span>Grupo de destino (si no viene en el CSV)</span><select name="grp">' + (b.groups || []).map((g) => '<option value="' + esc(g.id) + '">' + esc(g.title) + '</option>').join('') + '</select></label>';
      };
      const fi = w.querySelector('#csv-file');
      fi.addEventListener('change', () => { const f = fi.files[0]; if (f) f.text().then(show); });
      const dz = w.querySelector('#csv-dz');
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) f.text().then(show); });
    },
    submit: async (fd, w) => {
      const rows = w._rows; if (!rows) { toast('Primero elige un archivo CSV'); return true; }
      const hdr = rows[0];
      const live = getBoard(b.id);
      let cols = clone(live.columns || []);
      let groups = clone(live.groups || []);
      const map = hdr.map((h, i) => String(fd.get('map' + i) || '__skip'));
      map.forEach((m, i) => { if (m === '__new') { const id = uid('c'); cols.push({ id, title: hdr[i] || 'Columna ' + (i + 1), type: 'text' }); map[i] = id; } });
      const defGroup = String(fd.get('grp') || (groups[0] || {}).id);
      let pos = nextPos(b.id);
      const ops = [];
      for (const r of rows.slice(1)) {
        const vals = {}; let name = ''; let grp = defGroup;
        map.forEach((m, i) => {
          const raw = String(r[i] == null ? '' : r[i]).trim(); if (!raw || m === '__skip') return;
          if (m === '__name') { name = raw; return; }
          if (m === '__group') { let g = groups.find((x) => norm(x.title) === norm(raw)); if (!g) { g = { id: uid('g'), title: raw, color: PALETTE[groups.length % PALETTE.length] }; groups.push(g); } grp = g.id; return; }
          const c = cols.find((x) => x.id === m); if (!c) return;
          if (c.type === 'status') { let l = (c.labels || []).find((x) => norm(x.label) === norm(raw)); if (!l) { const ids = (c.labels || []).map((x) => Number(x.id)).filter((n) => !isNaN(n)); l = { id: String(ids.length ? Math.max(...ids) + 1 : 0), label: raw, color: PALETTE[(c.labels || []).length % PALETTE.length] }; c.labels = (c.labels || []).concat([l]); } vals[c.id] = l.id; }
          else if (c.type === 'dropdown') { vals[c.id] = raw.split(/\s*[,;]\s*/).filter(Boolean).map((x) => { let l = (c.labels || []).find((y) => norm(y.label) === norm(x)); if (!l) { const ids = (c.labels || []).map((y) => Number(y.id)).filter((n) => !isNaN(n)); l = { id: String(ids.length ? Math.max(...ids) + 1 : 1), label: x }; c.labels = (c.labels || []).concat([l]); } return l.id; }); }
          else if (c.type === 'people') vals[c.id] = raw.split(/\s*[,;]\s*/).filter(Boolean);
          else if (c.type === 'numbers') { const n = parseNum(raw); if (!Number.isNaN(n) && n != null) vals[c.id] = n; }
          else if (c.type === 'date') { const d = parseDateLoose(raw); if (d) vals[c.id] = d; }
          else if (c.type === 'checkbox') vals[c.id] = /^(s[ií]|true|1|x|v|✓|yes)$/i.test(raw);
          else vals[c.id] = raw;
        });
        if (!name) continue;
        ops.push({ op: 'set', c: 'items', id: uid('i'), d: { board: b.id, group: grp, parent: null, name, values: vals, pos: pos++, created: nowISO(), updated: nowISO() } });
      }
      ops.unshift({ op: 'update', c: 'boards', id: b.id, d: { columns: cols, groups } });
      await batch(ops);
      toast((ops.length - 1) + ' elementos importados');
    },
  });
}

/* ---------- arrastrar y soltar */
function wireDnD() {
  const body = $('#main-body');
  body.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-item][draggable]'); if (!el) return;
    S.drag = el.dataset.item; el.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', S.drag); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* navegador sin dataTransfer */ }
  });
  body.addEventListener('dragend', () => { S.drag = null; $$('.dragging,.drop-before,.over', body).forEach((x) => x.classList.remove('dragging', 'drop-before', 'over')); });
  body.addEventListener('dragover', (e) => {
    if (!S.drag) return;
    const lane = e.target.closest('.kb-col'); const row = e.target.closest('.row[data-item]:not(.sub)'); const gh = e.target.closest('[data-drop-group]');
    if (lane || row || gh) e.preventDefault();
    $$('.drop-before,.over', body).forEach((x) => x.classList.remove('drop-before', 'over'));
    if (lane) lane.classList.add('over'); else if (row && row.dataset.item !== S.drag) row.classList.add('drop-before');
  });
  body.addEventListener('drop', (e) => {
    if (!S.drag) return;
    e.preventDefault();
    const it = getItem(S.drag); S.drag = null; if (!it) return;
    const b = getBoard(it.board);
    const lane = e.target.closest('.kb-col');
    if (lane) { const col = primaryStatus(b); const v = lane.dataset.lane === '__none' ? null : lane.dataset.lane; if (String((it.values || {})[col.id]) !== String(v)) setVal(it, col.id, v); return; }
    const row = e.target.closest('.row[data-item]:not(.sub)');
    if (row && row.dataset.item !== it.id) {
      const tgt = getItem(row.dataset.item); if (!tgt) return;
      const list = boardItems(b.id).filter((x) => x.id !== it.id);
      const i = list.findIndex((x) => x.id === tgt.id);
      const prev = list[i - 1];
      const pos = prev ? ((prev.pos || 0) + (tgt.pos || 0)) / 2 : (tgt.pos || 0) - 1;
      patch('items', it.id, { pos, group: tgt.group, updated: nowISO() });
      return;
    }
    const gh = e.target.closest('[data-drop-group]');
    if (gh) patch('items', it.id, { group: gh.dataset.dropGroup, pos: nextPos(b.id), updated: nowISO() });
  });
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.sel) { if (t.checked) S.ui.selected.add(t.dataset.sel); else S.ui.selected.delete(t.dataset.sel); render(); }
    if (t.dataset.selgroup) { const b = curBoard(); const ids = visibleItems(b).filter((it) => it.group === t.dataset.selgroup).map((it) => it.id); ids.forEach((id) => (t.checked ? S.ui.selected.add(id) : S.ui.selected.delete(id))); render(); }
  });
  body.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key !== 'Enter') return;
    if (t.dataset.addgroup !== undefined || t.dataset.addsub !== undefined) {
      e.preventDefault();
      const v = t.value.trim(); if (!v) return;
      const b = curBoard();
      if (t.dataset.addsub) {
        const parent = getItem(t.dataset.addsub);
        if (!(b.subColumns || []).length) patch('boards', b.id, { subColumns: [{ id: uid('c'), title: 'Responsable', type: 'people' }, { id: uid('c'), title: 'Estado', type: 'status', labels: DEFAULT_STATUS() }, { id: uid('c'), title: 'Fecha', type: 'date' }] });
        createItem(b, parent.group, v, {}, parent.id);
      } else createItem(b, t.dataset.addgroup, v);
      const key = t.dataset.addgroup !== undefined ? '[data-addgroup="' + t.dataset.addgroup + '"]' : '[data-addsub="' + t.dataset.addsub + '"]';
      t.value = ''; t.blur();
      requestAnimationFrame(() => requestAnimationFrame(() => { const n = $(key); if (n) n.focus(); }));
    }
  });
}

/* ---------- barra de selección múltiple */
function renderBulk() {
  const root = $('#bulk-root');
  const n = S.ui.selected.size;
  if (!n || S.route.view !== 'board') { root.innerHTML = ''; return; }
  root.innerHTML = '<div class="bulk" role="toolbar" aria-label="Elementos seleccionados"><span class="n">' + n + '</span><span>' + (n === 1 ? 'seleccionado' : 'seleccionados') + '</span>' +
    '<button class="btn sm ghost" data-a="bulk-move">' + ic('move', 14) + 'Mover a grupo</button><button class="btn sm ghost" data-a="bulk-board">' + ic('board', 14) + 'Mover a tablero</button><button class="btn sm ghost" data-a="bulk-dup">' + ic('copy', 14) + 'Duplicar</button><button class="btn sm ghost danger" data-a="bulk-del">' + ic('trash', 14) + 'Eliminar</button><button class="icon-btn" data-a="bulk-clear" aria-label="Quitar selección">' + ic('x') + '</button></div>';
}
ACT['bulk-clear'] = () => { S.ui.selected.clear(); render(); };
ACT['bulk-del'] = () => { const ids = Array.from(S.ui.selected); confirmBox('Eliminar elementos', 'Se eliminarán ' + ids.length + ' elementos. Puedes deshacerlo justo después.', 'Eliminar', () => deleteItems(ids)); };
ACT['bulk-dup'] = () => { duplicateItems(Array.from(S.ui.selected)); S.ui.selected.clear(); };
ACT['bulk-move'] = (t) => { const b = curBoard(); menu(t, [{ head: 'Mover a grupo' }].concat((b.groups || []).map((g) => ({ label: g.title, icon: 'right', run: () => { batch(Array.from(S.ui.selected).map((id) => ({ op: 'update', c: 'items', id, d: { group: g.id, updated: nowISO() } }))); S.ui.selected.clear(); } })))); };
ACT['bulk-board'] = (t) => { const b = curBoard(); menu(t, [{ head: 'Mover a tablero' }].concat(boardsSorted().filter((x) => x.id !== b.id).map((x) => ({ label: x.name, icon: 'board', run: () => moveToBoard(Array.from(S.ui.selected), x) })))); };

/* SARAHI OS — panel lateral del elemento: actualizaciones, información, notas y transcripciones. */

function openItem(id, tab, focusTitle) { closePop(); S.panel = { id, tab: tab || (isClientRecord(getItem(id)) ? 'week' : 'updates'), focus: !!focusTitle }; render(); }
function clientBoardFor(it) {
  const bs = boardsSorted().filter((b) => !b.isTemplate);
  return bs.find((b) => b.clientItem === it.id) || bs.find((b) => norm(b.name) === norm(it.name)) || null;
}
function renderPanel() {
  const root = $('#panel-root');
  if (!S.panel) { if (root.innerHTML) root.innerHTML = ''; return; }
  const it = getItem(S.panel.id);
  if (!it) { S.panel = null; root.innerHTML = ''; return; }
  if (live(root)) { S.pending = true; return; }
  const b = getBoard(it.board);
  if (!b) { S.panel = null; root.innerHTML = ''; return; }
  const parent = it.parent ? getItem(it.parent) : null;
  const g = (b.groups || []).find((x) => x.id === (parent || it).group) || {};
  const ups = idx().upd.get(it.id) || [];
  const notes = idx().notesBy.get(it.id) || [];
  const txs = idx().txBy.get(it.id) || [];
  const st = settings();
  const tab = S.panel.tab;
  const tabBtn = (k, label, n) => '<button class="tab' + (tab === k ? ' on' : '') + '" data-a="p-tab" data-t="' + k + '">' + label + (n ? ' <span class="pill" style="height:18px;padding:0 6px">' + n + '</span>' : '') + '</button>';
  let actions = '';
  if (!it.parent && b.id === st.crmBoard && st.clientsBoard && S.data.boards[st.clientsBoard]) actions += '<button class="btn sm primary" data-a="convert-client" data-id="' + esc(it.id) + '">' + ic('star', 14) + 'Convertir en cliente</button>';
  if (!it.parent && b.id === st.clientsBoard) {
    const cb = clientBoardFor(it);
    actions += cb ? '<button class="btn sm" data-a="open-board" data-id="' + esc(cb.id) + '">' + ic('board', 14) + 'Tablero de ' + esc(it.name) + '</button>' : (st.templateBoard && S.data.boards[st.templateBoard] ? '<button class="btn sm" data-a="client-board" data-id="' + esc(it.id) + '">' + ic('plus', 14) + 'Crear tablero del cliente</button>' : '');
  }
  if (!it.parent) actions += '<button class="btn sm ghost" data-a="p-note" data-id="' + esc(it.id) + '">' + ic('note', 14) + 'Nota</button><button class="btn sm ghost" data-a="p-tx" data-id="' + esc(it.id) + '">' + ic('mic', 14) + 'Transcripción</button>';
  let body = '';
  const cliRec = isClientRecord(it);
  if (tab === 'week' && cliRec) body = clientWeekPanel(it);
  else if (tab === 'updates') {
    body = '<div class="composer"><label class="sr" for="upd-text">Escribe una actualización</label><textarea id="upd-text" data-live placeholder="Escribe una actualización, un acuerdo o el próximo paso…"></textarea><div class="bar"><span class="muted" style="font-size:12px;margin-right:auto;align-self:center">Ctrl + Enter para publicar</span><button class="btn sm primary" data-a="post-update" data-id="' + esc(it.id) + '">Publicar</button></div></div>' +
      '<div class="feed">' + (ups.length ? ups.map((u) => '<article class="upd"><div class="upd-h"><span class="av" style="--avc:' + hashColor(authorName(u)) + '">' + esc(initials(authorName(u))) + '</span><b>' + esc(authorName(u)) + '</b><span title="' + esc(u.created) + '">' + relTime(u.created) + '</span><button class="icon-btn" data-a="del-update" data-id="' + esc(u.id) + '" aria-label="Eliminar actualización">' + ic('trash', 13) + '</button></div><div class="upd-b">' + linkify(u.body) + '</div></article>').join('') : '<div class="empty-state"><b>Sin actualizaciones todavía</b><span>Registra aquí llamadas, acuerdos y próximos pasos. Quedan con fecha y autor.</span></div>') + '</div>';
  } else if (tab === 'info') {
    const cols = colsFor(b, it);
    body = '<div class="fields">' + cols.map((c) => '<div class="field"><label>' + esc(c.title) + '</label><div class="v' + (c.type === 'status' ? ' st-cell' : '') + '" data-a="pcell" data-id="' + esc(it.id) + '" data-col="' + esc(c.id) + '">' + (c.type === 'long_text' ? '<div class="cell left lt">' + (it.values && it.values[c.id] ? linkify(it.values[c.id]) : '<span class="muted">Agregar texto</span>') + '</div>' : cellInner(b, c, it.values && it.values[c.id], it)) + '</div></div>').join('') + '</div>';
    if (!it.parent) {
      const kids = childrenOf(it.id);
      body += '<div class="sec-h"><h3>Subelementos</h3></div><div class="link-list">' + kids.map((k) => { const sc = (b.subColumns || []).find((c) => c.type === 'status'); const l = sc && labelOf(sc, k.values && k.values[sc.id]); return '<button class="link-row" data-a="open-item" data-id="' + esc(k.id) + '"><span class="t">' + esc(k.name) + '</span>' + (l ? '<span class="chip" style="background:' + esc(l.color) + ';color:' + inkFor(l.color) + '">' + esc(l.label) + '</span>' : '') + '</button>'; }).join('') +
        '<input style="width:100%;border:1px dashed var(--line-strong);border-radius:8px;padding:9px 12px;background:transparent" data-live id="p-addsub" placeholder="+ Agregar subelemento y pulsar Enter" aria-label="Agregar subelemento"></div>';
    }
    body += '<p class="muted" style="font-size:12px;margin-top:18px">Creado ' + esc(fmtDate((it.created || '').slice(0, 10), true)) + ' · Actualizado ' + relTime(it.updated) + ' · ID ' + esc(it.id) + '</p>';
  } else if (tab === 'notes') {
    body = '<div class="sec-h" style="margin-top:0"><h3>Notas de este elemento</h3><button class="btn sm" data-a="p-note" data-id="' + esc(it.id) + '">' + ic('plus', 13) + 'Nueva nota</button></div>' +
      (notes.length ? '<div class="link-list">' + notes.sort((a, c) => String(c.updated).localeCompare(String(a.updated))).map((n) => '<button class="link-row" data-a="open-note" data-id="' + esc(n.id) + '">' + ic(n.pinned ? 'pin' : 'note') + '<span class="t">' + esc(n.title || 'Sin título') + '</span><span class="d">' + relTime(n.updated) + '</span></button>').join('') + '</div>' : '<div class="empty-state"><b>Sin notas</b><span>Las notas que vincules a este elemento aparecen aquí.</span></div>');
  } else if (tab === 'tx') {
    body = '<div class="sec-h" style="margin-top:0"><h3>Transcripciones</h3><button class="btn sm" data-a="p-tx" data-id="' + esc(it.id) + '">' + ic('plus', 13) + 'Agregar</button></div>' +
      (txs.length ? '<div class="link-list">' + txs.sort((a, c) => String(c.date).localeCompare(String(a.date))).map((t) => '<button class="link-row" data-a="open-tx" data-id="' + esc(t.id) + '">' + ic('mic') + '<span class="t">' + esc(t.title || 'Reunión') + '</span>' + (t.summary ? '<span class="pill lime">Resumen</span>' : '') + '<span class="d">' + fmtDate(t.date) + '</span></button>').join('') + '</div>' : '<div class="empty-state"><b>Sin transcripciones</b><span>Sube la transcripción de una reunión (Tactiq, Meet, Zoom) y resúmela con IA.</span></div>');
  }
  root.innerHTML = '<div class="scrim" data-a="close-panel"></div><aside class="panel" role="dialog" aria-label="' + esc(it.name) + '">' +
    '<div class="p-head"><div class="p-top"><textarea id="p-title" data-live rows="1" aria-label="Nombre">' + esc(it.name || '') + '</textarea><button class="icon-btn" data-a="p-menu" data-id="' + esc(it.id) + '" aria-label="Opciones">' + ic('dots', 18) + '</button><button class="icon-btn" data-a="close-panel" aria-label="Cerrar">' + ic('x', 18) + '</button></div>' +
    '<div class="p-crumb" style="--g:' + esc(g.color || '#579bfc') + '"><span class="gdot"></span><button class="btn sm ghost" style="height:22px;padding:0 4px" data-a="open-board" data-id="' + esc(b.id) + '">' + esc(b.name) + '</button><span>›</span><span>' + esc(parent ? parent.name : g.title || '') + '</span></div>' +
    (actions ? '<div class="p-actions">' + actions + '</div>' : '') +
    '<div class="tabs">' + (cliRec ? tabBtn('week', 'La semana') : '') + tabBtn('updates', 'Actualizaciones', ups.length) + tabBtn('info', 'Información') + (!it.parent ? tabBtn('notes', 'Notas', notes.length) + tabBtn('tx', 'Transcripciones', txs.length) : '') + '</div></div>' +
    '<div class="p-body">' + body + '</div></aside>';
  const ta = $('#p-title');
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  fit();
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); } });
  ta.addEventListener('change', () => { const v = ta.value.trim(); if (v && v !== it.name) patch('items', it.id, { name: v, updated: nowISO() }); });
  if (S.panel.focus) { S.panel.focus = false; ta.focus(); ta.select(); }
  const up = $('#upd-text');
  if (up) up.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postUpdate(it.id); } });
  const as = $('#p-addsub');
  if (as) as.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const v = as.value.trim(); if (!v) return;
    if (!(b.subColumns || []).length) patch('boards', b.id, { subColumns: [{ id: uid('c'), title: 'Responsable', type: 'people' }, { id: uid('c'), title: 'Estado', type: 'status', labels: DEFAULT_STATUS() }, { id: uid('c'), title: 'Fecha', type: 'date' }] });
    createItem(b, it.group, v, {}, it.id); as.value = ''; as.blur();
    requestAnimationFrame(() => requestAnimationFrame(() => { const n = $('#p-addsub'); if (n) n.focus(); }));
  });
}
function linkify(s) {
  return esc(s || '').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
ACT['close-panel'] = () => { S.panel = null; render(); };
ACT['p-tab'] = (t) => { S.panel.tab = t.dataset.t; render(); };
ACT.pcell = (el) => {
  const it = getItem(el.dataset.id); if (!it) return;
  const b = getBoard(it.board); const col = colOf(b, it, el.dataset.col); if (!col) return;
  editCell(el, b, it, col);
};
ACT['p-menu'] = (t) => { const it = getItem(t.dataset.id); itemMenu(t, getBoard(it.board), it); };
ACT['post-update'] = (t) => postUpdate(t.dataset.id);
function postUpdate(itemId) {
  const ta = $('#upd-text'); if (!ta) return;
  const body = ta.value.trim(); if (!body) return;
  const it = getItem(itemId);
  ta.value = ''; ta.blur();
  put('updates', uid('u'), { item: itemId, board: it.board, body, author: S.caps.server ? (S.me.name || '') : '', authorId: S.me.id || null, created: nowISO() });
  patch('items', itemId, { updated: nowISO() });
}
ACT['del-update'] = (t) => {
  const u = S.data.updates[t.dataset.id]; if (!u) return;
  const snap = clone(u);
  del('updates', t.dataset.id);
  toast('Actualización eliminada', { label: 'Deshacer', run: () => put('updates', t.dataset.id, snap) });
};
ACT['p-note'] = (t) => { const it = getItem(t.dataset.id); newNote({ link: { board: it.board, item: it.id }, title: 'Nota · ' + it.name }); };
ACT['p-tx'] = (t) => { const it = getItem(t.dataset.id); newTranscriptModal({ board: it.board, item: it.id }); };
ACT['open-note'] = (t) => { S.panel = null; go({ view: 'notes', id: t.dataset.id }); };
ACT['open-tx'] = (t) => { S.panel = null; go({ view: 'transcripts', id: t.dataset.id }); };

/* ---------- convertir lead en cliente */
ACT['convert-client'] = (t) => {
  const lead = getItem(t.dataset.id); const st = settings();
  const cb = getBoard(st.clientsBoard); const tpl = st.templateBoard ? getBoard(st.templateBoard) : null;
  const linked = (idx().notesBy.get(lead.id) || []).length + (idx().txBy.get(lead.id) || []).length;
  openModal({
    title: 'Convertir en cliente',
    body: '<label class="fld"><span>Nombre del cliente</span><input name="n" value="' + esc(lead.name) + '"></label>' +
      '<label class="fld"><span>Grupo en «' + esc(cb.name) + '»</span><select name="g">' + (cb.groups || []).filter((g) => g.id !== cb.pastGroup).map((g) => '<option value="' + esc(g.id) + '">' + esc(g.title) + '</option>').join('') + '</select></label>' +
      (tpl ? '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="tpl" checked> Crear su tablero desde «' + esc(tpl.name) + '»</label>' : '') +
      (linked ? '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="mv" checked> Pasar sus ' + linked + ' notas y transcripciones a la ficha del cliente</label>' : '') +
      '<p class="muted" style="margin:0;font-size:13px">El lead queda marcado como ganado y con una actualización que enlaza al cliente.</p>',
    ok: 'Convertir',
    submit: async (fd) => {
      const name = String(fd.get('n') || lead.name).trim();
      const lb = getBoard(lead.board);
      const cid = uid('i');
      const vals = mapValues(lb.columns || [], cb.columns || [], lead.values || {});
      const contact = (lb.columns || []).find((c) => /contacto/i.test(c.title) && c.type === 'text');
      const cContact = (cb.columns || []).find((c) => /contacto/i.test(c.title) && c.type === 'text');
      if (contact && cContact && lead.values && lead.values[contact.id]) vals[cContact.id] = lead.values[contact.id];
      const ops = [{ op: 'set', c: 'items', id: cid, d: { board: cb.id, group: String(fd.get('g') || (cb.groups[0] || {}).id), parent: null, name, values: vals, pos: nextPos(cb.id, true), created: nowISO(), updated: nowISO(), fromLead: lead.id } }];
      let newBoard = null;
      if (tpl && fd.get('tpl')) { const r = cloneBoardOps(tpl, { name, folder: st.clientsFolder || tpl.folder, withItems: true, isTemplate: false, clientItem: cid, blankValues: true }); newBoard = r.id; ops.push(...r.ops); }
      const ps = primaryStatus(lb); const won = ps && (ps.labels || []).find((l) => l.done);
      const lp = { updated: nowISO(), values: {} }; if (won) lp.values[ps.id] = won.id;
      if (won && lb.stageSync && lb.stageSync.map[won.id]) lp.group = lb.stageSync.map[won.id];
      if (won) stagePatch(lb, lead, ps.id, won.id, lp);
      ops.push({ op: 'update', c: 'items', id: lead.id, d: lp });
      ops.push({ op: 'set', c: 'updates', id: uid('u'), d: { item: lead.id, board: lead.board, body: 'Convertido en cliente: ' + name + (newBoard ? ' (con tablero propio)' : '') + '.', author: S.caps.server ? S.me.name : '', authorId: S.me.id || null, created: nowISO() } });
      if (fd.get('mv')) {
        for (const n of idx().notesBy.get(lead.id) || []) ops.push({ op: 'update', c: 'notes', id: n.id, d: { link: { board: cb.id, item: cid } } });
        for (const x of idx().txBy.get(lead.id) || []) ops.push({ op: 'update', c: 'transcripts', id: x.id, d: { link: { board: cb.id, item: cid } } });
      }
      await batch(ops);
      S.panel = { id: cid, tab: 'info' };
      render();
      toast(name + ' ya es cliente', newBoard ? { label: 'Abrir su tablero', run: () => { S.panel = null; go({ view: 'board', id: newBoard }); } } : null);
    },
  });
};
ACT['client-board'] = async (t) => {
  const it = getItem(t.dataset.id); const st = settings(); const tpl = getBoard(st.templateBoard);
  const r = cloneBoardOps(tpl, { name: it.name, folder: st.clientsFolder || tpl.folder, withItems: true, isTemplate: false, clientItem: it.id, blankValues: true });
  await batch(r.ops);
  S.panel = null;
  go({ view: 'board', id: r.id });
  toast('Tablero de ' + it.name + ' creado desde la plantilla');
};

/* SARAHI OS — páginas: inicio, mi trabajo, notas, transcripciones, búsqueda y ajustes. */

function collectDues(person) {
  const out = [];
  for (const b of boardsSorted()) {
    if (b.isTemplate) continue;
    const dc = dateCols(b);
    const sdc = (b.subColumns || []).filter((c) => c.type === 'date');
    for (const it of boardItems(b.id)) {
      if (!isDone(b, it) && (!person || personMatch(b, it, person))) for (const c of dc) { const v = it.values && it.values[c.id]; if (v) out.push({ it, b, col: c, date: v }); }
      for (const k of sdc.length ? childrenOf(it.id) : []) {
        if (isDone(b, k) || (person && !personMatch(b, k, person))) continue;
        for (const c of sdc) { const v = k.values && k.values[c.id]; if (v) out.push({ it: k, b, col: c, date: v, parent: it }); }
      }
    }
  }
  return out.sort((a, c) => a.date.localeCompare(c.date));
}
function dueRow(d) {
  const t = todayISO();
  const ps = primaryStatus(d.b); const l = ps && !d.parent && labelOf(ps, d.it.values && d.it.values[ps.id]);
  return '<button class="due" data-a="open-item" data-id="' + esc(d.it.id) + '"><span class="dt' + (d.date < t ? ' over' : d.date === t ? ' today' : '') + '">' + fmtDate(d.date) + '</span><span class="t">' + esc(d.it.name) + (d.parent ? ' <span class="muted">· ' + esc(d.parent.name) + '</span>' : '') + '</span><span class="b">' + (l ? '<span class="chip" style="background:' + esc(l.color) + ';color:' + inkFor(l.color) + ';margin-right:6px">' + esc(l.label) + '</span>' : '') + esc(d.b.name) + '</span></button>';
}

/* ---------- Inicio */
function viewHome(body) {
  const st = settings(); const t = todayISO();
  if (!S.data.meta.main && !Object.keys(S.data.boards).length) { setHTML(body, emptyWorkspace()); return; }
  const crm = getBoard(st.crmBoard); const cli = getBoard(st.clientsBoard);
  const sc = salesCfg();
  let open = 0, weighted = 0;
  if (crm) {
    const cps = primaryStatus(crm);
    for (const it of boardItems(crm.id)) { const role = stageRole(cps && labelOf(cps, it.values && it.values[cps.id])); if (role !== 'won' && role !== 'lost') { open++; weighted += dealUF(crm, it) * probOf(role, sc) / 100; } }
  }
  const sy = new Date().getFullYear(); const sd = salesData(sy); const mi = new Date().getMonth();
  const monthSales = sd.rows.reduce((a, r) => a + r.clp[mi], 0);
  const monthRec = Array(12).fill(0); sd.rows.forEach((r) => r.clp.forEach((v, i) => { monthRec[i] += v; }));
  const dues = collectDues();
  const over = dues.filter((d) => d.date < t);
  const week = dues.filter((d) => d.date >= t && d.date <= addDays(t, 7));
  const clients = cli ? boardItems(cli.id).filter((i) => i.group !== cli.pastGroup) : [];
  const clientsHealth = clients.map((c) => Object.assign({ c }, clientHealthOf(c)));
  const h = new Date().getHours();
  const hello = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  const who = (S.me.name || st.ownerName || '').split(' ')[0];
  let dstr = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); dstr = dstr.charAt(0).toUpperCase() + dstr.slice(1);
  let html = '<div class="page"><div class="greet"><div><h1>' + hello + (who ? ', ' + esc(who) : '') + '</h1><p>' + esc(dstr) + '</p></div><div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-a="new-note">' + ic('note', 14) + 'Nota rápida</button>' + (crm ? '<button class="btn primary" data-a="quick-lead">' + ic('plus', 14) + 'Nuevo lead</button>' : '') + '</div></div>';
  html += '<div class="kpis">' +
    (sd.rows.length ? '<button class="kpi" data-a="go" data-v="sales"><span class="k">Ventas de ' + MONTHS_L[mi] + '</span><span class="v">' + compactCLP(monthSales) + '</span><span class="s">' + pct(monthSales, sc.goalMonth) + '% de la meta de ' + compactCLP(sc.goalMonth) + '</span></button>' : '') +
    (crm ? '<button class="kpi" ' + (canSales() ? 'data-a="go" data-v="sales"' : 'data-a="open-board" data-id="' + esc(crm.id) + '"') + '><span class="k">Pipeline ponderado</span><span class="v">' + NF.format(Math.round(weighted * 10) / 10) + ' UF</span><span class="s">' + open + ' leads abiertos · ≈ ' + compactCLP(weighted * (Number(sc.ufCLP) || 0)) + '/mes</span></button>' : '') +
    '<button class="kpi' + (over.length ? ' alert' : '') + '" data-a="go" data-v="mywork"><span class="k">Seguimientos vencidos</span><span class="v">' + over.length + '</span><span class="s">fechas pasadas sin cerrar</span></button>' +
    '<button class="kpi" data-a="go" data-v="mywork"><span class="k">Vencen en 7 días</span><span class="v">' + week.length + '</span><span class="s">hasta el ' + fmtDate(addDays(t, 7)) + '</span></button>' +
    (cli && !(sd.rows.length && crm) ? (() => { const need = clientsHealth.filter((x) => x.k === 'risk' || x.k === 'warn'); return '<button class="kpi' + (need.some((x) => x.k === 'risk') ? ' alert' : '') + '" data-a="open-board" data-id="' + esc(cli.id) + '"><span class="k">Clientes que piden atención</span><span class="v">' + need.length + '</span><span class="s">' + (need.length ? esc(need.slice(0, 3).map((x) => x.c.name).join(', ')) : 'todos al día') + '</span></button>'; })() : '') +
    '</div>';
  html += '<div class="cols2"><div style="display:grid;gap:18px;min-width:0">';
  if (sd.rows.length) html += '<section class="box"><h2>Ventas ' + sy + '<button class="btn sm" data-a="go" data-v="sales">Ver ventas</button></h2><div class="viz-wrap">' + colChart({ W: chartW(0.545), H: 210, labels: MONTHS_C, series: [{ label: 'Ventas', color: 'var(--s1)', values: monthRec }], cur: mi, goal: Number(sc.goalMonth), goalLabel: 'Meta', aria: 'Ventas por mes' }) + '</div></section>';
  if (crm) {
    const ps = primaryStatus(crm);
    const counts = {}; const sums = {};
    for (const it of boardItems(crm.id)) { const v = it.values && it.values[ps.id]; counts[v] = (counts[v] || 0) + 1; sums[v] = (sums[v] || 0) + dealUF(crm, it); }
    const max = Math.max(1, ...Object.values(counts));
    html += '<section class="box"><h2>Pipeline comercial<button class="btn sm" data-a="open-board" data-id="' + esc(crm.id) + '">Abrir</button></h2><div class="funnel">' + (ps.labels || []).map((l) => '<div class="fn-row"><span>' + esc(l.label) + '</span><div class="fn-bar" title="' + (sums[l.id] ? esc(NF.format(sums[l.id]) + ' UF/mes') : '') + '"><i style="--c:' + esc(l.color) + ';width:' + ((counts[l.id] || 0) / max * 100) + '%"></i></div><span class="n">' + (counts[l.id] || 0) + '</span></div>').join('') + '</div></section>';
  }
  const soon = over.concat(dues.filter((d) => d.date >= t && d.date <= addDays(t, 14)));
  html += '<section class="box"><h2>Próximos vencimientos<button class="btn sm" data-a="go" data-v="mywork">Ver todo</button></h2>' + (soon.length ? '<div class="due-list">' + soon.slice(0, 12).map(dueRow).join('') + '</div>' + (soon.length > 12 ? '<p class="muted" style="margin:10px 0 0;font-size:13px">y ' + (soon.length - 12) + ' más en Mi trabajo</p>' : '') : '<div class="empty-state"><b>Nada pendiente con fecha.</b><span>Las columnas de fecha de seguimiento de tus tableros aparecen aquí.</span></div>') + '</section>';
  html += '</div><div style="display:grid;gap:18px;min-width:0">';
  if (cli) {
    html += '<section class="box"><h2>Clientes activos <span class="pill">' + clients.length + '</span><button class="btn sm" data-a="open-board" data-id="' + esc(cli.id) + '">Abrir</button></h2><div class="link-list">' + clients.slice(0, 12).map((c) => {
      const pc = (cli.columns || []).find((x) => x.type === 'status'); const l = pc && labelOf(pc, c.values && c.values[pc.id]);
      const nN = (idx().notesBy.get(c.id) || []).length, nT = (idx().txBy.get(c.id) || []).length;
      const hh = clientsHealth.find((x) => x.c.id === c.id) || {};
      return '<button class="link-row" data-a="open-item" data-id="' + esc(c.id) + '"><span class="t">' + esc(c.name) + '</span>' + (nN ? '<span class="d">' + ic('note', 12) + ' ' + nN + '</span>' : '') + (nT ? '<span class="d">' + ic('mic', 12) + ' ' + nT + '</span>' : '') + healthChip(hh.k || 'ok', (hh.why || []).join(' · ')) + (l ? '<span class="chip" style="background:' + esc(l.color) + ';color:' + inkFor(l.color) + '">' + esc(l.label) + '</span>' : '') + '</button>';
    }).join('') + '</div></section>';
  }
  const act = [];
  for (const [id, u] of Object.entries(S.data.updates)) act.push({ at: u.created, html: '<b>' + esc(authorName(u)) + '</b> en ' + esc((getItem(u.item) || {}).name || 'un elemento'), a: 'open-item', id: u.item, icon: 'chat' });
  for (const [id, n] of Object.entries(S.data.notes)) act.push({ at: n.updated, html: 'Nota: <b>' + esc(n.title || 'Sin título') + '</b>', a: 'open-note', id, icon: 'note' });
  for (const [id, x] of Object.entries(S.data.transcripts)) act.push({ at: x.created, html: 'Transcripción: <b>' + esc(x.title || 'Reunión') + '</b>', a: 'open-tx', id, icon: 'mic' });
  act.sort((a, c) => String(c.at).localeCompare(String(a.at)));
  html += '<section class="box"><h2>Actividad reciente</h2>' + (act.length ? '<div class="link-list">' + act.slice(0, 8).map((x) => '<button class="link-row" data-a="' + x.a + '" data-id="' + esc(x.id) + '">' + ic(x.icon) + '<span class="t" style="font-weight:400">' + x.html + '</span><span class="d">' + relTime(x.at) + '</span></button>').join('') + '</div>' : '<div class="empty-state"><b>Sin actividad todavía.</b><span>Las actualizaciones, notas y transcripciones nuevas aparecen aquí.</span></div>') + '</section>';
  html += '</div></div></div>';
  setHTML(body, html);
}
function emptyWorkspace() {
  return '<div class="page"><div class="box" style="max-width:640px;margin:40px auto;display:grid;gap:12px"><h2 style="font-size:20px">Tu espacio está vacío</h2><p class="muted" style="margin:0">Importa tus tableros desde monday en Ajustes, carga una copia de seguridad o empieza con un tablero en blanco.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-a="go" data-v="settings">' + ic('upload', 14) + 'Importar desde Ajustes</button><button class="btn" data-a="new-board">' + ic('plus', 14) + 'Tablero en blanco</button></div></div></div>';
}
ACT['quick-lead'] = () => { const b = getBoard(settings().crmBoard); if (!b) return; const ps = primaryStatus(b); const vals = {}; if (ps && ps.labels && ps.labels[0]) vals[ps.id] = ps.labels[0].id; const dc = (b.columns || []).find((c) => c.type === 'date' && !c.followup); if (dc) vals[dc.id] = todayISO(); const id = createItem(b, null, newLabel(b), vals); openItem(id, 'info', true); };

/* ---------- Mi trabajo */
function viewMyWork(body) {
  if (S.ui.myPerson === null) S.ui.myPerson = team().includes(settings().ownerName) ? settings().ownerName : '';
  const person = S.ui.myPerson;
  const dues = collectDues(person || null);
  const t = todayISO();
  const secs = [
    ['Vencidas', dues.filter((d) => d.date < t)],
    ['Hoy', dues.filter((d) => d.date === t)],
    ['Próximos 7 días', dues.filter((d) => d.date > t && d.date <= addDays(t, 7))],
    ['Más adelante', dues.filter((d) => d.date > addDays(t, 7))],
  ];
  let html = '<div class="page"><div class="greet"><div><h1>Mi trabajo</h1><p>Todo lo que tiene fecha y no está terminado, de todos los tableros.</p></div></div>';
  html += '<div class="chips"><button class="chip-btn' + (!person ? ' on' : '') + '" data-a="my-person" data-p="">Todos</button>' + team().map((p) => '<button class="chip-btn' + (person === p ? ' on' : '') + '" data-a="my-person" data-p="' + esc(p) + '">' + esc(p) + '</button>').join('') + '</div>';
  for (const [title, list] of secs) {
    html += '<section class="box"><h2>' + esc(title) + ' <span class="pill' + (title === 'Vencidas' && list.length ? ' danger' : '') + '">' + list.length + '</span></h2>' + (list.length ? '<div class="due-list">' + list.slice(0, 200).map(dueRow).join('') + '</div>' : '<p class="muted" style="margin:0">Nada aquí.</p>') + '</section>';
  }
  html += '</div>';
  setHTML(body, html);
}
ACT['my-person'] = (t) => { S.ui.myPerson = t.dataset.p; render(); };

/* ---------- Notas */
function linkOptions(cur) {
  const st = settings();
  const groups = [];
  for (const bid of [st.clientsBoard, st.crmBoard]) { const b = getBoard(bid); if (b) groups.push(b); }
  let h = '<option value="">Sin vincular</option>';
  for (const b of groups) h += '<optgroup label="' + esc(b.name) + '">' + boardItems(b.id).map((it) => '<option value="' + esc(b.id + '|' + it.id) + '"' + (cur && cur.item === it.id ? ' selected' : '') + '>' + esc(it.name) + '</option>').join('') + '</optgroup>';
  if (cur && cur.item && !groups.some((b) => b.id === cur.board)) { const it = getItem(cur.item); if (it) h += '<option value="' + esc(cur.board + '|' + cur.item) + '" selected>' + esc(it.name) + '</option>'; }
  return h;
}
function parseLink(v) { if (!v) return null; const [board, item] = String(v).split('|'); return item ? { board, item } : null; }
function linkName(l) { const it = l && getItem(l.item); return it ? it.name : ''; }
function newNote(o) {
  const id = uid('n');
  put('notes', id, { title: (o && o.title) || '', body: '', link: (o && o.link) || null, pinned: false, created: nowISO(), updated: nowISO(), author: S.caps.server ? S.me.name : '', authorId: S.me.id || null });
  S.panel = null;
  go({ view: 'notes', id, focus: true });
}
ACT['new-note'] = () => newNote();
function noteList() {
  const q = norm(S.ui.noteQ); const cf = S.ui.noteClient;
  let list = Object.entries(S.data.notes).map(([id, n]) => Object.assign({ id }, n));
  if (q) list = list.filter((n) => norm(n.title).includes(q) || norm(n.body).includes(q) || norm(linkName(n.link)).includes(q));
  if (cf === '__none') list = list.filter((n) => !n.link); else if (cf) list = list.filter((n) => n.link && n.link.item === cf);
  list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.updated).localeCompare(String(a.updated)));
  return list;
}
function noteListHTML() {
  const list = noteList(); const cur = S.route.id;
  return list.length ? list.map((n) => '<button class="lp-item' + (n.id === cur ? ' on' : '') + '" data-a="note-sel" data-id="' + esc(n.id) + '"><b>' + (n.pinned ? ic('pin', 12) + ' ' : '') + esc(n.title || 'Sin título') + '</b><small>' + esc(linkName(n.link) ? linkName(n.link) + ' · ' : '') + relTime(n.updated) + ' · ' + esc(String(n.body || '').slice(0, 60)) + '</small></button>').join('') : '<div style="padding:16px" class="muted">' + (S.ui.noteQ || S.ui.noteClient ? 'Ninguna nota coincide.' : 'Aún no hay notas.') + '</div>';
}
function viewNotes(body) {
  const id = S.route.id && S.data.notes[S.route.id] ? S.route.id : null;
  const n = id ? S.data.notes[id] : null;
  const clientOpts = (() => { const ids = new Set(); for (const x of Object.values(S.data.notes)) if (x.link && x.link.item) ids.add(x.link.item); return Array.from(ids).map((i) => getItem(i)).filter(Boolean); })();
  let html = '<div class="split' + (n ? ' has-sel' : '') + '"><div class="list-pane"><div class="lp-h"><button class="btn primary" data-a="new-note">' + ic('plus', 14) + 'Nueva nota</button><input id="note-q" type="search" data-live placeholder="Buscar en notas" value="' + esc(S.ui.noteQ) + '" aria-label="Buscar en notas"><select id="note-client" aria-label="Filtrar por cliente"><option value="">Todas las notas</option><option value="__none"' + (S.ui.noteClient === '__none' ? ' selected' : '') + '>Sin vincular</option>' + clientOpts.map((c) => '<option value="' + esc(c.id) + '"' + (S.ui.noteClient === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></div><div class="lp-items" id="note-items">' + noteListHTML() + '</div></div>';
  if (n) {
    html += '<div class="editor"><div class="meta-row"><button class="btn sm ghost" data-a="go" data-v="notes" style="padding:0 6px">' + ic('right', 14, ' style="transform:rotate(180deg)"') + 'Notas</button><select id="note-link" aria-label="Vincular a">' + linkOptions(n.link) + '</select>' + (n.link && getItem(n.link.item) ? '<button class="btn sm ghost" data-a="open-item" data-id="' + esc(n.link.item) + '">' + ic('open', 13) + 'Abrir ficha</button>' : '') + '<button class="btn sm ghost' + (n.pinned ? ' on' : '') + '" data-a="note-pin" data-id="' + esc(id) + '">' + ic('pin', 14) + (n.pinned ? 'Fijada' : 'Fijar') + '</button>' + (S.caps.server && isAdmin() ? '<button class="btn sm ghost' + (n.shared ? ' on' : '') + '" data-a="note-share" data-id="' + esc(id) + '" title="Visible para todos los usuarios, aunque no esté vinculada a un cliente">' + ic('user', 14) + (n.shared ? 'Para todo el equipo' : 'Compartir con el equipo') + '</button>' : '') + '<button class="btn sm ghost danger" data-a="note-del" data-id="' + esc(id) + '">' + ic('trash', 14) + 'Eliminar</button><span class="saved" id="note-saved">Guardado ' + relTime(n.updated) + '</span></div>' +
      '<input class="ttl" id="note-title" data-live placeholder="Título" value="' + esc(n.title || '') + '" aria-label="Título de la nota"><textarea class="body" id="note-body" data-live placeholder="Escribe aquí. Se guarda solo." aria-label="Contenido de la nota">' + esc(n.body || '') + '</textarea></div>';
  } else {
    html += '<div class="editor"><div class="empty-state"><b>Elige una nota o crea una nueva.</b><span>Las notas se pueden vincular a un cliente o a un lead para verlas desde su ficha.</span><button class="btn primary" data-a="new-note">' + ic('plus', 14) + 'Nueva nota</button></div></div>';
  }
  html += '</div>';
  if (!setHTML(body, html)) return;
  const qi = $('#note-q');
  qi.addEventListener('input', () => { S.ui.noteQ = qi.value; $('#note-items').innerHTML = noteListHTML(); });
  $('#note-client').addEventListener('change', (e) => { S.ui.noteClient = e.target.value; $('#note-items').innerHTML = noteListHTML(); });
  if (!n) return;
  const ti = $('#note-title'), bo = $('#note-body'), sv = $('#note-saved');
  const save = debounce(() => { const p = { title: ti.value, body: bo.value, updated: nowISO() }; const cur = S.data.notes[id]; if (!cur || (cur.title === p.title && cur.body === p.body)) return; S.data.notes[id] = merge(clone(cur), p); S.idx = null; Promise.resolve(A.update('notes', id, p)).then(() => { sv.textContent = 'Guardado'; }).catch(fail); }, 700);
  const typing = () => { sv.textContent = 'Guardando…'; save(); };
  ti.addEventListener('input', typing); bo.addEventListener('input', typing);
  ti.addEventListener('blur', () => save.flush()); bo.addEventListener('blur', () => save.flush());
  ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bo.focus(); } });
  $('#note-link').addEventListener('change', (e) => patch('notes', id, { link: parseLink(e.target.value), updated: nowISO() }));
  if (S.route.focus) { S.route.focus = false; ti.focus(); }
}
ACT['note-sel'] = (t) => go({ view: 'notes', id: t.dataset.id });
ACT['note-pin'] = (t) => { const n = S.data.notes[t.dataset.id]; patch('notes', t.dataset.id, { pinned: !n.pinned }); };
ACT['note-share'] = (t) => { const n = S.data.notes[t.dataset.id]; patch('notes', t.dataset.id, { shared: !n.shared }); toast(n.shared ? 'La nota vuelve a ser visible solo según su vínculo' : 'Todo el equipo puede ver esta nota'); };
ACT['note-del'] = (t) => { const id = t.dataset.id; const snap = clone(S.data.notes[id]); go({ view: 'notes' }); del('notes', id); toast('Nota eliminada', { label: 'Deshacer', run: () => put('notes', id, snap) }); };

/* ---------- Transcripciones */
function cleanTranscript(text, name) {
  let s = String(text || '').replace(/\r/g, '');
  if (/\.(vtt|srt)$/i.test(name || '') || /^WEBVTT/.test(s)) {
    s = s.replace(/^WEBVTT.*\n/, '').split('\n').filter((l) => !/^\d+$/.test(l.trim()) && !/-->/.test(l) && !/^(NOTE|STYLE)\b/.test(l)).join('\n');
    s = s.replace(/<v ([^>]+)>/g, '$1: ').replace(/<[^>]+>/g, '');
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
let mammothP = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (!mammothP) mammothP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'; s.onload = () => res(window.mammoth); s.onerror = () => { mammothP = null; rej(new Error('No se pudo cargar el lector de Word')); }; document.head.appendChild(s); });
  return mammothP;
}
async function readTranscriptFile(f) {
  if (/\.docx$/i.test(f.name)) { const m = await loadMammoth(); const r = await m.extractRawText({ arrayBuffer: await f.arrayBuffer() }); return cleanTranscript(r.value, f.name); }
  if (/\.(pdf|doc)$/i.test(f.name)) throw new Error('Ese formato no se puede leer aquí. Exporta la transcripción como .txt, .docx, .vtt o .srt.');
  return cleanTranscript(await f.text(), f.name);
}
function newTranscriptModal(link) {
  openModal({
    title: 'Nueva transcripción', wide: true,
    body: '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px"><label class="fld"><span>Título</span><input name="title" placeholder="Reunión semanal con el cliente" required></label><label class="fld"><span>Fecha</span><input type="date" name="date" value="' + todayISO() + '"></label></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px"><label class="fld"><span>Participantes</span><input name="who" placeholder="Jorge, Matías"></label><label class="fld"><span>Cliente o lead</span><select name="link">' + linkOptions(link) + '</select></label></div>' +
      '<div class="dropzone" id="tx-dz"><b style="color:var(--fg)">Sube el archivo de la reunión</b><div style="font-size:12.5px;margin:4px 0 8px">.txt, .docx, .vtt, .srt o .md (exportado desde Tactiq, Meet, Zoom o Teams)</div><input type="file" id="tx-file" accept=".txt,.md,.vtt,.srt,.docx,text/plain"></div>' +
      '<label class="fld"><span>O pega el texto</span><textarea name="body" id="tx-paste" rows="8" placeholder="Pega aquí la transcripción"></textarea></label>',
    ok: 'Guardar transcripción',
    mount: (w) => {
      const fi = w.querySelector('#tx-file'), ta = w.querySelector('#tx-paste'), dz = w.querySelector('#tx-dz');
      const load = async (f) => { try { ta.value = await readTranscriptFile(f); const ti = w.querySelector('[name=title]'); if (!ti.value) ti.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '); toast('Archivo leído: ' + ta.value.length.toLocaleString('es-CL') + ' caracteres'); } catch (e) { toast(e.message || 'No se pudo leer el archivo'); } };
      fi.addEventListener('change', () => fi.files[0] && load(fi.files[0]));
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
    },
    submit: (fd) => {
      let body = String(fd.get('body') || '').trim();
      if (!body) { toast('Sube un archivo o pega el texto de la transcripción'); return true; }
      let cut = false;
      if (body.length > 200000) { body = body.slice(0, 200000); cut = true; }
      const id = uid('t');
      put('transcripts', id, { title: String(fd.get('title') || '').trim() || 'Reunión ' + fmtDate(String(fd.get('date') || todayISO()), true), date: String(fd.get('date') || todayISO()), participants: String(fd.get('who') || '').trim(), link: parseLink(fd.get('link')), body, created: nowISO(), updated: nowISO(), authorId: S.me.id || null, author: S.caps.server ? S.me.name : '' });
      S.panel = null;
      go({ view: 'transcripts', id });
      if (cut) toast('La transcripción era muy larga: se guardaron los primeros 200.000 caracteres.');
    },
  });
}
ACT['new-tx'] = () => newTranscriptModal(null);
function txList() {
  const q = norm(S.ui.txQ);
  let list = Object.entries(S.data.transcripts).map(([id, x]) => Object.assign({ id }, x));
  if (q) list = list.filter((x) => norm(x.title).includes(q) || norm(x.participants).includes(q) || norm(linkName(x.link)).includes(q) || norm(x.summary).includes(q) || norm(x.body).includes(q));
  return list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created).localeCompare(String(a.created)));
}
function txListHTML() {
  const list = txList(); const cur = S.route.id;
  return list.length ? list.map((x) => '<button class="lp-item' + (x.id === cur ? ' on' : '') + '" data-a="tx-sel" data-id="' + esc(x.id) + '"><b>' + esc(x.title || 'Reunión') + '</b><small>' + fmtDate(x.date, true) + (linkName(x.link) ? ' · ' + esc(linkName(x.link)) : '') + (x.summary ? ' · con resumen' : '') + '</small></button>').join('') : '<div style="padding:16px" class="muted">' + (S.ui.txQ ? 'Nada coincide.' : 'Aún no hay transcripciones.') + '</div>';
}
function viewTranscripts(body) {
  const id = S.route.id && S.data.transcripts[S.route.id] ? S.route.id : null;
  const x = id ? S.data.transcripts[id] : null;
  let html = '<div class="split' + (x ? ' has-sel' : '') + '"><div class="list-pane"><div class="lp-h"><button class="btn primary" data-a="new-tx">' + ic('plus', 14) + 'Nueva transcripción</button><input id="tx-q" type="search" data-live placeholder="Buscar en transcripciones" value="' + esc(S.ui.txQ) + '" aria-label="Buscar en transcripciones"></div>' + meetBarHTML() + '<div class="lp-items" id="tx-items">' + txListHTML() + '</div></div>';
  if (x) {
    const tab = S.route.tab || (x.summary ? 'sum' : 'text');
    const words = String(x.body || '').split(/\s+/).filter(Boolean).length;
    html += '<div class="editor"><div class="meta-row"><button class="btn sm ghost" data-a="go" data-v="transcripts" style="padding:0 6px">' + ic('right', 14, ' style="transform:rotate(180deg)"') + 'Transcripciones</button><input type="date" id="tx-date" value="' + esc(x.date || '') + '" aria-label="Fecha">' + (x.sourceUrl ? '<a class="btn sm ghost" href="' + esc(x.sourceUrl) + '" target="_blank" rel="noopener">' + ic('open', 13) + 'Notas de Gemini</a>' : '') + '<select id="tx-link" aria-label="Cliente o lead">' + linkOptions(x.link) + '</select>' + (x.link && getItem(x.link.item) ? '<button class="btn sm ghost" data-a="open-item" data-id="' + esc(x.link.item) + '">' + ic('open', 13) + 'Ficha</button>' : '') + '<button class="btn sm ghost danger" data-a="tx-del" data-id="' + esc(id) + '">' + ic('trash', 14) + 'Eliminar</button><span class="saved" id="tx-saved">' + words.toLocaleString('es-CL') + ' palabras</span></div>' +
      '<input class="ttl" id="tx-title" data-live value="' + esc(x.title || '') + '" aria-label="Título"><input id="tx-who" data-live value="' + esc(x.participants || '') + '" placeholder="Participantes" style="border:0;outline:none;background:transparent;color:var(--muted);padding:0" aria-label="Participantes">' +
      '<div class="tabs" style="margin-top:0"><button class="tab' + (tab === 'sum' ? ' on' : '') + '" data-a="tx-tab" data-t="sum">' + ic('spark', 14) + 'Resumen y acciones</button><button class="tab' + (tab === 'text' ? ' on' : '') + '" data-a="tx-tab" data-t="text">' + ic('mic', 14) + 'Transcripción</button></div>';
    if (tab === 'sum') {
      if (x.summary) {
        const acts = x.actions || [];
        html += '<div class="summary">' + esc(x.summary) + '</div>' +
          (x.points && x.points.length ? '<div><div class="sec-h" style="margin-top:4px"><h3>Puntos clave</h3></div><ul style="margin:0;padding-left:18px;display:grid;gap:4px">' + x.points.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></div>' : '') +
          (x.agreements && x.agreements.length ? '<div><div class="sec-h" style="margin-top:4px"><h3>Acuerdos</h3></div><ul style="margin:0;padding-left:18px;display:grid;gap:4px">' + x.agreements.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul></div>' : '') +
          '<div><div class="sec-h" style="margin-top:4px"><h3>Acciones</h3>' + (acts.some((a) => !a.taskId) ? '<button class="btn sm" data-a="tx-all-tasks" data-id="' + esc(id) + '">' + ic('plus', 13) + 'Crear todas como tareas</button>' : '') + '</div><div class="actions-list">' +
          (acts.length ? acts.map((a, i) => '<div class="act' + (a.taskId ? ' done' : '') + '"><div>' + esc(a.text) + '<small>' + esc([a.owner, a.due ? fmtDate(a.due, true) : ''].filter(Boolean).join(' · ') || 'Sin responsable ni fecha') + '</small></div>' + (a.taskId && S.data.items[a.taskId] ? '<button class="btn sm ghost" data-a="open-item" data-id="' + esc(a.taskId) + '">' + ic('check', 13) + 'Ver tarea</button>' : '<button class="btn sm" data-a="tx-task" data-id="' + esc(id) + '" data-i="' + i + '">Crear tarea</button>') + '</div>').join('') : '<p class="muted" style="margin:0">La reunión no dejó acciones concretas.</p>') + '</div></div>' +
          (x.next ? '<div><div class="sec-h" style="margin-top:4px"><h3>Próximos pasos</h3></div><p style="margin:0">' + esc(x.next) + '</p></div>' : '') +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' + (S.caps.ai ? '<button class="btn sm" data-a="tx-ai" data-id="' + esc(id) + '">' + ic('refresh', 13) + 'Volver a resumir</button>' : '') + '<span class="muted" style="font-size:12px">Resumido ' + relTime(x.summarizedAt) + '</span></div>';
      } else {
        html += '<div class="empty-state"><b>Todavía no hay resumen.</b>' + (S.caps.ai ? '<span>Claude lee la transcripción y devuelve resumen, puntos clave, acuerdos y acciones que puedes convertir en tareas.</span><button class="btn primary" data-a="tx-ai" data-id="' + esc(id) + '">' + ic('spark', 14) + 'Resumir con IA</button>' : '<span>' + (S.caps.server ? 'Para resumir con IA, agrega tu clave de la API de Anthropic en config.php del servidor.' : 'El resumen con IA no está disponible en esta vista.') + '</span>') + '<div id="tx-ai-out" class="muted" style="font-size:13px"></div></div>';
      }
    } else {
      html += '<textarea class="tx-body" id="tx-body" data-live aria-label="Texto de la transcripción">' + esc(x.body || '') + '</textarea>';
    }
    html += '</div>';
  } else {
    html += '<div class="editor"><div class="empty-state"><b>Guarda aquí las transcripciones de tus reuniones.</b><span>Sube el archivo de Tactiq, Meet o Zoom, vincúlalo al cliente y conviértelo en resumen y tareas.</span><button class="btn primary" data-a="new-tx">' + ic('plus', 14) + 'Nueva transcripción</button></div></div>';
  }
  html += '</div>';
  if (!setHTML(body, html)) return;
  const qi = $('#tx-q');
  qi.addEventListener('input', () => { S.ui.txQ = qi.value; $('#tx-items').innerHTML = txListHTML(); });
  if (!x) return;
  const field = (sel, key) => { const el = $(sel); if (!el) return; const sv = debounce(() => { const p = {}; p[key] = el.value; p.updated = nowISO(); const cur = S.data.transcripts[id]; if (!cur || cur[key] === el.value) return; S.data.transcripts[id] = merge(clone(cur), p); S.idx = null; Promise.resolve(A.update('transcripts', id, p)).catch(fail); }, 800); el.addEventListener('input', sv); el.addEventListener('blur', () => sv.flush()); };
  field('#tx-title', 'title'); field('#tx-who', 'participants'); field('#tx-body', 'body');
  const tt = $('#tx-title'); if (tt && x.source) tt.addEventListener('change', () => { if (!S.data.transcripts[id].titleManual) patch('transcripts', id, { titleManual: true }); });
  $('#tx-date').addEventListener('change', (e) => patch('transcripts', id, { date: e.target.value }));
  $('#tx-link').addEventListener('change', (e) => patch('transcripts', id, { link: parseLink(e.target.value), linkManual: true }));
}
ACT['tx-sel'] = (t) => go({ view: 'transcripts', id: t.dataset.id });
ACT['tx-tab'] = (t) => { S.route = Object.assign({}, S.route, { tab: t.dataset.t }); render(); };
ACT['tx-del'] = (t) => { const id = t.dataset.id; const snap = clone(S.data.transcripts[id]); go({ view: 'transcripts' }); del('transcripts', id); toast('Transcripción eliminada', { label: 'Deshacer', run: () => put('transcripts', id, snap) }); };
ACT['tx-ai'] = async (t) => {
  const id = t.dataset.id; const x = S.data.transcripts[id]; if (!x || !A.ai) return;
  t.disabled = true; const label = t.innerHTML; t.innerHTML = '<span class="spin" style="width:14px;height:14px;border-width:2px"></span> Resumiendo… puede tardar un minuto';
  const prompt = 'Eres el asistente interno de SARAHI, una agencia de estrategia y crecimiento especializada en Meta Ads y Google Ads, con clientes en Chile y España.\n' +
    'Analiza la transcripción de esta reunión y responde SOLO con un objeto JSON, sin texto antes ni después, con esta forma exacta:\n' +
    '{"resumen":"4 a 6 frases en español con lo que se habló y se decidió","puntos_clave":["..."],"acuerdos":["..."],"acciones":[{"tarea":"verbo en infinitivo + qué hacer","responsable":"nombre de la persona o vacío","fecha":"AAAA-MM-DD o vacío"}],"proximos_pasos":"1 o 2 frases"}\n' +
    'Reglas: usa solo información de la transcripción; si una fecha es relativa ("el viernes"), conviértela tomando como referencia la fecha de la reunión; no inventes responsables.\n' +
    'Reunión: «' + (x.title || '') + '», fecha ' + (x.date || '') + ', participantes: ' + (x.participants || 'sin indicar') + ', cliente o lead: ' + (linkName(x.link) || 'sin vincular') + '.\n\nTRANSCRIPCIÓN:\n' + String(x.body || '').slice(0, 140000);
  try {
    const r = await A.ai(prompt, { json: true });
    if (!r || typeof r !== 'object' || !r.resumen) throw new Error('La respuesta de la IA no trajo un resumen. Vuelve a intentarlo.');
    await patch('transcripts', id, { summary: String(r.resumen), points: (r.puntos_clave || []).map(String), agreements: (r.acuerdos || []).map(String), actions: (r.acciones || []).filter((a) => a && a.tarea).map((a) => ({ id: uid('a'), text: String(a.tarea), owner: String(a.responsable || ''), due: parseDateLoose(a.fecha) || '' })), next: String(r.proximos_pasos || ''), summarizedAt: nowISO() });
    S.route = Object.assign({}, S.route, { tab: 'sum' }); render();
  } catch (e) {
    t.disabled = false; t.innerHTML = label;
    toast(aiError(e));
  }
};
function aiError(e) {
  const c = e && e.code;
  if (c === 'not_granted' || c === 'sampling_disabled') return 'No se permitió usar Claude desde esta página.';
  if (c === 'rate_limited') return 'Demasiadas solicitudes a la IA. Espera un momento y vuelve a intentarlo.';
  if (c === 'prompt_too_large') return 'La transcripción es demasiado larga para resumirla de una vez.';
  return 'No se pudo resumir: ' + ((e && e.message) || 'error desconocido');
}
function taskTargetBoard(x) {
  const st = settings();
  const li = x.link && getItem(x.link.item);
  if (li) { if (li.board === st.clientsBoard) { const cb = clientBoardFor(li); if (cb) return cb; } }
  return getBoard(st.inboxBoard) || boardsSorted().find((b) => !b.isTemplate);
}
function makeTask(x, a, b) {
  const vals = {};
  const pc = (b.columns || []).find((c) => c.type === 'people');
  if (pc && a.owner) vals[pc.id] = [a.owner];
  const dc = dateCols(b)[0] || (b.columns || []).find((c) => c.type === 'date');
  if (dc && a.due) vals[dc.id] = a.due;
  const id = createItem(b, null, a.text, vals);
  put('updates', uid('u'), { item: id, board: b.id, body: 'Creada desde la transcripción «' + (x.title || 'Reunión') + '» del ' + fmtDate(x.date, true) + '.', author: S.caps.server ? S.me.name : '', authorId: S.me.id || null, created: nowISO() });
  return id;
}
ACT['tx-task'] = (t) => {
  const id = t.dataset.id; const x = S.data.transcripts[id]; const i = Number(t.dataset.i); const a = (x.actions || [])[i]; if (!a) return;
  const def = taskTargetBoard(x);
  menu(t, [{ head: 'Crear tarea en' }].concat(boardsSorted().filter((b) => !b.isTemplate).sort((p, q) => (p.id === (def || {}).id ? -1 : q.id === (def || {}).id ? 1 : 0)).slice(0, 14).map((b) => ({ label: b.name, icon: 'board', run: () => {
    const tid = makeTask(x, a, b);
    const acts = clone(x.actions); acts[i].taskId = tid; acts[i].taskBoard = b.id;
    patch('transcripts', id, { actions: acts });
    toast('Tarea creada en ' + b.name, { label: 'Ver', run: () => openItem(tid) });
  } }))));
};
ACT['tx-all-tasks'] = (t) => {
  const id = t.dataset.id; const x = S.data.transcripts[id]; const b = taskTargetBoard(x); if (!b) return;
  const acts = clone(x.actions || []); let n = 0;
  acts.forEach((a) => { if (!a.taskId) { a.taskId = makeTask(x, a, b); a.taskBoard = b.id; n++; } });
  patch('transcripts', id, { actions: acts });
  toast(n + ' tareas creadas en ' + b.name, { label: 'Abrir tablero', run: () => go({ view: 'board', id: b.id }) });
};

/* ---------- Búsqueda */
function viewSearch(body) {
  const q = norm(S.ui.globalQ);
  let html = '<div class="page"><div class="greet"><div><h1>Búsqueda</h1><p>' + (q ? 'Resultados para «' + esc(S.ui.globalQ) + '»' : 'Escribe en el buscador de la barra lateral.') + '</p></div></div>';
  if (q) {
    const items = [];
    for (const b of boardsSorted()) for (const it of boardItems(b.id)) if (matchItem(b, it, q)) items.push({ b, it });
    const notes = Object.entries(S.data.notes).filter(([, n]) => norm(n.title).includes(q) || norm(n.body).includes(q));
    const txs = Object.entries(S.data.transcripts).filter(([, x]) => norm(x.title).includes(q) || norm(x.body).includes(q) || norm(x.summary).includes(q));
    html += '<section class="box"><h2>Elementos <span class="pill">' + items.length + '</span></h2>' + (items.length ? '<div class="link-list">' + items.slice(0, 60).map(({ b, it }) => '<button class="link-row" data-a="open-item" data-id="' + esc(it.id) + '"><span class="t">' + esc(it.name) + '</span><span class="d" style="font-family:var(--font)">' + esc(b.name) + '</span></button>').join('') + '</div>' : '<p class="muted" style="margin:0">Sin coincidencias.</p>') + '</section>';
    html += '<section class="box"><h2>Notas <span class="pill">' + notes.length + '</span></h2>' + (notes.length ? '<div class="link-list">' + notes.slice(0, 30).map(([id, n]) => '<button class="link-row" data-a="open-note" data-id="' + esc(id) + '">' + ic('note') + '<span class="t">' + esc(n.title || 'Sin título') + '</span><span class="d">' + relTime(n.updated) + '</span></button>').join('') + '</div>' : '<p class="muted" style="margin:0">Sin coincidencias.</p>') + '</section>';
    html += '<section class="box"><h2>Transcripciones <span class="pill">' + txs.length + '</span></h2>' + (txs.length ? '<div class="link-list">' + txs.slice(0, 30).map(([id, x]) => '<button class="link-row" data-a="open-tx" data-id="' + esc(id) + '">' + ic('mic') + '<span class="t">' + esc(x.title || 'Reunión') + '</span><span class="d">' + fmtDate(x.date) + '</span></button>').join('') + '</div>' : '<p class="muted" style="margin:0">Sin coincidencias.</p>') + '</section>';
  }
  setHTML(body, html + '</div>');
}

/* ---------- Ajustes */
function viewSettings(body) {
  const st = settings(); const m = meta();
  const bOpts = (sel, filt) => '<option value="">Ninguno</option>' + boardsSorted().filter(filt || (() => true)).map((b) => '<option value="' + esc(b.id) + '"' + (b.id === sel ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('');
  let html = '<div class="set-grid"><div class="greet"><div><h1>Ajustes</h1><p>Equipo, tableros clave, importación y copias de seguridad.</p></div></div>';
  html += '<section class="box"><h2>Equipo</h2><p>Las personas que puedes asignar en las columnas de Personas.</p><div class="chips" style="margin-bottom:10px">' + team().map((p) => '<span class="pill" style="height:30px;font-size:13px;color:var(--fg)"><span class="av" style="--avc:' + hashColor(p) + ';width:22px;height:22px;font-size:10px;border:0">' + esc(initials(p)) + '</span>' + esc(p) + '<button class="icon-btn" style="width:20px;height:20px" data-a="team-rm" data-p="' + esc(p) + '" aria-label="Quitar ' + esc(p) + '">' + ic('x', 11) + '</button></span>').join('') + '</div><div style="display:flex;gap:8px;max-width:420px"><input id="team-new" class="btn" style="flex:1;font-weight:400" placeholder="Nombre de la persona" aria-label="Nueva persona"><button class="btn" data-a="team-add">' + ic('plus', 14) + 'Agregar</button></div></section>';
  html += '<section class="box"><h2>Tableros clave</h2><p>Definen el pipeline del inicio, la conversión de lead a cliente y dónde caen las tareas que salen de una reunión.</p><form id="keys-form" class="kv">' +
    '<label for="k-crm">Pipeline comercial (CRM)</label><select id="k-crm" name="crmBoard" class="btn">' + bOpts(st.crmBoard) + '</select>' +
    '<label for="k-cli">Clientes</label><select id="k-cli" name="clientsBoard" class="btn">' + bOpts(st.clientsBoard) + '</select>' +
    '<label for="k-tpl">Plantilla de cliente nuevo</label><select id="k-tpl" name="templateBoard" class="btn">' + bOpts(st.templateBoard) + '</select>' +
    '<label for="k-fold">Carpeta de tableros de clientes</label><select id="k-fold" name="clientsFolder" class="btn">' + folderOptions(st.clientsFolder) + '</select>' +
    '<label for="k-inbox">Bandeja para tareas sueltas</label><select id="k-inbox" name="inboxBoard" class="btn">' + bOpts(st.inboxBoard) + '</select>' +
    '<label for="k-owner">Tu nombre</label><input id="k-owner" name="ownerName" class="btn" style="font-weight:400" value="' + esc(st.ownerName || '') + '">' +
    '<span></span><div><button class="btn primary" type="submit">Guardar</button></div></form></section>';
  html += '<section class="box"><h2>Espacios y carpetas</h2><div class="link-list">' + (m.workspaces || []).map((w) => '<div class="link-row">' + ic('board') + '<span class="t">' + esc(w.name) + '</span><span class="d">' + boardsSorted().filter((b) => b.ws === w.id).length + ' tableros</span><button class="btn sm ghost" data-a="ws-rename" data-id="' + esc(w.id) + '">Renombrar</button></div>' + (m.folders || []).filter((f) => f.ws === w.id).map((f) => '<div class="link-row" style="margin-left:24px;width:calc(100% - 24px)">' + ic('folder') + '<span class="t" style="font-weight:500">' + esc(f.name) + '</span><span class="d">' + boardsSorted().filter((b) => b.folder === f.id).length + '</span><button class="btn sm ghost" data-a="folder-rename" data-id="' + esc(f.id) + '">Renombrar</button><button class="btn sm ghost danger" data-a="folder-del" data-id="' + esc(f.id) + '">Quitar</button></div>').join('')).join('') + '</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn sm" data-a="ws-add">' + ic('plus', 13) + 'Nuevo espacio</button><button class="btn sm" data-a="folder-add">' + ic('plus', 13) + 'Nueva carpeta</button></div></section>';
  if (S.caps.server) html += serverSettingsHTML();
  else html += '<section class="box"><h2>Instalar en tu subdominio</h2><p>Esta es la vista previa dentro de Claude, con tus tableros reales de monday. La versión instalable (PHP + SQLite, para el hosting de Verpex) incluye usuarios con contraseña, la importación completa desde monday, el formulario de la web conectado y el resumen con IA usando tu clave de Anthropic.</p></section>';
  html += '<section class="box"><h2>Copia de seguridad</h2><p>Descarga todo (tableros, elementos, actualizaciones, notas y transcripciones) en un archivo JSON, o restaura una copia.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-a="backup">' + ic('download', 14) + 'Descargar copia</button><label class="btn" style="cursor:pointer">' + ic('upload', 14) + 'Restaurar copia<input type="file" id="restore-file" accept=".json,application/json" hidden></label></div><p class="muted" style="margin:10px 0 0;font-size:12.5px">' + Object.keys(S.data.boards).length + ' tableros · ' + Object.keys(S.data.items).length + ' elementos · ' + Object.keys(S.data.updates).length + ' actualizaciones · ' + Object.keys(S.data.notes).length + ' notas · ' + Object.keys(S.data.transcripts).length + ' transcripciones</p></section>';
  html += '</div>';
  if (!setHTML(body, html)) return;
  $('#keys-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const p = {};
    for (const [k, v] of fd.entries()) p[k] = String(v) || null;
    patchMeta({ settings: p }); toast('Ajustes guardados');
  });
  const tn = $('#team-new'); tn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ACT['team-add'](); } });
  $('#restore-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) restoreBackup(f); });
  if (S.caps.server) wireServerSettings();
}
ACT['team-add'] = () => { const i = $('#team-new'); const v = i.value.trim(); if (!v || team().includes(v)) return; patchMeta({ team: team().concat([v]), settings: { teamRemoved: (settings().teamRemoved || []).filter((x) => x !== v) } }); i.value = ''; };
ACT['team-rm'] = (t) => patchMeta({ team: team().filter((p) => p !== t.dataset.p), settings: { teamRemoved: Array.from(new Set((settings().teamRemoved || []).concat([t.dataset.p]))) } });
ACT['ws-add'] = () => renameModal('Nuevo espacio', '', (v) => v && patchMeta({ workspaces: (meta().workspaces || []).concat([{ id: uid('w'), name: v }]) }));
ACT['ws-rename'] = (t) => { const w = (meta().workspaces || []).find((x) => x.id === t.dataset.id); renameModal('Renombrar espacio', w.name, (v) => v && patchMeta({ workspaces: meta().workspaces.map((x) => (x.id === w.id ? Object.assign({}, x, { name: v }) : x)) })); };
ACT['folder-add'] = () => openModal({ title: 'Nueva carpeta', body: '<label class="fld"><span>Nombre</span><input name="n"></label><label class="fld"><span>Espacio</span><select name="ws">' + wsOptions() + '</select></label>', submit: (fd) => { const n = String(fd.get('n') || '').trim(); if (n) patchMeta({ folders: (meta().folders || []).concat([{ id: uid('f'), ws: String(fd.get('ws')), name: n }]) }); } });
ACT['folder-rename'] = (t) => { const f = (meta().folders || []).find((x) => x.id === t.dataset.id); renameModal('Renombrar carpeta', f.name, (v) => v && patchMeta({ folders: meta().folders.map((x) => (x.id === f.id ? Object.assign({}, x, { name: v }) : x)) })); };
ACT['folder-del'] = (t) => { const id = t.dataset.id; const n = boardsSorted().filter((b) => b.folder === id); batch(n.map((b) => ({ op: 'update', c: 'boards', id: b.id, d: { folder: null } }))); patchMeta({ folders: (meta().folders || []).filter((x) => x.id !== id) }); toast(n.length ? 'Carpeta quitada; sus ' + n.length + ' tableros quedan sueltos en el espacio' : 'Carpeta quitada'); };
ACT.backup = () => {
  const docs = [];
  for (const c of COLLECTIONS) for (const [id, d] of Object.entries(S.data[c])) docs.push({ c, id, d });
  saveFile('sarahi-os-copia-' + todayISO() + '.json', JSON.stringify({ app: 'sarahi-os', version: 1, exported: nowISO(), docs }), 'application/json');
};
async function restoreBackup(f) {
  let data;
  try { data = JSON.parse(await f.text()); } catch (e) { toast('El archivo no es una copia válida de SARAHI OS'); return; }
  const docs = Array.isArray(data) ? data : data && data.docs;
  if (!Array.isArray(docs) || !docs.every((d) => d && COLLECTIONS.includes(d.c) && d.id && d.d)) { toast('El archivo no es una copia válida de SARAHI OS'); return; }
  confirmBox('Restaurar copia', 'Se cargarán ' + docs.length + ' registros. Los que ya existan con el mismo identificador se reemplazan; el resto de tus datos se mantiene.', 'Restaurar', async () => {
    for (let i = 0; i < docs.length; i += 200) await batch(docs.slice(i, i + 200).map((d) => ({ op: 'set', c: d.c, id: d.id, d: d.d })));
    toast(docs.length + ' registros restaurados');
  });
}

/* SARAHI OS — ajustes que solo existen en la instalación del subdominio (usuarios, importación de monday, formulario web, IA). */

function serverSettingsHTML() {
  const st = settings(); const wh = st.webhook || {};
  const admin = S.me.role === 'admin';
  const tb = getBoard(wh.board);
  let h = '';
  if (admin) h += '<section class="box"><h2>Usuarios y permisos<button class="btn sm" data-a="user-new">' + ic('plus', 13) + 'Nuevo usuario</button></h2><p>Cada persona entra con su email y contraseña y ve solo lo que permite su rol:</p>' +
    '<div class="roles"><div><b>Administrador</b><span>Todo: ventas, pipeline, CRM, clientes, usuarios y ajustes.</span></div><div><b>Equipo</b><span>Todos los tableros menos Ventas y las columnas ocultas (fee, montos).</span></div><div><b>Solo clientes</b><span>Solo los tableros de clientes y su ficha, más los tableros que le compartas. Trabaja en las tareas, pero no cambia la estructura.</span></div></div>' +
    '<div id="users-box" class="muted">Cargando…</div></section>';
  if (admin) h += meetSettingsHTML();
  h += '<section class="box"><h2>Formulario de la web</h2><p>Los formularios de sarahiagency.com pueden crear leads aquí en vez de en monday. Envía un POST con los campos del formulario a esta dirección:</p>' +
    '<div class="kv"><span class="muted">Dirección</span><div class="code" id="wh-url">Cargando…</div>' +
    '<label for="wh-board" class="muted">Tablero de destino</label><select id="wh-board" class="btn">' + boardsSorted().map((b) => '<option value="' + esc(b.id) + '"' + (b.id === wh.board ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select>' +
    '<label for="wh-group" class="muted">Grupo</label><select id="wh-group" class="btn">' + ((tb && tb.groups) || []).map((g) => '<option value="' + esc(g.id) + '"' + (g.id === wh.group ? ' selected' : '') + '>' + esc(g.title) + '</option>').join('') + '</select></div>' +
    '<p style="margin-top:12px">Campos reconocidos: <span class="mono">empresa, nombre, email, telefono, whatsapp, sitio, pais, origen</span>. Lo demás (necesidad, inversión, página, UTM…) se guarda en las notas del lead, como ahora en monday. El campo oculto <span class="mono">website_hp</span> sirve de trampa anti-spam.</p>' +
    (admin ? '<button class="btn sm" data-a="wh-rotate">' + ic('refresh', 13) + 'Generar una clave nueva</button>' : '') + '</section>';
  h += '<section class="box"><h2>Resumen con IA</h2><p>' + (S.caps.ai ? 'Activo. Las transcripciones se resumen con tu clave de la API de Anthropic configurada en el servidor.' : 'Desactivado. Para activarlo, escribe tu clave de la API de Anthropic en <span class="mono">config.php</span> (ANTHROPIC_API_KEY).') + '</p></section>';
  return h;
}
async function wireServerSettings() {
  const admin = S.me.role === 'admin';
  try { const w = await A.call('webhook_info'); const el = $('#wh-url'); if (el) el.textContent = w.url; } catch (e) { const el = $('#wh-url'); if (el) el.textContent = 'No disponible: ' + (e.message || e); }
  const wb = $('#wh-board'), wg = $('#wh-group');
  if (wb) wb.addEventListener('change', () => { const b = getBoard(wb.value); patchMeta({ settings: { webhook: { board: wb.value, group: ((b && b.groups) || [])[0] ? b.groups[0].id : null } } }); });
  if (wg) wg.addEventListener('change', () => patchMeta({ settings: { webhook: { group: wg.value } } }));
  if (admin) loadUsers();
}
async function loadUsers() {
  const box = $('#users-box'); if (!box) return;
  try {
    const r = await A.call('users');
    box.classList.remove('muted');
    box.innerHTML = '<div style="overflow-x:auto"><table class="tbl-simple"><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Último acceso</th><th></th></tr></thead><tbody>' + r.users.map((u) => '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td><td>' + esc(ROLE_NAMES[u.role] || u.role) + (u.role === 'clients' && u.access && Array.isArray(u.access.clients) ? ' <span class="muted">· ' + u.access.clients.length + (u.access.clients.length === 1 ? ' cliente' : ' clientes') + '</span>' : '') + (u.role === 'clients' && u.access && (u.access.boards || []).length ? ' <span class="muted">+ ' + u.access.boards.length + ' tablero' + (u.access.boards.length === 1 ? '' : 's') + '</span>' : '') + '</td><td class="muted">' + (u.last_login ? relTime(u.last_login) : 'nunca') + '</td><td style="white-space:nowrap"><button class="btn sm ghost" data-a="user-edit" data-id="' + u.id + '">Editar</button>' + (String(u.id) !== String(S.me.id) ? '<button class="btn sm ghost danger" data-a="user-del" data-id="' + u.id + '" data-n="' + esc(u.name) + '">Quitar</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>';
    S.users = r.users;
  } catch (e) { box.textContent = 'No se pudo cargar la lista: ' + (e.message || e); }
}
function userModal(u) {
  openModal({
    title: u ? 'Editar usuario' : 'Nuevo usuario',
    body: '<label class="fld"><span>Nombre</span><input name="name" value="' + esc(u ? u.name : '') + '" required></label><label class="fld"><span>Email</span><input name="email" type="email" value="' + esc(u ? u.email : '') + '" required></label>' +
      '<label class="fld"><span>' + (u ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña (mínimo 10 caracteres)') + '</span><input name="password" type="password" autocomplete="new-password"' + (u ? '' : ' required') + '></label>' +
      '<label class="fld"><span>Rol</span><select name="role" id="u-role">' + ['clients', 'member', 'admin'].map((r) => '<option value="' + r + '"' + ((u ? u.role : 'clients') === r ? ' selected' : '') + '>' + ROLE_NAMES[r] + '</option>').join('') + '</select></label>' +
      (() => {
        const all = !u || !u.access || !Array.isArray(u.access.clients);
        const cbs = boardsSorted().filter((b) => isClientBoard(b));
        return '<fieldset class="fld" id="u-clients"' + ((u ? u.role : 'clients') === 'clients' ? '' : ' hidden') + '><legend>Clientes a los que tiene acceso</legend>' +
          '<label class="chk-all"><input type="checkbox" name="allClients" id="u-all"' + (all ? ' checked' : '') + '> Todos los clientes (también los que se agreguen después)</label>' +
          '<div class="chk-list" id="u-client-list">' + cbs.map((b) => '<label><input type="checkbox" name="clients" value="' + esc(b.id) + '"' + (all || u.access.clients.includes(b.id) ? ' checked' : '') + (all ? ' disabled' : '') + '> ' + esc(b.name) + '</label>').join('') + '</div></fieldset>';
      })() +
      '<fieldset class="fld" id="u-extra"' + ((u ? u.role : 'clients') === 'clients' ? '' : ' hidden') + '><legend>Además de los clientes, puede ver estos tableros</legend><div class="chk-list">' +
      boardsSorted().filter((b) => !b.sales && !isClientBoard(b) && b.id !== settings().clientsBoard).map((b) => '<label><input type="checkbox" name="boards" value="' + esc(b.id) + '"' + (u && u.access && (u.access.boards || []).includes(b.id) ? ' checked' : '') + '> ' + esc(b.name) + '</label>').join('') + '</div></fieldset>',
    onOpen: (m) => {
      const r = m.querySelector('#u-role'); const x = m.querySelector('#u-extra'); const cl = m.querySelector('#u-clients');
      if (r) r.addEventListener('change', () => { x.hidden = r.value !== 'clients'; cl.hidden = r.value !== 'clients'; });
      const all = m.querySelector('#u-all');
      if (all) all.addEventListener('change', () => { m.querySelectorAll('#u-client-list input').forEach((c) => { c.disabled = all.checked; if (all.checked) c.checked = true; }); });
    },
    submit: async (fd) => {
      try { await A.call('user_save', { id: u ? u.id : null, name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), role: fd.get('role'), boards: fd.getAll('boards'), clients: fd.get('allClients') ? null : fd.getAll('clients') }); toast('Usuario guardado'); loadUsers(); if (fd.get('name') && !team().includes(String(fd.get('name')).split(' ')[0])) patchMeta({ team: team().concat([String(fd.get('name')).split(' ')[0]]) }); }
      catch (e) { toast(e.message || 'No se pudo guardar'); return true; }
    },
  });
}
ACT['user-new'] = () => userModal(null);
ACT['user-edit'] = (t) => userModal((S.users || []).find((u) => String(u.id) === t.dataset.id));
ACT['user-del'] = (t) => confirmBox('Quitar usuario', 'Se quitará el acceso de ' + t.dataset.n + '. Sus actualizaciones y notas se mantienen.', 'Quitar', async () => { try { await A.call('user_delete', { id: t.dataset.id }); loadUsers(); } catch (e) { toast(e.message || 'No se pudo quitar'); } });
ACT['wh-rotate'] = () => confirmBox('Generar una clave nueva', 'La dirección actual dejará de funcionar. Tendrás que actualizarla en los formularios de la web.', 'Generar', async () => { const w = await A.call('webhook_info', { rotate: true }); const el = $('#wh-url'); if (el) el.textContent = w.url; toast('Clave nueva generada'); });
ACT['mon-list'] = async (t) => {
  const token = ($('#mon-token') || {}).value || '';
  if (!token.trim()) { toast('Pega primero tu token de la API de monday'); return; }
  const box = $('#mon-boards');
  t.disabled = true; box.innerHTML = '<div class="muted">Consultando monday…</div>';
  try {
    const r = await A.call('monday_list', { token: token.trim() });
    const byWs = {};
    for (const b of r.boards) (byWs[b.workspace || 'Sin espacio'] = byWs[b.workspace || 'Sin espacio'] || []).push(b);
    box.innerHTML = '<p style="margin:0 0 8px"><b>' + r.boards.length + '</b> tableros encontrados.</p>' + Object.entries(byWs).map(([ws, bs]) => '<div style="margin:10px 0 4px;font-weight:600">' + esc(ws) + '</div>' + bs.map((b) => '<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" class="mon-b" value="' + esc(b.id) + '" data-n="' + esc(b.name) + '" checked> ' + esc(b.name) + (b.folder ? ' <span class="muted">· ' + esc(b.folder) + '</span>' : '') + ' <span class="muted mono" style="font-size:12px">' + (b.items_count || 0) + '</span></label>').join('')).join('') +
      '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="mon-upd" checked> Importar también las actualizaciones (comentarios) de cada elemento</label><div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap"><button class="btn primary" data-a="mon-import">Importar seleccionados</button><div class="progress" style="flex:1;min-width:160px"><i id="mon-prog"></i></div></div><div id="mon-log" class="muted" style="font-size:12.5px;margin-top:8px;display:grid;gap:2px"></div>';
  } catch (e) { box.innerHTML = '<div style="color:var(--danger)">' + esc(e.message || 'No se pudo conectar con monday') + '</div>'; }
  t.disabled = false;
};
ACT['mon-import'] = async (t) => {
  const token = ($('#mon-token') || {}).value.trim();
  const sel = $$('.mon-b:checked');
  if (!sel.length) { toast('Elige al menos un tablero'); return; }
  const upd = $('#mon-upd').checked;
  const log = $('#mon-log'), prog = $('#mon-prog');
  t.disabled = true;
  let done = 0, items = 0;
  for (const c of sel) {
    const line = document.createElement('div'); line.textContent = 'Importando ' + c.dataset.n + '…'; log.prepend(line);
    try { const r = await A.call('monday_import', { token, board_id: c.value, updates: upd }); items += r.items; line.textContent = '✓ ' + c.dataset.n + ': ' + r.items + ' elementos' + (r.updates ? ', ' + r.updates + ' actualizaciones' : ''); }
    catch (e) { line.textContent = '✗ ' + c.dataset.n + ': ' + (e.message || 'error'); line.style.color = 'var(--danger)'; }
    done++; prog.style.width = (done / sel.length * 100) + '%';
  }
  t.disabled = false;
  if (A.refresh) await A.refresh();
  toast('Importación terminada: ' + done + ' tableros, ' + items + ' elementos');
};

/* SARAHI OS — Ventas: facturación real por mes y cliente, metas, altas y bajas, pipeline ponderado, embudo y prospección. */

const MONTHS_C = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const SALES_DEF = {
  goalYear: 120000000, goalMonth: 10000000, ufCLP: 41210.47, eurCLP: 1113.56, ratesDate: '2026-10-24',
  probs: { new: 10, qualified: 25, meeting: 40, proposal: 60 },
  planFees: { inicio: 16, pro: 22, partner: 32 }, defaultDealUF: 16,
  monthly: { leads: null, meetings: null, proposals: null, wins: null, newUF: null },
};
function salesCfg() { const s = settings().sales || {}; return merge(clone(SALES_DEF), s); }

/* ---------- etapas: rol de cada etiqueta e historial */
function stageRole(l) {
  if (!l) return null;
  const t = norm(l.label);
  if (l.done || /ganad|cerrado ganado|won/.test(t)) return 'won';
  if (CLOSED_RE.test(l.label)) return 'lost';
  if (/propuest/.test(t)) return 'proposal';
  if (/reuni/.test(t)) return 'meeting';
  if (/respondi|contactad|radiograf/.test(t)) return 'contacted';
  if (/calific/.test(t) && !/por calificar/.test(t)) return 'qualified';
  if (/nuevo|por calificar/.test(t)) return 'new';
  return 'other';
}
function stageLogOf(b, it) {
  if (Array.isArray(it.stageLog) && it.stageLog.length) return it.stageLog;
  const ps = primaryStatus(b); const v = ps && it.values && it.values[ps.id];
  return v != null ? [{ v: String(v), at: it.created || it.updated, inferred: true }] : [];
}
/* Se llama desde setVal y createItem: registra el cambio de etapa y la fecha de cierre. */
function stagePatch(b, it, cid, v, p) {
  const ps = primaryStatus(b);
  if (!ps || ps.id !== cid || (it && it.parent)) return;
  const prev = it && it.values ? it.values[cid] : undefined;
  if (prev != null && String(prev) === String(v)) return;
  const cur = it && S.data.items[it.id];
  const log = (cur && Array.isArray(cur.stageLog) ? cur.stageLog : []).slice(-49);
  if (!log.length && prev != null) log.push({ v: String(prev), at: (cur && cur.created) || nowISO(), inferred: true });
  log.push({ v: v == null ? null : String(v), at: nowISO() });
  p.stageLog = log;
  const role = stageRole(labelOf(ps, v));
  const closeCol = (b.columns || []).find((c) => c.type === 'date' && c.closeDate);
  if (role === 'won' || role === 'lost') {
    p.closedAt = nowISO();
    if (closeCol && !(it && it.values && it.values[closeCol.id])) p.values[closeCol.id] = todayISO();
  } else if (cur && cur.closedAt) p.closedAt = null;
}

/* ---------- valor de un negocio (UF al mes) */
function dealUF(b, it) {
  const s = salesCfg();
  const fee = (b.columns || []).find((c) => c.type === 'numbers' && /fee|honorario|valor/i.test(c.title) && (c.unit === 'UF' || /\buf\b/i.test(c.title)));
  const v = fee && Number(it.values && it.values[fee.id]);
  if (v) return v;
  const pc = (b.columns || []).find((c) => c.type === 'status' && /plan/i.test(c.title));
  const l = pc && labelOf(pc, it.values && it.values[pc.id]);
  if (l && s.planFees[norm(l.label)]) return Number(s.planFees[norm(l.label)]);
  return Number(s.defaultDealUF) || 0;
}
function probOf(role, s) { if (role === 'won') return 100; if (role === 'lost') return 0; return Number(s.probs[role === 'contacted' ? 'qualified' : role] || 0); }

/* ---------- datos de facturación */
function salesBoards() { return boardsSorted().filter((b) => b.sales && b.sales.year); }
function salesData(year) {
  const s = salesCfg();
  const boards = salesBoards().filter((b) => Number(b.sales.year) === Number(year));
  const rows = [];
  for (const b of boards) {
    const cur = b.sales.currency || 'CLP';
    const rate = cur === 'EUR' ? Number(s.eurCLP) || 0 : cur === 'UF' ? Number(s.ufCLP) || 0 : 1;
    const mcols = (b.columns || []).filter((c) => c.month).sort((x, y) => x.month - y.month);
    const tcol = (b.columns || []).find((c) => c.type === 'status' && /tipo/i.test(c.title));
    for (const it of boardItems(b.id)) {
      const native = Array(12).fill(0);
      for (const c of mcols) native[c.month - 1] = Number(it.values && it.values[c.id]) || 0;
      if (!native.some((x) => x)) continue;
      const tl = tcol && labelOf(tcol, it.values && it.values[tcol.id]);
      rows.push({ id: it.id, board: b.id, name: it.name, currency: cur, native, clp: native.map((x) => x * rate), type: tl ? norm(tl.label) : 'recurrente', group: it.group, past: b.pastGroup && it.group === b.pastGroup });
    }
  }
  return { rows, boards };
}
function curMonthIdx(year) { const t = new Date(); return t.getFullYear() > year ? 12 : t.getFullYear() < year ? -1 : t.getMonth(); }

/* ---------- formato */
function money(n) { return '$' + NF.format(Math.round(n || 0)); }
function compactCLP(n) {
  const a = Math.abs(n || 0); const sg = n < 0 ? '−' : '';
  if (a >= 1e6) return sg + (a / 1e6).toLocaleString('es-CL', { maximumFractionDigits: a >= 1e8 ? 0 : 1 }) + 'M';
  if (a >= 1e3) return sg + Math.round(a / 1e3).toLocaleString('es-CL') + ' mil';
  return sg + Math.round(a).toLocaleString('es-CL');
}
function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
const SER = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
function chartW(frac) {
  const body = $('#main-body');
  const inner = Math.min(1200, (body ? body.clientWidth : 900) - (window.innerWidth <= 860 ? 32 : 48));
  const two = window.innerWidth > 1100 && frac < 1;
  return Math.max(260, Math.floor((two ? (inner - 18) * frac : inner) - 34));
}
function legendHTML(items) { return '<div class="viz-legend">' + items.map((i) => '<span><i style="background:' + i.color + (i.dim ? ';opacity:.45' : '') + '"></i>' + esc(i.label) + '</span>').join('') + '</div>'; }

/* ---------- gráficos SVG (marcas finas, separación de 2px, rejilla tenue) */
function colChart(o) {
  const W = o.W, H = o.H || 260, pl = 46, pr = o.goal ? 64 : 12, pt = 22, pb = 26;
  const n = o.labels.length, pw = W - pl - pr, ph = H - pt - pb;
  const totals = o.labels.map((_, i) => o.series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const top0 = Math.max(o.goal ? o.goal * 1.08 : 0, ...totals) || 1;
  const max = o.ints ? Math.max(4, Math.ceil(top0 / 4) * 4) : niceMax(top0);
  const y = (v) => pt + ph - (v / max) * ph;
  const slot = pw / n, bw = Math.max(6, Math.min(24, slot * 0.58));
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = (max / 4) * k; const yy = Math.round(y(v)) + 0.5; g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" class="' + (k ? 'grid' : 'base') + '"/><text x="' + (pl - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="tick">' + esc(o.tick ? o.tick(v) : compactCLP(v)) + '</text>'; }
  let marks = '';
  const showTotals = slot >= 30;
  const labW = Math.max(...o.labels.map((l) => String(l).length)) * 6.4 + 6;
  const every = slot < 22 ? 1 : Math.max(1, Math.ceil(labW / slot));
  o.labels.forEach((lab, i) => {
    const x = pl + slot * i + (slot - bw) / 2;
    const fut = o.cur != null && i > o.cur;
    let acc = 0;
    const segs = o.series.map((s, si) => ({ s, si, v: s.values[i] || 0 })).filter((q) => q.v > 0);
    marks += '<rect x="' + (pl + slot * i) + '" y="' + pt + '" width="' + slot + '" height="' + ph + '" fill="transparent" class="hit" data-tip="' + esc(lab + (fut ? ' (proyección)' : i === o.cur ? ' (en curso)' : '') + ' · total ' + (o.fmt ? o.fmt(totals[i]) : money(totals[i]))) + '"/>';
    marks += '<g' + (fut ? ' class="fut"' : '') + '>';
    segs.forEach((q, k) => {
      const y0 = y(acc), y1 = y(acc + q.v); acc += q.v;
      const top = k === segs.length - 1;
      const h = Math.max(0, y0 - y1 - (top ? 0 : 2));
      if (h <= 0.5) return;
      const tip = esc(q.s.label + ' · ' + lab + ': ' + (o.fmt ? o.fmt(q.v) : money(q.v)));
      if (top && h > 4) marks += '<path d="M' + x + ',' + (y1 + h) + 'V' + (y1 + 4) + 'Q' + x + ',' + y1 + ' ' + (x + 4) + ',' + y1 + 'H' + (x + bw - 4) + 'Q' + (x + bw) + ',' + y1 + ' ' + (x + bw) + ',' + (y1 + 4) + 'V' + (y1 + h) + 'Z" fill="' + q.s.color + '" data-tip="' + tip + '"/>';
      else marks += '<rect x="' + x + '" y="' + y1 + '" width="' + bw + '" height="' + h + '" fill="' + q.s.color + '" data-tip="' + tip + '"/>';
    });
    if (totals[i] > 0 && (showTotals || i === o.cur)) marks += '<text x="' + (x + bw / 2) + '" y="' + (y(totals[i]) - 6) + '" text-anchor="middle" class="val">' + esc(o.tick ? o.tick(totals[i]) : compactCLP(totals[i])) + '</text>';
    marks += '</g>';
    if ((n - 1 - i) % every === 0) marks += '<text x="' + (pl + slot * i + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="tick' + (i === o.cur ? ' cur' : '') + '">' + esc(slot < 22 ? lab[0] : lab) + '</text>';
  });
  let goal = '';
  if (o.goal) { const gy = Math.round(y(o.goal)) + 0.5; goal = '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" class="goal"/><text x="' + (W - pr + 6) + '" y="' + (gy + 4) + '" class="goal-l">' + esc(o.goalLabel || 'Meta') + '</text>'; }
  return '<svg class="viz" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria || '') + '">' + g + marks + goal + '</svg>';
}
function hbarChart(o) {
  const W = o.W, lw = Math.min(170, Math.round(W * 0.36)), vw = o.valueW || 96, row = 30, H = o.rows.length * row + 6;
  const max = Math.max(1, ...o.rows.map((r) => r.value));
  const bw = W - lw - vw - 8;
  const maxCh = Math.max(6, Math.floor((lw - 10) / 6.8));
  let s = '';
  o.rows.forEach((r, i) => {
    const y = i * row + 6; const w = Math.max(r.value > 0 ? 3 : 0, (r.value / max) * bw); const bh = 16;
    s += '<text x="0" y="' + (y + 13) + '" class="lab' + (r.muted ? ' mut' : '') + '">' + esc(r.label.length > maxCh ? r.label.slice(0, maxCh - 1).trim() + '…' : r.label) + '</text>';
    if (w > 0) s += '<path d="M' + lw + ',' + (y + 1) + 'H' + (lw + w - 4) + 'Q' + (lw + w) + ',' + (y + 1) + ' ' + (lw + w) + ',' + (y + 5) + 'V' + (y + bh - 3) + 'Q' + (lw + w) + ',' + (y + bh + 1) + ' ' + (lw + w - 4) + ',' + (y + bh + 1) + 'H' + lw + 'Z" fill="' + r.color + '"' + (r.muted ? ' opacity=".5"' : '') + ' data-tip="' + esc(r.tip || r.label + ': ' + r.text) + '"/>';
    s += '<text x="' + (lw + w + 8) + '" y="' + (y + 13) + '" class="val">' + esc(r.text) + '</text>';
  });
  return '<svg class="viz" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria || '') + '">' + s + '</svg>';
}
function divChart(o) {
  const W = o.W, H = o.H || 200, pl = 46, pr = 12, pt = 14, pb = 26, n = o.labels.length, pw = W - pl - pr, ph = H - pt - pb;
  const up = o.labels.map((_, i) => o.up.reduce((a, s) => a + (s.values[i] || 0), 0));
  const dn = o.labels.map((_, i) => o.down.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = niceMax(Math.max(1, ...up, ...dn));
  const mid = pt + ph / 2, sc = (ph / 2) / max;
  const slot = pw / n, bw = Math.max(6, Math.min(20, slot * 0.5));
  let s = '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (mid + 0.5) + '" y2="' + (mid + 0.5) + '" class="base"/>';
  s += '<text x="' + (pl - 6) + '" y="' + (pt + 8) + '" text-anchor="end" class="tick">+' + compactCLP(max) + '</text><text x="' + (pl - 6) + '" y="' + (pt + ph) + '" text-anchor="end" class="tick">−' + compactCLP(max) + '</text>';
  o.labels.forEach((lab, i) => {
    const x = pl + slot * i + (slot - bw) / 2;
    let acc = 0;
    o.up.forEach((ser) => { const v = ser.values[i] || 0; if (!v) return; const h = v * sc; s += '<rect x="' + x + '" y="' + (mid - acc - h) + '" width="' + bw + '" height="' + Math.max(1, h - 2) + '" rx="2" fill="' + ser.color + '" data-tip="' + esc(lab + ' · ' + ser.label + ': +' + money(v) + (ser.who && ser.who[i] ? ' (' + ser.who[i] + ')' : '')) + '"/>'; acc += h; });
    acc = 0;
    o.down.forEach((ser) => { const v = ser.values[i] || 0; if (!v) return; const h = v * sc; s += '<rect x="' + x + '" y="' + (mid + acc + 2) + '" width="' + bw + '" height="' + Math.max(1, h - 2) + '" rx="2" fill="' + ser.color + '" data-tip="' + esc(lab + ' · ' + ser.label + ': −' + money(v) + (ser.who && ser.who[i] ? ' (' + ser.who[i] + ')' : '')) + '"/>'; acc += h; });
    s += '<text x="' + (pl + slot * i + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle" class="tick">' + esc(slot < 22 ? lab[0] : lab) + '</text>';
  });
  return '<svg class="viz" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria || '') + '">' + s + '</svg>';
}
function meter(label, val, goal, fmt) {
  const p = goal ? Math.min(100, (val / goal) * 100) : 0;
  return '<div class="meter"><div class="meter-h"><span>' + esc(label) + '</span><b>' + esc(fmt ? fmt(val) : String(val)) + '</b><span class="muted">' + (goal ? 'de ' + esc(fmt ? fmt(goal) : String(goal)) : 'sin meta') + '</span></div><div class="meter-t"><i style="width:' + p + '%"></i></div></div>';
}

/* ---------- vista Ventas */
function viewSales(body) {
  const s = salesCfg();
  const years = Array.from(new Set(salesBoards().map((b) => Number(b.sales.year)))).sort();
  const year = S.ui.salesYear || (years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[years.length - 1]) || new Date().getFullYear();
  S.ui.salesYear = year;
  const { rows, boards } = salesData(year);
  const cur = curMonthIdx(year);
  const closed = Math.min(cur, 12) - 1;
  const t = todayISO();
  const W1 = chartW(1), W2 = chartW(0.5);
  let html = '<div class="page sales">';
  html += '<div class="greet"><div><h1>Ventas</h1><p>Facturación real por cliente, metas y pipeline comercial.</p></div><div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    (years.length > 1 ? '<select id="sales-year" class="btn" aria-label="Año">' + years.map((y) => '<option' + (y === year ? ' selected' : '') + '>' + y + '</option>').join('') + '</select>' : '') +
    boards.map((b) => '<button class="btn" data-a="open-board" data-id="' + esc(b.id) + '">' + ic('table', 14) + esc(b.name) + '</button>').join('') +
    '<button class="btn" data-a="sales-config">' + ic('gear', 14) + 'Metas y supuestos</button></div></div>';

  if (!rows.length) {
    html += '<div class="box"><div class="empty-state"><b>No hay tablero de ventas para ' + year + '.</b><span>Crea un tablero con una columna por mes (como tu hoja de Contabilidad) y SARAHI OS arma los gráficos solo.</span><button class="btn primary" data-a="sales-new-board" data-y="' + year + '">' + ic('plus', 14) + 'Crear tablero Ventas ' + year + '</button></div></div>';
  } else {
    const monthTot = Array(12).fill(0); const recTot = Array(12).fill(0);
    rows.forEach((r) => r.clp.forEach((v, i) => { monthTot[i] += v; if (r.type !== 'proyecto') recTot[i] += v; }));
    const ytd = monthTot.slice(0, Math.max(0, Math.min(cur + 1, 12))).reduce((a, b) => a + b, 0);
    const proj = monthTot.reduce((a, b) => a + b, 0);
    const lastClosed = closed >= 0 ? closed : null;
    const lastRec = lastClosed != null ? recTot[lastClosed] : 0;
    const prevRec = lastClosed > 0 ? recTot[lastClosed - 1] : null;
    const byClient = rows.map((r) => ({ r, ytd: r.clp.slice(0, Math.max(0, Math.min(cur + 1, 12))).reduce((a, b) => a + b, 0) })).sort((a, b) => b.ytd - a.ytd);
    const top = byClient[0];
    const share = top && ytd ? pct(top.ytd, ytd) : 0;
    const gap = Math.max(0, Number(s.goalYear) - proj);
    const delta = prevRec != null ? lastRec - prevRec : null;
    html += '<div class="kpis">' +
      '<div class="kpi"><span class="k">Vendido en ' + year + ' a la fecha</span><span class="v">' + compactCLP(ytd) + '</span><span class="s">' + pct(ytd, s.goalYear) + '% de la meta de ' + compactCLP(s.goalYear) + '</span></div>' +
      '<div class="kpi' + (gap > 0 ? ' warn' : '') + '"><span class="k">Cierre proyectado del año</span><span class="v">' + compactCLP(proj) + '</span><span class="s">' + (gap > 0 ? 'faltan ' + compactCLP(gap) + ' para la meta' : 'supera la meta anual') + '</span></div>' +
      '<div class="kpi"><span class="k">Recurrente de ' + (lastClosed != null ? MONTHS_L[lastClosed] : '—') + '</span><span class="v">' + compactCLP(lastRec) + '</span><span class="s">' + pct(lastRec, s.goalMonth) + '% de la meta mensual' + (delta != null ? ' · <span class="' + (delta >= 0 ? 'up' : 'down') + '">' + (delta >= 0 ? '▲ ' : '▼ ') + compactCLP(Math.abs(delta)) + '</span> vs ' + MONTHS[lastClosed - 1] : '') + '</span></div>' +
      '<div class="kpi' + (share >= 25 ? ' warn' : '') + '"><span class="k">Cliente más grande</span><span class="v">' + share + '%</span><span class="s">' + esc(top ? top.r.name : '') + ' sobre lo vendido' + (share >= 25 ? ' · riesgo de concentración' : '') + '</span></div></div>';

    // gráfico 1: ventas por mes apiladas por cliente
    const order = byClient.filter((x) => x.r.type !== 'proyecto').map((x) => x.r);
    const main = order.slice(0, 7);
    const rest = rows.filter((r) => !main.includes(r));
    const series = main.map((r, i) => ({ label: r.name, color: SER[i], values: r.clp }));
    if (rest.length) series.push({ label: rest.length === 1 ? rest[0].name : 'Otros (' + rest.length + ')', color: 'var(--s-other)', values: Array(12).fill(0).map((_, i) => rest.reduce((a, r) => a + r.clp[i], 0)) });
    const conv = boards.some((b) => b.sales.currency !== 'CLP');
    html += '<section class="box"><h2>Ventas por mes ' + year + '<span class="pill">CLP' + (conv ? ' · EUR a ' + NF.format(s.eurCLP) : '') + '</span></h2>' +
      '<p class="viz-sub">Barras llenas: meses cerrados y en curso. Barras tenues: lo que tienes proyectado en el tablero. La línea es tu meta de ' + compactCLP(s.goalMonth) + ' al mes.</p>' +
      legendHTML(series.map((x) => ({ label: x.label, color: x.color }))) +
      '<div class="viz-wrap">' + colChart({ W: W1, H: 290, labels: MONTHS_C, series, cur: Math.min(cur, 11), goal: Number(s.goalMonth), goalLabel: 'Meta ' + compactCLP(s.goalMonth), aria: 'Ventas mensuales por cliente' }) + '</div></section>';

    // gráfico 2: ventas por cliente
    const colorOf = (r) => { const k = main.indexOf(r); return k >= 0 ? SER[k] : 'var(--s-other)'; };
    html += '<div class="cols2 even"><section class="box"><h2>Ventas por cliente <span class="pill">a la fecha</span></h2>' +
      '<div class="viz-wrap">' + hbarChart({ W: W2, rows: byClient.filter((x) => x.ytd > 0).map((x) => ({ label: x.r.name, value: x.ytd, color: colorOf(x.r), muted: x.r.past, text: compactCLP(x.ytd) + ' · ' + pct(x.ytd, ytd) + '%', tip: x.r.name + ': ' + money(x.ytd) + ' (' + pct(x.ytd, ytd) + '% de lo vendido)' + (x.r.past ? ' · ex cliente' : '') })), aria: 'Ventas por cliente en el año' }) + '</div>' +
      (rest.length ? '' : '') + '</section>';

    // gráfico 3: altas, bajas y cambios de fee
    const mv = movements(rows, cur);
    html += '<section class="box"><h2>Altas, bajas y cambios de fee</h2>' +
      legendHTML([{ label: 'Clientes nuevos', color: 'var(--div-pos)' }, { label: 'Suben fee', color: 'var(--div-pos-2)' }, { label: 'Bajan fee', color: 'var(--div-neg-2)' }, { label: 'Clientes que salen', color: 'var(--div-neg)' }]) +
      '<div class="viz-wrap">' + divChart({ W: W2, H: 190, labels: MONTHS_C.slice(0, Math.max(1, Math.min(cur + 1, 12))), up: [{ label: 'Clientes nuevos', color: 'var(--div-pos)', values: mv.add, who: mv.addWho }, { label: 'Suben fee', color: 'var(--div-pos-2)', values: mv.exp, who: mv.expWho }], down: [{ label: 'Clientes que salen', color: 'var(--div-neg)', values: mv.churn, who: mv.churnWho }, { label: 'Bajan fee', color: 'var(--div-neg-2)', values: mv.con, who: mv.conWho }], aria: 'Altas y bajas por mes' }) + '</div>' +
      '<div class="mv-list">' + (mv.list.length ? mv.list.map((m) => '<div class="mv"><span class="mono muted">' + MONTHS_C[m.i] + '</span><span class="mv-d ' + (m.v >= 0 ? 'up' : 'down') + '">' + (m.v >= 0 ? '+' : '−') + compactCLP(Math.abs(m.v)) + '</span><span>' + esc(m.text) + '</span></div>').join('') : '<p class="muted" style="margin:0">Sin movimientos en el año.</p>') + '</div>' +
      '<p class="viz-sub" style="margin-top:8px">Los clientes con fee variable (por ejemplo, % de la venta) no cuentan como subidas o bajadas.</p></section></div>';
  }

  html += pipelineSection(W1, W2);
  html += outboundSection(W2);
  html += '</div>';
  if (!setHTML(body, html)) return;
  const ys = $('#sales-year'); if (ys) ys.addEventListener('change', () => { S.ui.salesYear = Number(ys.value); render(); });
}
function movements(rows, cur) {
  const last = Math.max(0, Math.min(cur, 11));
  const add = Array(12).fill(0), churn = Array(12).fill(0), exp = Array(12).fill(0), con = Array(12).fill(0);
  const addWho = Array(12).fill(''), churnWho = Array(12).fill(''), expWho = Array(12).fill(''), conWho = Array(12).fill('');
  const list = [];
  const join = (a, n) => (a ? a + ', ' : '') + n;
  for (const r of rows) {
    if (r.type === 'proyecto') continue;
    const v = r.clp;
    for (let i = 1; i <= last; i++) {
      const a = v[i - 1], b = v[i];
      if (!a && b) { add[i] += b; addWho[i] = join(addWho[i], r.name); list.push({ i, v: b, text: 'Entra ' + r.name }); }
      else if (a && !b && !v.slice(i, last + 1).some((x) => x)) { churn[i] += a; churnWho[i] = join(churnWho[i], r.name); list.push({ i, v: -a, text: 'Sale ' + r.name }); }
      else if (a && b && r.type === 'recurrente' && Math.abs(b - a) / a >= 0.05) {
        if (b > a) { exp[i] += b - a; expWho[i] = join(expWho[i], r.name); list.push({ i, v: b - a, text: r.name + ' sube a ' + compactCLP(b) }); }
        else { con[i] += a - b; conWho[i] = join(conWho[i], r.name); list.push({ i, v: b - a, text: r.name + ' baja a ' + compactCLP(b) }); }
      }
    }
  }
  list.sort((x, y) => y.i - x.i || y.v - x.v);
  return { add, churn, exp, con, addWho, churnWho, expWho, conWho, list };
}
function pipelineSection(W1, W2) {
  const st = settings(); const s = salesCfg();
  const b = getBoard(st.crmBoard);
  if (!b) return '<section class="box"><h2>Pipeline comercial</h2><p class="muted">Elige tu tablero de pipeline en Ajustes → Tableros clave.</p></section>';
  const ps = primaryStatus(b);
  if (!ps) return '';
  const items = boardItems(b.id);
  const t = todayISO(); const ym = t.slice(0, 7);
  const open = [], won = [], lost = [];
  let weighted = 0, openUF = 0;
  for (const it of items) {
    const role = stageRole(labelOf(ps, it.values && it.values[ps.id]));
    if (role === 'won') won.push(it); else if (role === 'lost') lost.push(it); else { open.push(it); const u = dealUF(b, it); openUF += u; weighted += (u * probOf(role, s)) / 100; }
  }
  const closedAt = (it) => it.closedAt || (stageLogOf(b, it).slice(-1)[0] || {}).at || it.updated;
  const since90 = new Date(Date.now() - 90 * 864e5).toISOString();
  const w90 = won.filter((it) => closedAt(it) >= since90).length, l90 = lost.filter((it) => closedAt(it) >= since90).length;
  const days = won.map((it) => (new Date(closedAt(it)) - new Date(it.created)) / 864e5).filter((d) => d >= 0);
  const avgDays = days.length ? Math.round(days.reduce((a, c) => a + c, 0) / days.length) : null;
  const wonMonthUF = won.filter((it) => String(closedAt(it)).slice(0, 7) === ym).reduce((a, it) => a + dealUF(b, it), 0);
  const uf = Number(s.ufCLP) || 0;
  // eventos del mes desde el historial de etapas
  const entered = { new: 0, meeting: 0, proposal: 0, won: 0 };
  for (const it of items) {
    if (String(it.created || '').slice(0, 7) === ym) entered.new++;
    const seen = new Set();
    for (const e of stageLogOf(b, it)) { if (e.inferred || String(e.at).slice(0, 7) !== ym) continue; const r = stageRole(labelOf(ps, e.v)); if (r && !seen.has(r)) { seen.add(r); if (entered[r] != null && r !== 'new') entered[r]++; } }
  }
  const g = s.monthly || {};
  let html = '<h2 class="sec-title">Pipeline comercial <button class="btn sm" data-a="open-board" data-id="' + esc(b.id) + '">Abrir ' + esc(b.name) + '</button></h2>';
  html += '<div class="kpis">' +
    '<div class="kpi"><span class="k">Leads abiertos</span><span class="v">' + open.length + '</span><span class="s">' + NF.format(openUF) + ' UF/mes si cierran todos</span></div>' +
    '<div class="kpi"><span class="k">Pipeline ponderado</span><span class="v">' + NF.format(Math.round(weighted * 10) / 10) + ' UF</span><span class="s">≈ ' + compactCLP(weighted * uf) + ' al mes, según probabilidad por etapa</span></div>' +
    '<div class="kpi"><span class="k">Ganado este mes</span><span class="v">' + NF.format(wonMonthUF) + ' UF</span><span class="s">' + won.filter((it) => String(closedAt(it)).slice(0, 7) === ym).length + ' cierres en ' + MONTHS_L[new Date().getMonth()] + '</span></div>' +
    '<div class="kpi"><span class="k">Tasa de cierre (90 días)</span><span class="v">' + (w90 + l90 ? pct(w90, w90 + l90) + '%' : '—') + '</span><span class="s">' + (w90 + l90 ? w90 + ' ganados de ' + (w90 + l90) + ' cerrados' : 'aún sin cierres registrados') + (avgDays != null ? ' · ' + avgDays + ' días hasta cerrar' : '') + '</span></div></div>';
  // metas del mes
  const hasGoals = ['leads', 'meetings', 'proposals', 'wins', 'newUF'].some((k) => Number(g[k]) > 0);
  html += '<div class="cols2 even"><section class="box"><h2>Metas de ' + MONTHS_L[new Date().getMonth()] + '<button class="btn sm" data-a="sales-config">Editar</button></h2>' +
    (hasGoals ? meter('Leads nuevos', entered.new, Number(g.leads) || 0) + meter('Reuniones', entered.meeting, Number(g.meetings) || 0) + meter('Propuestas enviadas', entered.proposal, Number(g.proposals) || 0) + meter('Clientes ganados', entered.won, Number(g.wins) || 0) + meter('Fee nuevo', wonMonthUF, Number(g.newUF) || 0, (v) => NF.format(v) + ' UF')
      : '<div class="empty-state"><b>Aún no tienes metas mensuales.</b><span>Define cuántos leads, reuniones, propuestas y cierres quieres por mes. Es la tarea «Definir metas del plan a 90 días» de tu Plan de adquisición.</span><button class="btn primary" data-a="sales-config">Definir metas</button></div>') +
    '<p class="viz-sub" style="margin-top:10px">Reuniones, propuestas y cierres se cuentan desde que una etapa cambia en SARAHI OS (historial desde el ' + fmtDate(settings().stageLogSince || todayISO(), true) + ').</p></section>';
  // embudo
  const stages = (ps.labels || []).filter((l) => { const r = stageRole(l); return r !== 'lost'; });
  const reached = stages.map((l) => {
    const k = stages.indexOf(l);
    return items.filter((it) => {
      const lab = labelOf(ps, it.values && it.values[ps.id]);
      const ci = stages.findIndex((x) => lab && String(x.id) === String(lab.id));
      if (ci >= k) return true;
      return stageLogOf(b, it).some((e) => stages.findIndex((x) => String(x.id) === String(e.v)) >= k);
    }).length;
  });
  const ramp = ['var(--r1)', 'var(--r2)', 'var(--r3)', 'var(--r4)', 'var(--r5)', 'var(--r6)'];
  html += '<section class="box"><h2>Embudo</h2><div class="viz-wrap">' + hbarChart({ W: W2, valueW: 120, rows: stages.map((l, k) => ({ label: l.label, value: reached[k], color: ramp[Math.min(k, ramp.length - 1)], text: reached[k] + (k > 0 && reached[k - 1] ? ' · ' + pct(reached[k], reached[k - 1]) + '%' : ''), tip: l.label + ': ' + reached[k] + ' llegaron a esta etapa' + (k > 0 && reached[k - 1] ? ' (' + pct(reached[k], reached[k - 1]) + '% del paso anterior)' : '') })), aria: 'Embudo de ventas' }) + '</div>' +
    '<p class="viz-sub">Cuántos leads llegaron al menos a cada etapa; el % es la conversión desde la etapa anterior. Perdidos: ' + lost.length + '.</p></section></div>';
  // leads por semana y motivos de pérdida
  const weeks = []; const mon = mondayOf(t);
  for (let k = 11; k >= 0; k--) weeks.push(addDays(mon, -7 * k));
  const oc = (b.columns || []).find((c) => c.type === 'status' && /origen|fuente|source/i.test(c.title));
  const origins = [];
  const counts = {};
  for (const it of items) {
    const d = localISO(new Date(it.created || it.updated)); const wk = mondayOf(d);
    const wi = weeks.indexOf(wk); if (wi < 0) continue;
    const l = oc && labelOf(oc, it.values && it.values[oc.id]); const key = l ? l.label : 'Sin origen';
    if (!origins.includes(key)) origins.push(key);
    counts[key] = counts[key] || Array(12).fill(0); counts[key][wi]++;
  }
  origins.sort((a, c) => counts[c].reduce((x, y) => x + y, 0) - counts[a].reduce((x, y) => x + y, 0));
  const wkSeries = origins.slice(0, 7).map((o, i) => ({ label: o, color: SER[i], values: counts[o] }));
  if (origins.length > 7) wkSeries.push({ label: 'Otros', color: 'var(--s-other)', values: Array(12).fill(0).map((_, i) => origins.slice(7).reduce((a, o) => a + counts[o][i], 0)) });
  const wkLabels = weeks.map((w) => { const [, m, d] = w.split('-').map(Number); return d + '/' + m; });
  const lc = (b.columns || []).find((c) => c.type === 'status' && /motivo|p[eé]rdida|raz[oó]n/i.test(c.title));
  const reasons = {};
  if (lc) for (const it of lost) { const l = labelOf(lc, it.values && it.values[lc.id]); const k = l ? l.label : 'Sin motivo'; reasons[k] = (reasons[k] || 0) + 1; }
  const rs = Object.entries(reasons).sort((a, c) => c[1] - a[1]);
  html += '<div class="cols2 even"><section class="box"><h2>Leads nuevos por semana</h2>' + (wkSeries.length > 1 ? legendHTML(wkSeries) : '') +
    (wkSeries.length ? '<div class="viz-wrap">' + colChart({ W: W2, H: 200, ints: true, labels: wkLabels, series: wkSeries, tick: (v) => String(Math.round(v)), fmt: (v) => v + (v === 1 ? ' lead' : ' leads'), aria: 'Leads nuevos por semana' }) + '</div>' : '<div class="empty-state">Sin leads nuevos en las últimas 12 semanas.</div>') + '</section>' +
    '<section class="box"><h2>Por qué se pierden</h2>' + (rs.length ? '<div class="viz-wrap">' + hbarChart({ W: W2, rows: rs.map(([k, v]) => ({ label: k, value: v, color: 'var(--div-neg)', text: v + (v === 1 ? ' lead' : ' leads') })), aria: 'Motivos de pérdida' }) + '</div>' : '<div class="empty-state"><b>Todavía no hay leads perdidos con motivo.</b><span>Al marcar un lead como Perdido, completa «Motivo de pérdida» para ver aquí qué frena tus cierres.</span></div>') + '</section></div>';
  // proyección
  const gapM = Math.max(0, Number(s.goalMonth) - (salesData(new Date().getFullYear()).rows.reduce((a, r) => a + (r.type !== 'proyecto' ? r.clp[Math.max(0, new Date().getMonth() - 1)] : 0), 0)));
  const propUF = open.filter((it) => stageRole(labelOf(ps, it.values && it.values[ps.id])) === 'proposal').reduce((a, it) => a + dealUF(b, it), 0);
  html += '<section class="box callout"><h2>¿Cuánto falta para la meta mensual?</h2><p>Te faltan <b>' + compactCLP(gapM) + '</b> al mes para llegar a ' + compactCLP(s.goalMonth) + ' recurrentes: unas <b>' + (uf ? NF.format(Math.ceil(gapM / uf)) : '—') + ' UF</b>, o <b>' + (uf && s.planFees.pro ? Math.ceil(gapM / (uf * s.planFees.pro)) : '—') + ' clientes en plan Pro</b> (' + s.planFees.pro + ' UF). Lo que tienes en propuesta suma ' + NF.format(propUF) + ' UF; el pipeline ponderado, ' + NF.format(Math.round(weighted * 10) / 10) + ' UF.</p></section>';
  return html;
}
function outboundSection(W2) {
  const bs = boardsSorted().filter((b) => !b.isTemplate && b.id !== settings().crmBoard && /lead|prospect/i.test(b.name) && primaryStatus(b));
  if (!bs.length) return '';
  let html = '<h2 class="sec-title">Prospección</h2><div class="cols2 even">';
  const t = todayISO(); const wk = addDays(t, -7);
  for (const b of bs.slice(0, 2)) {
    const ps = primaryStatus(b); const items = boardItems(b.id);
    const counts = (ps.labels || []).map((l) => items.filter((it) => String(it.values && it.values[ps.id]) === String(l.id)).length);
    const cc = (b.columns || []).find((c) => c.type === 'date' && /contacto/i.test(c.title));
    const fc = dateCols(b)[0];
    const contacted7 = cc ? items.filter((it) => (it.values || {})[cc.id] >= wk).length : null;
    const overdue = fc ? items.filter((it) => !isDone(b, it) && (it.values || {})[fc.id] && it.values[fc.id] < t).length : 0;
    html += '<section class="box"><h2>' + esc(b.name) + '<button class="btn sm" data-a="open-board" data-id="' + esc(b.id) + '">Abrir</button></h2><p class="viz-sub">' + items.length + ' prospectos' + (contacted7 != null ? ' · ' + contacted7 + ' contactados en 7 días' : '') + ' · ' + overdue + ' seguimientos vencidos</p>' +
      '<div class="viz-wrap">' + hbarChart({ W: W2, rows: (ps.labels || []).map((l, k) => ({ label: l.label, value: counts[k], color: stageRole(l) === 'lost' ? 'var(--s-other)' : 'var(--r3)', text: String(counts[k]) })).filter((r) => r.value > 0), aria: 'Prospectos por etapa' }) + '</div></section>';
  }
  return html + '</div>';
}

/* ---------- configuración y tablero del año */
ACT['sales-config'] = () => {
  const s = salesCfg(); const g = s.monthly || {};
  const num = (name, v, label, step) => '<label class="fld"><span>' + label + '</span><input name="' + name + '" type="number" inputmode="decimal" step="' + (step || 'any') + '" value="' + (v == null ? '' : esc(v)) + '"></label>';
  openModal({
    title: 'Metas y supuestos de ventas', wide: true,
    body: '<h3 class="mh">Metas</h3><div class="grid3">' + num('goalYear', s.goalYear, 'Meta anual (CLP)') + num('goalMonth', s.goalMonth, 'Meta mensual recurrente (CLP)') + '</div>' +
      '<h3 class="mh">Metas de cada mes</h3><div class="grid3">' + num('leads', g.leads, 'Leads nuevos', 1) + num('meetings', g.meetings, 'Reuniones', 1) + num('proposals', g.proposals, 'Propuestas', 1) + num('wins', g.wins, 'Clientes ganados', 1) + num('newUF', g.newUF, 'Fee nuevo (UF)') + '</div>' +
      '<h3 class="mh">Tipo de cambio</h3><div class="grid3">' + num('ufCLP', s.ufCLP, '1 UF en CLP') + num('eurCLP', s.eurCLP, '1 EUR en CLP') + '<label class="fld"><span>Valores del</span><input name="ratesDate" type="date" value="' + esc(s.ratesDate || '') + '"></label></div>' +
      '<h3 class="mh">Valor de un negocio</h3><p class="muted" style="margin:0 0 8px;font-size:13px">Se usa «Fee propuesto UF» del lead; si está vacío, el precio de su plan de interés; si no hay plan, el valor por defecto.</p><div class="grid3">' + num('fee_inicio', s.planFees.inicio, 'Plan Inicio (UF)') + num('fee_pro', s.planFees.pro, 'Plan Pro (UF)') + num('fee_partner', s.planFees.partner, 'Plan Partner (UF)') + num('defaultDealUF', s.defaultDealUF, 'Por defecto (UF)') + '</div>' +
      '<h3 class="mh">Probabilidad de cierre por etapa (%)</h3><div class="grid3">' + num('p_new', s.probs.new, 'Nuevo', 1) + num('p_qualified', s.probs.qualified, 'Calificado', 1) + num('p_meeting', s.probs.meeting, 'Reunión', 1) + num('p_proposal', s.probs.proposal, 'Propuesta', 1) + '</div>',
    submit: (fd) => {
      const n = (k) => { const v = String(fd.get(k) || '').replace(',', '.'); return v === '' ? null : Number(v); };
      patchMeta({ settings: { sales: { goalYear: n('goalYear'), goalMonth: n('goalMonth'), ufCLP: n('ufCLP'), eurCLP: n('eurCLP'), ratesDate: String(fd.get('ratesDate') || ''), defaultDealUF: n('defaultDealUF'),
        monthly: { leads: n('leads'), meetings: n('meetings'), proposals: n('proposals'), wins: n('wins'), newUF: n('newUF') },
        planFees: { inicio: n('fee_inicio'), pro: n('fee_pro'), partner: n('fee_partner') },
        probs: { new: n('p_new'), qualified: n('p_qualified'), meeting: n('p_meeting'), proposal: n('p_proposal') } } } });
      toast('Metas y supuestos guardados');
    },
  });
};
ACT['sales-new-board'] = async (t) => {
  const year = Number(t.dataset.y);
  const prev = salesBoards().filter((b) => Number(b.sales.year) === year - 1);
  const ops = []; let firstId = null;
  if (prev.length) {
    for (const src of prev) {
      const r = cloneBoardOps(src, { name: src.name.replace(String(year - 1), String(year)), withItems: true, blankValues: true });
      const bd = r.ops[0].d; bd.sales = Object.assign({}, bd.sales, { year }); bd.created = nowISO();
      r.ops.forEach((o) => { if (o.c === 'items' && src.pastGroup && o.d.group === src.pastGroup) o.skip = true; });
      ops.push(...r.ops.filter((o) => !o.skip)); firstId = firstId || r.id;
    }
  } else {
    firstId = uid('b');
    ops.push({ op: 'set', c: 'boards', id: firstId, d: { name: 'Ventas ' + year, ws: ((meta().workspaces || [])[0] || {}).id || 'w-main', folder: null, pos: 0, itemLabel: 'Cliente', created: nowISO(), sales: { year, currency: 'CLP' }, description: 'Facturación mensual por cliente.',
      columns: [{ id: 'tipo', title: 'Tipo', type: 'status', labels: [{ id: '0', label: 'Recurrente', color: '#579bfc' }, { id: '1', label: 'Variable', color: '#fdab3d' }, { id: '2', label: 'Proyecto', color: '#9d50dd' }] }, { id: 'acuerdo', title: 'Acuerdo', type: 'text' }].concat(MONTHS_C.map((m, i) => ({ id: 'm' + String(i + 1).padStart(2, '0'), title: m, type: 'numbers', unit: 'CLP', month: i + 1, width: 112 }))),
      groups: [{ id: 'g_rec', title: 'Clientes activos', color: '#579bfc' }, { id: 'g_proj', title: 'Proyectos', color: '#9d50dd' }, { id: 'g_out', title: 'Ex clientes', color: '#757575' }], pastGroup: 'g_out' } });
  }
  await batch(ops);
  go({ view: 'board', id: firstId });
  toast('Tablero Ventas ' + year + ' creado' + (prev.length ? ' con tus clientes activos' : ''));
};

/* ---------- tooltip de los gráficos */
(function () {
  let tip = null;
  const show = (el, x, y) => {
    if (!tip) { tip = document.createElement('div'); tip.className = 'viz-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
    tip.style.top = Math.max(8, y - h - 12) + 'px';
  };
  const hide = () => { if (tip) tip.hidden = true; };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('.viz [data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); });
  document.addEventListener('mousemove', (e) => { const el = e.target.closest && e.target.closest('.viz [data-tip]'); if (el && tip && !tip.hidden) show(el, e.clientX, e.clientY); });
  document.addEventListener('click', (e) => { const el = e.target.closest && e.target.closest('.viz [data-tip]'); if (el) show(el, e.clientX, e.clientY); });
  document.addEventListener('scroll', hide, true);
})();
window.addEventListener('resize', debounce(() => { if (['sales', 'home'].includes(S.route.view)) render(); }, 180));

/* SARAHI OS — «El cliente en la semana»: estado del cliente de un vistazo y lo pendiente según
   las reuniones (transcripciones), los comentarios y las tareas con fecha. */

function isClientBoard(b) {
  if (!b || b.isTemplate || b.sales) return false;
  const st = settings();
  return !!b.clientItem || (!!st.clientsFolder && b.folder === st.clientsFolder && b.id !== st.clientsBoard);
}
function isClientRecord(it) { const st = settings(); return !!(it && !it.parent && st.clientsBoard && it.board === st.clientsBoard); }

function clientCtx(x) {
  let board = null, item = null;
  if (x && x.columns) { board = x; item = x.clientItem ? getItem(x.clientItem) : null; }
  else if (x) { item = x; board = clientBoardFor(x); }
  const scope = new Set();
  if (item) scope.add(item.id);
  if (board) for (const it of boardItems(board.id)) { scope.add(it.id); for (const k of childrenOf(it.id)) scope.add(k.id); }
  const cb = item ? getBoard(item.board) : null;
  const past = !!(item && cb && cb.pastGroup && item.group === cb.pastGroup);
  return { board, item, cb, name: item ? item.name : board ? board.name : '', scope, past };
}

function clientActivity(ctx) {
  const ups = [], txs = [];
  for (const [id, u] of Object.entries(S.data.updates)) if (u && ctx.scope.has(u.item)) ups.push(Object.assign({ id }, u));
  for (const [id, x] of Object.entries(S.data.transcripts)) {
    const l = x && x.link;
    if (l && ((l.item && ctx.scope.has(l.item)) || (ctx.board && l.board === ctx.board.id))) txs.push(Object.assign({ id }, x));
  }
  ups.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  txs.sort((a, b) => String(b.date || b.created).localeCompare(String(a.date || a.created)));
  return { ups, txs };
}

const NOT_TASK_RE = /credencial|acceso|contrase|password|login/i;
function dueOf(b, it) {
  const cols = it.parent ? (b.subColumns || []) : (b.columns || []);
  const v = it.values || {};
  const dc = cols.filter((c) => c.type === 'date');
  const f = dc.filter((c) => c.followup);
  for (const c of (f.length ? f : dc)) if (v[c.id]) return String(v[c.id]).slice(0, 10);
  for (const c of cols) if (c.type === 'timeline' && v[c.id] && (v[c.id].to || v[c.id].from)) return String(v[c.id].to || v[c.id].from).slice(0, 10);
  return '';
}
function clientTasks(ctx) {
  const out = { open: [], over: [], week: [], doneWeek: [], meetings: [] };
  const b = ctx.board; if (!b) return out;
  const t = todayISO(), ws = mondayOf(t), we = addDays(ws, 6);
  const gname = (g) => ((b.groups || []).find((x) => x.id === g) || {}).title || '';
  const ps = primaryStatus(b);
  const consider = (it, parent) => {
    const grp = gname((parent || it).group);
    if (NOT_TASK_RE.test(grp)) return;
    const due = dueOf(b, it);
    if (/reuni/i.test(grp) && !it.parent) { if (due && due >= t) out.meetings.push({ it, due }); return; }
    const st = !it.parent && ps ? (it.values || {})[ps.id] : null;
    if (isDone(b, it)) { if (String(it.updated || '').slice(0, 10) >= ws) out.doneWeek.push({ it, parent }); return; }
    if (!due && st == null && !it.parent && !/pendiente|tarea|por hacer|to ?do|backlog/i.test(grp)) return;
    const row = { it, parent, due };
    out.open.push(row);
    if (due && due < t) out.over.push(row);
    else if (due && due <= we) out.week.push(row);
  };
  for (const it of boardItems(b.id)) { consider(it, null); for (const k of childrenOf(it.id)) consider(k, it); }
  out.over.sort((a, c) => a.due.localeCompare(c.due));
  out.week.sort((a, c) => a.due.localeCompare(c.due));
  out.meetings.sort((a, c) => a.due.localeCompare(c.due));
  return out;
}

function daysSince(iso) { if (!iso) return null; const a = new Date(String(iso).slice(0, 10) + 'T12:00:00'), b = new Date(todayISO() + 'T12:00:00'); return Math.round((b - a) / 86400000); }
function recordField(ctx, re, type) {
  if (!ctx.item || !ctx.cb) return null;
  const c = (ctx.cb.columns || []).find((x) => (!type || x.type === type) && re.test(x.title));
  if (!c) return null;
  const v = (ctx.item.values || {})[c.id];
  if (v == null || v === '') return null;
  if (c.type === 'status') { const l = labelOf(c, v); return l ? { text: l.label, color: l.color } : null; }
  if (c.type === 'dropdown') return { text: (Array.isArray(v) ? v : [v]).map((x) => (labelOf(c, x) || {}).label || x).join(', ') };
  if (c.type === 'people') return { text: (Array.isArray(v) ? v : [v]).join(', ') };
  return { text: String(v) };
}

function clientWeekData(x) {
  const ctx = clientCtx(x);
  const act = clientActivity(ctx);
  const tasks = clientTasks(ctx);
  const lastUp = act.ups.length ? String(act.ups[0].created).slice(0, 10) : '';
  const lastTx = act.txs.length ? String(act.txs[0].date || act.txs[0].created).slice(0, 10) : '';
  const last = [lastUp, lastTx].filter(Boolean).sort().pop() || '';
  const days = daysSince(last);
  const estado = recordField(ctx, /^estado$/i, 'status');
  const why = [];
  let k = 'ok';
  if (ctx.past) k = 'past';
  else {
    const stuck = !!(estado && /estanc|detenid|riesgo|pausa|bloque/i.test(estado.text));
    if (tasks.over.length) why.push(tasks.over.length + (tasks.over.length === 1 ? ' tarea vencida' : ' tareas vencidas'));
    if (days === null) why.push('sin comentarios ni reuniones registradas');
    else if (days > 10) why.push('sin comentarios ni reuniones registradas hace ' + days + ' días');
    if (stuck) why.push('estado: ' + estado.text.toLowerCase());
    if (tasks.over.length >= 3 || stuck || (tasks.over.length && days !== null && days > 21)) k = 'risk';
    else if (tasks.over.length || days === null || days > 10) k = 'warn';
  }
  const weekly = (ctx.item && ctx.item.weekly) || (ctx.board && ctx.board.weekly) || null;
  return { ctx, act, tasks, last, days, why, k, weekly };
}
const HEALTH = {
  ok: { label: 'Al día', icon: 'check' },
  warn: { label: 'Atención', icon: 'clock' },
  risk: { label: 'En riesgo', icon: 'alert' },
  past: { label: 'Cliente pasado', icon: 'clock' },
};
function healthChip(k, title) { const h = HEALTH[k] || HEALTH.ok; return '<span class="health h-' + k + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + ic(h.icon, 13) + h.label + '</span>'; }
function clientHealthOf(item) { const d = clientWeekData(item); return { k: d.k, why: d.why }; }

/* Pendientes sin IA: acciones abiertas de las reuniones recientes + tareas vencidas y de la semana. */
function pendingFallback(d) {
  const out = [];
  const since = addDays(todayISO(), -21);
  for (const x of d.act.txs) {
    if (String(x.date || '').slice(0, 10) < since) continue;
    for (const a of x.actions || []) {
      const task = a.taskId && getItem(a.taskId);
      if (task && isDone(getBoard(task.board), task)) continue;
      out.push({ texto: a.text, resp: a.owner || '', fecha: a.due || '', fuente: 'reunión', ref: { a: 'open-tx', id: x.id } });
    }
  }
  for (const r of d.tasks.over.concat(d.tasks.week)) out.push({ texto: r.it.name + (r.parent ? ' (' + r.parent.name + ')' : ''), resp: '', fecha: r.due, fuente: 'tarea', ref: { a: 'open-item', id: r.it.id } });
  return out.slice(0, 12);
}

function weekLabel() {
  const ws = mondayOf(todayISO()), we = addDays(ws, 6);
  const [, m1, d1] = ws.split('-').map(Number), [, m2, d2] = we.split('-').map(Number);
  return 'Semana del ' + d1 + (m1 !== m2 ? ' de ' + MONTHS_L[m1 - 1] : '') + ' al ' + d2 + ' de ' + MONTHS_L[m2 - 1];
}

function pendingHTML(d, compact) {
  const cur = d.weekly && d.weekly.week === mondayOf(todayISO());
  const src = (f) => '<span class="src">' + esc(f || '') + '</span>';
  const meta = (p) => [p.resp, p.fecha ? fmtDate(p.fecha) : ''].filter(Boolean).join(' · ');
  const key = d.ctx.item ? 'data-item="' + esc(d.ctx.item.id) + '"' : 'data-board="' + esc(d.ctx.board.id) + '"';
  const aiBtn = (label, cls) => S.caps.ai ? '<button class="btn sm' + (cls || '') + '" data-a="cw-ai" ' + key + '>' + ic('spark', 13) + label + '</button>' : '';
  let h = '';
  if (d.weekly) {
    const w = d.weekly;
    if (!cur) h += '<p class="muted cw-stale">' + ic('clock', 13) + ' Este resumen es de la semana del ' + fmtDate(w.week) + '. ' + (S.caps.ai ? 'Actualízalo para ver lo de esta semana.' : '') + '</p>';
    if (w.estado) h += '<p class="cw-estado">' + esc(w.estado) + '</p>';
    h += (w.pendientes || []).length ? '<ul class="cw-list">' + w.pendientes.map((p) => '<li><span>' + esc(p.texto) + (meta(p) ? '<small>' + esc(meta(p)) + '</small>' : '') + '</span>' + src(p.fuente) + '</li>').join('') + '</ul>' : '<p class="muted">No quedó nada pendiente.</p>';
    if (!compact && (w.riesgos || []).length) h += '<div class="cw-risks"><b>' + ic('alert', 13) + ' Riesgos</b><ul>' + w.riesgos.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul></div>';
    if (w.proxima) h += '<p class="cw-next"><b>Próxima acción:</b> ' + esc(w.proxima) + '</p>';
    h += '<div class="cw-foot"><span class="muted">Resumido ' + relTime(w.at) + ' con ' + (w.n ? (w.n.up || 0) + ' comentarios y ' + (w.n.tx || 0) + ' reuniones' : 'la actividad reciente') + '.</span>' + aiBtn('Actualizar', ' ghost') + '</div>';
    return h;
  }
  const fb = pendingFallback(d);
  h += fb.length ? '<ul class="cw-list">' + fb.map((p) => '<li><button class="lk" data-a="' + p.ref.a + '" data-id="' + esc(p.ref.id) + '">' + esc(p.texto) + '</button>' + (meta(p) ? '<small>' + esc(meta(p)) + '</small>' : '') + src(p.fuente) + '</li>').join('') + '</ul>' : '<p class="muted" style="margin:0 0 8px">No hay tareas con fecha ni acciones abiertas de reuniones recientes.</p>';
  h += '<div class="cw-foot">' + (S.caps.ai
    ? '<span class="muted">Para sumar lo que se habló en comentarios y reuniones, resume la semana con IA.</span>' + aiBtn('Resumir la semana con IA', ' primary')
    : '<span class="muted">' + (S.caps.server ? 'Con la clave de IA en config.php, aquí aparece un resumen de comentarios y reuniones.' : 'El resumen con IA no está disponible en esta vista.') + '</span>') + '</div>';
  return h;
}

function kpi(label, value, sub, cls) { return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><span class="k">' + label + '</span><span class="v">' + value + '</span>' + (sub ? '<span class="s">' + sub + '</span>' : '') + '</div>'; }
function weekKpis(d) {
  const t = d.tasks, ws = mondayOf(todayISO());
  const upsWeek = d.act.ups.filter((u) => String(u.created).slice(0, 10) >= ws).length;
  const txWeek = d.act.txs.filter((x) => String(x.date || x.created).slice(0, 10) >= ws).length;
  return '<div class="kpis cw-kpis">' +
    kpi('Tareas abiertas', t.open.length, t.week.length + ' vencen esta semana') +
    kpi('Vencidas', t.over.length, t.over.length ? 'desde el ' + fmtDate(t.over[0].due) : 'ninguna', t.over.length ? 'alert' : '') +
    kpi('Hechas esta semana', t.doneWeek.length, 'tareas cerradas') +
    kpi('Último contacto', d.days === null ? '—' : d.days === 0 ? 'Hoy' : d.days === 1 ? 'Ayer' : 'Hace ' + d.days + ' d', upsWeek + ' comentarios y ' + txWeek + ' reuniones esta semana', d.days !== null && d.days > 10 ? 'warn' : '') +
    '</div>';
}

function recordHTML(d) {
  const f = (label, v) => v ? '<div class="cw-f"><span>' + label + '</span><b>' + (v.color ? '<span class="chip" style="background:' + esc(v.color) + ';color:' + inkFor(v.color) + '">' + esc(v.text) + '</span>' : esc(v.text)) + '</b></div>' : '';
  const ctx = d.ctx;
  let h = '';
  h += f('Prioridad', recordField(ctx, /prioridad/i, 'status'));
  h += f('Estado', recordField(ctx, /^estado$/i, 'status'));
  h += f('Responsable', recordField(ctx, /responsable/i, 'people'));
  h += f('Reuniones', recordField(ctx, /frecuencia de reuni/i));
  h += f('Revisión', recordField(ctx, /frecuencia de revisi/i));
  h += f('Contacto', recordField(ctx, /contacto/i, 'text'));
  const next = d.tasks.meetings[0];
  if (next) h += '<div class="cw-f"><span>Próxima reunión</span><b><button class="lk" data-a="open-item" data-id="' + esc(next.it.id) + '">' + esc(fmtDate(next.due)) + ' · ' + esc(next.it.name) + '</button></b></div>';
  const drive = recordField(ctx, /drive/i, 'link');
  const links = [];
  if (ctx.item) links.push('<button class="btn sm" data-a="open-item" data-id="' + esc(ctx.item.id) + '">' + ic('user', 13) + 'Ficha</button>');
  if (drive && safeUrl(drive.text)) links.push('<a class="btn sm" href="' + esc(safeUrl(drive.text)) + '" target="_blank" rel="noopener">' + ic('open', 13) + 'Drive</a>');
  if (ctx.item) links.push('<button class="btn sm ghost" data-a="p-tx" data-id="' + esc(ctx.item.id) + '">' + ic('mic', 13) + 'Agregar reunión</button>');
  return (h || '<p class="muted" style="margin:0">' + (ctx.item ? 'La ficha no tiene datos todavía.' : 'Este tablero no está unido a una ficha de cliente.') + '</p>') + (links.length ? '<div class="cw-links">' + links.join('') + '</div>' : '');
}

function activityHTML(d) {
  const rows = d.act.ups.slice(0, 6).map((u) => ({ at: u.created, a: 'open-item', id: u.item, icon: 'chat', who: authorName(u), where: (getItem(u.item) || {}).name || '', text: String(u.body || '').replace(/\s+/g, ' ').slice(0, 180) }))
    .concat(d.act.txs.slice(0, 3).map((x) => ({ at: x.date || x.created, a: 'open-tx', id: x.id, icon: 'mic', who: 'Reunión', where: x.title || '', text: String(x.summary || x.body || '').replace(/\s+/g, ' ').slice(0, 180) })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 7);
  if (!rows.length) return '<div class="empty-state"><b>Sin comentarios ni reuniones.</b><span>Las actualizaciones de sus tareas y las transcripciones vinculadas a este cliente aparecen aquí.</span></div>';
  return '<div class="cw-act">' + rows.map((r) => '<button class="cw-a" data-a="' + r.a + '" data-id="' + esc(r.id) + '">' + ic(r.icon, 14) + '<span><b>' + esc(r.who) + '</b>' + (r.where ? ' · ' + esc(r.where) : '') + '<small>' + esc(r.text) + '</small></span><span class="d">' + (String(r.at).length > 10 ? relTime(r.at) : fmtDate(r.at)) + '</span></button>').join('') + '</div>';
}

function tasksHTML(d) {
  const rows = d.tasks.over.concat(d.tasks.week);
  if (!rows.length) return '<div class="empty-state"><b>Nada vencido ni por vencer esta semana.</b><span>Se cuentan las tareas con fecha o cronograma del tablero del cliente.</span></div>';
  const t = todayISO();
  return '<div class="due-list">' + rows.slice(0, 12).map((r) => '<button class="due" data-a="open-item" data-id="' + esc(r.it.id) + '"><span class="dt' + (r.due < t ? ' over' : r.due === t ? ' today' : '') + '">' + fmtDate(r.due) + '</span><span class="t">' + esc(r.it.name) + (r.parent ? ' <span class="muted">· ' + esc(r.parent.name) + '</span>' : '') + '</span></button>').join('') + '</div>' + (rows.length > 12 ? '<p class="muted" style="margin:8px 0 0;font-size:13px">y ' + (rows.length - 12) + ' más</p>' : '');
}

/* Vista completa, como pestaña del tablero del cliente */
function renderClientWeek(b) {
  const d = clientWeekData(b);
  return '<div class="cw page">' +
    '<div class="cw-head"><div><h2>' + esc(d.ctx.name) + ' en la semana</h2><p class="muted">' + esc(weekLabel()) + '</p></div>' + healthChip(d.k) + '</div>' +
    (d.why.length ? '<p class="cw-why">' + esc(d.why.join(' · ')) + '</p>' : '') +
    weekKpis(d) +
    '<div class="cols2 even"><section class="box"><h2>' + ic('pulse', 15) + ' Lo pendiente esta semana</h2>' + pendingHTML(d) + '</section>' +
    '<section class="box"><h2>' + ic('user', 15) + ' Estado del cliente</h2>' + recordHTML(d) + '</section></div>' +
    '<div class="cols2 even"><section class="box"><h2>Tareas vencidas y de la semana</h2>' + tasksHTML(d) + '</section>' +
    '<section class="box"><h2>Últimos comentarios y reuniones</h2>' + activityHTML(d) + '</section></div>' +
    '</div>';
}

/* Versión compacta, como pestaña de la ficha del cliente */
function clientWeekPanel(it) {
  const d = clientWeekData(it);
  return '<div class="cw cw-compact"><div class="cw-head"><div><h3 style="margin:0">' + esc(weekLabel()) + '</h3></div>' + healthChip(d.k) + '</div>' +
    (d.why.length ? '<p class="cw-why">' + esc(d.why.join(' · ')) + '</p>' : '') + weekKpis(d) +
    '<div class="sec-h"><h3>Lo pendiente</h3></div>' + pendingHTML(d, true) +
    '<div class="sec-h"><h3>Últimos comentarios y reuniones</h3></div>' + activityHTML(d) +
    (d.ctx.board ? '<div style="margin-top:14px"><button class="btn sm" data-a="cw-open" data-id="' + esc(d.ctx.board.id) + '">' + ic('board', 13) + 'Ver la semana completa</button></div>' : '') + '</div>';
}
ACT['cw-open'] = (t) => { S.panel = null; go({ view: 'board', id: t.dataset.id, mode: 'week' }); };

ACT['cw-ai'] = async (t) => {
  if (!A.ai) return;
  const x = t.dataset.item ? getItem(t.dataset.item) : getBoard(t.dataset.board);
  if (!x) return;
  const d = clientWeekData(x);
  const today = todayISO(), ws = mondayOf(today);
  let ups = d.act.ups.filter((u) => String(u.created).slice(0, 10) >= addDays(today, -14)).slice(0, 30);
  let txs = d.act.txs.filter((r) => String(r.date || r.created).slice(0, 10) >= addDays(today, -21)).slice(0, 4);
  const old = !ups.length && !txs.length;  // sin actividad reciente: se usa lo último registrado
  if (old) { ups = d.act.ups.slice(0, 12); txs = d.act.txs.slice(0, 2); }
  const open = d.tasks.over.concat(d.tasks.week, d.tasks.open.filter((r) => !r.due)).slice(0, 25);
  if (!ups.length && !txs.length && !open.length) { toast('No hay comentarios, reuniones ni tareas abiertas recientes para resumir'); return; }
  t.disabled = true; const label = t.innerHTML; t.innerHTML = ic('spark', 13) + 'Resumiendo…';
  const cut = (s, n) => { s = String(s || '').replace(/\s+\n/g, '\n').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const prompt = 'Eres el asistente de SARAHI, una agencia de marketing digital (Meta Ads y Google Ads). Hoy es ' + today + ' (semana del ' + ws + ' al ' + addDays(ws, 6) + ').\n' +
    'Lee la actividad del cliente «' + d.ctx.name + '» y resume en español lo que QUEDA PENDIENTE esta semana.\n' +
    'Devuelve SOLO un JSON con esta forma:\n' +
    '{"estado":"una frase sobre cómo está el cliente y la cuenta esta semana","pendientes":[{"texto":"verbo en infinitivo + qué falta","responsable":"nombre o vacío","fecha":"AAAA-MM-DD o vacío","fuente":"reunión|comentario|tarea"}],"riesgos":["…"],"proxima_accion":"la acción más importante de la semana"}\n' +
    'Reglas: máximo 8 pendientes, ordenados por urgencia; no repitas; no incluyas lo que un comentario posterior da por resuelto; no inventes datos, fechas ni responsables; "riesgos" puede ir vacío.\n\n' +
    'TAREAS ABIERTAS DEL TABLERO:\n' + (open.length ? open.map((r) => '- ' + r.it.name + (r.parent ? ' (dentro de ' + r.parent.name + ')' : '') + (r.due ? ' · fecha ' + r.due + (r.due < today ? ' (VENCIDA)' : '') : '')).join('\n') : '(ninguna)') + '\n\n' +
    (old ? 'OJO: no hay comentarios ni reuniones en las últimas 2 semanas; abajo va lo último registrado. Dilo en "estado" y extrae solo lo que siga abierto.\n\n' : '') +
    'COMENTARIOS ' + (old ? 'MÁS RECIENTES' : 'DE LOS ÚLTIMOS 14 DÍAS') + ' (más recientes primero):\n' + (ups.length ? ups.map((u) => '- ' + String(u.created).slice(0, 10) + ' · ' + authorName(u) + ' · en «' + ((getItem(u.item) || {}).name || '') + '»: ' + cut(u.body, 700)).join('\n') : '(ninguno)') + '\n\n' +
    'REUNIONES ' + (old ? 'MÁS RECIENTES' : 'DE LAS ÚLTIMAS 3 SEMANAS') + ':\n' + (txs.length ? txs.map((r) => '### ' + (r.date || '') + ' · ' + (r.title || 'Reunión') + '\n' + (r.summary ? 'Resumen: ' + cut(r.summary, 1200) + '\n' : '') + ((r.actions || []).length ? 'Acciones acordadas: ' + r.actions.map((a) => a.text + (a.owner ? ' (' + a.owner + ')' : '') + (a.due ? ' para ' + a.due : '')).join('; ') + '\n' : '') + 'Transcripción (extracto): ' + cut(r.body, r.summary ? 2500 : 6000)).join('\n\n') : '(ninguna)');
  try {
    const r = await A.ai(prompt, { json: true });
    if (!r || typeof r !== 'object') throw new Error('La IA no devolvió un resumen válido');
    const w = { week: ws, at: nowISO(), estado: String(r.estado || ''), pendientes: (Array.isArray(r.pendientes) ? r.pendientes : []).filter((p) => p && p.texto).slice(0, 10).map((p) => ({ texto: String(p.texto), resp: String(p.responsable || ''), fecha: parseDateLoose(p.fecha) || '', fuente: String(p.fuente || '') })),
      riesgos: (Array.isArray(r.riesgos) ? r.riesgos : []).map(String).filter(Boolean).slice(0, 5), proxima: String(r.proxima_accion || ''), n: { up: ups.length, tx: txs.length, tasks: open.length } };
    if (d.ctx.item) await patch('items', d.ctx.item.id, { weekly: w }); else await patch('boards', d.ctx.board.id, { weekly: w });
    toast('Resumen de la semana listo');
  } catch (e) { toast(e.message || 'No se pudo resumir'); t.disabled = false; t.innerHTML = label; }
};

/* SARAHI OS — reuniones automáticas: las «Notas de Gemini» de Google Meet llegan solas a Transcripciones,
   con resumen, acuerdos y próximos pasos, y vinculadas al cliente que corresponde.
   - En el artefacto: el navegador las trae de Google Drive con tu conector (al abrir y con «Revisar ahora»).
   - En el subdominio: un script de Google (Apps Script) las envía cada 15 minutos (Ajustes → Reuniones automáticas).
   parseMeetingNotes() se usa en los dos lados: build.py la copia tal cual dentro del script de Google. */

/*<meet-parser>*/
function parseMeetingNotes(raw, fileName, createdISO) {
  var text = String(raw || '').replace(/\r/g, '').replace(/\\([\[\]*_#()>.-])/g, '$1');
  var fold = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
  var clean = function (s) { return String(s || '').replace(/\[([^\]]+)\]\((?:https?|mailto):[^)]*\)/g, '$1').replace(/\*\*|__|\*/g, '').replace(/\s+/g, ' ').trim(); };
  var out = { summary: [], agreements: [], debate: [], actions: [], points: [], details: [], transcript: [], emails: [], heading: '' };
  var sec = '', sub = '', inTx = false, pendingHead = '';
  text.split('\n').forEach(function (ln) {
    var h = ln.match(/^\s*(#{1,4})\s*(.+?)\s*$/);
    if (h) {
      var t = fold(clean(h[2]));
      if (h[1].length === 1 && /transcrip/.test(t)) { inTx = true; return; }
      if (inTx) { out.transcript.push(clean(h[2])); return; }
      if (/^(resumen|summary)\b/.test(t)) { sec = 'summary'; sub = ''; }
      else if (/^(decisiones|decisions)\b/.test(t)) { sec = 'decisions'; sub = ''; }
      else if (/^(proximos pasos|siguientes pasos|next steps|acciones)/.test(t)) sec = 'actions';
      else if (/^(detalles|details)\b/.test(t)) sec = 'details';
      else if (sec === 'decisions' && /acordad|agreed|aligned/.test(t)) sub = 'agreed';
      else if (sec === 'decisions' && /debate|discussion|discusion|abiert/.test(t)) sub = 'debate';
      else if (!sec && h[1].length >= 2 && !out.heading) out.heading = clean(h[2]);
      return;
    }
    var s = ln.trim();
    if (!s) return;
    if (inTx) { out.transcript.push(clean(s)); return; }
    var b = s.match(/^[-*•]\s+(.*)$/);
    if (sec === 'summary') {
      if (/^\*\*[^*]+\*\*$/.test(s)) { pendingHead = clean(s); return; }
      out.summary.push(pendingHead ? pendingHead + ': ' + clean(s) : clean(s)); pendingHead = '';
    } else if (sec === 'decisions' && b) {
      var bm = b[1].match(/^\*\*(.+?)\*\*\s*(.*)$/);
      (sub === 'debate' ? out.debate : out.agreements).push(bm && bm[2] ? clean(bm[1]).replace(/[.:]$/, '') + ': ' + clean(bm[2]) : clean(b[1]));
    } else if (sec === 'actions' && b) {
      var a = clean(b[1]); var m = a.match(/^\[([^\]]+)\]\s*(.+)$/);
      out.actions.push(m ? { owner: m[1].trim(), text: m[2].trim() } : { owner: '', text: a });
    } else if (sec === 'details') {
      if (/^-{3,}$/.test(s)) return;
      var d = clean(s).replace(/\s*\(\d{1,2}:\d{2}(?::\d{2})?\)/g, '');
      var pm = d.match(/^([^:]{4,140}):\s/);
      if (pm) out.points.push(pm[1]);
      out.details.push(d);
    } else if (!sec && /^(invitad|invited|participant)/i.test(s)) {
      out.emails = (s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).map(function (e) { return e.toLowerCase(); });
    }
  });
  var name = String(fileName || '');
  var dm = name.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  var date = dm ? dm[1] + '-' + dm[2] + '-' + dm[3] : String(createdISO || '').slice(0, 10);
  var title = name.replace(/\s*-\s*(Notas de Gemini|Notes by Gemini)\s*$/i, '').replace(/\s*-\s*\d{4}\/\d{2}\/\d{2}[^-]*$/, '').trim();
  var generic = !title || /^(reuni[oó]n iniciada|meeting started|reuni[oó]n del)/i.test(title);
  if (generic) title = (out.heading || title).replace(/\s+a las\s+.*$/i, '').replace(/\s+at\s+\d.*$/i, '').replace(/\s*-\s*Transcripci[oó]n$/i, '').trim();
  var tx = out.transcript.join('\n');
  var body = out.details.join('\n\n') + (tx ? '\n\n— Transcripción —\n' + tx : '');
  return {
    title: title || 'Reunión', generic: generic, date: date, emails: out.emails,
    summary: out.summary.join('\n'), agreements: out.agreements, debate: out.debate, points: out.points.slice(0, 12),
    actions: out.actions.slice(0, 25), body: body.slice(0, 150000), hasTranscript: !!tx,
  };
}
/*</meet-parser>*/

/* ---------- a qué cliente pertenece la reunión */
const MEET_STOP = /^(internacional|international|sarahi|spa|ltda|limitada|chile|espana|spain|group|grupo|the|de|del|la|el|los|las|y|and|x|s a|sa)$/;
const FREE_MAIL = /^(gmail|hotmail|outlook|live|yahoo|icloud|me|msn|protonmail|sarahiagency|jorgeurra)\./;
function squash(s) { return norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/(.)\1+/g, '$1').replace(/\s+/g, ' ').trim(); }
function aliasesOf(name) {
  const set = new Set();
  const add = (s) => { const w = squash(s).split(' ').filter((x) => x && !MEET_STOP.test(x)).join(' '); if (w.length >= 3) set.add(w); };
  add(name);
  String(name || '').split(/\s*(?:&|\/|\+|,|\s-\s|\sy\s|\sx\s)\s*/i).forEach(add);
  return Array.from(set);
}
function clientCandidates() {
  const st = settings(); const out = [];
  const cb = getBoard(st.clientsBoard);
  const emailCol = cb && (cb.columns || []).find((c) => c.type === 'email');
  if (cb) for (const it of boardItems(cb.id)) {
    const b = clientBoardFor(it);
    const mails = [].concat(emailCol && it.values ? it.values[emailCol.id] || [] : []);
    out.push({ link: { board: cb.id, item: it.id }, name: it.name, aliases: Array.from(new Set(aliasesOf(it.name).concat(b ? aliasesOf(b.name) : []))), domains: mails.map((m) => String(m).split('@')[1] || '').filter(Boolean) });
  }
  for (const b of boardsSorted()) if (isClientBoard(b) && !b.clientItem && !out.some((o) => o.aliases.includes(aliasesOf(b.name)[0]))) out.push({ link: { board: b.id }, name: b.name, aliases: aliasesOf(b.name), domains: [] });
  return out;
}
function matchClient(p) {
  const cands = clientCandidates(); if (!cands.length) return null;
  const T = ' ' + squash(p.title) + ' ';
  const B = ' ' + squash(String(p.summary || '') + ' ' + String(p.body || '').slice(0, 40000)) + ' ';
  const doms = (p.emails || []).map((e) => e.split('@')[1] || '').filter((d) => d && !FREE_MAIL.test(d));
  const scored = cands.map((c) => {
    let s = 0;
    for (const a of c.aliases) {
      if (T.includes(' ' + a + ' ')) s += 10;
      const k = a.replace(/ /g, '');
      if (doms.some((d) => d.split('.')[0].replace(/[^a-z0-9]/g, '') === k || (k.length >= 5 && d.replace(/[^a-z0-9]/g, '').includes(k)))) s += 6;
      let n = 0, i = B.indexOf(' ' + a + ' ');
      while (i >= 0 && n < 8) { n++; i = B.indexOf(' ' + a + ' ', i + 1); }
      s += n;
    }
    if (c.domains.some((d) => doms.includes(d))) s += 6;
    return { c, s };
  }).sort((a, b) => b.s - a.s);
  const [best, second] = scored;
  if (!best || best.s < 2 || (second && second.s * 1.5 > best.s)) return null;
  return best.c;
}

function meetingDoc(p, cl, src, prev) {
  const title = p.generic && cl ? cl.name + ' · reunión del ' + fmtDate(p.date) : p.title;
  const keepLink = prev && prev.linkManual;
  return {
    title: prev && prev.titleManual ? prev.title : title, date: p.date,
    participants: (p.emails || []).filter((e) => !/sarahiagency|jorgeurra/.test(e)).join(', '),
    link: keepLink ? prev.link : (cl ? cl.link : null), linkManual: !!keepLink,
    body: p.body, summary: p.summary, points: p.points, agreements: p.agreements.concat((p.debate || []).map((d) => 'Por definir: ' + d)),
    actions: p.actions.map((a, i) => { const old = prev && (prev.actions || []).find((o) => o.text === a.text); return { id: old ? old.id : 'a' + i + Math.random().toString(36).slice(2, 6), text: a.text, owner: a.owner, due: '', taskId: old ? old.taskId || null : null }; }),
    next: '', summarizedAt: src.modified || nowISO(), source: 'gemini', sourceId: src.id, sourceUrl: src.url || '', sourceModified: src.modified || '',
    created: prev ? prev.created : nowISO(), updated: nowISO(), author: 'Google Meet', authorId: null,
  };
}

/* ---------- artefacto: traer de Google Drive con el conector del navegador */
const MEET_Q = "(title contains 'Notas de Gemini' or title contains 'Notes by Gemini') and mimeType = 'application/vnd.google-apps.document'";
const MEET_FROM = '2026-09-01T00:00:00Z';
async function importDriveMeetings(manual) {
  if (!A.drive || !isAdmin() || S.meetBusy) return;
  const st = settings().meetings || {};
  S.meetBusy = true; S.meetMsg = 'Revisando Google Meet…'; if (S.route.view === 'transcripts') render();
  let n = 0, mark = st.since || MEET_FROM;
  try {
    const files = []; let tok = null, guard = 0;
    do {
      const r = await A.drive.search(MEET_Q + " and modifiedTime > '" + mark + "'", tok);
      (r && r.files || []).forEach((f) => files.push(f));
      tok = r && r.nextPageToken; guard++;
    } while (tok && guard < 5);
    files.sort((a, b) => String(a.modifiedTime).localeCompare(String(b.modifiedTime)));
    const cutoff = new Date(Date.now() - 8 * 60000).toISOString();
    for (const f of files) {
      if (String(f.modifiedTime) > cutoff) break; // Gemini todavía puede estar escribiendo las notas
      const id = 'tg_' + f.id;
      const prev = S.data.transcripts[id];
      if (!prev || prev.sourceModified !== f.modifiedTime) {
        const r = await A.drive.read(f.id);
        const p = parseMeetingNotes(r && r.fileContent, (r && r.title) || f.title, f.createdTime);
        await put('transcripts', id, meetingDoc(p, matchClient(p), { id: f.id, url: (r && r.viewUrl) || f.viewUrl, modified: f.modifiedTime }, prev));
        n++;
      }
      mark = f.modifiedTime;
      if (n >= 25) break;
    }
    await patchMeta({ settings: { meetings: { since: mark, lastRun: nowISO(), lastCount: n } } });
    S.meetMsg = '';
    if (n || manual) toast(n ? (n === 1 ? '1 reunión nueva desde Google Meet' : n + ' reuniones nuevas desde Google Meet') : 'No hay reuniones nuevas en Google Meet');
  } catch (e) {
    const c = e && e.code;
    S.meetMsg = c === 'server_not_connected' ? 'Conecta Google Drive en claude.ai → Ajustes → Conectores para traer las reuniones.'
      : c === 'needs_reauth' ? 'Vuelve a conectar Google Drive en claude.ai → Ajustes → Conectores.'
      : (c === 'not_in_manifest' || c === 'approval_required' || c === 'not_granted') ? 'Falta tu permiso para leer Google Drive desde esta página.'
      : 'No se pudo revisar Google Meet ahora' + (e && e.message ? ': ' + e.message : '') + '.';
    if (n) await patchMeta({ settings: { meetings: { since: mark, lastRun: nowISO(), lastCount: n } } }).catch(() => {});
    if (manual || n) toast(S.meetMsg);
  } finally { S.meetBusy = false; if (S.route.view === 'transcripts') render(); }
}
function autoImportMeetings() {
  if (!A.drive || !isAdmin()) return;
  const st = settings().meetings || {};
  if (st.lastRun && Date.now() - new Date(st.lastRun).getTime() < 30 * 60000) return;
  setTimeout(() => importDriveMeetings(false), 2500);
}
ACT['meet-import'] = () => importDriveMeetings(true);

function meetBarHTML() {
  const st = settings().meetings || {};
  if (A.drive && isAdmin()) {
    const last = st.lastRun ? 'Última revisión ' + relTime(st.lastRun) : 'Todavía no se ha revisado';
    return '<div class="meet-bar">' + ic('mic', 13) + '<span>' + (S.meetBusy ? 'Revisando Google Meet…' : S.meetMsg ? esc(S.meetMsg) : 'Las notas de Google Meet llegan solas. ' + esc(last) + '.') + '</span><button class="btn sm ghost" data-a="meet-import"' + (S.meetBusy ? ' disabled' : '') + '>' + ic('refresh', 12) + 'Revisar</button></div>';
  }
  if (S.caps.server) {
    const n = Object.values(S.data.transcripts).filter((x) => x && x.source === 'gemini').length;
    return '<div class="meet-bar">' + ic('mic', 13) + '<span>' + (n ? 'Las notas de Google Meet llegan solas (' + n + ' recibidas).' : isAdmin() ? 'Haz que las reuniones de Google Meet lleguen solas: Ajustes → Reuniones automáticas.' : 'Las reuniones de Google Meet aparecen aquí solas cuando las activa el administrador.') + '</span></div>';
  }
  return '';
}

/* ---------- subdominio: script de Google que envía las notas (Ajustes) */
const MEET_SCRIPT = "/**\n * SARAHI OS — Reuniones de Google Meet → Transcripciones (automático)\n *\n * Qué hace: cada 15 minutos busca en tu Google Drive las «Notas de Gemini» nuevas o editadas,\n * saca el resumen, los acuerdos y los próximos pasos, y las envía a SARAHI OS. Allí quedan en\n * Transcripciones, vinculadas al cliente que corresponde.\n *\n * Cómo se instala (una sola vez):\n *   1. Pega este código en un proyecto nuevo de https://script.google.com con la cuenta de Google\n *      donde llegan tus notas de Gemini, y guarda.\n *   2. Arriba elige la función «instalar» y pulsa Ejecutar. Acepta los permisos (Drive y conexión externa).\n *   Listo: la primera vez trae también las reuniones desde DESDE.\n *\n * La dirección lleva la clave privada de SARAHI OS: no compartas este script.\n */\nvar URL_SARAHI_OS = '%%URL%%';\nvar DESDE = '2026-09-01T00:00:00';\nvar MAX_POR_VUELTA = 20;\n\nfunction instalar() {\n  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'revisarReuniones') ScriptApp.deleteTrigger(t); });\n  ScriptApp.newTrigger('revisarReuniones').timeBased().everyMinutes(15).create();\n  revisarReuniones();\n}\n\nfunction revisarReuniones() {\n  var props = PropertiesService.getScriptProperties();\n  var desde = props.getProperty('desde') || DESDE;\n  var q = \"(title contains 'Notas de Gemini' or title contains 'Notes by Gemini') and mimeType = 'application/vnd.google-apps.document' and modifiedDate > '\" + desde + \"'\";\n  var it = DriveApp.searchFiles(q), files = [];\n  while (it.hasNext()) files.push(it.next());\n  files.sort(function (a, b) { return a.getLastUpdated() - b.getLastUpdated(); });\n  var limite = new Date(Date.now() - 8 * 60 * 1000); // Gemini puede seguir escribiendo las notas unos minutos\n  var enviados = 0;\n  for (var i = 0; i < files.length && enviados < MAX_POR_VUELTA; i++) {\n    var f = files[i];\n    if (f.getLastUpdated() > limite) break;\n    var p = parseMeetingNotes(leerNotas(f), f.getName(), f.getDateCreated().toISOString());\n    p.sourceId = f.getId(); p.url = f.getUrl(); p.modified = f.getLastUpdated().toISOString(); p.source = 'gemini';\n    var r = UrlFetchApp.fetch(URL_SARAHI_OS, { method: 'post', contentType: 'application/json', payload: JSON.stringify(p), muteHttpExceptions: true });\n    if (r.getResponseCode() !== 200) { console.warn('SARAHI OS respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300)); break; }\n    props.setProperty('desde', Utilities.formatDate(f.getLastUpdated(), 'UTC', \"yyyy-MM-dd'T'HH:mm:ss\"));\n    enviados++;\n  }\n  console.log('Reuniones enviadas: ' + enviados);\n}\n\nfunction leerNotas(f) {\n  try {\n    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '/export?mimeType=text%2Fmarkdown',\n      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });\n    if (r.getResponseCode() === 200) return r.getContentText();\n  } catch (e) { /* se usa el texto plano */ }\n  var body = DocumentApp.openById(f.getId()).getBody(), out = [];\n  for (var i = 0; i < body.getNumChildren(); i++) {\n    var c = body.getChild(i), t = c.getText ? c.getText() : '';\n    if (!t) continue;\n    if (c.getType() === DocumentApp.ElementType.LIST_ITEM) out.push('- ' + t);\n    else if (c.getType() === DocumentApp.ElementType.PARAGRAPH && c.asParagraph().getHeading() !== DocumentApp.ParagraphHeading.NORMAL) out.push('### ' + t);\n    else out.push(t);\n  }\n  return out.join('\\n');\n}\n\n/* Lector de las notas (el mismo que usa SARAHI OS) */\nfunction parseMeetingNotes(raw, fileName, createdISO) {\n  var text = String(raw || '').replace(/\\r/g, '').replace(/\\\\([\\[\\]*_#()>.-])/g, '$1');\n  var fold = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim(); };\n  var clean = function (s) { return String(s || '').replace(/\\[([^\\]]+)\\]\\((?:https?|mailto):[^)]*\\)/g, '$1').replace(/\\*\\*|__|\\*/g, '').replace(/\\s+/g, ' ').trim(); };\n  var out = { summary: [], agreements: [], debate: [], actions: [], points: [], details: [], transcript: [], emails: [], heading: '' };\n  var sec = '', sub = '', inTx = false, pendingHead = '';\n  text.split('\\n').forEach(function (ln) {\n    var h = ln.match(/^\\s*(#{1,4})\\s*(.+?)\\s*$/);\n    if (h) {\n      var t = fold(clean(h[2]));\n      if (h[1].length === 1 && /transcrip/.test(t)) { inTx = true; return; }\n      if (inTx) { out.transcript.push(clean(h[2])); return; }\n      if (/^(resumen|summary)\\b/.test(t)) { sec = 'summary'; sub = ''; }\n      else if (/^(decisiones|decisions)\\b/.test(t)) { sec = 'decisions'; sub = ''; }\n      else if (/^(proximos pasos|siguientes pasos|next steps|acciones)/.test(t)) sec = 'actions';\n      else if (/^(detalles|details)\\b/.test(t)) sec = 'details';\n      else if (sec === 'decisions' && /acordad|agreed|aligned/.test(t)) sub = 'agreed';\n      else if (sec === 'decisions' && /debate|discussion|discusion|abiert/.test(t)) sub = 'debate';\n      else if (!sec && h[1].length >= 2 && !out.heading) out.heading = clean(h[2]);\n      return;\n    }\n    var s = ln.trim();\n    if (!s) return;\n    if (inTx) { out.transcript.push(clean(s)); return; }\n    var b = s.match(/^[-*•]\\s+(.*)$/);\n    if (sec === 'summary') {\n      if (/^\\*\\*[^*]+\\*\\*$/.test(s)) { pendingHead = clean(s); return; }\n      out.summary.push(pendingHead ? pendingHead + ': ' + clean(s) : clean(s)); pendingHead = '';\n    } else if (sec === 'decisions' && b) {\n      var bm = b[1].match(/^\\*\\*(.+?)\\*\\*\\s*(.*)$/);\n      (sub === 'debate' ? out.debate : out.agreements).push(bm && bm[2] ? clean(bm[1]).replace(/[.:]$/, '') + ': ' + clean(bm[2]) : clean(b[1]));\n    } else if (sec === 'actions' && b) {\n      var a = clean(b[1]); var m = a.match(/^\\[([^\\]]+)\\]\\s*(.+)$/);\n      out.actions.push(m ? { owner: m[1].trim(), text: m[2].trim() } : { owner: '', text: a });\n    } else if (sec === 'details') {\n      if (/^-{3,}$/.test(s)) return;\n      var d = clean(s).replace(/\\s*\\(\\d{1,2}:\\d{2}(?::\\d{2})?\\)/g, '');\n      var pm = d.match(/^([^:]{4,140}):\\s/);\n      if (pm) out.points.push(pm[1]);\n      out.details.push(d);\n    } else if (!sec && /^(invitad|invited|participant)/i.test(s)) {\n      out.emails = (s.match(/[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+/g) || []).map(function (e) { return e.toLowerCase(); });\n    }\n  });\n  var name = String(fileName || '');\n  var dm = name.match(/(\\d{4})\\/(\\d{2})\\/(\\d{2})/);\n  var date = dm ? dm[1] + '-' + dm[2] + '-' + dm[3] : String(createdISO || '').slice(0, 10);\n  var title = name.replace(/\\s*-\\s*(Notas de Gemini|Notes by Gemini)\\s*$/i, '').replace(/\\s*-\\s*\\d{4}\\/\\d{2}\\/\\d{2}[^-]*$/, '').trim();\n  var generic = !title || /^(reuni[oó]n iniciada|meeting started|reuni[oó]n del)/i.test(title);\n  if (generic) title = (out.heading || title).replace(/\\s+a las\\s+.*$/i, '').replace(/\\s+at\\s+\\d.*$/i, '').replace(/\\s*-\\s*Transcripci[oó]n$/i, '').trim();\n  var tx = out.transcript.join('\\n');\n  var body = out.details.join('\\n\\n') + (tx ? '\\n\\n— Transcripción —\\n' + tx : '');\n  return {\n    title: title || 'Reunión', generic: generic, date: date, emails: out.emails,\n    summary: out.summary.join('\\n'), agreements: out.agreements, debate: out.debate, points: out.points.slice(0, 12),\n    actions: out.actions.slice(0, 25), body: body.slice(0, 150000), hasTranscript: !!tx,\n  };\n}\n";
function meetSettingsHTML() {
  return '<section class="box"><h2>Reuniones automáticas (Google Meet)</h2>' +
    '<p>Las «Notas de Gemini» de cada reunión de Meet llegan solas a Transcripciones, con resumen, acuerdos y próximos pasos, y quedan vinculadas al cliente según el título, los correos de los invitados y lo que se habló. Así alimentan «La semana» de cada cliente.</p>' +
    '<ol class="steps"><li>Abre <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a> con la cuenta de Google donde llegan tus notas de Gemini.</li><li>Borra lo que aparece, pega el script y guarda.</li><li>Elige la función <b>instalar</b>, pulsa <b>Ejecutar</b> y acepta los permisos. Desde ahí revisa cada 15 minutos y trae también las reuniones desde el 1 de septiembre.</li></ol>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-a="meet-copy">' + ic('copy', 14) + 'Copiar el script</button><a class="btn" href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">' + ic('open', 14) + 'Abrir Apps Script</a></div>' +
    '<p class="muted" style="margin-top:10px;font-size:12.5px">El script lleva la clave privada del formulario: no lo compartas. Si generas una clave nueva, vuelve a copiarlo y pegarlo.</p></section>';
}
ACT['meet-copy'] = async () => {
  try {
    const w = await A.call('webhook_info');
    const url = String(w.url).replace('a=lead', 'a=meeting');
    const code = MEET_SCRIPT.replace('%%URL%%', url);
    await navigator.clipboard.writeText(code);
    toast('Script copiado. Pégalo en Apps Script y ejecuta «instalar».');
  } catch (e) { toast('No se pudo copiar: ' + (e.message || e)); }
};

/* Permisos en la interfaz (el servidor los hace cumplir de todos modos): «Solo clientes» trabaja en los
   elementos, pero no cambia columnas, grupos ni tableros. */
['add-col', 'add-group', 'add-status-col', 'board-menu', 'col-menu', 'grp-menu', 'new-board', 'folder-add', 'folder-del', 'folder-rename', 'ws-add', 'ws-rename', 'team-add', 'team-rm', 'quick-lead'].forEach((k) => {
  const f = ACT[k];
  if (f) ACT[k] = function (t, e) { if (!canStructure()) { toast('Solo un administrador puede cambiar la estructura de los tableros.'); return; } return f.apply(this, arguments); };
});
/* Arranque */
boot();

})();
