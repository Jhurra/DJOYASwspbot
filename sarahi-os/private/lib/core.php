<?php
/* SARAHI OS — núcleo del servidor: configuración, base de datos, sesión y utilidades. */
defined('SOS') or exit;

const COLLECTIONS = ['meta', 'boards', 'items', 'updates', 'notes', 'transcripts'];
const ROLES = ['admin', 'member', 'clients'];

function config(?string $key = null, $default = null)
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/../config.php';
        if (!is_file($file)) {
            http_response_code(500);
            exit('Falta private/config.php. Copia config.sample.php como config.php y complétalo.');
        }
        $cfg = require $file;
        date_default_timezone_set($cfg['timezone'] ?? 'America/Santiago');
    }
    return $key === null ? $cfg : ($cfg[$key] ?? $default);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $file = __DIR__ . '/../data/' . basename(config('db_file', 'sarahi.sqlite'));
    $pdo = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 8000; PRAGMA foreign_keys = ON;');
    $pdo->exec('CREATE TABLE IF NOT EXISTS docs (c TEXT NOT NULL, id TEXT NOT NULL, data TEXT, rev INTEGER NOT NULL, PRIMARY KEY (c, id))');
    $pdo->exec('CREATE INDEX IF NOT EXISTS docs_rev ON docs (rev)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass TEXT NOT NULL, role TEXT NOT NULL, access TEXT, last_login TEXT, created TEXT NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS login_fails (email TEXT NOT NULL, ip TEXT NOT NULL, at INTEGER NOT NULL)');
    return $pdo;
}

function kv_get(string $k, ?string $default = null): ?string
{
    $st = db()->prepare('SELECT v FROM kv WHERE k = ?');
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? $default : $v;
}

function kv_set(string $k, string $v): void
{
    db()->prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')->execute([$k, $v]);
}

/* ---------- documentos (mismo modelo que la base del artefacto) */

function json_out($v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}

function doc_get(string $c, string $id): ?object
{
    $st = db()->prepare('SELECT data FROM docs WHERE c = ? AND id = ?');
    $st->execute([$c, $id]);
    $d = $st->fetchColumn();
    return $d ? json_decode($d) : null;
}

function docs_all(string $c): array
{
    $st = db()->prepare('SELECT id, data FROM docs WHERE c = ? AND data IS NOT NULL');
    $st->execute([$c]);
    $out = [];
    foreach ($st as $r) $out[$r['id']] = json_decode($r['data']);
    return $out;
}

function next_rev(): int
{
    db()->exec("INSERT INTO kv (k, v) VALUES ('rev', '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1");
    return (int) kv_get('rev');
}

function current_rev(): int
{
    return (int) kv_get('rev', '0');
}

/* Guarda (o borra, con $d = null) y devuelve la revisión. Los borrados quedan como marca para que las demás pestañas se enteren. */
function doc_put(string $c, string $id, ?object $d): int
{
    $rev = next_rev();
    db()->prepare('INSERT INTO docs (c, id, data, rev) VALUES (?, ?, ?, ?) ON CONFLICT(c, id) DO UPDATE SET data = excluded.data, rev = excluded.rev')
        ->execute([$c, $id, $d === null ? null : json_out($d), $rev]);
    return $rev;
}

/* Fusión igual a merge() de app.js: los objetos se combinan, las listas y valores simples se reemplazan. */
function merge_doc($a, $b)
{
    $out = is_object($a) ? clone $a : new stdClass();
    foreach (get_object_vars($b) as $k => $v) {
        if (is_object($v) && isset($out->$k) && is_object($out->$k)) $out->$k = merge_doc($out->$k, $v);
        else $out->$k = $v;
    }
    return $out;
}

function valid_id(string $id): bool
{
    return (bool) preg_match('/^[A-Za-z0-9_\-.:]{1,120}$/', $id);
}

/* ---------- utilidades */

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s.v\Z');
}

function today_iso(): string
{
    return date('Y-m-d');
}

function uid(string $p): string
{
    return $p . base_convert((string) (int) (microtime(true) * 1000), 10, 36) . bin2hex(random_bytes(3));
}

/* Igual a norm() de app.js: minúsculas, sin tildes, sin espacios a los lados. */
function norm($s): string
{
    $s = mb_strtolower((string) $s, 'UTF-8');
    $s = strtr($s, ['á' => 'a', 'à' => 'a', 'ä' => 'a', 'â' => 'a', 'ã' => 'a', 'é' => 'e', 'è' => 'e', 'ë' => 'e', 'ê' => 'e', 'í' => 'i', 'ì' => 'i', 'ï' => 'i', 'î' => 'i', 'ó' => 'o', 'ò' => 'o', 'ö' => 'o', 'ô' => 'o', 'õ' => 'o', 'ú' => 'u', 'ù' => 'u', 'ü' => 'u', 'û' => 'u', 'ñ' => 'n', 'ç' => 'c']);
    return trim($s);
}

function base_url(): string
{
    $cfg = rtrim((string) config('base_url', ''), '/');
    if ($cfg) return $cfg;
    $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir;
}

function is_https(): bool
{
    return ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function send_json($v, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_out($v);
    exit;
}

function fail(string $msg, int $status = 400): void
{
    send_json(['error' => $msg], $status);
}

function read_json_body(): object
{
    $raw = file_get_contents('php://input');
    $d = json_decode($raw ?: '{}');
    if (!is_object($d)) fail('JSON no válido');
    return $d;
}

/* ---------- sesión y usuarios */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('sos');
    session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'httponly' => true, 'secure' => is_https(), 'samesite' => 'Lax']);
    ini_set('session.gc_maxlifetime', (string) (60 * 60 * 24 * 30));
    session_start();
}

function current_user(): ?array
{
    start_session();
    $id = $_SESSION['uid'] ?? null;
    if (!$id) return null;
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u || ($_SESSION['pv'] ?? '') !== substr($u['pass'], -12)) return null; // cambió la contraseña o se borró el usuario
    $u['access'] = json_decode($u['access'] ?: '{}') ?: new stdClass();
    return $u;
}

function login_user(array $u): void
{
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = $u['id'];
    $_SESSION['pv'] = substr($u['pass'], -12);
    db()->prepare('UPDATE users SET last_login = ? WHERE id = ?')->execute([now_iso(), $u['id']]);
}

function users_count(): int
{
    return (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
}

function user_public(array $u): array
{
    return ['id' => 'u' . $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role']];
}
