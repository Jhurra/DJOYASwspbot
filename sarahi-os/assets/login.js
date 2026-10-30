(function () {
  'use strict';
  var mode = document.currentScript.dataset.mode;
  var form = document.getElementById('auth-form');
  var err = document.getElementById('auth-err');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    err.textContent = '';
    var fd = new FormData(form);
    var body = {};
    fd.forEach(function (v, k) { body[k] = v; });
    if (mode === 'setup') body.import = fd.has('import');
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      var r = await fetch('api.php?a=' + (mode === 'setup' ? 'setup' : 'login'), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-SOS': '1' }, body: JSON.stringify(body),
      });
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.error || 'No se pudo entrar');
      location.reload();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
})();
