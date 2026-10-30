/* jorgeurra.com: aplica contenido.js al sitio */
(function () {
  "use strict";

  var C = window.CONTENIDO || {};
  var contacto = C.contacto || {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Enlaces de contacto: WhatsApp, email y SARAHI se definen una sola vez en contenido.js
  var waNumero = String(contacto.whatsapp || "").replace(/\D/g, "");
  var links = {
    whatsapp: waNumero
      ? "https://wa.me/" + waNumero + "?text=" + encodeURIComponent(contacto.mensajeWhatsapp || "")
      : null,
    email: contacto.email ? "mailto:" + contacto.email : null,
    sarahi: contacto.sarahi || null
  };

  document.querySelectorAll("[data-link]").forEach(function (a) {
    var href = links[a.getAttribute("data-link")];
    if (!href) return;
    a.setAttribute("href", href);
    if (href.indexOf("http") === 0) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    }
    if (a.getAttribute("data-link") === "email" && contacto.email && a.textContent.indexOf("@") > -1) {
      a.textContent = contacto.email;
    }
  });

  // Redes sociales opcionales
  var social = document.getElementById("social");
  if (social) {
    [["LinkedIn", contacto.linkedin], ["Instagram", contacto.instagram]].forEach(function (r) {
      if (!r[1]) return;
      var a = document.createElement("a");
      a.href = r[1];
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = r[0];
      social.appendChild(a);
    });
  }

  // Novedades: las 6 más recientes
  var news = document.getElementById("news");
  var items = (C.novedades || []).slice().sort(function (a, b) {
    return String(b.fecha).localeCompare(String(a.fecha));
  }).slice(0, 6);

  function fecha(iso) {
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
  }

  if (news && items.length) {
    news.innerHTML = items.map(function (n) {
      var externo = /^https?:/.test(n.enlace || "");
      return (
        '<a class="news__item" href="' + esc(n.enlace || "#contacto") + '"' +
        (externo ? ' target="_blank" rel="noopener"' : "") + ">" +
        '<span class="news__meta">' +
        (n.etiqueta ? '<span class="news__tag">' + esc(n.etiqueta) + "</span>" : "") +
        "<time datetime=\"" + esc(n.fecha) + "\">" + esc(fecha(n.fecha)) + "</time></span>" +
        "<h3>" + esc(n.titulo) + "</h3>" +
        "<p>" + esc(n.resumen) + "</p>" +
        '<span class="news__more">Leer más' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>' +
        "</a>"
      );
    }).join("");
  } else if (news) {
    news.closest("section").hidden = true;
  }

  // Año siempre al día
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
