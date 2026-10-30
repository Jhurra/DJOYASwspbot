#!/usr/bin/env bash
# Arma dist/sarahi-os.zip listo para subir al hosting: código, dependencias, config.php con claves nuevas
# y, si se indica, la copia de datos que se carga al instalar.
#   tools/build.sh [ruta/a/seed.json]
set -euo pipefail
cd "$(dirname "$0")/.."
SEED="${1:-}"
OUT=dist/sarahi-os
rm -rf dist && mkdir -p "$OUT/private/data"
COMPOSER_ALLOW_SUPERUSER=1 composer install -q --no-dev --optimize-autoloader
cp -r .htaccess index.php api.php hook.php assets "$OUT/"
cp -r private/lib private/vendor private/.htaccess private/config.sample.php "$OUT/private/"
cp private/data/.htaccess "$OUT/private/data/"
SETUP_CODE=$(php -r 'echo bin2hex(random_bytes(5));')
DB_NAME="sarahi-$(php -r 'echo bin2hex(random_bytes(8));').sqlite"
sed -e "s/'CAMBIA-ESTE-CODIGO'/'$SETUP_CODE'/" -e "s/'sarahi-CAMBIA-ESTO.sqlite'/'$DB_NAME'/" private/config.sample.php > "$OUT/private/config.php"
[ -n "$SEED" ] && cp "$SEED" "$OUT/private/data/seed.json"
(cd dist && zip -qr sarahi-os.zip sarahi-os)
echo "Listo: dist/sarahi-os.zip ($(du -h dist/sarahi-os.zip | cut -f1))"
echo "Código de instalación: $SETUP_CODE"
