# jorgeurra.com

Sitio estático (HTML + CSS + JS, sin WordPress) de Jorge Urra, con SARAHI presente en cada sección.

## Estructura

| Archivo | Para qué |
|---|---|
| `index.html` | Página completa (SEO, secciones, textos fijos) |
| `contenido.js` | **Lo que actualizas:** WhatsApp, email, redes y la lista de novedades |
| `assets/styles.css` | Diseño con los tokens de SARAHI (DM Sans, naranja, charcoal, lima, crema) |
| `assets/app.js` | Aplica `contenido.js`: enlaces de contacto, novedades, año del footer |
| `assets/logo-sarahi.png` | Wordmark SARAHI con fondo transparente |
| `CNAME`, `robots.txt`, `sitemap.xml` | Dominio y SEO básico |

## Cómo actualizarlo

1. Edita `contenido.js` (por ejemplo, agrega una novedad al principio de `novedades`).
2. Commit y push a `main`.
3. El workflow `.github/workflows/jorgeurra-pages.yml` lo publica solo en GitHub Pages.

Para verlo en local basta con abrir `index.html` en el navegador.

## Publicación (una sola vez)

1. GitHub → Settings → Pages → Source: **GitHub Actions**.
2. Settings → Pages → Custom domain: `jorgeurra.com`.
3. En el DNS del dominio:
   - Registros `A` de `jorgeurra.com` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` de `www` → `<usuario>.github.io`

También sirve cualquier hosting estático (Netlify, Cloudflare Pages, Vercel o subir la carpeta por FTP).

## Pendiente de confirmar

- Número real de WhatsApp en `contenido.js` (hoy es el marcador `34600000000`).
- Texto de "Sobre mí" y el cargo exacto de Jorge en SARAHI.
- LinkedIn e Instagram, si se quieren en el footer.
