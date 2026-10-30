"use strict";
/* SARAHI CRM — interfaz. Sin dependencias: todo el contenido del usuario se inserta como texto (nunca innerHTML). */

const state = {
  me: null,
  workspaces: [],
  board: null,        // {id, name, columns, groups, subitems_board, ...}
  items: [],
  related: {},
  subitemCounts: {},
  view: "table",
  search: "",
  filter: null,       // {key, labelId}
  kanbanKey: null,
  navOpen: false,
};

const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ } },
};

// ---------- Utilidades ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401 && path !== "/api/auth/login") {
    state.me = null;
    renderLogin();
    throw new Error("Tu sesión expiró");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? "Datos no válidos" : "Ocurrió un error");
  }
  return data;
}

let toastTimer;
function toast(msg, isError) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 2800);
}

async function attempt(fn) {
  try { return await fn(); } catch (e) { toast(e.message, true); return undefined; }
}

const labelsOf = (col) => col.settings?.labels || [];
const labelById = (col, id) => labelsOf(col).find((l) => l.id === id);
const isAdmin = () => state.me?.role === "admin";
const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
const WS_COLORS = ["#0073ea", "#00a85a", "#a25ddc", "#e2445c", "#fdab3d", "#037f4c", "#579bfc"];
const TYPE_NAMES = {
  text: "Texto", long_text: "Texto largo", number: "Número", status: "Estado (etiquetas)", dropdown: "Lista desplegable",
  date: "Fecha", timeline: "Cronograma", email: "Email", phone: "Teléfono", link: "Enlace", checkbox: "Casilla",
  people: "Personas", relation: "Conectar tableros", file: "Archivos",
};
const PALETTE = ["#00c875", "#fdab3d", "#df2f4a", "#579bfc", "#a25ddc", "#037f4c", "#ffcb00", "#ff5ac4", "#007eb5", "#9cd326", "#757575", "#c4c4c4"];

function fmtNumber(n, col) {
  if (n === null || n === undefined || n === "") return "";
  const s = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(n);
  const unit = col?.settings?.unit;
  if (!unit) return s;
  return col.settings.unit_direction === "right" ? `${s} ${unit}` : `${unit}${s}`;
}

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(s) {
  if (!s) return "";
  return parseDate(s).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" });
}
const todayStr = () => new Date().toLocaleDateString("sv-SE");
// En columnas de seguimiento, una fecha vencida se marca en rojo
const isFollowUpColumn = (col) => /pr[oó]xim|seguimiento|vence|entrega|deadline/i.test(col.title);

function cellText(col, v) {
  if (v === null || v === undefined) return "";
  switch (col.type) {
    case "status": return labelById(col, v)?.label || "";
    case "dropdown": return v.map((id) => labelById(col, id)?.label || "").join(", ");
    case "number": return fmtNumber(v, col);
    case "date": return fmtDate(v);
    case "timeline": return `${fmtDate(v.from)} → ${fmtDate(v.to)}`;
    case "link": return v.text || v.url;
    case "people": return v.join(", ");
    case "relation": return v.map((id) => state.related[String(id)] || "").join(", ");
    case "file": return v.map((f) => f.name).join(", ");
    case "checkbox": return v ? "Sí" : "";
    default: return String(v);
  }
}

function searchText(item) {
  const cols = state.board.columns;
  return [item.name, ...cols.map((c) => cellText(c, item.values[c.key]))].join(" ").toLowerCase();
}

function visibleItems() {
  const q = state.search.trim().toLowerCase();
  return state.items.filter((it) => {
    if (state.filter) {
      const col = state.board.columns.find((c) => c.key === state.filter.key);
      const v = it.values[state.filter.key];
      if (!col) return true;
      if (state.filter.labelId === "") { if (v !== undefined && v !== null) return false; }
      else if (col.type === "status" ? v !== state.filter.labelId : !(v || []).includes(state.filter.labelId)) return false;
    }
    return !q || searchText(it).includes(q);
  });
}

// ---------- Popovers y modales ----------

let activePopover = null;
function closePopover() {
  if (activePopover) { activePopover.el.remove(); activePopover.onClose?.(); activePopover = null; }
}
function popover(anchor, content, onClose) {
  closePopover();
  const el = h("div", { class: "popover" }, content);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
  el.style.left = Math.max(8, left) + "px";
  el.style.top = top + "px";
  activePopover = { el, onClose };
  setTimeout(() => el.querySelector("input, textarea")?.focus(), 0);
  return el;
}
document.addEventListener("mousedown", (e) => {
  if (activePopover && !activePopover.el.contains(e.target)) closePopover();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (activePopover) closePopover();
  else if (document.querySelector(".overlay")) document.querySelector(".overlay").remove();
  else if (document.querySelector(".drawer")) closeDrawer();
});

function modal(title, body, actions) {
  const overlay = h("div", { class: "overlay", onmousedown: (e) => { if (e.target === overlay) overlay.remove(); } });
  const close = () => overlay.remove();
  const foot = h("div", { class: "modal-foot" });
  for (const a of actions) {
    foot.append(h("button", {
      class: "btn " + (a.kind || ""),
      text: a.label,
      onclick: async () => { const keep = await a.onClick?.(close); if (keep !== true && a.closes !== false) close(); },
    }));
  }
  overlay.append(h("div", { class: "modal", role: "dialog", "aria-label": title },
    h("div", { class: "modal-head" }, h("h2", { text: title }), h("button", { class: "icon-btn", text: "✕", "aria-label": "Cerrar", onclick: close })),
    h("div", { class: "modal-body" }, body), foot));
  document.body.append(overlay);
  setTimeout(() => overlay.querySelector("input, select, textarea")?.focus(), 0);
  return close;
}

function confirmDialog(title, text, okLabel, onOk) {
  modal(title, h("p", { text }), [
    { label: "Cancelar" },
    { label: okLabel, kind: "danger", onClick: onOk },
  ]);
}

function promptDialog(title, label, initial, onOk) {
  const input = h("input", { class: "input", value: initial || "" });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.closest(".modal").querySelector(".btn.primary").click(); });
  modal(title, h("label", { class: "field" }, label, input), [
    { label: "Cancelar" },
    { label: "Guardar", kind: "primary", onClick: async () => { const v = input.value.trim(); if (!v) return true; await onOk(v); } },
  ]);
}

// ---------- Login ----------

function renderLogin() {
  const email = h("input", { class: "input", type: "email", autocomplete: "username", required: true });
  const password = h("input", { class: "input", type: "password", autocomplete: "current-password", required: true });
  const error = h("p", { class: "error-text" });
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = "";
      try {
        state.me = await api("POST", "/api/auth/login", { email: email.value, password: password.value });
        await boot();
      } catch (err) { error.textContent = err.message; }
    },
  },
    h("label", { class: "field" }, "Email", email),
    h("label", { class: "field" }, "Contraseña", password),
    error,
    h("button", { class: "btn primary", type: "submit", text: "Entrar" }));
  document.getElementById("app").replaceChildren(h("div", { class: "login-wrap" },
    h("div", { class: "login-card" },
      h("div", { class: "logo" }, h("span", { class: "logo-mark", text: "S" }), "SARAHI CRM"),
      h("h1", { text: "Hola de nuevo" }),
      h("p", { text: "Ingresa para ver tus tableros." }),
      form)));
  email.focus();
}

// ---------- Layout ----------

async function boot() {
  if (!state.me) {
    try { state.me = await api("GET", "/api/me"); } catch { return renderLogin(); }
  }
  state.workspaces = await api("GET", "/api/workspaces");
  route();
}

