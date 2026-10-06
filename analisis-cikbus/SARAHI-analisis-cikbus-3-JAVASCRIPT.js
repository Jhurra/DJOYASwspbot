(function(){
"use strict";

/* Sin ampersand ni signos menor o mayor que: el CMS los reescribe. */
function cada(lista, fn){
  var i = 0;
  var n = lista ? lista.length : 0;
  while(i !== n){ fn(lista[i], i); i = i + 1; }
}
function maximo(a, b){ return Math.max(a, b); }

function arranca(){
  var ROOT = document.querySelector('.sarcik');
  if(!ROOT){
    arranca.intentos = (arranca.intentos || 0) + 1;
    if(arranca.intentos !== 100){ setTimeout(arranca, 100); }
    return;
  }
  if(ROOT.getAttribute('data-ck-lista') === '1') return;
  ROOT.setAttribute('data-ck-lista', '1');
  pieza(ROOT);
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', arranca);
} else {
  arranca();
}

function pieza(ROOT){
  var NS = 'http://www.w3.org/2000/svg';
  var C1 = '#f2692d', C2 = '#8088e6', GRID = '#ececec', AXIS = '#c7c7c7', INK = '#323232', MUTED = '#8f8b86';

  function el(tag, attrs, padre, texto){
    var e = document.createElementNS(NS, tag);
    for(var k in attrs){ if(Object.prototype.hasOwnProperty.call(attrs, k)){ e.setAttribute(k, attrs[k]); } }
    if(texto !== undefined){ e.textContent = texto; }
    if(padre){ padre.appendChild(e); }
    return e;
  }
  function coma(n, dec){ return n.toFixed(dec).replace('.', ','); }

  /* Barras horizontales. filas: [{nombre, valor, propio, nota}] */
  function barras(caja, filas, escala, ticks, dec){
    if(!caja) return;
    while(caja.firstChild){ caja.removeChild(caja.firstChild); }
    var W = 780, filaH = 46, top = 16, bottom = 34;
    var H = top + filas.length * filaH + bottom;
    var x0 = 196, x1 = 720;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'presentation', 'font-family': 'DM Sans, system-ui, sans-serif' }, caja);
    cada(ticks, function(t){
      var x = x0 + (x1 - x0) * t / escala;
      el('line', { x1: x, x2: x, y1: top - 4, y2: H - bottom + 4, stroke: t === 0 ? AXIS : GRID, 'stroke-width': t === 0 ? 1.5 : 1 }, svg);
      el('text', { x: x, y: H - 10, 'text-anchor': 'middle', 'font-size': 12, fill: MUTED }, svg, coma(t, 0));
    });
    cada(filas, function(f, i){
      var y = top + i * filaH;
      var w = maximo(0, (x1 - x0) * f.valor / escala);
      el('text', { x: x0 - 14, y: y + filaH / 2 + 5, 'text-anchor': 'end', 'font-size': 14, 'font-weight': f.propio ? 700 : 500, fill: INK }, svg, f.nombre);
      el('rect', { x: x0, y: y + 11, width: maximo(w, 0.0001), height: filaH - 22, rx: 6, fill: f.propio ? C1 : C2 }, svg);
      var etiqueta = f.nota ? f.nota : coma(f.valor, dec);
      el('text', { x: x0 + w + 10, y: y + filaH / 2 + 5, 'font-size': 14, 'font-weight': 700, fill: INK }, svg, etiqueta);
    });
  }

  /* 1. Calificaciones por dimensión (Busbud, 05/10/2026) */
  var DATOS = {
    general:     { c: 3.6, p: 3.8, a: 3.8 },
    personal:    { c: 4.5, p: 4.5, a: 4.3 },
    puntualidad: { c: 3.3, p: 3.8, a: 3.6 },
    limpieza:    { c: 4.2, p: 4.6, a: 4.2 },
    wifi:        { c: 1.3, p: 1.5, a: 1.2 }
  };
  var NOMBRES = { general: 'la nota general', personal: 'tripulación', puntualidad: 'puntualidad', limpieza: 'limpieza', wifi: 'Wi-Fi' };
  var cajaRating = ROOT.querySelector('#ck-chart-rating');
  var veredicto = ROOT.querySelector('#ck-verdict');

  function pintaRating(dim){
    var d = DATOS[dim];
    barras(cajaRating, [
      { nombre: 'Cikbus Elité', valor: d.c, propio: true },
      { nombre: 'Pluss Chile', valor: d.p },
      { nombre: 'Andimar (FlixBus)', valor: d.a }
    ], 5, [0, 1, 2, 3, 4, 5], 1);
    var mejor = maximo(d.p, d.a);
    var dif = Math.round((d.c - mejor) * 10) / 10;
    var tag = 'ck-tag-good', txt = 'A la par', frase;
    if(dif === 0){
      frase = 'Cikbus empata con el mejor de sus pares en ' + NOMBRES[dim] + '.';
    } else if(Math.abs(dif) === dif){
      txt = 'Sobre sus pares';
      frase = 'Cikbus supera por ' + coma(dif, 1) + ' puntos al mejor de sus pares en ' + NOMBRES[dim] + '.';
    } else {
      tag = 'ck-tag-bad'; txt = 'Bajo sus pares';
      frase = 'Cikbus queda ' + coma(Math.abs(dif), 1) + ' puntos bajo el mejor de sus pares en ' + NOMBRES[dim] + '.';
    }
    if(veredicto){
      while(veredicto.firstChild){ veredicto.removeChild(veredicto.firstChild); }
      var t = document.createElement('span'); t.className = 'ck-tag ' + tag; t.textContent = txt;
      var f = document.createElement('span'); f.textContent = frase;
      veredicto.appendChild(t); veredicto.appendChild(f);
    }
  }
  var botones = ROOT.querySelectorAll('#ck-seg button');
  cada(botones, function(b){
    b.addEventListener('click', function(){
      cada(botones, function(o){ o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      pintaRating(b.getAttribute('data-dim'));
    });
  });
  pintaRating('general');

  /* 2. Anuncios activos en Meta */
  barras(ROOT.querySelector('#ck-chart-ads'), [
    { nombre: 'FlixBus', valor: 18, nota: '18+' },
    { nombre: 'Turbus', valor: 16 },
    { nombre: 'Kupos.cl', valor: 10 },
    { nombre: 'Pullman Bus', valor: 0 },
    { nombre: 'Expreso Norte', valor: 0 },
    { nombre: 'Cikbus Elité', valor: 0, propio: true }
  ], 20, [0, 5, 10, 15, 20], 0);

  /* Navegación */
  var secciones = [];
  cada(ROOT.querySelectorAll('.ck-toc a'), function(a){
    var href = a.getAttribute('href') || '';
    if(href.charAt(0) !== '#') return;
    var sec = document.getElementById(href.slice(1));
    if(sec){ secciones.push({ link: a, sec: sec }); }
  });
  function marca(activa){
    cada(secciones, function(it){
      if(it.sec === activa){ it.link.classList.add('ck-on'); } else { it.link.classList.remove('ck-on'); }
    });
  }
  if('IntersectionObserver' in window){
    var visibles = {};
    var obs = new IntersectionObserver(function(entries){
      cada(entries, function(en){ visibles[en.target.id] = en.isIntersecting; });
      var hecho = false;
      cada(secciones, function(it){
        if(hecho) return;
        if(visibles[it.sec.id]){ marca(it.sec); hecho = true; }
      });
    }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });
    cada(secciones, function(it){ obs.observe(it.sec); });
  }
  function irA(destino){
    var suave = true;
    if(window.matchMedia){ if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){ suave = false; } }
    try { destino.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' }); }
    catch(e){ destino.scrollIntoView(true); }
  }
  cada(secciones, function(it){
    it.link.addEventListener('click', function(ev){ ev.preventDefault(); irA(it.sec); marca(it.sec); });
  });
  var volver = ROOT.querySelector('.ck-actions a[href="#ck-toc"]');
  var toc = ROOT.querySelector('#ck-toc');
  if(volver){ if(toc){ volver.addEventListener('click', function(ev){ ev.preventDefault(); irA(toc); }); } }

  /* PDF */
  var btn = ROOT.querySelector('#ck-print');
  if(btn){
    btn.addEventListener('click', function(){
      cada(ROOT.querySelectorAll('details'), function(d){ d.setAttribute('open', ''); });
      window.print();
    });
  }
}
})();
