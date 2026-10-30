<?php
/* SARAHI OS — entradas desde afuera, protegidas con la clave privada (Ajustes → Formulario de la web).
   ?a=lead     formularios de sarahiagency.com → lead nuevo en el tablero elegido
   ?a=meeting  script de Google (Apps Script) → transcripción de una reunión de Google Meet */
require __DIR__ . '/private/lib/bootstrap.php';

$action = $_GET['a'] ?? '';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = (array) config('form_allowed_hosts', []);
$originHost = $origin ? parse_url($origin, PHP_URL_HOST) : null;
if ($originHost && in_array($originHost, $allowed, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: POST');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') exit;
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('Método no permitido', 405);
if (!hash_equals(hook_key(), (string) ($_GET['k'] ?? ''))) fail('Clave no válida', 403);

$ctype = $_SERVER['CONTENT_TYPE'] ?? '';
$fields = str_contains($ctype, 'application/json') ? (array) json_decode(file_get_contents('php://input') ?: '{}', true) : $_POST;

try {
    db()->exec('BEGIN IMMEDIATE');
    if ($action === 'lead') {
        // Campo trampa: los humanos no lo ven, los bots lo llenan
        if (trim((string) ($fields['website_hp'] ?? '')) !== '') { db()->exec('ROLLBACK'); send_json(['ok' => true]); }
        $id = save_lead($fields);
    } elseif ($action === 'meeting') {
        $id = save_meeting(json_decode(json_encode($fields)));
    } else {
        throw new RuntimeException('Acción desconocida');
    }
    db()->exec('COMMIT');
} catch (RuntimeException $e) {
    db()->exec('ROLLBACK');
    fail($e->getMessage());
}

// Formularios HTML clásicos: volver a la página de gracias del sitio
$redirect = (string) ($fields['redirect'] ?? '');
$rhost = $redirect ? parse_url($redirect, PHP_URL_HOST) : null;
if ($rhost && in_array($rhost, $allowed, true) && preg_match('#^https?://#', $redirect)) {
    header('Location: ' . $redirect, true, 303);
    exit;
}
send_json(['ok' => true, 'id' => $id]);