function route() {
  closePopover();
  closeDrawer();
  const m = location.hash.match(/^#\/board\/(\d+)(?:\/item\/(\d+))?/);
  if (m) return openBoard(Number(m[1]), m[2] ? Number(m[2]) : null);
  if (location.hash === "#/admin" && isAdmin()) return renderAdmin();
  renderHome();
}
window.addEventListener("hashchange", () => { if (state.me) route(); });

function shell(main) {
  const layout = h("div", { class: "layout" + (state.navOpen ? " nav-open" : "") }, renderSidebar(), h("div", { class: "main" }, main));
  document.getElementById("app").replaceChildren(layout);
}

function renderSidebar() {
  const collapsed = new Set(store.get("collapsedNav", []));
  const toggle = (key) => {
    collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
    store.set("collapsedNav", [...collapsed]);
    document.querySelector(".sidebar").replaceWith(renderSidebar());
  };
  const boardLink = (b, inFolder) => h("a", {
    class: "nav-board" + (inFolder ? " in-folder" : "") + (state.board?.id === b.id && location.hash.startsWith("#/board/") ? " active" : ""),
    href: `#/board/${b.id}`,
    onclick: () => { state.navOpen = false; },
  }, h("span", { class: "bi", text: "▦" }), b.name);

  const nav = h("nav", { class: "sidebar-nav", "aria-label": "Espacios de trabajo" });
  state.workspaces.forEach((ws, i) => {
    const key = "ws" + ws.id;
    const closed = collapsed.has(key);
    const head = h("div", { class: "ws-head", onclick: () => toggle(key) },
      h("span", { class: "caret" + (closed ? " closed" : ""), text: "▼" }),
      h("span", { class: "ws-icon", style: { background: WS_COLORS[i % WS_COLORS.length] }, text: initials(ws.name) }),
      h("span", { class: "name", text: ws.name, title: ws.name }),
      isAdmin() && h("button", { class: "icon-btn", text: "+", title: "Agregar", "aria-label": "Agregar al espacio",
        onclick: (e) => { e.stopPropagation(); workspaceMenu(e.currentTarget, ws); } }));
    const wrap = h("div", { class: "ws" }, head);
    if (!closed) {
      for (const f of ws.folders) {
        const fkey = "f" + f.id;
        const fclosed = collapsed.has(fkey);
        wrap.append(h("div", { class: "folder-head", onclick: () => toggle(fkey) },
          h("span", { class: "caret" + (fclosed ? " closed" : ""), text: "▼" }), "📁 ", f.name));
        if (!fclosed) f.boards.forEach((b) => wrap.append(boardLink(b, true)));
      }
      ws.boards.forEach((b) => wrap.append(boardLink(b, false)));
    }
    nav.append(wrap);
  });
  if (!state.workspaces.length) nav.append(h("p", { class: "empty", text: "No tienes espacios de trabajo todavía." }));

  return h("aside", { class: "sidebar" },
    h("div", { class: "sidebar-head" },
      h("a", { class: "logo", href: "#/" }, h("span", { class: "logo-mark", text: "S" }), "SARAHI CRM"),
      isAdmin() && h("button", { class: "icon-btn", text: "+", title: "Nuevo espacio de trabajo", "aria-label": "Nuevo espacio de trabajo",
        onclick: () => promptDialog("Nuevo espacio de trabajo", "Nombre", "", async (name) => {
          await attempt(async () => { await api("POST", "/api/workspaces", { name }); await refreshNav(); });
        }) }),
      h("button", { class: "icon-btn mobile-only", text: "✕", "aria-label": "Cerrar menú", onclick: () => toggleNav(false) })),
    nav,
    h("div", { class: "sidebar-foot" },
      h("span", { class: "avatar", text: initials(state.me.name) }),
      h("div", { class: "who" }, h("b", { text: state.me.name }), h("span", { text: isAdmin() ? "Administrador" : "Miembro" })),
      isAdmin() && h("a", { class: "icon-btn", href: "#/admin", title: "Usuarios y accesos", "aria-label": "Usuarios y accesos", text: "⚙" }),
      h("button", { class: "btn ghost sm", title: "Cerrar sesión", text: "Salir",
        onclick: async () => { await api("POST", "/api/auth/logout"); state.me = null; location.hash = ""; renderLogin(); } })));
}

function toggleNav(open) {
  state.navOpen = open;
  document.querySelector(".layout")?.classList.toggle("nav-open", open);
}

async function refreshNav() {
  state.workspaces = await api("GET", "/api/workspaces");
  document.querySelector(".sidebar")?.replaceWith(renderSidebar());
}

function workspaceMenu(anchor, ws) {
  popover(anchor, [
    h("div", { class: "opt", text: "▦  Nuevo tablero", onclick: () => { closePopover(); newBoardDialog(ws); } }),
    h("div", { class: "opt", text: "📁  Nueva carpeta", onclick: () => { closePopover(); promptDialog("Nueva carpeta", "Nombre", "", async (name) => {
      await attempt(async () => { await api("POST", "/api/folders", { workspace_id: ws.id, name }); await refreshNav(); });
    }); } }),
    h("div", { class: "opt", text: "✎  Renombrar espacio", onclick: () => { closePopover(); promptDialog("Renombrar espacio de trabajo", "Nombre", ws.name, async (name) => {
      await attempt(async () => { await api("PATCH", `/api/workspaces/${ws.id}`, { name }); await refreshNav(); });
    }); } }),
    ...ws.folders.map((f) => h("div", { class: "opt", text: `✎  Renombrar carpeta “${f.name}”`, onclick: () => { closePopover(); promptDialog("Renombrar carpeta", "Nombre", f.name, async (name) => {
      await attempt(async () => { await api("PATCH", `/api/folders/${f.id}`, { name }); await refreshNav(); });
    }); } })),
  ]);
}

function newBoardDialog(ws) {
  const name = h("input", { class: "input" });
  const label = h("input", { class: "input", value: "Elemento" });
  const folder = h("select", { class: "select" }, h("option", { value: "", text: "(sin carpeta)" }),
    ws.folders.map((f) => h("option", { value: f.id, text: f.name })));
  modal("Nuevo tablero", [
    h("label", { class: "field" }, "Nombre del tablero", name),
    h("label", { class: "field" }, "¿Cómo se llama cada elemento? (Lead, Cliente, Tarea…)", label),
    h("label", { class: "field" }, "Carpeta", folder),
  ], [
    { label: "Cancelar" },
    { label: "Crear", kind: "primary", onClick: async () => {
      if (!name.value.trim()) return true;
      const b = await attempt(() => api("POST", "/api/boards", {
        workspace_id: ws.id, name: name.value.trim(), item_label: label.value.trim() || "Elemento",
        folder_id: folder.value ? Number(folder.value) : null,
      }));
      if (b) { await refreshNav(); location.hash = `#/board/${b.id}`; }
    } },
  ]);
}

// ---------- Inicio ----------

function renderHome() {
  state.board = null;
  const content = h("div", { class: "content" }, h("div", { class: "page" },
    state.workspaces.length ? state.workspaces.map((ws) => {
      const boards = [...ws.folders.flatMap((f) => f.boards), ...ws.boards];
      return [
        h("h2", { text: ws.name }),
        boards.length
          ? h("div", { class: "home-grid" }, boards.map((b) => h("a", { class: "home-card", href: `#/board/${b.id}` },
              h("b", { text: b.name }), h("span", { text: b.item_label }))))
          : h("p", { class: "empty", text: "Este espacio aún no tiene tableros." }),
      ];
    }) : h("div", { class: "empty" }, h("h2", { text: "Bienvenido" }),
      h("p", { text: isAdmin() ? "Crea tu primer espacio de trabajo con el botón + o importa tus datos desde Monday." : "Aún no tienes acceso a ningún espacio. Pídeselo al administrador." }))));
  shell([h("div", { class: "topbar", style: { paddingBottom: "14px" } },
    h("div", { class: "title-row" }, h("button", { class: "icon-btn mobile-only", text: "☰", "aria-label": "Menú", onclick: () => toggleNav(true) }),
      h("h1", { text: `Hola, ${state.me.name.split(" ")[0]}` }))), content]);
}

// ---------- Tablero ----------

async function openBoard(id, itemId) {
  const sameBoard = state.board?.id === id;
  if (!sameBoard) {
    const [board, data] = await Promise.all([api("GET", `/api/boards/${id}`), api("GET", `/api/boards/${id}/items`)]).catch((e) => { toast(e.message, true); return []; });
    if (!board) { location.hash = "#/"; return; }
    state.board = board;
    state.items = data.items;
    state.related = data.related;
    state.subitemCounts = data.subitem_counts;
    state.search = "";
    state.filter = null;
    state.view = store.get(`view:${id}`, "table");
    state.kanbanKey = store.get(`kanban:${id}`, board.columns.find((c) => c.type === "status")?.key || null);
  }
  // Abrir o cerrar la ficha de un elemento no vuelve a dibujar el tablero completo
  if (!sameBoard || !document.getElementById("view")) renderBoard();
  if (itemId) openDrawer(itemId);
}

async function reloadBoard() {
  const id = state.board.id;
  const [board, data] = await Promise.all([api("GET", `/api/boards/${id}`), api("GET", `/api/boards/${id}/items`)]);
  Object.assign(state, { board, items: data.items, related: data.related, subitemCounts: data.subitem_counts });
  renderView();
}

function renderBoard() {
  const b = state.board;
  const setView = (v) => { state.view = v; store.set(`view:${b.id}`, v); renderBoard(); };
  const search = h("input", { class: "input search", type: "search", placeholder: "Buscar…", value: state.search,
    oninput: (e) => { state.search = e.target.value; renderView(); } });
  const filterCols = b.columns.filter((c) => c.type === "status" || c.type === "dropdown");
  const toolbar = h("div", { class: "toolbar" },
    h("button", { class: "btn primary", text: `+ Nuevo ${b.item_label}`, onclick: () => quickAdd() }),
    search,
    filterCols.length ? h("button", { class: "btn", text: "⚲ Filtrar", onclick: (e) => filterMenu(e.currentTarget, filterCols) }) : null,
    state.filter ? filterChip() : null,
    h("span", { class: "spacer" }),
    state.view === "table" && h("button", { class: "btn", text: "+ Grupo", onclick: () => promptDialog("Nuevo grupo", "Nombre", "", async (title) => {
      await attempt(async () => { await api("POST", `/api/boards/${b.id}/groups`, { title, color: PALETTE[Math.floor(Math.random() * 8)] }); await reloadBoard(); });
    }) }),
    isAdmin() && h("button", { class: "btn", text: "+ Columna", onclick: () => columnDialog(null) }),
    h("a", { class: "btn", href: `/api/boards/${b.id}/export.csv`, text: "⤓ Exportar" }),
    isAdmin() && h("button", { class: "icon-btn", text: "⋯", title: "Opciones del tablero", "aria-label": "Opciones del tablero",
      onclick: (e) => boardMenu(e.currentTarget) }));

  const top = h("div", { class: "topbar" },
    h("div", { class: "crumb", text: b.workspace.name }),
    h("div", { class: "title-row" },
      h("button", { class: "icon-btn mobile-only", text: "☰", "aria-label": "Menú", onclick: () => toggleNav(true) }),
      h("h1", { text: b.name }),
      h("span", { class: "count", id: "item-count" })),
    h("div", { class: "tabs", role: "tablist" },
      [["table", "Tabla"], ["kanban", "Kanban"], ["summary", "Resumen"]].map(([v, label]) =>
        h("button", { class: "tab" + (state.view === v ? " active" : ""), role: "tab", "aria-selected": String(state.view === v), text: label, onclick: () => setView(v) }))));

  shell([top, toolbar, h("div", { class: "content", id: "view" })]);
  renderView();
}

function filterChip() {
  const col = state.board.columns.find((c) => c.key === state.filter.key);
  const label = state.filter.labelId === "" ? "(vacío)" : labelById(col, state.filter.labelId)?.label;
  return h("span", { class: "chip-filter" }, `${col?.title}: ${label}`,
    h("button", { text: "✕", "aria-label": "Quitar filtro", onclick: () => { state.filter = null; renderBoard(); } }));
}

function filterMenu(anchor, cols) {
  const body = h("div");
  const showCol = (col) => {
    const counts = {};
    for (const it of state.items) {
      const v = it.values[col.key];
      const ids = v === undefined || v === null ? [""] : col.type === "status" ? [v] : v;
      ids.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
    }
    body.replaceChildren(
      h("div", { class: "opt", text: "← Columnas", onclick: () => showCols() }), h("div", { class: "sep" }),
      ...labelsOf(col).map((l) => h("div", { class: "opt", onclick: () => { state.filter = { key: col.key, labelId: l.id }; closePopover(); renderBoard(); } },
        h("span", { class: "chip", style: { background: l.color, color: "#fff" }, text: l.label }), h("span", { style: { marginLeft: "auto", color: "var(--text-3)" }, text: counts[l.id] || 0 }))),
      h("div", { class: "opt", onclick: () => { state.filter = { key: col.key, labelId: "" }; closePopover(); renderBoard(); } },
        "(vacío)", h("span", { style: { marginLeft: "auto", color: "var(--text-3)" }, text: counts[""] || 0 })));
  };
  const showCols = () => body.replaceChildren(...cols.map((c) => h("div", { class: "opt", text: c.title, onclick: () => showCol(c) })));
  showCols();
  popover(anchor, body);
}

function boardMenu(anchor) {
  const b = state.board;
  popover(anchor, [
    h("div", { class: "opt", text: "✎  Renombrar tablero", onclick: () => { closePopover(); promptDialog("Renombrar tablero", "Nombre", b.name, async (name) => {
      await attempt(async () => { await api("PATCH", `/api/boards/${b.id}`, { name }); await refreshNav(); state.board.name = name; renderBoard(); });
    }); } }),
    h("div", { class: "opt", text: "✎  Nombre de los elementos", onclick: () => { closePopover(); promptDialog("¿Cómo se llama cada elemento?", "Ej.: Lead, Cliente, Oferta", b.item_label, async (item_label) => {
      await attempt(async () => { await api("PATCH", `/api/boards/${b.id}`, { item_label }); state.board.item_label = item_label; renderBoard(); });
    }); } }),
    h("div", { class: "opt", text: "⇄  Mover a otro espacio o carpeta", onclick: () => { closePopover(); moveBoardDialog(); } }),
    h("div", { class: "sep" }),
    h("div", { class: "opt", style: { color: "var(--danger)" }, text: "🗑  Eliminar tablero", onclick: () => { closePopover(); confirmDialog("Eliminar tablero",
      `Se eliminará “${b.name}” con todos sus elementos. No se puede deshacer.`, "Eliminar", async () => {
        await attempt(async () => { await api("DELETE", `/api/boards/${b.id}`); state.board = null; await refreshNav(); location.hash = "#/"; });
      }); } }),
  ]);
}

function moveBoardDialog() {
  const b = state.board;
  const select = h("select", { class: "select" });
  for (const ws of state.workspaces) {
    select.append(h("option", { value: `${ws.id}:`, text: ws.name }));
    ws.folders.forEach((f) => select.append(h("option", { value: `${ws.id}:${f.id}`, text: `${ws.name} / ${f.name}` })));
  }
  select.value = `${b.workspace.id}:${b.folder_id || ""}`;
  modal("Mover tablero", h("label", { class: "field" }, "Destino", select), [
    { label: "Cancelar" },
    { label: "Mover", kind: "primary", onClick: async () => {
      const [ws, folder] = select.value.split(":");
      await attempt(async () => {
        await api("PATCH", `/api/boards/${b.id}`, { workspace_id: Number(ws), folder_id: folder ? Number(folder) : null });
        await refreshNav();
        state.board = null;
        openBoard(b.id);
      });
    } },
  ]);
}

function renderView() {
  const view = document.getElementById("view");
  if (!view) return;
  const items = visibleItems();
  const count = document.getElementById("item-count");
  if (count) count.textContent = items.length === state.items.length ? `${items.length} ${state.board.item_label.toLowerCase()}s` : `${items.length} de ${state.items.length}`;
  if (state.view === "kanban") view.replaceChildren(renderKanban(items));
  else if (state.view === "summary") view.replaceChildren(renderSummary(items));
  else view.replaceChildren(...renderTable(items).flat().filter(Boolean));
}

// ---------- Vista tabla ----------

const COL_WIDTH = { long_text: 220, link: 200, email: 200, relation: 200, dropdown: 180, timeline: 200, text: 160, status: 150, file: 160 };
const colWidth = (c) => COL_WIDTH[c.type] || 140;
const nameWidth = () => (window.innerWidth < 860 ? 170 : 300);
const rowEls = new Map();

function renderTable(items) {
  const b = state.board;
  rowEls.clear();
  const collapsed = new Set(store.get(`collapsed:${b.id}`, []));
  const byGroup = new Map(b.groups.map((g) => [g.id, []]));
  const orphan = [];
  items.forEach((it) => (byGroup.get(it.group_id) || orphan).push(it));
  if (!b.groups.length && !items.length) {
    return [h("div", { class: "empty" }, h("h2", { text: "Tablero vacío" }), h("p", { text: "Crea un grupo para empezar." }))];
  }
  const groups = [...b.groups];
  if (orphan.length) groups.push({ id: null, title: "Sin grupo", color: "#c4c4c4" });

  return groups.map((g) => {
    const list = g.id === null ? orphan : byGroup.get(g.id);
    // Al buscar o filtrar se ocultan los grupos sin resultados
    if ((state.search || state.filter) && !list.length) return null;
    const isCollapsed = collapsed.has(g.id);
    const toggle = () => {
      isCollapsed ? collapsed.delete(g.id) : collapsed.add(g.id);
      store.set(`collapsed:${b.id}`, [...collapsed]);
      renderView();
    };
    const head = h("div", { class: "group-head" },
      h("button", { class: "icon-btn", style: { opacity: 1, color: g.color }, "aria-label": "Contraer grupo", onclick: toggle },
        h("span", { class: "caret" + (isCollapsed ? " closed" : ""), style: { color: g.color }, text: "▼" })),
      h("span", { class: "gtitle", style: { color: g.color }, text: g.title, onclick: toggle }),
      h("span", { class: "gcount", text: `${list.length}` }),
      g.id !== null && h("button", { class: "icon-btn", text: "⋯", "aria-label": "Opciones del grupo", onclick: (e) => groupMenu(e.currentTarget, g, list.length) }));
    if (isCollapsed) return h("div", { class: "group" }, head);

    const cols = b.columns;
    const colgroup = h("colgroup", {}, h("col", { style: { width: "6px" } }), h("col", { style: { width: nameWidth() + "px" } }),
      cols.map((c) => h("col", { style: { width: colWidth(c) + "px" } })));
    const thead = h("thead", {}, h("tr", {},
      h("th", { class: "strip", style: { background: g.color } }),
      h("th", { class: "name-col", text: b.item_label }),
      cols.map((c) => h("th", { class: isAdmin() ? "admin-col" : "", title: c.title, text: c.title,
        onclick: isAdmin() ? (e) => columnMenu(e.currentTarget, c) : null }))));
    const tbody = h("tbody");
    list.forEach((it) => tbody.append(renderRow(it, g.color)));
    tbody.append(sumRow(cols, list), addRow(g, cols.length));
    return h("div", { class: "group" }, head,
      h("div", { class: "table-wrap" }, h("table", { class: "board", style: { width: 6 + nameWidth() + cols.reduce((s, c) => s + colWidth(c), 0) + "px" } }, colgroup, thead, tbody)));
  });
}

function renderRow(item, color) {
  const subCount = state.subitemCounts[String(item.id)];
  const nameSpan = h("span", { class: "nm", text: item.name, title: item.name });
  nameSpan.addEventListener("click", () => editInline(nameSpan.parentElement, item.name, async (v) => {
    if (v && v !== item.name) await saveItem(item, { name: v });
  }, "text", () => renderRowAgain(item)));
  const tr = h("tr", { "data-id": item.id },
    h("td", { class: "strip", style: { background: color } }),
    h("td", { class: "name-col" }, h("div", { class: "name-cell" }, nameSpan,
      subCount ? h("span", { class: "sub-badge", text: `${subCount} sub`, title: "Subelementos", onclick: () => openItem(item.id) }) : null,
      h("button", { class: "btn sm open", text: "Abrir", onclick: () => openItem(item.id) }))),
    state.board.columns.map((c) => h("td", {}, renderCell(c, item))));
  const prev = rowEls.get(item.id);
  rowEls.set(item.id, tr);
  if (prev?.isConnected) prev.replaceWith(tr);
  return tr;
}

function renderRowAgain(item) {
  const prev = rowEls.get(item.id);
  if (!prev?.isConnected) return renderView();
  const color = prev.querySelector(".strip")?.style.background;
  renderRow(item, color);
}

function sumRow(cols, list) {
  const nums = cols.filter((c) => c.type === "number");
  if (!nums.length || !list.length) return h("tr", { hidden: true });
  return h("tr", { class: "sum-row" }, h("td", { class: "strip" }), h("td", { class: "name-col" }),
    cols.map((c) => {
      if (c.type !== "number") return h("td");
      const values = list.map((it) => it.values[c.key]).filter((v) => typeof v === "number");
      return h("td", { title: "Suma" }, values.length ? fmtNumber(values.reduce((a, v) => a + v, 0), c) : "");
    }));
}

function addRow(group, ncols) {
  if (group.id === null) return h("tr", { hidden: true });
  const input = h("input", { placeholder: `+ Agregar ${state.board.item_label.toLowerCase()}`, "aria-label": `Agregar ${state.board.item_label}` });
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    const name = input.value.trim();
    input.value = "";
    const item = await attempt(() => api("POST", `/api/boards/${state.board.id}/items`, { name, group_id: group.id }));
    if (item) { state.items.unshift(item); renderView(); document.querySelector(`tr[data-id="${item.id}"]`)?.closest("tbody")?.querySelector(".add-row input")?.focus(); }
  });
  return h("tr", { class: "add-row" }, h("td", { class: "strip" }), h("td", { class: "name-col", colspan: String(ncols + 1) }, input));
}

