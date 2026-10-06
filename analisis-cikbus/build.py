import re, pathlib
src = pathlib.Path('src/analisis-marca-cikbus.html').read_text(encoding='utf-8')
css = re.search(r'/\* ==CSS== \*/\n(.*?)\n/\* ==/CSS== \*/', src, re.S).group(1)
html = re.search(r'<!-- ==HTML== -->\n(.*?)\n<!-- ==/HTML== -->', src, re.S).group(1)
js  = re.search(r'/\* ==JS== \*/\n(.*?)\n/\* ==/JS== \*/', src, re.S).group(1)
out = pathlib.Path('.')
# HTML en una sola linea: el CMS (wpautop) mete <p> y <br> donde hay saltos y rompe tablas
html_cms = re.sub(r'<!--.*?-->', '', html, flags=re.S)
html_cms = re.sub(r'>\s+<', '><', html_cms)
html_cms = re.sub(r'\s*\n\s*', ' ', html_cms).strip()
(out/'SARAHI-analisis-cikbus-1-HTML.html').write_text(html_cms+'\n', encoding='utf-8')
html = html_cms
(out/'SARAHI-analisis-cikbus-2-CSS.css').write_text(css+'\n', encoding='utf-8')
(out/'SARAHI-analisis-cikbus-3-JAVASCRIPT.js').write_text(js+'\n', encoding='utf-8')
# single piece deliverable
(out/'analisis-marca-cikbus-elite-2026-10-05.html').write_text(src, encoding='utf-8')
# hostile test page: CMS mangling + theme + script before markup
mangle = lambda t: t.replace('&', '&#038;')
tema = ('body{margin:0;background:#fff;color:#444;font-family:"DM Sans",sans-serif}'
        'h1,h2,h3,h4{font-family:Georgia,serif;margin:0 0 20px}p{margin:0 0 1.2em}'
        'button{background:#8088E6;color:#fff;border:2px solid #181818;padding:14px 28px;text-transform:uppercase}'
        'input{width:100%;border:2px solid #DADADA;padding:16px}'
        'table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:12px}'
        '.card{background:#181818!important;color:#fff;padding:60px}'
        '.tile,.chip,.step,.seg,.wrap,.hero,.band,.kpi{background:#ffe;border:3px dashed red;padding:40px}')
pagina = ('<!doctype html><html lang="es"><head><meta charset="utf-8">'
          '<meta name="viewport" content="width=device-width,initial-scale=1">'
          '<style>'+tema+'</style><style>'+mangle(css)+'</style></head><body>'
          '<header><h1>Sitio</h1><button>Boton tema</button></header>'
          '<div style="max-width:1170px;margin:0 auto">'
          '<script>'+mangle(js)+'</script>'+mangle(html)+'</div>'
          '<footer><div class="card">.card del tema, debe seguir negra</div></footer>'
          '</body></html>')
(out/'test/test-cms.html').parent.mkdir(exist_ok=True)
(out/'test/test-cms.html').write_text(pagina, encoding='utf-8')
for f in ['SARAHI-analisis-cikbus-1-HTML.html','SARAHI-analisis-cikbus-2-CSS.css','SARAHI-analisis-cikbus-3-JAVASCRIPT.js']:
    t=(out/f).read_text(encoding='utf-8'); print(f, len(t), 'chars, ampersands:', t.count('&'))
