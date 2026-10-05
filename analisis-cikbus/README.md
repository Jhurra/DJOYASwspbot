# Análisis de Marca Cikbus Elité x SARAHI (05/10/2026)

Carpeta autocontenida. No depende del resto del repositorio.

- `analisis-marca-cikbus-elite-2026-10-05.html`: página completa de una sola pieza para abrir en el navegador o enviar.
- `SARAHI-analisis-cikbus-1-HTML.html`, `-2-CSS.css`, `-3-JAVASCRIPT.js`: los tres archivos para pegar en las pestañas HTML, CSS y JavaScript del bloque de sarahiagency.com. Sin ampersands, sin reglas sobre body ni :root, namespace `.sarcik`.
- `contexto-base-cikbus-2026-10-05.txt`: documento de contexto base con las 6 áreas de fuentes y su estado de verificación.
- `src/analisis-marca-cikbus.html`: fuente única. `python3 build.py` regenera los tres archivos, la página de una pieza y la página de prueba hostil.
- `test/check.js`: prueba con Playwright (errores de JS, scroll horizontal a 1280 y 390 px, tema del sitio intacto, navegación). `node test/check.js` desde la carpeta `test`.