function groupMenu(anchor, g, count) {
  popover(anchor, [
    h("div", { class: "opt", text: "✎  Renombrar", onclick: () => { closePopover(); promptDialog("Renombrar grupo", "Nombre", g.title, async (title) => {
      await attempt(async () => { await api("PATCH", `/api/groups/${g.id}`, { title }); await reloadBoard(); });
    }); } }),
    h("div", { class: "opt", style: { flexWrap: "wrap" } }, PALETTE.map((color) => h("button", {
      class: "icon-btn", style: { background: color, width: "22px", height: "22px", borderRadius: "50%" }, "aria-label": `Color ${color}`,
      onclick: async () => { closePopover(); await attempt(async () => { await api("PATCH", `/api/groups/${g.id}`, { color }); await reloadBoard(); }); },
    }))),
    h("div", { class: "sep" }),
    h("div", { class: "opt", style: { color: "var(--danger)" }, text: "🗑  Eliminar grupo", onclick: () => {
      closePopover();
      if (count) return toast("Mueve o elimina los elementos del grupo antes de borrarlo", true);
      attempt(async () => { await api("DELETE", `/api/groups/${g.id}`); await reloadBoard(); });
    } }),
  ]);
}

async function quickAdd() {
  const g = state.board.groups[0];
  if (!g) return toast("Crea un grupo primero", true);
  promptDialog(`Nuevo ${state.board.item_label}`, "Nombre", "", async (name) => {
    const item = await attempt(() => api("POST", `/api/boards/${state.board.id}/items`, { name, group_id: g.id }));
    if (item) { state.items.unshift(item); renderView(); openItem(item.id); }
  });
}

