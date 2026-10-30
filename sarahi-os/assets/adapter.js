/* SARAHI OS — adaptador del servidor: guarda en la base de datos propia (api.php) en vez de la del artefacto.
   Expone la misma interfaz que el adaptador del artefacto (window.SOS_ADAPTER), así app.js no cambia. */
(function () {
  'use strict';
  var POLL_MS = 20000;
  var rev = 0;
  var onChange = null;
  var mine = new Set(); // revisiones que escribió esta pestaña: no hay que volver a aplicarlas
  var chains = new Map();

  function chain(key, fn) {
    var prev = chains.get(key) || Promise.resolve();
    var p = prev.catch(function () {}).then(fn);
    chains.set(key, p);
    p.finally(function () { if (chains.get(key) === p) chains.delete(key); }).catch(function () {});
    return p;
  }

  async function req(method, action, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'X-SOS': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var r;
    try { r = await fetch('api.php?a=' + action, opts); }
    catch (e) { throw new Error('sin conexión con el servidor'); }
    if (r.status === 401) { location.reload(); throw new Error('tu sesión expiró'); }
    var data = null;
    try { data = await r.json(); } catch (e) { /* respuesta vacía */ }
    if (!r.ok) throw new Error((data && data.error) || 'error del servidor (' + r.status + ')');
    return data;
  }

  function apply(docs) {
    for (var i = 0; i < docs.length; i++) {
      var x = docs[i];
      var key = x.c + '/' + x.id + '@' + x.rev;
      if (mine.has(key)) { mine.delete(key); continue; }
      onChange(x.c, x.id, x.d);
    }
  }

  async function poll() {
    if (document.hidden) return;
    try {
      var r = await req('GET', 'changes&since=' + rev);
      apply(r.docs);
      rev = Math.max(rev, r.rev);
    } catch (e) { /* se reintenta en la próxima vuelta */ }
  }

  async function write(ops) {
    var r = await req('POST', 'write', { ops: ops });
    (r.revs || []).forEach(function (x) { mine.add(x.c + '/' + x.id + '@' + x.rev); });
    return r;
  }

  var api = {
    kind: 'server',
    init: async function (cb) {
      onChange = cb;
      var r = await req('GET', 'boot');
      r.docs.forEach(function (x) { onChange(x.c, x.id, x.d); });
      rev = r.rev;
      setInterval(poll, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
      return { me: r.me, caps: r.caps };
    },
    set: function (c, id, d) { return chain(c + '/' + id, function () { return write([{ op: 'set', c: c, id: id, d: d }]); }); },
    update: function (c, id, d) { return chain(c + '/' + id, function () { return write([{ op: 'update', c: c, id: id, d: d }]); }); },
    remove: function (c, id) { return chain(c + '/' + id, function () { return write([{ op: 'del', c: c, id: id }]); }); },
    batch: async function (ops) {
      for (var i = 0; i < ops.length; i += 100) {
        await write(ops.slice(i, i + 100).map(function (o) { return { op: o.op === 'remove' ? 'del' : o.op, c: o.c, id: o.id, d: o.d }; }));
      }
    },
    ai: async function (prompt, opts) {
      var r = await req('POST', 'ai', { prompt: prompt, json: !!(opts && opts.json) });
      return opts && opts.json ? r.json : r.text;
    },
    call: function (name, args) { return req('POST', 'call', { name: name, args: args || {} }); },
    refresh: poll,
  };
  window.SOS_ADAPTER = api;
})();
