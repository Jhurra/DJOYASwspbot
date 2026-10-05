(function(){
"use strict";

function arranca(){
  var ROOT = document.querySelector('.sarcik');
  if(!ROOT){
    arranca.intentos = (arranca.intentos || 0) + 1;
    if(arranca.intentos < 100) setTimeout(arranca, 100);
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
  var links = ROOT.querySelectorAll('.ck-toc a[href^="#"]');
  var secciones = [];
  var i;
  for(i = 0; i < links.length; i++){
    var id = links[i].getAttribute('href').slice(1);
    var sec = document.getElementById(id);
    if(sec){ secciones.push({ link: links[i], sec: sec }); }
  }

  function marca(activa){
    for(var k = 0; k < secciones.length; k++){
      if(secciones[k].sec === activa){
        secciones[k].link.classList.add('ck-on');
      } else {
        secciones[k].link.classList.remove('ck-on');
      }
    }
  }

  if('IntersectionObserver' in window){
    var visibles = {};
    var obs = new IntersectionObserver(function(entries){
      for(var e = 0; e < entries.length; e++){
        visibles[entries[e].target.id] = entries[e].isIntersecting;
      }
      for(var s = 0; s < secciones.length; s++){
        if(visibles[secciones[s].sec.id]){ marca(secciones[s].sec); return; }
      }
    }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });
    for(i = 0; i < secciones.length; i++){ obs.observe(secciones[i].sec); }
  }

  for(i = 0; i < links.length; i++){
    links[i].addEventListener('click', function(ev){
      var destino = document.getElementById(this.getAttribute('href').slice(1));
      if(!destino) return;
      ev.preventDefault();
      var suave = true;
      if(window.matchMedia){
        if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){ suave = false; }
      }
      destino.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
      if(history.replaceState){ history.replaceState(null, '', '#' + destino.id); }
    });
  }

  var btn = ROOT.querySelector('#ck-print');
  if(btn){
    btn.addEventListener('click', function(){
      var det = ROOT.querySelectorAll('details');
      for(var d = 0; d < det.length; d++){ det[d].setAttribute('open', ''); }
      window.print();
    });
  }
}
})();
