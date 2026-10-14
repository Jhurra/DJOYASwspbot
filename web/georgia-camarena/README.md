# Terapia con Gi: sitio web de Georgia Camarena

Sitio estático en HTML, CSS y JS, con el diseño y la paleta de la plantilla Blocksy Consultant.

## Archivos

```
index.html        Inicio
conoceme.html     Conóceme
servicios.html    Servicios
contacto.html     Contacto
css/styles.css    Estilos de todas las páginas
js/main.js        Menú móvil, número de WhatsApp, formulario y botón de copiar
img/              Fotos (retrato, videollamada y 3 imágenes del sitio actual)
notas/            Documento interno con la estructura. No se sube al hosting.
```

## Cómo montarlo

1. Sube `index.html`, `conoceme.html`, `servicios.html`, `contacto.html` y las carpetas `css`, `js` e `img` a la carpeta pública del hosting (normalmente `public_html`), con la misma estructura.
2. Abre `js/main.js` y escribe el número de WhatsApp en la línea `var WHATSAPP = "";`, con código de país y sin espacios ni signos. Ejemplo: `"5215512345678"`. Todos los botones de WhatsApp del sitio lo toman de ahí.
3. Busca en los HTML las etiquetas `class="todo"` (se ven como avisos amarillos de **Pendiente**) y reemplázalas por el dato real antes de publicar.

El sitio actual está hecho con el constructor de GoDaddy, que no permite subir archivos HTML propios. Para usar estos archivos hace falta un hosting con acceso a archivos: el hosting web de GoDaddy con cPanel, Hostinger, Netlify u otro similar.

## Pendientes

- Número de WhatsApp (en `js/main.js`).
- Correo de contacto.
- Duración y precio de la sesión. Confirmar si habrá paquete de 4 sesiones.
- Un testimonio real con permiso.
- Validar los 4 servicios y el texto de "Mi historia".
- El formulario de contacto todavía no envía correos. Hay que conectarlo a un servicio como Formspree o al correo del hosting.
- Enlaces de Facebook y TikTok.
