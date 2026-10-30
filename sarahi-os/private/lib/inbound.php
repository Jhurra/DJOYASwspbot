<?php
/* SARAHI OS — lo que llega de afuera: leads del formulario de la web y notas de Google Meet (Apps Script).
   La asignación de cada reunión a su cliente es la misma que hace app.js (aliasesOf / matchClient / meetingDoc). */
defined('SOS') or exit;

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

function fmt_date_short(string $iso): string
{
    $p = array_map('intval', explode('-', substr($iso, 0, 10)));
    if (count($p) < 3 || !$p[1]) return $iso;
    return $p[2] . ' ' . MONTHS_SHORT[$p[1] - 1] . ($p[0] !== (int) date('Y') ? ' ' . $p[0] : '');
}

function squash($s): string
{
    $s = preg_replace('/[^a-z0-9 ]/', ' ', norm($s));
    $s = preg_replace('/(.)\1+/', '$1', $s);
    return trim(preg_replace('/\s+/', ' ', $s));
}

function aliases_of($name): array
{
    $stop = '/^(internacional|international|sarahi|spa|ltda|limitada|chile|espana|spain|group|grupo|the|de|del|la|el|los|las|y|and|x|s a|sa)$/';
    $set = [];
    $add = function ($s) use (&$set, $stop) {
        $w = implode(' ', array_filter(explode(' ', squash($s)), fn ($x) => $x !== '' && !preg_match($stop, $x)));
        if (strlen($w) >= 3) $set[$w] = true;
    };
    $add($name);
    foreach (preg_split('/\s*(?:&|\/|\+|,|\s-\s|\sy\s|\sx\s)\s*/i', (string) $name) as $part) $add($part);
    return array_keys($set);
}

function board_items(string $boardId): array
{
    $out = [];
    foreach (docs_all('items') as $id => $it) if (($it->board ?? null) === $boardId && empty($it->parent)) $out[$id] = $it;
    return $out;
}

function client_candidates(object $st, array $boards): array
{
    $out = [];
    $cbId = $st->clientsBoard ?? null;
    $cb = $cbId ? ($boards[$cbId] ?? null) : null;
    if ($cb) {
        $emailCol = null;
        foreach (($cb->columns ?? []) as $col) if (($col->type ?? '') === 'email') { $emailCol = $col->id; break; }
        foreach (board_items($cbId) as $iid => $it) {
            $aliases = aliases_of($it->name ?? '');
            foreach ($boards as $bid => $b) {
                if (!empty($b->isTemplate)) continue;
                if (($b->clientItem ?? null) === $iid || norm($b->name ?? '') === norm($it->name ?? '')) { $aliases = array_merge($aliases, aliases_of($b->name ?? '')); break; }
            }
            $mails = $emailCol && isset($it->values->$emailCol) ? (array) $it->values->$emailCol : [];
            $domains = array_values(array_filter(array_map(fn ($m) => explode('@', (string) $m)[1] ?? '', $mails)));
            $out[] = ['link' => (object) ['board' => $cbId, 'item' => $iid], 'name' => $it->name ?? '', 'aliases' => array_values(array_unique($aliases)), 'domains' => $domains];
        }
    }
    foreach ($boards as $bid => $b) {
        if (!Perm::isClientBoard((string) $bid, $b, $st) || !empty($b->clientItem)) continue;
        $first = aliases_of($b->name ?? '')[0] ?? null;
        $dup = false;
        foreach ($out as $o) if ($first !== null && in_array($first, $o['aliases'], true)) $dup = true;
        if (!$dup) $out[] = ['link' => (object) ['board' => (string) $bid], 'name' => $b->name ?? '', 'aliases' => aliases_of($b->name ?? ''), 'domains' => []];
    }
    return $out;
}

