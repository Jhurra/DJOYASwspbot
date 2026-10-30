# SARAHI CRM

Plataforma propia para reemplazar Monday: espacios de trabajo, carpetas, tableros, grupos, columnas,
vista de tabla, kanban y resumen, ficha de cada elemento con subelementos y actualizaciones,
usuarios con permisos y exportación a Excel (CSV). Tema claro ("versión día").

## Qué replica de Monday

| Monday | SARAHI CRM |
|---|---|
| Espacios de trabajo y carpetas | Sí. Cada usuario ve solo los espacios a los que tiene acceso |
| Tableros con grupos | Sí (renombrar, color, contraer) |
| Columnas | Texto, texto largo, número (con unidad: $, UF…), estado, lista desplegable, fecha, cronograma, email, teléfono (abre WhatsApp), enlace, casilla, personas, conectar tableros, archivos (enlaces) |
| Vista tabla | Edición en la celda, suma de números por grupo, búsqueda y filtros |
| Vista kanban | Arrastrar tarjetas entre etapas |
| Dashboard | Pestaña Resumen: totales, sumas, seguimientos vencidos y distribución por etapa, fuente, etc. |
| Subelementos y actualizaciones | En la ficha de cada elemento |
| Exportar a Excel | Botón Exportar (CSV) |
| Permisos | Administrador ve todo; miembros solo los espacios que se les asignen |

Aún no tiene automatizaciones, notificaciones por email ni subida de archivos (los archivos se guardan como enlaces de Drive/Dropbox).

## Probar en local

```bash
cd crm
pip install -r requirements.txt
cp .env.example .env        # en local: DATABASE_URL=sqlite:///./crm.db y COOKIE_SECURE=false
python -m app.cli crear-admin --email tu@correo.com --nombre "Jorge"
uvicorn app.main:app --reload --port 8000
```

Abre http://localhost:8000

## Traer los datos desde Monday

1. En Monday: foto de perfil → **Desarrolladores** → **Mi token de acceso** → copiar.
2. Importa los espacios que quieras (los IDs están en la URL de Monday, `/workspaces/ID`):

```bash
python -m app.cli importar-monday --token TU_TOKEN --workspace 5874363 --workspace 2625801 --con-comentarios
```

- Copia espacios, carpetas, tableros, grupos, columnas (con sus colores), elementos, subelementos, conexiones entre tableros y, con `--con-comentarios`, las actualizaciones.
- Se puede repetir: lo ya importado se actualiza, no se duplica. Importa ahora, usa ambos unos días y vuelve a importar justo antes de cancelar Monday.
- Las columnas que no existen aquí (fórmulas, espejos…) se importan como texto con el valor que mostraba Monday.
- Los archivos subidos a Monday no se descargan: descárgalos antes de cancelar.

## Dar acceso a otras personas

Desde la plataforma: ⚙ (abajo a la izquierda) → **Invitar usuario** → marcar los espacios a los que tendrá acceso.
Ejemplo: "CRM y Ventas" solo para ti y "Clientes SARAHI" para ti y tu equipo.

## Publicar en internet

Necesitas un servidor con Python y una base PostgreSQL. La opción más simple es Render o Railway:

- Directorio raíz: `crm`
- Build: `pip install -r requirements.txt`
- Start: `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:$PORT`
- Variables: `DATABASE_URL` (de la base PostgreSQL que crea el mismo servicio)
- Después, en la consola del servicio: `python -m app.cli crear-admin ...` y `python -m app.cli importar-monday ...`

También hay un `Dockerfile` listo.

Haz respaldos de la base de datos (Render y Railway los ofrecen automáticos en sus planes pagos).

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
