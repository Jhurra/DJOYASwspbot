// Terapia con Gi, interacciones del contenido
(function () {
  // Zona horaria de quien visita (campo del formulario de contacto)
  var zoneField = document.getElementById("zona");
  if (zoneField) {
    try { zoneField.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  }

  // Formulario de contacto: abre el correo de quien visita con el mensaje listo
  var form = document.getElementById("contacto-form");
  var done = document.getElementById("contacto-ok");
  if (form && done) {
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      var val = function (id) { return (document.getElementById(id).value || "").trim(); };
      var body = "Nombre: " + val("nombre") + "\nCorreo: " + val("correo") + "\nPaís: " + val("pais") +
        "\nZona horaria: " + val("zona") + "\n\n" + val("mensaje");
      var href = "mailto:camarenageorgia@gmail.com?subject=" + encodeURIComponent("Consulta desde la web") +
        "&body=" + encodeURIComponent(body);
      done.querySelector("[data-name]").textContent = val("nombre").split(" ")[0];
      form.hidden = true; done.hidden = false;
      window.location.href = href;
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