function match_client(object $p, object $st, array $boards): ?array
{
    $cands = client_candidates($st, $boards);
    if (!$cands) return null;
    $T = ' ' . squash($p->title ?? '') . ' ';
    $B = ' ' . squash(($p->summary ?? '') . ' ' . substr((string) ($p->body ?? ''), 0, 40000)) . ' ';
    $doms = [];
    foreach ((array) ($p->emails ?? []) as $e) {
        $d = explode('@', (string) $e)[1] ?? '';
        if ($d && !preg_match('/^(gmail|hotmail|outlook|live|yahoo|icloud|me|msn|protonmail|sarahiagency|jorgeurra)\./', $d)) $doms[] = $d;
    }
    $scored = [];
    foreach ($cands as $c) {
        $s = 0;
        foreach ($c['aliases'] as $a) {
            if (strpos($T, ' ' . $a . ' ') !== false) $s += 10;
            $k = str_replace(' ', '', $a);
            foreach ($doms as $d) {
                $d0 = preg_replace('/[^a-z0-9]/', '', explode('.', $d)[0]);
                if ($d0 === $k || (strlen($k) >= 5 && strpos(preg_replace('/[^a-z0-9]/', '', $d), $k) !== false)) { $s += 6; break; }
            }
            $n = 0;
            $i = strpos($B, ' ' . $a . ' ');
            while ($i !== false && $n < 8) { $n++; $i = strpos($B, ' ' . $a . ' ', $i + 1); }
            $s += $n;
        }
        if (array_intersect($c['domains'], $doms)) $s += 6;
        $scored[] = ['c' => $c, 's' => $s];
    }
    usort($scored, fn ($x, $y) => $y['s'] <=> $x['s']);
    $best = $scored[0];
    $second = $scored[1] ?? null;
    if ($best['s'] < 2 || ($second && $second['s'] * 1.5 > $best['s'])) return null;
    return $best['c'];
}

/* Guarda (o actualiza) la transcripción que manda el script de Google. Devuelve el id. */
function save_meeting(object $p): string
{
    if (empty($p->sourceId) || !valid_id('tg_' . $p->sourceId)) throw new RuntimeException('Falta sourceId');
    $meta = doc_get('meta', 'main');
    $st = ($meta && isset($meta->settings)) ? $meta->settings : new stdClass();
    $boards = docs_all('boards');
    $id = 'tg_' . $p->sourceId;
    $prev = doc_get('transcripts', $id);
    $cl = match_client($p, $st, $boards);
    $date = preg_match('/^\d{4}-\d{2}-\d{2}/', (string) ($p->date ?? '')) ? substr($p->date, 0, 10) : today_iso();
    $title = !empty($p->generic) && $cl ? $cl['name'] . ' · reunión del ' . fmt_date_short($date) : (string) ($p->title ?? 'Reunión');
    $keepLink = $prev && !empty($prev->linkManual);
    $actions = [];
    foreach (array_slice((array) ($p->actions ?? []), 0, 25) as $i => $a) {
        $old = null;
        foreach (($prev->actions ?? []) as $o) if (($o->text ?? null) === ($a->text ?? null)) { $old = $o; break; }
        $actions[] = (object) ['id' => $old->id ?? 'a' . $i . bin2hex(random_bytes(2)), 'text' => (string) ($a->text ?? ''), 'owner' => (string) ($a->owner ?? ''), 'due' => '', 'taskId' => $old->taskId ?? null];
    }
    $agreements = array_merge(array_map('strval', (array) ($p->agreements ?? [])), array_map(fn ($d) => 'Por definir: ' . $d, (array) ($p->debate ?? [])));
    $participants = implode(', ', array_filter(array_map('strval', (array) ($p->emails ?? [])), fn ($e) => !preg_match('/sarahiagency|jorgeurra/', $e)));
    $doc = (object) [
        'title' => $prev && !empty($prev->titleManual) ? $prev->title : $title,
        'date' => $date,
        'participants' => $participants,
        'link' => $keepLink ? $prev->link : ($cl ? $cl['link'] : null),
        'linkManual' => $keepLink,
        'body' => substr((string) ($p->body ?? ''), 0, 150000),
        'summary' => (string) ($p->summary ?? ''),
        'points' => array_slice(array_map('strval', (array) ($p->points ?? [])), 0, 12),
        'agreements' => $agreements,
        'actions' => $actions,
        'next' => '',
        'summarizedAt' => (string) ($p->modified ?? now_iso()),
        'source' => 'gemini', 'sourceId' => (string) $p->sourceId, 'sourceUrl' => (string) ($p->url ?? ''), 'sourceModified' => (string) ($p->modified ?? ''),
        'created' => $prev->created ?? now_iso(), 'updated' => now_iso(), 'author' => 'Google Meet', 'authorId' => null,
    ];
    if ($prev && !empty($prev->titleManual)) $doc->titleManual = true;
    doc_put('transcripts', $id, $doc);
    return $id;
}

function find_col(object $b, string $type, string $re): ?object
{
    foreach (($b->columns ?? []) as $c) if (($c->type ?? '') === $type && preg_match($re, $c->title ?? '')) return $c;
    return null;
}

function label_id(?object $col, string $text): ?string
{
    if (!$col || $text === '') return null;
    foreach (($col->labels ?? []) as $l) if (norm($l->label ?? '') === norm($text)) return (string) $l->id;
    return null;
}

