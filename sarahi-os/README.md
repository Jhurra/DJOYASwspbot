# SARAHI OS

La plataforma propia de SARAHI para dejar de pagar monday: tableros, CRM, clientes («La semana» de cada uno),
ventas, mi trabajo, notas y transcripciones de reuniones con resumen por IA. Es el mismo artefacto que se armó
en Claude, ahora instalable en tu hosting con inicio de sesión por email y contraseña.

- **Interfaz**: `assets/app.js` y `assets/app.css` son el artefacto tal cual, con dos cambios: dentro de un
  cliente ya no aparecen Kanban ni Calendario, y se quitó la importación desde monday (los datos ya vienen migrados).
- **Servidor**: PHP 8.1+ y SQLite. No necesita base de datos aparte. `assets/adapter.js` conecta la interfaz con `api.php`.
- **Versión día**: la interfaz siempre se muestra en tema claro.

## Quién ve qué

| Rol | Ve | Puede cambiar |
|---|---|---|
| Administrador (Jorge) | Todo: ventas, CRM, leads, clientes, usuarios y ajustes | Todo |
| Equipo | Todo menos los tableros de ventas y las columnas marcadas como ocultas (por ejemplo, el fee) | Elementos y estructura de lo que ve |
| Solo clientes (Osvaldo) | Los tableros de cada cliente, la ficha de clientes y los tableros que le compartas | Tareas, comentarios y notas, pero no columnas, grupos ni tableros |

El servidor aplica estos permisos: aunque alguien manipule el navegador, no recibe ni puede escribir lo que no le toca.

## Instalar en Verpex (cPanel), en un subdominio

1. **Arma el paquete** (o usa el ZIP que te entregó Claude): `tools/build.sh ruta/a/seed.json` crea
   `dist/sarahi-os.zip` y muestra el **código de instalación**.
2. En cPanel → **Dominios** → crea el subdominio, por ejemplo `os.sarahiagency.com`. Anota su carpeta
   (por ejemplo `os.sarahiagency.com/`).
3. En cPanel → **Seleccionar versión de PHP**: elige **8.1 o superior** para ese subdominio y deja activas las
   extensiones `pdo_sqlite`, `mbstring` y `curl` (vienen activas casi siempre).
4. En **Administrador de archivos**, entra a la carpeta del subdominio, sube `sarahi-os.zip` y usa **Extraer**.
   Mueve el contenido de la carpeta `sarahi-os/` a la raíz del subdominio (debe quedar `index.php` en la raíz).
5. En cPanel → **SSL/TLS Status**, emite el certificado del subdominio (HTTPS).
6. Abre `https://os.sarahiagency.com`: aparece **Instalación**. Escribe el código, tu nombre, tu email y una
   contraseña, deja marcado **Cargar mis tableros, clientes y reuniones** y pulsa **Instalar y entrar**.
7. **Ajustes → Usuarios y permisos → Nuevo usuario**: crea a Osvaldo con el rol **Solo clientes**.

### Activar los resúmenes con IA (opcional)
En `private/config.php` pon tu clave de [console.anthropic.com](https://console.anthropic.com) en `anthropic_api_key`.
Se usa para «Resumir con IA» en Transcripciones y en «La semana» de cada cliente. Modelo: Claude Opus 5.5
(`ai_model`), con esfuerzo `low` para que responda rápido (`ai_effort`).

### Reuniones de Google Meet automáticas
Ajustes → **Reuniones automáticas** → **Copiar el script** → pégalo en [script.google.com](https://script.google.com)
con la cuenta donde llegan las «Notas de Gemini» y ejecuta **instalar**. Cada 15 minutos manda las reuniones nuevas,
que quedan vinculadas al cliente que corresponde.

### Formularios de sarahiagency.com
Ajustes → **Formulario de la web** muestra la dirección a la que deben enviar los formularios (POST). Campos:
`empresa, nombre, email, telefono, whatsapp, sitio, pais, origen`; el resto queda en Notas del lead.
`website_hp` es un campo trampa anti-spam (ocúltalo con CSS). Con un campo `redirect` se vuelve a tu página de gracias.

## Copias de seguridad

- Desde la app: **Ajustes → Copia de seguridad → Descargar copia** (JSON). Se restaura con **Restaurar copia**.
- La base completa es un solo archivo: `private/data/<db_file>.sqlite`. Descárgalo desde cPanel cada cierto tiempo
  (o activa las copias automáticas de Verpex).

## Seguridad

- Contraseñas con `password_hash`; sesión en cookie `HttpOnly`, `SameSite=Lax` y `Secure` con HTTPS.
- Freno a fuerza bruta: 10 intentos fallidos cada 15 minutos por email o IP.
- `private/` está bloqueada por `.htaccess`, y el archivo de la base tiene un nombre aleatorio.
- Las peticiones que cambian datos exigen la cabecera `X-SOS` (protección CSRF).

## Pruebas

```bash
COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev
python3 tests/test_server.py [ruta/a/seed.json]
```
Levanta la app con `php -S`, con una IA simulada, y prueba instalación, permisos de cada rol, columnas privadas,
sincronización entre usuarios, formulario web, reuniones de Meet e IA.