async function saveItem(item, patch) {
  const updated = await attempt(() => api("PATCH", `/api/items/${item.id}`, patch));
  if (!updated) return null;
  Object.assign(item, updated);
  const idx = state.items.findIndex((i) => i.id === item.id);
  if (idx >= 0) state.items[idx] = item;
  return item;
}

async function saveValue(item, col, value) {
  const updated = await saveItem(item, { values: { [col.key]: value } });
  if (updated && item.parent_item_id === null) {
    if (state.view === "table") renderRowAgain(item);
    else renderView();
  }
  return updated;
}

// ---------- Celdas ----------

function editInline(container, initial, onSave, type, onDone) {
  const input = h("input", { class: "inline", type: type === "number" ? "text" : type || "text", value: initial ?? "" });
  if (type === "number") input.inputMode = "decimal";
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save) await onSave(input.value.trim());
    onDone?.();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") { e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
  container.replaceChildren(input);
  input.focus();
  if (input.select) input.select();
}

function renderCell(col, item, opts = {}) {
  const v = item.values[col.key];
  const refresh = () => (opts.onChange ? opts.onChange() : renderRowAgain(item));
  const save = async (value) => { await saveValue(item, col, value); if (opts.onChange) opts.onChange(); };
  const cell = h("div", { class: "cell" });

  switch (col.type) {
    case "status": {
      const l = v !== undefined ? labelById(col, v) : null;
      cell.classList.add("status-cell");
      if (l) { cell.style.background = l.color; cell.textContent = l.label; }
      else cell.classList.add("empty-status");
      cell.addEventListener("click", () => popover(cell, [
        ...labelsOf(col).map((lb) => h("div", { class: "opt label-opt" + (lb.id === v ? " selected" : ""), style: { background: lb.color }, text: lb.label,
          onclick: () => { closePopover(); save(lb.id); } })),
        h("div", { class: "sep" }),
        h("div", { class: "opt", text: "Vaciar", onclick: () => { closePopover(); save(null); } }),
      ]));
      return cell;
    }
    case "dropdown": {
      const ids = v || [];
      if (ids.length) cell.append(h("div", { class: "chips" }, ids.map((id) => h("span", { class: "chip", text: labelById(col, id)?.label || "" }))));
      cell.title = cellText(col, v);
      cell.addEventListener("click", () => dropdownPopover(cell, col, ids, save));
      return cell;
    }
    case "checkbox": {
      const box = h("input", { type: "checkbox", "aria-label": col.title });
      box.checked = !!v;
      box.addEventListener("change", () => save(box.checked));
      cell.classList.add("readonly");
      cell.append(box);
      return cell;
    }
    case "date": {
      if (v) {
        const late = isFollowUpColumn(col) && v < todayStr();
        const today = isFollowUpColumn(col) && v === todayStr();
        cell.append(h("span", { class: "txt" + (late ? " date-late" : today ? " date-today" : ""), text: fmtDate(v), title: late ? "Vencida" : null }));
      }
      cell.addEventListener("click", () => {
        const input = h("input", { class: "input", type: "date", value: v || "" });
        popover(cell, [input, h("div", { class: "pop-actions" },
          h("button", { class: "btn sm", text: "Hoy", onclick: () => { closePopover(); save(todayStr()); } }),
          h("button", { class: "btn sm", text: "Vaciar", onclick: () => { closePopover(); save(null); } }),
          h("button", { class: "btn sm primary", text: "Guardar", onclick: () => { closePopover(); save(input.value || null); } }))]);
      });
      return cell;
    }
    case "timeline": {
      if (v) cell.append(h("span", { class: "txt", text: cellText(col, v) }));
      cell.addEventListener("click", () => {
        const from = h("input", { class: "input", type: "date", value: v?.from || "" });
        const to = h("input", { class: "input", type: "date", value: v?.to || "" });
        popover(cell, [h("label", { class: "field" }, "Desde", from), h("label", { class: "field" }, "Hasta", to),
          h("div", { class: "pop-actions" },
            h("button", { class: "btn sm", text: "Vaciar", onclick: () => { closePopover(); save(null); } }),
            h("button", { class: "btn sm primary", text: "Guardar", onclick: () => { closePopover(); save({ from: from.value || null, to: to.value || null }); } }))]);
      });
      return cell;
    }
    case "long_text": {
      if (opts.wide) {
        const preview = h("div", { class: "long-preview", text: v || "Clic para escribir…", style: v ? null : { color: "var(--text-3)" } });
        preview.addEventListener("click", () => longTextPopover(preview, col, v, save));
        return preview;
      }
      cell.classList.add("left");
      if (v) cell.append(h("span", { class: "txt", text: v.split("\n")[0], title: v.slice(0, 500) }));
      cell.addEventListener("click", () => longTextPopover(cell, col, v, save));
      return cell;
    }
    case "link": {
      if (v) cell.append(h("a", { href: v.url, target: "_blank", rel: "noopener noreferrer", class: "txt", text: v.text || v.url, title: v.url,
        onclick: (e) => e.stopPropagation() }));
      cell.addEventListener("click", () => {
        const url = h("input", { class: "input", value: v?.url || "", placeholder: "https://…" });
        const text = h("input", { class: "input", value: v?.text || "", placeholder: "Texto a mostrar" });
        popover(cell, [h("label", { class: "field" }, "Enlace", url), h("label", { class: "field" }, "Texto", text),
          h("div", { class: "pop-actions" },
            h("button", { class: "btn sm", text: "Vaciar", onclick: () => { closePopover(); save(null); } }),
            h("button", { class: "btn sm primary", text: "Guardar", onclick: () => { closePopover(); save(url.value.trim() ? { url: url.value.trim(), text: text.value.trim() } : null); } }))]);
      });
      return cell;
    }
    case "relation": {
      const ids = v || [];
      if (ids.length) cell.append(h("div", { class: "chips" }, ids.map((id) => h("span", { class: "chip rel", text: state.related[String(id)] || "—" }))));
      cell.addEventListener("click", () => relationPopover(cell, col, ids, save));
      return cell;
    }
    case "file": {
      if (v?.length) cell.append(h("div", { class: "chips" }, v.map((f) => h("a", { class: "chip rel", href: f.url, target: "_blank", rel: "noopener noreferrer",
        text: f.name, onclick: (e) => e.stopPropagation() }))));
      cell.addEventListener("click", () => {
        const ta = h("textarea", { class: "textarea", placeholder: "Un enlace por línea (Drive, Dropbox…)", value: (v || []).map((f) => f.url).join("\n") });
        popover(cell, [ta, h("div", { class: "pop-actions" },
          h("button", { class: "btn sm primary", text: "Guardar", onclick: () => {
            closePopover();
            const files = ta.value.split("\n").map((s) => s.trim()).filter(Boolean).map((url) => ({ url, name: decodeURIComponent(url.split("/").pop() || url).slice(0, 60) }));
            save(files);
          } }))]);
      });
      return cell;
    }
    default: {
      // text, number, email, phone, people
      const display = cellText(col, v);
      if (col.type === "number") cell.style.fontVariantNumeric = "tabular-nums";
      if (display) {
        if (col.type === "email") cell.append(h("a", { href: `mailto:${v}`, class: "txt", text: v, onclick: (e) => e.stopPropagation() }));
        else if (col.type === "phone") cell.append(h("a", { href: `https://wa.me/${String(v).replace(/[^\d]/g, "")}`, target: "_blank", rel: "noopener noreferrer",
          class: "txt", text: v, title: "Abrir en WhatsApp", onclick: (e) => e.stopPropagation() }));
        else cell.append(h("span", { class: "txt", text: display, title: display }));
      }
      if (col.type === "text" || col.type === "people") cell.classList.add("left");
      cell.addEventListener("click", () => {
        const initial = col.type === "people" ? (v || []).join(", ") : v ?? "";
        editInline(cell, initial, async (val) => { if (val !== String(initial)) await save(val || null); },
          col.type === "email" ? "email" : col.type === "number" ? "number" : "text", () => { if (cell.isConnected) refresh(); });
      });
      return cell;
    }
  }
}

