<?php
/* SARAHI OS — permisos. El servidor decide qué ve y qué puede cambiar cada rol; la interfaz solo esconde botones.
   - admin: todo.
   - member («Equipo»): todo menos los tableros de ventas y las columnas ocultas (privadas).
   - clients («Solo clientes»): los tableros de cada cliente, la ficha de clientes y los tableros que se le compartan.
     Trabaja en los elementos, pero no cambia la estructura de los tableros. */
defined('SOS') or exit;

final class Perm
{
    public array $user;
    public string $role;
    public object $settings;
    /** @var array<string, object> */
    public array $boards;
    private array $visible = [];

    public function __construct(array $user)
    {
        $this->user = $user;
        $this->role = in_array($user['role'], ROLES, true) ? $user['role'] : 'clients';
        $meta = doc_get('meta', 'main');
        $this->settings = ($meta && isset($meta->settings) && is_object($meta->settings)) ? $meta->settings : new stdClass();
        $this->boards = docs_all('boards');
        foreach ($this->boards as $id => $b) $this->visible[$id] = $this->boardVisible((string) $id, $b);
    }

    public function isAdmin(): bool { return $this->role === 'admin'; }
    public function meId(): string { return 'u' . $this->user['id']; }

    public static function isClientBoard(string $id, object $b, object $st): bool
    {
        if (!empty($b->isTemplate) || !empty($b->sales)) return false;
        if (!empty($b->clientItem)) return true;
        return !empty($st->clientsFolder) && ($b->folder ?? null) === $st->clientsFolder && $id !== ($st->clientsBoard ?? null);
    }

    public function boardVisible(string $id, ?object $b): bool
    {
        if (!$b) return false;
        if ($this->role === 'admin') return true;
        if ($this->role === 'member') return empty($b->sales);
        if (!empty($b->sales)) return false;
        if ($id === ($this->settings->clientsBoard ?? null)) return true;
        if (self::isClientBoard($id, $b, $this->settings)) return true;
        $shared = $this->user['access']->boards ?? [];
        return is_array($shared) && in_array($id, $shared, true);
    }

    public function boardIdVisible(?string $id): bool
    {
        return $id !== null && ($this->visible[$id] ?? false);
    }

    private function itemBoard(?string $itemId): ?string
    {
        if (!$itemId) return null;
        $it = doc_get('items', $itemId);
        return $it->board ?? null;
    }

    private function linkVisible($link): bool
    {
        if (!is_object($link)) return false;
        if (!empty($link->board)) return $this->boardIdVisible($link->board);
        return $this->boardIdVisible($this->itemBoard($link->item ?? null));
    }

    public function docVisible(string $c, string $id, ?object $d): bool
    {
        if ($d === null) return true; // un borrado no revela contenido
        if ($this->isAdmin()) return true;
        switch ($c) {
            case 'meta': return $id === 'main';
            case 'boards': return $this->boardVisible($id, $d);
            case 'items': return $this->boardIdVisible($d->board ?? null);
            case 'updates': return $this->boardIdVisible($d->board ?? $this->itemBoard($d->item ?? null));
            case 'notes': return ($d->authorId ?? null) === $this->meId() || !empty($d->shared) || $this->linkVisible($d->link ?? null);
            case 'transcripts': return $this->linkVisible($d->link ?? null);
        }
        return false;
    }

    /** Columnas ocultas al equipo (solo administradores) de un tablero. */
    public function privateCols(?string $boardId): array
    {
        $b = $boardId ? ($this->boards[$boardId] ?? null) : null;
        if (!$b) return [];
        $ids = [];
        foreach (['columns', 'subColumns'] as $k) foreach (($b->$k ?? []) as $col) if (!empty($col->private)) $ids[] = $col->id;
        return $ids;
    }

    /** Lo que ve este usuario de un documento (sin columnas privadas ni ajustes sensibles). */
    public function sanitize(string $c, ?object $d): ?object
    {
        if ($d === null || $this->isAdmin()) return $d;
        $d = clone $d;
        if ($c === 'boards') {
            foreach (['columns', 'subColumns'] as $k) {
                if (isset($d->$k) && is_array($d->$k)) $d->$k = array_values(array_filter($d->$k, fn ($col) => empty($col->private)));
            }
        } elseif ($c === 'items' && isset($d->values) && is_object($d->values)) {
            $vals = clone $d->values;
            foreach ($this->privateCols($d->board ?? null) as $cid) unset($vals->$cid);
            $d->values = $vals;
        } elseif ($c === 'meta' && isset($d->settings) && is_object($d->settings)) {
            $st = clone $d->settings;
            unset($st->webhook);
            if ($this->role !== 'admin') unset($st->sales);
            $d->settings = $st;
        }
        return $d;
    }

