<?php
/* SARAHI OS — API JSON que usa assets/adapter.js. */
require __DIR__ . '/private/lib/bootstrap.php';

$action = $_GET['a'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Las peticiones que cambian algo deben traer esta cabecera: un formulario de otro sitio no puede ponerla (CSRF).
if ($method === 'POST' && ($_SERVER['HTTP_X_SOS'] ?? '') !== '1') fail('Petición no válida', 403);

if ($action === 'login' && $method === 'POST') {
    $in = read_json_body();
    $email = mb_strtolower(trim((string) ($in->email ?? '')));
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    db()->prepare('DELETE FROM login_fails WHERE at < ?')->execute([time() - 900]);
    $st = db()->prepare('SELECT COUNT(*) FROM login_fails WHERE email = ? OR ip = ?');
    $st->execute([$email, $ip]);
    if ((int) $st->fetchColumn() >= 10) fail('Demasiados intentos. Espera 15 minutos.', 429);
    $st = db()->prepare('SELECT * FROM users WHERE email = ?');
    $st->execute([$email]);
    $u = $st->fetch();
    if (!$u || !password_verify((string) ($in->password ?? ''), $u['pass'])) {
        db()->prepare('INSERT INTO login_fails (email, ip, at) VALUES (?, ?, ?)')->execute([$email, $ip, time()]);
        fail('Email o contraseña incorrectos', 401);
    }
    login_user($u);
    send_json(['ok' => true]);
}

if ($action === 'setup' && $method === 'POST') {
    if (users_count() > 0) fail('La instalación ya está hecha', 403);
    $in = read_json_body();
    $code = (string) config('setup_code', '');
    if ($code === '' || !hash_equals($code, (string) ($in->code ?? ''))) fail('El código de instalación no es correcto', 403);
    $user = save_user(null, $in, true);
    $imported = 0;
    if (!empty($in->import)) $imported = import_seed();
    login_user($user);
    send_json(['ok' => true, 'imported' => $imported]);
}

$user = current_user();
if (!$user) fail('No has iniciado sesión', 401);
$perm = new Perm($user);

switch ($action) {
    case 'boot':
        $docs = [];
        $st = db()->query('SELECT c, id, data, rev FROM docs WHERE data IS NOT NULL');
        foreach ($st as $r) {
            $d = json_decode($r['data']);
            if ($perm->docVisible($r['c'], $r['id'], $d)) $docs[] = ['c' => $r['c'], 'id' => $r['id'], 'd' => $perm->sanitize($r['c'], $d), 'rev' => (int) $r['rev']];
        }
        send_json([
            'me' => user_public($user),
            'caps' => ['server' => true, 'ai' => ai_enabled(), 'readOnly' => false, 'downloads' => false],
            'rev' => current_rev(),
            'docs' => $docs,
        ]);

    case 'changes':
        $since = (int) ($_GET['since'] ?? 0);
        $st = db()->prepare('SELECT c, id, data, rev FROM docs WHERE rev > ? ORDER BY rev LIMIT 5000');
        $st->execute([$since]);
        $docs = [];
        $max = $since;
        foreach ($st as $r) {
            $max = max($max, (int) $r['rev']);
            $d = $r['data'] === null ? null : json_decode($r['data']);
            // Si un documento deja de ser visible para alguien (p. ej. un tablero que pasa a ventas), se le manda como borrado
            $vis = $perm->docVisible($r['c'], $r['id'], $d);
            $docs[] = ['c' => $r['c'], 'id' => $r['id'], 'd' => $vis ? $perm->sanitize($r['c'], $d) : null, 'rev' => (int) $r['rev']];
        }
        send_json(['rev' => max($max, $since), 'docs' => $docs]);

    case 'write':
        if ($method !== 'POST') fail('Método no permitido', 405);
        $in = read_json_body();
        $ops = is_array($in->ops ?? null) ? $in->ops : [];
        if (count($ops) > 500) fail('Demasiados cambios en una sola petición');
        $revs = [];
        db()->exec('BEGIN IMMEDIATE');
        try {
            foreach ($ops as $o) {
                $op = (string) ($o->op ?? '');
                if (!in_array($op, ['set', 'update', 'del'], true)) throw new RuntimeException('Operación no válida');
                $c = (string) ($o->c ?? '');
                $id = (string) ($o->id ?? '');
                $d = isset($o->d) && is_object($o->d) ? $o->d : null;
                $final = $perm->resolveWrite($op, $c, $id, $d);
                $revs[] = ['c' => $c, 'id' => $id, 'rev' => doc_put($c, $id, $final)];
                if ($c === 'boards') $perm = new Perm($user); // los permisos dependen de los tableros
            }
            db()->exec('COMMIT');
        } catch (RuntimeException $e) {
            db()->exec('ROLLBACK');
            fail($e->getMessage(), 403);
        } catch (Throwable $e) {
            db()->exec('ROLLBACK');
            error_log('SARAHI OS write: ' . $e->getMessage());
            fail('No se pudo guardar', 500);
        }
        send_json(['ok' => true, 'revs' => $revs]);

    case 'ai':
        if ($method !== 'POST') fail('Método no permitido', 405);
        $in = read_json_body();
        $prompt = (string) ($in->prompt ?? '');
        if ($prompt === '' || strlen($prompt) > 400000) fail('Texto no válido');
        try {
            $text = ai_complete($prompt);
            send_json(!empty($in->json) ? ['json' => ai_parse_json($text)] : ['text' => $text]);
        } catch (RuntimeException $e) {
            fail($e->getMessage(), 502);
        }

    case 'call':
        if ($method !== 'POST') fail('Método no permitido', 405);
        $in = read_json_body();
        $args = isset($in->args) && is_object($in->args) ? $in->args : new stdClass();
        handle_call((string) ($in->name ?? ''), $args, $user, $perm);
}
fail('Acción desconocida', 404);

function handle_call(string $name, object $args, array $user, Perm $perm): void
{
    if ($name === 'logout') {
        $_SESSION = [];
        session_destroy();
        send_json(['ok' => true]);
    }
    if (!$perm->isAdmin()) fail('Solo un administrador puede hacer esto', 403);
    switch ($name) {
        case 'users':
            $rows = db()->query('SELECT * FROM users ORDER BY id')->fetchAll();
            send_json(['users' => array_map(fn ($u) => ['id' => (int) $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'access' => json_decode($u['access'] ?: '{}'), 'last_login' => $u['last_login']], $rows)]);
        case 'user_save':
            try {
                save_user(isset($args->id) && $args->id !== null && $args->id !== '' ? (int) $args->id : null, $args, false, (int) $user['id']);
            } catch (RuntimeException $e) {
                fail($e->getMessage());
            }
            send_json(['ok' => true]);
        case 'user_delete':
            $id = (int) ($args->id ?? 0);
            if ($id === (int) $user['id']) fail('No puedes quitarte el acceso a ti mismo');
            db()->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            send_json(['ok' => true]);
        case 'webhook_info':
            $key = hook_key(!empty($args->rotate));
            send_json(['url' => base_url() . '/hook.php?a=lead&k=' . $key]);
        case 'monday_list':
        case 'monday_import':
            fail('Tus datos de monday ya están migrados. Para cargar otra copia usa Ajustes → Restaurar copia.');
    }
    fail('Acción desconocida', 404);
}

/** Crea o actualiza un usuario. Lanza RuntimeException si los datos no sirven. */
function save_user(?int $id, object $in, bool $first = false, int $actingId = 0): array
{
    $name = trim((string) ($in->name ?? ''));
    $email = mb_strtolower(trim((string) ($in->email ?? '')));
    $pass = (string) ($in->password ?? '');
    $role = $first ? 'admin' : (string) ($in->role ?? 'clients');
    if ($name === '') throw new RuntimeException('Escribe el nombre');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('El email no es válido');
    if (!in_array($role, ROLES, true)) throw new RuntimeException('Rol no válido');
    if (($id === null || $pass !== '') && mb_strlen($pass) < 10) throw new RuntimeException('La contraseña debe tener al menos 10 caracteres');
    $boards = array_values(array_filter(array_map('strval', (array) ($in->boards ?? [])), 'valid_id'));
    $access = json_out(['boards' => $boards]);
    $st = db()->prepare('SELECT id FROM users WHERE email = ? AND id != ?');
    $st->execute([$email, $id ?? 0]);
    if ($st->fetchColumn()) throw new RuntimeException('Ya existe un usuario con ese email');
    if ($id === null) {
        db()->prepare('INSERT INTO users (email, name, pass, role, access, created) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$email, $name, password_hash($pass, PASSWORD_DEFAULT), $role, $access, now_iso()]);
        $id = (int) db()->lastInsertId();
    } else {
        if ($id === $actingId && $role !== 'admin') throw new RuntimeException('No puedes quitarte el rol de administrador');
        db()->prepare('UPDATE users SET email = ?, name = ?, role = ?, access = ? WHERE id = ?')->execute([$email, $name, $role, $access, $id]);
        if ($pass !== '') db()->prepare('UPDATE users SET pass = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $id]);
    }
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch();
}

/** Carga la copia de datos incluida en private/data/seed.json (la migración desde el artefacto). */
function import_seed(): int
{
    $file = __DIR__ . '/private/data/seed.json';
    if (!is_file($file)) return 0;
    $data = json_decode(file_get_contents($file));
    $docs = is_array($data) ? $data : ($data->docs ?? []);
    $n = 0;
    db()->exec('BEGIN IMMEDIATE');
    foreach ($docs as $x) {
        if (!in_array($x->c ?? '', COLLECTIONS, true) || !valid_id((string) ($x->id ?? '')) || !is_object($x->d ?? null)) continue;
        doc_put($x->c, $x->id, $x->d);
        $n++;
    }
    db()->exec('COMMIT');
    rename($file, $file . '.importado');
    return $n;
}
