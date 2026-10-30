def make_board(client, workspace_id, name="Leads"):
    r = client.post("/api/boards", json={"workspace_id": workspace_id, "name": name, "item_label": "Lead"})
    assert r.status_code == 200, r.text
    return client.get(f"/api/boards/{r.json()['id']}").json()


def test_login_required(setup):
    from fastapi.testclient import TestClient
    from app.main import app
    assert TestClient(app).get("/api/workspaces").status_code == 401


def test_wrong_password(setup):
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).post("/api/auth/login", json={"email": "jorge@sarahi.cl", "password": "otra"})
    assert r.status_code == 401


def test_private_workspace_is_hidden_from_members(jorge, georgia, setup):
    crm_board = make_board(jorge, setup["crm"], "Pipeline")
    clientes_board = make_board(jorge, setup["clientes"], "DJOYAS")

    names = [w["name"] for w in georgia.get("/api/workspaces").json()]
    assert names == ["Clientes SARAHI"]
    assert georgia.get(f"/api/boards/{crm_board['id']}").status_code == 404
    assert georgia.get(f"/api/boards/{crm_board['id']}/items").status_code == 404
    assert georgia.get(f"/api/boards/{crm_board['id']}/export.csv").status_code == 404
    assert georgia.get(f"/api/boards/{clientes_board['id']}").status_code == 200

    # Tampoco puede leer ni editar elementos del CRM conociendo su ID
    item = jorge.post(f"/api/boards/{crm_board['id']}/items", json={"name": "Lead secreto"}).json()
    assert georgia.get(f"/api/items/{item['id']}").status_code == 404
    assert georgia.patch(f"/api/items/{item['id']}", json={"name": "x"}).status_code == 404
    assert georgia.post(f"/api/items/{item['id']}/updates", json={"body": "hola"}).status_code == 404


def test_members_cannot_change_structure(jorge, georgia, setup):
    board = make_board(jorge, setup["clientes"])
    assert georgia.post("/api/boards", json={"workspace_id": setup["clientes"], "name": "x"}).status_code == 403
    assert georgia.post(f"/api/boards/{board['id']}/columns", json={"title": "x", "type": "text"}).status_code == 403
    assert georgia.get("/api/users").status_code == 403
    # Pero sí pueden trabajar con los elementos
    assert georgia.post(f"/api/boards/{board['id']}/items", json={"name": "Tarea"}).status_code == 200


def test_item_values_are_validated(jorge, setup):
    board = make_board(jorge, setup["crm"])
    status = board["columns"][0]
    cols = {}
    for title, type_ in [("Email", "email"), ("Fee", "number"), ("Próximo seguimiento", "date"), ("Web", "link")]:
        cols[type_] = jorge.post(f"/api/boards/{board['id']}/columns", json={"title": title, "type": type_}).json()
    item = jorge.post(f"/api/boards/{board['id']}/items", json={"name": "Toke"}).json()

    ok = jorge.patch(f"/api/items/{item['id']}", json={"values": {
        status["key"]: "2", cols["email"]["key"]: "nicolas@toke.cl", cols["number"]["key"]: "12,5",
        cols["date"]["key"]: "2026-11-03", cols["link"]["key"]: {"url": "https://toke.cl", "text": "Sitio"},
    }})
    assert ok.status_code == 200, ok.text
    values = ok.json()["values"]
    assert values[cols["number"]["key"]] == 12.5
    assert values[status["key"]] == "2"

    bad = [
        {status["key"]: "99"},
        {cols["email"]["key"]: "no-es-email"},
        {cols["date"]["key"]: "03/11/2026"},
        {cols["link"]["key"]: {"url": "javascript:alert(1)"}},
        {"columna_inexistente": "x"},
    ]
    for values in bad:
        assert jorge.patch(f"/api/items/{item['id']}", json={"values": values}).status_code == 400, values

    # Vaciar un valor lo elimina
    cleared = jorge.patch(f"/api/items/{item['id']}", json={"values": {status["key"]: None}}).json()
    assert status["key"] not in cleared["values"]


def test_removing_a_label_clears_items(jorge, setup):
    board = make_board(jorge, setup["crm"])
    status = board["columns"][0]
    item = jorge.post(f"/api/boards/{board['id']}/items", json={"name": "A", "values": {status["key"]: "1"}}).json()
    labels = [l for l in status["settings"]["labels"] if l["id"] != "1"]
    jorge.patch(f"/api/columns/{status['id']}", json={"settings": {"labels": labels}})
    assert status["key"] not in jorge.get(f"/api/items/{item['id']}").json()["item"]["values"]


def test_subitems_updates_and_export(jorge, setup):
    board = make_board(jorge, setup["crm"])
    item = jorge.post(f"/api/boards/{board['id']}/items", json={"name": "Brincus"}).json()
    sub = jorge.post(f"/api/items/{item['id']}/subitems", json={"name": "Enviar propuesta"})
    assert sub.status_code == 200, sub.text
    jorge.post(f"/api/items/{item['id']}/updates", json={"body": "Llamé, quedó en responder el lunes"})

    detail = jorge.get(f"/api/items/{item['id']}").json()
    assert [s["name"] for s in detail["subitems"]] == ["Enviar propuesta"]
    assert detail["updates"][0]["author_name"] == "Jorge"

    listing = jorge.get(f"/api/boards/{board['id']}/items").json()
    assert [i["name"] for i in listing["items"]] == ["Brincus"]  # los subelementos no salen en la tabla
    assert listing["subitem_counts"] == {str(item["id"]): 1}

    csv = jorge.get(f"/api/boards/{board['id']}/export.csv")
    assert csv.status_code == 200
    assert "Brincus" in csv.text and "Nuevos" in csv.text


def test_group_with_items_cannot_be_deleted(jorge, setup):
    board = make_board(jorge, setup["crm"])
    group = board["groups"][0]
    jorge.post(f"/api/boards/{board['id']}/items", json={"name": "A"})
    assert jorge.delete(f"/api/groups/{group['id']}").status_code == 409


def test_admin_manages_user_access(jorge, setup):
    r = jorge.post("/api/users", json={"email": "Nueva@Cliente.cl", "name": "Nueva", "password": "clave-segura",
                                       "workspace_ids": [setup["clientes"]]})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == "nueva@cliente.cl"
    assert jorge.post("/api/users", json={"email": "nueva@cliente.cl", "name": "x", "password": "12345678"}).status_code == 409
    # El admin no puede quitarse a sí mismo el rol
    assert jorge.patch(f"/api/users/{setup['jorge']}", json={"role": "member"}).status_code == 400

    from tests.conftest import login
    nueva = login("nueva@cliente.cl")
    assert [w["name"] for w in nueva.get("/api/workspaces").json()] == ["Clientes SARAHI"]
    jorge.patch(f"/api/users/{r.json()['id']}", json={"is_active": False})
    assert nueva.get("/api/me").status_code == 401


def test_security_headers(jorge):
    r = jorge.get("/")
    assert r.status_code == 200
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