/* Crea el lead que llega del formulario de la web en el tablero y grupo elegidos en Ajustes. */
function save_lead(array $f): string
{
    $meta = doc_get('meta', 'main');
    $wh = $meta->settings->webhook ?? null;
    $boardId = $wh->board ?? ($meta->settings->crmBoard ?? null);
    $b = $boardId ? doc_get('boards', $boardId) : null;
    if (!$b) throw new RuntimeException('No hay tablero de destino para los leads');
    $groups = $b->groups ?? [];
    $group = $wh->group ?? null;
    if (!$group || !array_filter($groups, fn ($g) => $g->id === $group)) $group = $groups[0]->id ?? 'g-default';

    $get = function (string ...$keys) use (&$f) {
        foreach ($keys as $k) if (isset($f[$k]) && trim((string) $f[$k]) !== '') { $v = trim((string) $f[$k]); unset($f[$k]); return $v; }
        return '';
    };
    $empresa = $get('empresa', 'company', 'negocio', 'marca');
    $nombre = $get('nombre', 'name', 'contacto');
    $email = $get('email', 'correo', 'mail');
    $tel = $get('whatsapp', 'telefono', 'teléfono', 'phone', 'celular');
    $sitio = $get('sitio', 'web', 'sitio_web', 'website', 'url');
    $pais = $get('pais', 'país', 'country');
    $origen = $get('origen', 'source', 'fuente');

    $vals = new stdClass();
    $set = function (?object $col, $v) use ($vals) { if ($col && $v !== null && $v !== '') { $k = $col->id; $vals->$k = $v; } };
    $set(find_col($b, 'text', '/contacto/i'), $nombre);
    $set(find_col($b, 'email', '/./'), $email);
    $set(find_col($b, 'phone', '/./'), $tel);
    $set(find_col($b, 'text', '/sitio|web/i') ?? find_col($b, 'link', '/sitio|web/i'), $sitio);
    $pc = find_col($b, 'status', '/pa[ií]s/i');
    $set($pc, label_id($pc, $pais) ?? label_id($pc, 'Otro'));
    $oc = find_col($b, 'status', '/origen|fuente/i');
    $set($oc, label_id($oc, $origen) ?? label_id($oc, 'Web formulario'));
    $set(find_col($b, 'date', '/entrada/i'), today_iso());
    $primary = null;
    foreach (($b->columns ?? []) as $c) if (($c->type ?? '') === 'status' && ($c->id === ($b->views->kanbanCol ?? null))) $primary = $c;
    if (!$primary) foreach (($b->columns ?? []) as $c) if (($c->type ?? '') === 'status') { $primary = $c; break; }
    $firstLabel = $primary->labels[0]->id ?? null;
    $set($primary, $firstLabel !== null ? (string) $firstLabel : null);

    $rest = [];
    foreach ($f as $k => $v) {
        if (in_array($k, ['a', 'k', 'website_hp', 'redirect'], true) || is_array($v) || trim((string) $v) === '') continue;
        $rest[] = $k . ': ' . trim((string) $v);
    }
    $set(find_col($b, 'long_text', '/nota/i'), $rest ? "Formulario web " . today_iso() . "\n" . implode("\n", $rest) : null);

    $minPos = 0;
    foreach (board_items($boardId) as $it) $minPos = min($minPos, $it->pos ?? 0);
    $id = uid('i');
    $doc = (object) ['board' => $boardId, 'group' => $group, 'parent' => null, 'name' => mb_substr($empresa ?: $nombre ?: 'Lead web', 0, 200), 'values' => $vals, 'pos' => $minPos - 1, 'created' => now_iso(), 'updated' => now_iso(), 'by' => null];
    if ($primary && $firstLabel !== null) $doc->stageLog = [(object) ['v' => (string) $firstLabel, 'at' => now_iso()]];
    doc_put('items', $id, $doc);
    doc_put('updates', uid('u'), (object) ['item' => $id, 'board' => $boardId, 'body' => 'Lead recibido desde el formulario de la web.' . ($rest ? "\n" . implode("\n", $rest) : ''), 'author' => 'Formulario web', 'authorId' => null, 'created' => now_iso()]);
    return $id;
}

function hook_key(bool $rotate = false): string
{
    $k = kv_get('hook_key');
    if (!$k || $rotate) {
        $k = bin2hex(random_bytes(20));
        kv_set('hook_key', $k);
    }
    return $k;
}
