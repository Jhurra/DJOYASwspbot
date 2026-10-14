// Terapia con Gi · interacciones del borrador
(function () {
  // Menú móvil
  var btn = document.querySelector(".menu-btn");
  var nav = document.querySelector(".nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "Cerrar" : "Menú";
    });
  }

  // Horas locales: tu zona + ciudades con muchas personas hispanohablantes migrantes
  function fmt(zone) {
    try {
      return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(new Date());
    } catch (e) { return ""; }
  }
  function tick() {
    document.querySelectorAll("[data-tz]").forEach(function (el) {
      var zone = el.getAttribute("data-tz");
      el.textContent = fmt(zone === "local" ? undefined : zone);
    });
  }
  var youName = document.querySelector("[data-tz-name]");
  if (youName) {
    try {
      var z = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      var city = z.split("/").pop().replace(/_/g, " ");
      if (city) youName.textContent = "Tu hora (" + city + ")";
    } catch (e) {}
  }
  var tzField = document.getElementById("zona");
  if (tzField) {
    try { tzField.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  }
  tick();
  setInterval(tick, 30000);

  // Formulario de agenda (borrador: no envía datos)
  var form = document.getElementById("agenda-form");
  var ok = document.getElementById("agenda-ok");
  if (form && ok) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      var name = (document.getElementById("nombre").value || "").trim().split(" ")[0];
      var slot = ok.querySelector("[data-name]");
      if (slot) slot.textContent = name || "";
      form.hidden = true;
      ok.hidden = false;
      ok.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    var again = document.getElementById("agenda-again");
    if (again) again.addEventListener("click", function () { ok.hidden = true; form.hidden = false; });
  }

  // Botones de copiar
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var target = document.getElementById(b.getAttribute("data-copy"));
      if (!target) return;
      var text = target.textContent.trim();
      var done = function () { var t = b.textContent; b.textContent = "Copiado"; setTimeout(function () { b.textContent = t; }, 1600); };
      var fallback = function () {
        var r = document.createRange(); r.selectNodeContents(target);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      };
      try {
        navigator.clipboard.writeText(text).then(done, fallback);
      } catch (e) { fallback(); }
    });
  });
})();
