(function(){
"use strict";

/* Sin los caracteres ampersand, menor que ni mayor que: el CMS los reescribe. */
function cada(lista, fn){
  var i = 0;
  var n = lista ? lista.length : 0;
  while(i !== n){ fn(lista[i], i); i = i + 1; }
}

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
  var links = ROOT.querySelectorAll('.ck-toc a');
  var secciones = [];
  cada(links, function(a){
    var href = a.getAttribute('href') || '';
    if(href.charAt(0) !== '#') return;
    var sec = document.getElementById(href.slice(1));
    if(sec){ secciones.push({ link: a, sec: sec }); }
  });

  function marca(activa){
    cada(secciones, function(it){
      if(it.sec === activa){ it.link.classList.add('ck-on'); }
      else { it.link.classList.remove('ck-on'); }
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

  cada(secciones, function(it){
    it.link.addEventListener('click', function(ev){
      ev.preventDefault();
      var suave = true;
      if(window.matchMedia){
        if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){ suave = false; }
      }
      try {
        it.sec.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
      } catch(e){
        it.sec.scrollIntoView(true);
      }
      marca(it.sec);
    });
  });

  var btn = ROOT.querySelector('#ck-print');
  if(btn){
    btn.addEventListener('click', function(){
      cada(ROOT.querySelectorAll('details'), function(d){ d.setAttribute('open', ''); });
      window.print();
    });
  }
}
})();