function longTextPopover(anchor, col, v, save) {
  const ta = h("textarea", { class: "textarea", style: { minHeight: "180px", width: "300px" }, value: v || "" });
  popover(anchor, [h("div", { style: { fontWeight: 600, marginBottom: "6px" }, text: col.title }), ta, h("div", { class: "pop-actions" },
    h("button", { class: "btn sm", text: "Cancelar", onclick: closePopover }),
    h("button", { class: "btn sm primary", text: "Guardar", onclick: () => { closePopover(); save(ta.value.trim() || null); } }))]);
}

function dropdownPopover(anchor, col, selected, save) {
  const chosen = new Set(selected);
  const filter = h("input", { class: "input", placeholder: "Buscar etiqueta…", style: { marginBottom: "6px" } });
  const list = h("div");
  const draw = () => list.replaceChildren(...labelsOf(col).filter((l) => l.label.toLowerCase().includes(filter.value.toLowerCase())).map((l) => {
    const box = h("input", { type: "checkbox" });
    box.checked = chosen.has(l.id);
    box.addEventListener("change", () => (box.checked ? chosen.add(l.id) : chosen.delete(l.id)));
    return h("label", { class: "opt" }, box, l.label);
  }));
  filter.addEventListener("input", draw);
  draw();
  popover(anchor, [filter, list, h("div", { class: "pop-actions" },
    h("button", { class: "btn sm primary", text: "Guardar", onclick: () => { closePopover(); save([...chosen]); } }))]);
}