    /**
     * Valida una escritura y devuelve el documento final que se guarda (o null para borrar).
     * Lanza RuntimeException con un mensaje para el usuario si no está permitida.
     */
    public function resolveWrite(string $op, string $c, string $id, ?object $incoming): ?object
    {
        if (!in_array($c, COLLECTIONS, true) || !valid_id($id)) throw new RuntimeException('Documento no válido');
        $cur = doc_get($c, $id);
        if ($op === 'del') {
            if ($cur && !$this->isAdmin()) $this->check($c, $id, $cur, 'borrar');
            return null;
        }
        if (!$incoming) throw new RuntimeException('Faltan los datos');
        $final = $op === 'update' ? merge_doc($cur ?: new stdClass(), $incoming) : $incoming;
        if ($this->isAdmin()) return $final;

        if ($cur) $this->check($c, $id, $cur, 'cambiar');
        if ($c === 'meta') {
            $keys = array_keys(get_object_vars($incoming));
            if ($this->role !== 'member' || $op !== 'update' || array_diff($keys, ['team'])) throw new RuntimeException('Solo un administrador puede cambiar los ajustes');
            return $final;
        }
        if ($c === 'boards') {
            if ($this->role === 'clients') {
                $keys = array_keys(get_object_vars($incoming));
                $allowed = ['weekly', 'views', 'automations'];
                if ($cur && empty($cur->subColumns)) $allowed[] = 'subColumns'; // primer subelemento del tablero
                if (!$cur || $op !== 'update' || array_diff($keys, $allowed)) throw new RuntimeException('Solo un administrador puede cambiar la estructura de los tableros');
            }
            if (!empty($final->sales)) throw new RuntimeException('Los tableros de ventas son solo para administradores');
            if ($cur) $final = $this->keepPrivateColumns($cur, $final);
            if (!$cur && !$this->boardVisible($id, $final)) throw new RuntimeException('No tienes acceso a ese tablero');
            return $final;
        }
        if ($c === 'items') {
            $final = $this->keepPrivateValues($cur, $final, $incoming, $op);
        }
        if (!$this->docVisible($c, $id, $final)) throw new RuntimeException('No tienes acceso a ese tablero');
        return $final;
    }

    private function check(string $c, string $id, object $cur, string $verb): void
    {
        if (!$this->docVisible($c, $id, $cur)) throw new RuntimeException('No tienes permiso para ' . $verb . ' esto');
        if ($c === 'boards' && $this->role === 'clients' && $verb === 'borrar') throw new RuntimeException('Solo un administrador puede borrar tableros');
    }

    /* Quien no ve las columnas privadas manda la lista sin ellas: se vuelven a poner donde estaban. */
    private function keepPrivateColumns(object $cur, object $final): object
    {
        foreach (['columns', 'subColumns'] as $k) {
            if (!isset($final->$k) || !is_array($final->$k)) continue;
            $out = $final->$k;
            foreach (($cur->$k ?? []) as $pos => $col) {
                if (empty($col->private)) continue;
                $exists = false;
                foreach ($out as $x) if (($x->id ?? null) === $col->id) $exists = true;
                if (!$exists) array_splice($out, min($pos, count($out)), 0, [$col]);
            }
            $final->$k = array_values($out);
        }
        return $final;
    }

    /* Los valores de columnas privadas no se pueden escribir ni se pierden al reemplazar el elemento. */
    private function keepPrivateValues(?object $cur, object $final, object $incoming, string $op): object
    {
        $priv = array_unique(array_merge($this->privateCols($cur->board ?? null), $this->privateCols($final->board ?? null)));
        if (!$priv) return $final;
        $vals = isset($final->values) && is_object($final->values) ? clone $final->values : new stdClass();
        foreach ($priv as $cid) {
            if ($cur && isset($cur->values->$cid)) $vals->$cid = $cur->values->$cid;
            else unset($vals->$cid);
        }
        $final->values = $vals;
        return $final;
    }
}
