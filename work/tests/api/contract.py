"""Run the same public API contract against any fresh MiniCafe server."""

import json
import gzip
import urllib.request
import urllib.error


def request(base, key, path, payload=None, headers=None):
    req = urllib.request.Request(
        base + path,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={
            "X-Cafe-Key": key,
            "Content-Type": "application/json",
            **(headers or {}),
        },
    )
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        return response.status, raw, dict(response.headers)


def contract(base, key):
    status, html, ui_headers = request(base, key, "/")
    assert status == 200 and b"<html" in html
    status, empty, cached = request(
        base, key, "/", headers={"If-None-Match": ui_headers["ETag"]}
    )
    assert status == 304 and not empty and cached["ETag"] == ui_headers["ETag"]
    assert (
        "private" in ui_headers["Cache-Control"]
        and "no-cache" in ui_headers["Cache-Control"]
    )
    assert request(base, key, "/", headers={"If-None-Match": '"older-ui"'})[0] == 200
    status, raw, headers = request(base, key, "/api/state")
    assert status == 200
    state = json.loads(raw)
    _, compressed_html, compression = request(
        base, key, "/", headers={"Accept-Encoding": "gzip"}
    )
    assert (
        compression.get("Content-Encoding") == "gzip"
        and gzip.decompress(compressed_html) == html
    )
    _, compressed_state, compression = request(
        base, key, "/api/state", headers={"Accept-Encoding": "gzip"}
    )
    assert (
        compression.get("Content-Encoding") == "gzip"
        and json.loads(gzip.decompress(compressed_state)) == state
    )
    print(
        f"PASS transfer: HTML {len(html)} -> {len(compressed_html)} bytes gzip, unchanged HTML -> 304; state {len(raw)} -> {len(compressed_state)} bytes gzip",
        flush=True,
    )
    assert state["access_role"] == "admin"
    assert (
        request(base, key, "/api/state", headers={"If-None-Match": headers["ETag"]})[0]
        == 304
    )
    drink = next(p for p in state["products"] if p["route"] == "bar")
    food = next(p for p in state["products"] if p["route"] == "instant")
    total = drink["price"] * 2 + food["price"]
    order = {
        "request": "contract-mixed",
        "guest": "Тест API",
        "cash_given": 500,
        "card_amount": total - 500,
        "items": [
            {"id": drink["id"], "qty": 2, "note": "Без цукру"},
            {"id": food["id"], "qty": 1},
        ],
    }
    status, result, _ = request(base, key, "/api/order", order)
    assert status == 200, result
    order_id = json.loads(result)["id"]
    assert json.loads(request(base, key, "/api/order", order)[1])["id"] == order_id
    current = json.loads(request(base, key, "/api/state")[1])
    item = next(o for o in current["orders"] if o["id"] == order_id)["items"][0]
    assert (
        request(
            base,
            key,
            "/api/issue-unit",
            {
                "order": order_id,
                "id": item["id"],
                "unit": 0,
                "route": "bar",
                "delivered": True,
            },
        )[0]
        == 200
    )
    assert request(base, key, "/api/undo-issue", {"route": "bar"})[0] == 200
    sid = current["active_session"]
    assert (
        json.loads(request(base, key, f"/api/stats?session={sid}")[1])["revenue"]
        >= total
    )
    assert request(base, key, f"/api/history?session={sid}")[0] == 200
    pdf = request(base, key, f"/api/report.pdf?session={sid}&key={key}")
    assert pdf[0] == 200 and pdf[1].startswith(b"%PDF-")
    gift = {
        **order,
        "request": "contract-gift",
        "gift": True,
        "cash_given": 0,
        "card_amount": 0,
    }
    assert request(base, key, "/api/order", gift)[0] == 200
    before = request(base, key, "/api/backup")[1]
    assert (
        request(
            base,
            key,
            "/api/order",
            {**order, "request": "contract-bad", "cash_given": 0, "card_amount": 1},
        )[0]
        == 400
    )
    assert request(base, key, "/api/backup")[1] == before
    access = json.loads(request(base, key, "/api/access")[1])
    assert request(base, access["bar"], "/api/stats?session=" + str(sid))[0] == 403
    limited = json.loads(request(base, access["bar"], "/api/state")[1])
    assert all(i["route"] == "bar" for o in limited["orders"] for i in o["items"])
    assert (
        request(base, access["cash"], "/api/delete-product", {"id": drink["id"]})[0]
        == 403
    )
    assert request(base, key, "/api/access/rotate", {})[0] == 200
    assert request(base, access["bar"], "/api/state")[0] == 403
    assert request(base, key, "/api/restore", json.loads(before))[0] == 200
    print(
        "PASS API contract:",
        base,
        "payments/gifts/units/undo/history/stats/PDF/rollback/backup/roles/revocation",
    )