async function relationPopover(anchor, col, selected, save) {
  const targetId = col.settings?.board_ids?.[0];
  if (!targetId) return toast("Esta columna no tiene un tablero conectado", true);
  const data = await attempt(() => api("GET", `/api/boards/${targetId}/items`));
  if (!data) return;
  const chosen = new Set(selected.map(Number));
  const filter = h("input", { class: "input", placeholder: "Buscar…", style: { marginBottom: "6px" } });
  const list = h("div");
  const draw = () => list.replaceChildren(...data.items.filter((i) => i.name.toLowerCase().includes(filter.value.toLowerCase())).slice(0, 80).map((i) => {
    const box = h("input", { type: "checkbox" });
    box.checked = chosen.has(i.id);
    box.addEventListener("change", () => { if (box.checked) { chosen.add(i.id); state.related[String(i.id)] = i.name; } else chosen.delete(i.id); });
    return h("label", { class: "opt" }, box, i.name);
  }));
  filter.addEventListener("input", draw);
  draw();
  popover(anchor, [filter, list, h("div", { class: "pop-actions" },
    h("button", { class: "btn sm primary", text: "Guardar", onclick: () => { closePopover(); save([...chosen]); } }))]);
}

// ---------- Columnas (admin) ----------

function columnMenu(anchor, col) {
  popover(anchor, [
    h("div", { style: { padding: "4px 8px", fontSize: "12px", color: "var(--text-3)" }, text: TYPE_NAMES[col.type] || col.type }),
    h("div", { class: "opt", text: "✎  Editar columna", onclick: () => { closePopover(); columnDialog(col); } }),
    h("div", { class: "opt", text: "←  Mover a la izquierda", onclick: () => { closePopover(); moveColumn(col, -1); } }),
    h("div", { class: "opt", text: "→  Mover a la derecha", onclick: () => { closePopover(); moveColumn(col, 1); } }),
    h("div", { class: "sep" }),
    h("div", { class: "opt", style: { color: "var(--danger)" }, text: "🗑  Eliminar columna", onclick: () => { closePopover(); confirmDialog("Eliminar columna",
      `Se borrará “${col.title}” y sus datos en todos los elementos.`, "Eliminar", async () => {
        await attempt(async () => { await api("DELETE", `/api/columns/${col.id}`); await reloadBoard(); });
      }); } }),
  ]);
}

async function moveColumn(col, dir) {
  const cols = state.board.columns;
  const i = cols.indexOf(col);
  const j = i + dir;
  if (j < 0 || j >= cols.length) return;
  await attempt(async () => {
    await api("PATCH", `/api/columns/${col.id}`, { position: cols[j].position });
    await api("PATCH", `/api/columns/${cols[j].id}`, { position: col.position });
    await reloadBoard();
  });
}

function columnDialog(col) {
  const editing = !!col;
  const title = h("input", { class: "input", value: col?.title || "" });
  const type = h("select", { class: "select", disabled: editing },
    Object.entries(TYPE_NAMES).map(([k, n]) => h("option", { value: k, text: n })));
  type.value = col?.type || "text";
  const labels = (col ? labelsOf(col) : [
    { id: "0", label: "Pendiente", color: "#c4c4c4" }, { id: "1", label: "En curso", color: "#fdab3d" }, { id: "2", label: "Listo", color: "#00c875", done: true },
  ]).map((l) => ({ ...l }));
  const unit = h("input", { class: "input", value: col?.settings?.unit || "", placeholder: "$, UF, %…" });
  const relBoard = h("select", { class: "select" }, state.workspaces.flatMap((ws) => [...ws.folders.flatMap((f) => f.boards), ...ws.boards])
    .map((b) => h("option", { value: b.id, text: b.name })));
  if (col?.settings?.board_ids?.[0]) relBoard.value = col.settings.board_ids[0];

  const labelBox = h("div", { class: "label-editor" });
  const drawLabels = () => {
    labelBox.replaceChildren(...labels.map((l, i) => {
      const color = h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : "#c4c4c4", "aria-label": "Color" });
      color.addEventListener("input", () => (l.color = color.value));
      const name = h("input", { class: "input", value: l.label });
      name.addEventListener("input", () => (l.label = name.value));
      return h("div", { class: "lrow" }, color, name,
        h("button", { class: "icon-btn", text: "✕", "aria-label": "Quitar etiqueta", onclick: () => { labels.splice(i, 1); drawLabels(); } }));
    }), h("button", { class: "btn sm", text: "+ Etiqueta", onclick: () => { labels.push({ label: "", color: PALETTE[labels.length % PALETTE.length] }); drawLabels(); } }));
  };
  drawLabels();
  const extra = h("div");
  const drawExtra = () => {
    const t = type.value;
    if (t === "status" || t === "dropdown") extra.replaceChildren(h("div", { class: "field", text: "Etiquetas" }), labelBox,
      editing ? h("p", { style: { fontSize: "12px", color: "var(--text-3)" }, text: "Si quitas una etiqueta, se vacía en los elementos que la tenían." }) : null);
    else if (t === "number") extra.replaceChildren(h("label", { class: "field" }, "Unidad", unit));
    else if (t === "relation") extra.replaceChildren(h("label", { class: "field" }, "Tablero conectado", relBoard));
    else extra.replaceChildren();
  };
  type.addEventListener("change", drawExtra);
  drawExtra();

  modal(editing ? "Editar columna" : "Nueva columna", [h("label", { class: "field" }, "Título", title), h("label", { class: "field" }, "Tipo", type), extra], [
    { label: "Cancelar" },
    { label: "Guardar", kind: "primary", onClick: async () => {
      if (!title.value.trim()) return true;
      const t = type.value;
      const settings = { ...(col?.settings || {}) };
      if (t === "status" || t === "dropdown") settings.labels = labels.filter((l) => l.label.trim());
      if (t === "number") settings.unit = unit.value.trim();
      if (t === "relation") settings.board_ids = [Number(relBoard.value)];
      await attempt(async () => {
        if (editing) await api("PATCH", `/api/columns/${col.id}`, { title: title.value.trim(), settings });
        else await api("POST", `/api/boards/${state.board.id}/columns`, { title: title.value.trim(), type: t, settings });
        await reloadBoard();
      });
    } },
  ]);
}

// ---------- Ficha del elemento ----------

function openItem(id) {
  location.hash = `#/board/${state.board.id}/item/${id}`;
}

