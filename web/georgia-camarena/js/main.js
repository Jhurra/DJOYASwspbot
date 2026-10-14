// Terapia con Gi, interacciones del borrador
(function () {
  // Menú móvil
  var btn = document.querySelector(".menu-btn");
  var nav = document.querySelector(".nav");
  if (btn && nav) {
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  // Zona horaria de quien visita (campo del formulario de contacto)
  var zoneField = document.getElementById("zona");
  if (zoneField) {
    try { zoneField.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  }

  // Número de WhatsApp: escríbelo aquí con código de país y sin signos, por ejemplo "5215512345678".
  // Se aplica a todos los botones de WhatsApp del sitio.
  var WHATSAPP = "";
  if (WHATSAPP) {
    document.querySelectorAll('a[href^="https://wa.me/"]').forEach(function (a) {
      a.href = a.href.replace("https://wa.me/", "https://wa.me/" + WHATSAPP);
    });
  }

  // Formulario de contacto (borrador: no envía datos)
  var form = document.getElementById("contacto-form");
  var done = document.getElementById("contacto-ok");
  if (form && done) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      var name = (document.getElementById("nombre").value || "").trim().split(" ")[0];
      done.querySelector("[data-name]").textContent = name;
      form.hidden = true; done.hidden = false;
    });
    document.getElementById("contacto-again").addEventListener("click", function () { done.hidden = true; form.hidden = false; });
  }

  // Botones de copiar
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var target = document.getElementById(b.getAttribute("data-copy"));
      if (!target) return;
      var label = b.textContent;
      var select = function () {
        var r = document.createRange(); r.selectNodeContents(target);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      };
      try {
        navigator.clipboard.writeText(target.textContent.trim()).then(function () {
          b.textContent = "Copiado"; setTimeout(function () { b.textContent = label; }, 1500);
        }, select);
      } catch (e) { select(); }
    });
  });
})();
