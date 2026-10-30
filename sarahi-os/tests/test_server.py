"""Pruebas del servidor de SARAHI OS (PHP) de punta a punta.

Uso:  python3 tests/test_server.py [ruta/a/seed.json]

Levanta una copia de la aplicación con `php -S`, con base de datos temporal y una IA simulada,
y prueba instalación, permisos por rol, formulario web, reuniones de Google Meet e IA.
Solo usa la biblioteca estándar de Python.
"""
import http.cookiejar
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

APP = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SETUP_CODE = "codigo-de-prueba"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def req(self, method, path, body=None, headers=None, form=None):
        h = {"X-SOS": "1"}
        h.update(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        r = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with self.opener.open(r) as resp:
                raw = resp.read()
                return resp.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw.decode(errors="replace")

    def api(self, method, action, body=None, **kw):
        return self.req(method, "/api.php?a=" + action, body, **kw)

    def write(self, *ops):
        return self.api("POST", "write", {"ops": list(ops)})


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("  ✓", msg)


def main():
    seed = sys.argv[1] if len(sys.argv) > 1 else None
    tmp = tempfile.mkdtemp(prefix="sarahi-os-test-")
    app = os.path.join(tmp, "app")
    shutil.copytree(APP, app, ignore=shutil.ignore_patterns("vendor", "data", "config.php", "tests", "dist"))
    os.makedirs(os.path.join(app, "private", "data"))
    os.symlink(os.path.join(APP, "private", "vendor"), os.path.join(app, "private", "vendor"))
    if seed:
        shutil.copy(seed, os.path.join(app, "private", "data", "seed.json"))

    mock_port, port = free_port(), free_port()
    mock = os.path.join(tmp, "mock")
    os.makedirs(mock)
    with open(os.path.join(mock, "index.php"), "w") as f:
        f.write("""<?php header('Content-Type: application/json');
echo json_encode(['id'=>'msg_1','type'=>'message','role'=>'assistant','model'=>'claude-opus-5-5',
 'content'=>[['type'=>'thinking','thinking'=>'','signature'=>'x'],['type'=>'text','text'=>"```json\\n{\\"resumen\\":\\"Se acordó la pauta\\",\\"acciones\\":[]}\\n```"]],
 'stop_reason'=>'end_turn','stop_sequence'=>null,'usage'=>['input_tokens'=>5,'output_tokens'=>5]]);""")
    with open(os.path.join(app, "private", "config.php"), "w") as f:
        f.write(f"""<?php return ['setup_code' => '{SETUP_CODE}', 'db_file' => 'test.sqlite', 'anthropic_api_key' => 'sk-test',
'anthropic_base_url' => 'http://127.0.0.1:{mock_port}', 'ai_model' => 'claude-opus-5-5', 'ai_effort' => 'low', 'base_url' => '',
'form_allowed_hosts' => ['sarahiagency.com'], 'timezone' => 'America/Santiago'];""")

    procs = [subprocess.Popen(["php", "-S", f"127.0.0.1:{mock_port}", "-t", mock], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
             subprocess.Popen(["php", "-S", f"127.0.0.1:{port}", "-t", app], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
    time.sleep(1)
    base = f"http://127.0.0.1:{port}"
    try:
        run(base, bool(seed))
        print("\nTodas las pruebas pasaron.")
    finally:
        for p in procs:
            p.terminate()
        shutil.rmtree(tmp, ignore_errors=True)


def run(base, seeded):
    jorge = Client(base)
    print("Instalación")
    check(jorge.api("GET", "boot")[0] == 401, "sin sesión no se ve nada")
    check(jorge.api("POST", "setup", {"code": "otro", "name": "Jorge", "email": "jorge@sarahi.cl", "password": "clave-segura-1"})[0] == 403, "código de instalación incorrecto se rechaza")
    st, r = jorge.api("POST", "setup", {"code": SETUP_CODE, "name": "Jorge", "email": "jorge@sarahi.cl", "password": "clave-segura-1", "import": seeded})
    check(st == 200, "se crea el administrador")
    if seeded:
        check(r["imported"] > 2000, f"se cargan los datos ({r['imported']} registros)")
    check(jorge.api("POST", "setup", {"code": SETUP_CODE, "name": "X", "email": "x@x.cl", "password": "clave-segura-1"})[0] == 403, "no se puede volver a instalar")
    check(jorge.req("POST", "/api.php?a=write", {"ops": []}, headers={"X-SOS": "0"})[0] == 403, "sin cabecera X-SOS se rechaza (CSRF)")

    if not seeded:
        jorge.write({"op": "set", "c": "meta", "id": "main", "d": {"settings": {"clientsFolder": "f1", "clientsBoard": "bcli", "crmBoard": "bcrm"}, "workspaces": [], "folders": [], "team": []}},
                    {"op": "set", "c": "boards", "id": "bcli", "d": {"name": "CLIENTES SARAHI", "folder": "f1", "columns": [{"id": "status", "type": "status", "title": "Estado", "labels": [{"id": "0", "label": "Activo", "color": "#00c875"}]}], "groups": [{"id": "g1", "title": "Activos"}]}},
                    {"op": "set", "c": "boards", "id": "bbrin", "d": {"name": "Brincus", "folder": "f1", "clientItem": "icli", "columns": [], "groups": [{"id": "g1", "title": "Tareas"}]}},
                    {"op": "set", "c": "items", "id": "icli", "d": {"board": "bcli", "group": "g1", "name": "Brincus", "values": {}}},
                    {"op": "set", "c": "boards", "id": "bcrm", "d": {"name": "Pipeline comercial SARAHI", "columns": [{"id": "st", "type": "status", "title": "Estado", "labels": [{"id": "7", "label": "Nuevo", "color": "#579bfc"}]}, {"id": "email", "type": "email", "title": "Email"}, {"id": "ct", "type": "text", "title": "Contacto"}, {"id": "nt", "type": "long_text", "title": "Notas"}], "groups": [{"id": "topics", "title": "Nuevo lead"}]}},
                    {"op": "set", "c": "boards", "id": "v2026cl", "d": {"name": "Ventas 2026 Chile", "sales": {"year": 2026}, "columns": [], "groups": []}})

    st, boot = jorge.api("GET", "boot")
    ids = {(d["c"], d["id"]) for d in boot["docs"]}
    meta = next(d["d"] for d in boot["docs"] if d["c"] == "meta")
    st_ = meta["settings"]
    boards = {d["id"]: d["d"] for d in boot["docs"] if d["c"] == "boards"}
    check(boot["me"]["role"] == "admin" and boot["caps"]["server"] and boot["caps"]["ai"], "el administrador entra con IA activa")
    check(("boards", "v2026cl") in ids and ("boards", st_["crmBoard"]) in ids, "el administrador ve ventas y el CRM")
    crm, cli = st_["crmBoard"], st_["clientsBoard"]
    client_board = next(i for i, b in boards.items() if b.get("clientItem"))

    print("Usuarios")
    st, _ = jorge.api("POST", "call", {"name": "user_save", "args": {"name": "Osvaldo", "email": "osvaldo@sarahi.cl", "password": "corta", "role": "clients"}})
    check(st == 400, "contraseña corta se rechaza")
    st, _ = jorge.api("POST", "call", {"name": "user_save", "args": {"name": "Osvaldo", "email": "Osvaldo@Sarahi.cl", "password": "clave-osvaldo-1", "role": "clients"}})
    check(st == 200, "se crea a Osvaldo con rol Solo clientes")
    jorge.api("POST", "call", {"name": "user_save", "args": {"name": "Equipo", "email": "equipo@sarahi.cl", "password": "clave-equipo-1", "role": "member"}})
    st, r = jorge.api("POST", "call", {"name": "users"})
    check({u["email"] for u in r["users"]} == {"jorge@sarahi.cl", "osvaldo@sarahi.cl", "equipo@sarahi.cl"}, "la lista de usuarios está completa")

    osvaldo = Client(base)
    check(osvaldo.api("POST", "login", {"email": "osvaldo@sarahi.cl", "password": "mala"})[0] == 401, "contraseña incorrecta se rechaza")
    check(osvaldo.api("POST", "login", {"email": "osvaldo@sarahi.cl", "password": "clave-osvaldo-1"})[0] == 200, "Osvaldo entra")

    print("Permisos de Solo clientes (Osvaldo)")
    st, ob = osvaldo.api("GET", "boot")
    oboards = {d["id"]: d["d"] for d in ob["docs"] if d["c"] == "boards"}
    check(cli in oboards and client_board in oboards, "ve la ficha de clientes y los tableros de clientes")
    check(crm not in oboards and "v2026cl" not in oboards, "no ve el CRM ni ventas")
    check(all(b.get("clientItem") or b.get("folder") == st_["clientsFolder"] for b in oboards.values()), "todo lo que ve es de clientes")
    visible_items = {d["d"]["board"] for d in ob["docs"] if d["c"] == "items"}
    check(visible_items <= set(oboards), "solo recibe elementos de tableros que ve")
    ometa = next(d["d"] for d in ob["docs"] if d["c"] == "meta")
    check("webhook" not in ometa["settings"] and "sales" not in ometa["settings"], "no recibe la clave del formulario ni las metas de ventas")
    check(osvaldo.api("POST", "call", {"name": "users"})[0] == 403, "no puede ver usuarios")

    st, r = osvaldo.write({"op": "set", "c": "items", "id": "itest1", "d": {"board": client_board, "group": "g1", "name": "Tarea de Osvaldo", "values": {}}})
    check(st == 200, "puede crear tareas en un cliente")
    st, _ = osvaldo.write({"op": "set", "c": "items", "id": "itest2", "d": {"board": crm, "group": "topics", "name": "Lead", "values": {}}})
    check(st == 403, "no puede crear leads en el CRM")
    st, _ = osvaldo.write({"op": "update", "c": "boards", "id": client_board, "d": {"columns": []}})
    check(st == 403, "no puede cambiar columnas")
    st, _ = osvaldo.write({"op": "del", "c": "boards", "id": client_board})
    check(st == 403, "no puede borrar tableros")
    st, _ = osvaldo.write({"op": "update", "c": "boards", "id": client_board, "d": {"weekly": {"week": "2026-10-26"}}})
    check(st == 200, "puede guardar el resumen de la semana del cliente")

    print("Columnas privadas (rol Equipo)")
    equipo = Client(base)
    equipo.api("POST", "login", {"email": "equipo@sarahi.cl", "password": "clave-equipo-1"})
    jorge.write({"op": "update", "c": "boards", "id": crm, "d": {"columns": boards[crm]["columns"] + [{"id": "fee", "type": "numbers", "title": "Fee UF", "private": True}]}},
                {"op": "set", "c": "items", "id": "ifee", "d": {"board": crm, "group": "topics", "name": "Lead con fee", "values": {"fee": 22}}})
    st, eb = equipo.api("GET", "boot")
    ecrm = next(d["d"] for d in eb["docs"] if d["c"] == "boards" and d["id"] == crm)
    check(all(c["id"] != "fee" for c in ecrm["columns"]), "el equipo no ve la columna privada")
    check("fee" not in next(d["d"] for d in eb["docs"] if d["id"] == "ifee")["values"], "ni sus valores")
    check(not any(d["id"] == "v2026cl" for d in eb["docs"]), "el equipo no ve ventas")
    equipo.write({"op": "update", "c": "boards", "id": crm, "d": {"columns": [dict(c, title=c["title"] + "!") if i == 0 else c for i, c in enumerate(ecrm["columns"])]}},
                 {"op": "set", "c": "items", "id": "ifee", "d": {"board": crm, "group": "topics", "name": "Renombrado", "values": {"fee": 1}}})
    st, jb = jorge.api("GET", "boot")
    jcrm = next(d["d"] for d in jb["docs"] if d["c"] == "boards" and d["id"] == crm)
    check(any(c["id"] == "fee" for c in jcrm["columns"]) and jcrm["columns"][0]["title"].endswith("!"), "la columna privada sobrevive a los cambios del equipo")
    ifee = next(d["d"] for d in jb["docs"] if d["id"] == "ifee")
    check(ifee["values"].get("fee") == 22 and ifee["name"] == "Renombrado", "y su valor no se pierde ni se puede pisar")

    print("Sincronización")
    osvaldo.write({"op": "update", "c": "items", "id": "itest1", "d": {"name": "Tarea editada"}})
    st, ch = equipo.api("GET", f"changes&since={eb['rev']}")
    check(any(d["id"] == "itest1" and d["d"]["name"] == "Tarea editada" for d in ch["docs"]), "los cambios de otros llegan al resto")
    check(all(d["d"] is None for d in ch["docs"] if d["id"] == "v2026cl"), "sin filtrar lo que no le toca")

    print("Formulario de la web")
    st, w = jorge.api("POST", "call", {"name": "webhook_info"})
    url = w["url"].replace("http://127.0.0.1", "")
    path = url[url.index("/hook.php"):]
    st, r = jorge.req("POST", path.replace("k=", "k=x"), form={"empresa": "Tienda Test"})
    check(st == 403, "una clave incorrecta se rechaza")
    st, r = jorge.req("POST", path, form={"empresa": "Tienda Test", "nombre": "Ana Pérez", "email": "ana@tienda.cl", "inversion": "500 mil"})
    check(st == 200, "el formulario crea un lead")
    st, ch = jorge.api("GET", f"changes&since={jb['rev']}")
    lead = next(d["d"] for d in ch["docs"] if d["c"] == "items" and d["d"] and d["d"]["name"] == "Tienda Test")
    check(lead["board"] == (st_.get("webhook") or {}).get("board", crm), "en el tablero configurado")
    check("ana@tienda.cl" in json.dumps(lead["values"]) and "inversion: 500 mil" in json.dumps(lead["values"], ensure_ascii=False), "con email y el resto en Notas")
    st, _ = jorge.req("POST", path, form={"empresa": "Spam", "website_hp": "http://spam"})
    st, ch2 = jorge.api("GET", f"changes&since={ch['rev']}")
    check(not any(d["d"] and d["d"].get("name") == "Spam" for d in ch2["docs"]), "la trampa anti-spam funciona")

    print("Reuniones de Google Meet")
    client_name = boards[client_board]["name"]
    st, r = jorge.req("POST", path.replace("a=lead", "a=meeting"), {"title": f"Reunión semanal {client_name}", "generic": False, "date": "2026-10-28", "emails": [], "summary": "Revisamos campañas", "agreements": [], "debate": [], "points": [], "actions": [{"owner": "Jorge", "text": "Enviar informe"}], "body": "texto", "sourceId": "abc123", "url": "https://docs.google.com/x", "modified": "2026-10-28T10:00:00Z"})
    check(st == 200, "la reunión se recibe")
    st, ch3 = jorge.api("GET", f"changes&since={ch2['rev']}")
    tx = next(d["d"] for d in ch3["docs"] if d["c"] == "transcripts")
    linked = tx["link"] and (tx["link"].get("board") == client_board or (jb and tx["link"].get("item") == boards[client_board].get("clientItem")))
    check(linked, f"y queda vinculada a {client_name}")

    print("IA")
    st, r = jorge.api("POST", "ai", {"prompt": "Resume", "json": True})
    check(st == 200 and r["json"]["resumen"] == "Se acordó la pauta", "el resumen con IA devuelve el JSON")

    print("Salir")
    jorge.api("POST", "call", {"name": "logout"})
    check(jorge.api("GET", "boot")[0] == 401, "al cerrar sesión se pierde el acceso")


if __name__ == "__main__":
    main()