function closeDrawer() {
  document.querySelector(".drawer")?.remove();
  document.querySelector(".drawer-overlay")?.remove();
}

async function openDrawer(itemId) {
  const data = await attempt(() => api("GET", `/api/items/${itemId}`));
  if (!data) return;
  Object.assign(state.related, data.related);
  const item = state.items.find((i) => i.id === itemId) || data.item;
  Object.assign(item, data.item);
  closeDrawer();
  const back = () => { location.hash = `#/board/${state.board.id}`; };
  const nameInput = h("input", { value: item.name, "aria-label": "Nombre" });
  nameInput.addEventListener("change", async () => { if (nameInput.value.trim()) { await saveItem(item, { name: nameInput.value.trim() }); renderView(); } });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

  const fieldsBox = h("div");
  const drawFields = () => {
    fieldsBox.replaceChildren(h("div", { class: "fields" },
      state.board.columns.flatMap((c) => [h("div", { class: "fl", text: c.title }),
        h("div", { class: "fv" }, renderCell(c, item, { wide: true, onChange: drawFields }))])));
  };
  drawFields();

  const groupSelect = h("select", { class: "select", style: { width: "auto" } }, state.board.groups.map((g) => h("option", { value: g.id, text: g.title })));
  groupSelect.value = item.group_id;
  groupSelect.addEventListener("change", async () => { await saveItem(item, { group_id: Number(groupSelect.value) }); renderView(); });

  const body = h("div", { class: "drawer-body" },
    h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" } },
      h("span", { style: { color: "var(--text-2)", fontSize: "13px" }, text: "Grupo" }), groupSelect,
      h("span", { style: { flex: 1 } }),
      h("button", { class: "btn sm danger", text: "Eliminar", onclick: () => confirmDialog("Eliminar", `¿Eliminar “${item.name}”?`, "Eliminar", async () => {
        await attempt(async () => {
          await api("DELETE", `/api/items/${item.id}`);
          state.items = state.items.filter((i) => i.id !== item.id);
          renderView();
          back();
        });
      }) })),
    fieldsBox,
    renderSubitems(item, data.subitems),
    renderUpdates(item, data.updates));

  document.body.append(h("div", { class: "drawer-overlay", onclick: back }),
    h("aside", { class: "drawer", role: "dialog", "aria-label": item.name },
      h("div", { class: "drawer-head" }, nameInput, h("button", { class: "icon-btn", text: "✕", "aria-label": "Cerrar", onclick: back })),
      body));
}

function renderSubitems(parent, subitems) {
  const sub = state.board.subitems_board;
  const cols = sub?.columns || [];
  const box = h("div");
  const list = h("div");
  const draw = () => {
    list.replaceChildren(subitems.length ? h("div", { class: "table-wrap" }, h("table", { class: "board", style: { width: 260 + cols.length * 150 + "px" } },
      h("thead", {}, h("tr", {}, h("th", { class: "name-col", text: "Subelemento" }), cols.map((c) => h("th", { text: c.title })))),
      h("tbody", {}, subitems.map((s) => h("tr", {},
        h("td", { class: "name-col" }, h("div", { class: "name-cell" }, h("span", { class: "nm", text: s.name }),
          h("button", { class: "icon-btn", text: "✕", "aria-label": "Eliminar subelemento", onclick: async () => {
            await attempt(async () => { await api("DELETE", `/api/items/${s.id}`); subitems.splice(subitems.indexOf(s), 1); bump(-1); draw(); });
          } }))),
        cols.map((c) => h("td", {}, renderCell(c, s, { onChange: draw })))))))) : h("p", { style: { color: "var(--text-3)", fontSize: "13px" }, text: "Sin subelementos." }));
  };
  const bump = (n) => {
    const key = String(parent.id);
    state.subitemCounts[key] = (state.subitemCounts[key] || 0) + n;
    if (state.view === "table") renderRowAgain(parent);
  };
  const input = h("input", { class: "input", placeholder: "+ Agregar subelemento (Enter)" });
  input.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    const s = await attempt(() => api("POST", `/api/items/${parent.id}/subitems`, { name: input.value.trim() }));
    if (!s) return;
    input.value = "";
    if (!state.board.subitems_board) {
      // Primer subelemento del tablero: se creó su tablero de subelementos
      const board = await api("GET", `/api/boards/${state.board.id}`);
      state.board.subitems_board = board.subitems_board;
      return openDrawer(parent.id);
    }
    subitems.push(s);
    bump(1);
    draw();
  });
  draw();
  box.append(h("h3", { text: "Subelementos" }), list, h("div", { style: { marginTop: "8px" } }, input));
  return box;
}

function renderUpdates(item, updates) {
  const list = h("div");
  const draw = () => list.replaceChildren(...(updates.length ? updates.map((u) => h("div", { class: "update" },
    h("div", { class: "meta" }, h("span", { class: "avatar", style: { width: "24px", height: "24px", fontSize: "10px" }, text: initials(u.author_name) }),
      h("b", { text: u.author_name || "—" }),
      h("span", { text: u.created_at ? new Date(u.created_at).toLocaleString("es-CL", { dateStyle: "medium", timeStyle: "short" }) : "" }),
      (u.user_id === state.me.id || isAdmin()) && h("button", { class: "icon-btn", text: "✕", "aria-label": "Borrar comentario", onclick: async () => {
        await attempt(async () => { await api("DELETE", `/api/updates/${u.id}`); updates.splice(updates.indexOf(u), 1); draw(); });
      } })),
    h("div", { class: "body", text: u.body }))) : [h("p", { style: { color: "var(--text-3)", fontSize: "13px" }, text: "Aún no hay comentarios." })]));
  const ta = h("textarea", { class: "textarea", placeholder: "Escribe una actualización: llamada, reunión, próximo paso…" });
  const send = async () => {
    if (!ta.value.trim()) return;
    const u = await attempt(() => api("POST", `/api/items/${item.id}/updates`, { body: ta.value }));
    if (u) { updates.unshift(u); ta.value = ""; draw(); }
  };
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); });
  draw();
  return h("div", {}, h("h3", { text: "Actualizaciones" }),
    h("div", { class: "update-form" }, ta, h("button", { class: "btn primary sm", text: "Publicar", onclick: send })), list);
}

// ---------- Vista kanban ----------

function renderKanban(items) {
  const b = state.board;
  const statusCols = b.columns.filter((c) => c.type === "status");
  if (!statusCols.length) return h("div", { class: "empty" }, h("h2", { text: "Sin columnas de estado" }), h("p", { text: "El kanban necesita una columna de tipo Estado." }));
  let col = statusCols.find((c) => c.key === state.kanbanKey) || statusCols[0];
  const picker = h("select", { class: "select", style: { width: "auto", marginBottom: "14px" }, "aria-label": "Agrupar por" },
    statusCols.map((c) => h("option", { value: c.key, text: `Agrupar por: ${c.title}` })));
  picker.value = col.key;
  picker.addEventListener("change", () => { state.kanbanKey = picker.value; store.set(`kanban:${b.id}`, picker.value); renderView(); });

  const preview = b.columns.filter((c) => c.key !== col.key && ["text", "number", "email", "phone", "date", "status", "dropdown"].includes(c.type)).slice(0, 4);
  const lanes = [...labelsOf(col).map((l) => ({ id: l.id, label: l.label, color: l.color })), { id: null, label: "Sin estado", color: "#9699a6" }];
  const LIMIT = 150;
  const board = h("div", { class: "kanban" }, lanes.map((lane) => {
    const laneItems = items.filter((it) => (it.values[col.key] ?? null) === lane.id);
    if (lane.id === null && !laneItems.length) return null;
    const body = h("div", { class: "lane-body" },
      laneItems.slice(0, LIMIT).map((it) => h("div", { class: "card", draggable: "true",
        ondragstart: (e) => { e.dataTransfer.setData("text/plain", String(it.id)); e.dataTransfer.effectAllowed = "move"; },
        onclick: () => openItem(it.id) },
        h("div", { class: "ct", text: it.name }),
        preview.map((c) => { const t = cellText(c, it.values[c.key]); return t ? h("div", { class: "cf" }, h("span", { text: c.title + ": " }), t) : null; }))),
      laneItems.length > LIMIT ? h("div", { class: "lane-more", text: `+${laneItems.length - LIMIT} más (usa la búsqueda o la tabla)` }) : null);
    const el = h("div", { class: "lane",
      ondragover: (e) => { e.preventDefault(); el.classList.add("drop"); },
      ondragleave: () => el.classList.remove("drop"),
      ondrop: async (e) => {
        e.preventDefault();
        el.classList.remove("drop");
        const it = state.items.find((i) => i.id === Number(e.dataTransfer.getData("text/plain")));
        if (it && (it.values[col.key] ?? null) !== lane.id) await saveValue(it, col, lane.id);
      } },
    h("div", { class: "lane-head", style: { background: lane.color } }, h("span", { text: lane.label }), h("span", { text: laneItems.length })), body);
    return el;
  }));
  return h("div", {}, picker, board);
}

