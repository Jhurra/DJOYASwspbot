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

  // Zona horaria de quien visita
  var zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  document.querySelectorAll("[data-zone]").forEach(function (el) { el.textContent = zone.replace(/_/g, " ") || "tu zona horaria"; });
  var zoneField = document.getElementById("zona");
  if (zoneField) zoneField.value = zone;

  // Calendario de reserva (disponibilidad de ejemplo: lunes a viernes)
  var cal = document.querySelector("[data-cal]");
  if (cal) {
    var grid = cal.querySelector(".cal-grid");
    var title = cal.querySelector(".cal-head h3");
    var slotsBox = cal.querySelector(".slots");
    var slotsWrap = cal.querySelector("[data-slots]");
    var ok = cal.querySelector(".booking-ok");
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var view = new Date(today.getFullYear(), today.getMonth(), 1);
    var picked = null;
    var hours = ["09:00", "11:00", "13:00", "17:00", "19:00"];
    var dows = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

    function render() {
      var t = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(view);
      title.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      grid.innerHTML = "";
      dows.forEach(function (d) { var s = document.createElement("span"); s.className = "dow"; s.textContent = d; grid.appendChild(s); });
      var offset = (view.getDay() + 6) % 7;
      for (var i = 0; i < offset; i++) grid.appendChild(document.createElement("span"));
      var days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
      for (var d = 1; d <= days; d++) {
        var date = new Date(view.getFullYear(), view.getMonth(), d);
        var b = document.createElement("button");
        b.type = "button"; b.textContent = d;
        var wd = date.getDay();
        var open = date > today && wd !== 0 && wd !== 6;
        if (open) {
          b.className = "open";
          b.setAttribute("aria-label", new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(date));
          (function (dt, el) { el.addEventListener("click", function () { pick(dt, el); }); })(date, b);
          if (picked && +picked === +date) b.classList.add("sel");
        } else { b.disabled = true; }
        grid.appendChild(b);
      }
    }
    function pick(date, el) {
      picked = date;
      grid.querySelectorAll(".sel").forEach(function (x) { x.classList.remove("sel"); });
      el.classList.add("sel");
      slotsWrap.hidden = false; ok.hidden = true;
      slotsBox.innerHTML = "";
      hours.forEach(function (h) {
        var s = document.createElement("button"); s.type = "button"; s.textContent = h;
        s.addEventListener("click", function () {
          slotsBox.querySelectorAll(".sel").forEach(function (x) { x.classList.remove("sel"); });
          s.classList.add("sel");
          var day = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(date);
          ok.textContent = "Elegiste el " + day + " a las " + h + " (tu hora). En el sitio real aquí se pide tu nombre y correo y se confirma la cita.";
          ok.hidden = false;
        });
        slotsBox.appendChild(s);
      });
    }
    cal.querySelector("[data-prev]").addEventListener("click", function () {
      var prev = new Date(view.getFullYear(), view.getMonth() - 1, 1);
      if (prev >= new Date(today.getFullYear(), today.getMonth(), 1)) { view = prev; render(); }
    });
    cal.querySelector("[data-next]").addEventListener("click", function () { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); });
    render();
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