// ---------- Vista resumen ----------

function renderSummary(items) {
  const b = state.board;
  const total = items.length;
  const kpis = [h("div", { class: "kpi" }, h("div", { class: "k", text: `Total de ${b.item_label.toLowerCase()}s` }), h("div", { class: "v", text: total }))];
  for (const c of b.columns.filter((c) => c.type === "number")) {
    const vals = items.map((i) => i.values[c.key]).filter((v) => typeof v === "number");
    if (!vals.length) continue;
    kpis.push(h("div", { class: "kpi" }, h("div", { class: "k", text: `${c.title} (suma)` }), h("div", { class: "v", text: fmtNumber(vals.reduce((a, v) => a + v, 0), c) })));
  }
  const followCols = b.columns.filter((c) => c.type === "date" && isFollowUpColumn(c));
  for (const c of followCols) {
    const late = items.filter((i) => i.values[c.key] && i.values[c.key] < todayStr()).length;
    kpis.push(h("div", { class: "kpi" }, h("div", { class: "k", text: `${c.title}: vencidos` }), h("div", { class: "v", style: { color: late ? "var(--danger)" : null }, text: late })));
  }
  const bars = (title, rows) => h("div", { class: "panel" }, h("h3", { text: title }),
    rows.map((r) => h("div", { class: "bar-row" }, h("span", { class: "bl", text: r.label, title: r.label }),
      h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: { width: total ? (r.count / total) * 100 + "%" : "0", background: r.color } })),
      h("span", { class: "bn", text: r.count }))));
  const panels = [];
  panels.push(bars("Por grupo", b.groups.map((g) => ({ label: g.title, color: g.color, count: items.filter((i) => i.group_id === g.id).length }))));
  for (const c of b.columns.filter((c) => c.type === "status" || c.type === "dropdown")) {
    const rows = labelsOf(c).map((l) => ({ label: l.label, color: c.type === "status" ? l.color : "#579bfc",
      count: items.filter((i) => { const v = i.values[c.key]; return c.type === "status" ? v === l.id : (v || []).includes(l.id); }).length }))
      .filter((r) => r.count).sort((a, z) => z.count - a.count).slice(0, 12);
    const empty = items.filter((i) => i.values[c.key] === undefined).length;
    if (empty) rows.push({ label: "(vacío)", color: "#c4c4c4", count: empty });
    if (rows.length) panels.push(bars(c.title, rows));
  }
  return h("div", {}, h("div", { class: "kpis" }, kpis), h("div", { class: "summary" }, panels));
}

// ---------- Administración ----------

async function renderAdmin() {
  state.board = null;
  const users = await attempt(() => api("GET", "/api/users"));
  if (!users) return;
  const wsName = Object.fromEntries(state.workspaces.map((w) => [w.id, w.name]));
  const content = h("div", { class: "content" }, h("div", { class: "page" },
    h("div", { style: { display: "flex", alignItems: "center", marginBottom: "12px" } }, h("h2", { text: "Usuarios", style: { margin: 0, flex: 1 } }),
      h("button", { class: "btn primary", text: "+ Invitar usuario", onclick: () => userDialog(null) })),
    h("table", { class: "list-table" },
      h("thead", {}, h("tr", {}, ["Nombre", "Email", "Rol", "Espacios con acceso", ""].map((t) => h("th", { text: t })))),
      h("tbody", {}, users.map((u) => h("tr", {},
        h("td", { text: u.name }), h("td", { text: u.email }),
        h("td", {}, h("span", { class: "badge" + (u.role === "admin" ? " admin" : ""), text: u.role === "admin" ? "Administrador" : "Miembro" }),
          !u.is_active && h("span", { class: "badge off", style: { marginLeft: "6px" }, text: "Desactivado" })),
        h("td", { text: u.role === "admin" ? "Todos" : u.workspace_ids.map((id) => wsName[id]).filter(Boolean).join(", ") || "Ninguno" }),
        h("td", { style: { textAlign: "right" } }, h("button", { class: "btn sm", text: "Editar", onclick: () => userDialog(u) })))))),
    h("p", { style: { color: "var(--text-2)", fontSize: "13px" } },
      "Los administradores ven todos los espacios. Los miembros solo ven los espacios que marques: así “CRM y Ventas” queda solo para ti y “Clientes” lo compartes con tu equipo.")));
  shell([h("div", { class: "topbar", style: { paddingBottom: "14px" } },
    h("div", { class: "title-row" }, h("button", { class: "icon-btn mobile-only", text: "☰", "aria-label": "Menú", onclick: () => toggleNav(true) }),
      h("h1", { text: "Usuarios y accesos" }))), content]);
}

function userDialog(u) {
  const editing = !!u;
  const name = h("input", { class: "input", value: u?.name || "" });
  const email = h("input", { class: "input", type: "email", value: u?.email || "", disabled: editing });
  const password = h("input", { class: "input", type: "password", autocomplete: "new-password", placeholder: editing ? "Dejar vacío para no cambiarla" : "Mínimo 8 caracteres" });
  const role = h("select", { class: "select" }, h("option", { value: "member", text: "Miembro" }), h("option", { value: "admin", text: "Administrador" }));
  role.value = u?.role || "member";
  const active = h("input", { type: "checkbox" });
  active.checked = u ? u.is_active : true;
  const chosen = new Set(u?.workspace_ids || []);
  const wsBoxes = state.workspaces.map((w) => {
    const box = h("input", { type: "checkbox" });
    box.checked = chosen.has(w.id);
    box.addEventListener("change", () => (box.checked ? chosen.add(w.id) : chosen.delete(w.id)));
    return h("label", { class: "opt", style: { padding: "4px 0" } }, box, w.name);
  });
  modal(editing ? "Editar usuario" : "Invitar usuario", [
    h("label", { class: "field" }, "Nombre", name),
    h("label", { class: "field" }, "Email", email),
    h("label", { class: "field" }, editing ? "Nueva contraseña" : "Contraseña inicial", password),
    h("label", { class: "field" }, "Rol", role),
    h("div", { class: "field" }, "Espacios de trabajo a los que tiene acceso", ...wsBoxes),
    editing && h("label", { class: "opt", style: { padding: "4px 0" } }, active, "Cuenta activa"),
  ], [
    { label: "Cancelar" },
    { label: "Guardar", kind: "primary", onClick: async () => {
      const payload = { name: name.value.trim(), role: role.value, workspace_ids: [...chosen] };
      if (password.value) payload.password = password.value;
      const ok = await attempt(async () => {
        if (editing) await api("PATCH", `/api/users/${u.id}`, { ...payload, is_active: active.checked });
        else await api("POST", "/api/users", { ...payload, email: email.value.trim() });
        return true;
      });
      if (!ok) return true;
      renderAdmin();
    } },
  ]);
}

boot();
