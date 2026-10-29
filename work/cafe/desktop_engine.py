"""Desktop wrapper around the shared Java engine; legacy SQLite is migrated once."""

import base64
import json
import os
from pathlib import Path
import queue
import threading
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request


def migrate_legacy(root):
    root = Path(root)
    target, legacy = root / "cafe-data.json", root / "cafe.sqlite3"
    if target.exists() or not legacy.exists():
        return False
    with sqlite3.connect(legacy) as source:
        source.row_factory = sqlite3.Row
        backup = root / "cafe-before-3.28.sqlite3"
        if not backup.exists():
            with sqlite3.connect(backup) as destination:
                source.backup(destination)
        tables = {
            r[0]
            for r in source.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        products = [dict(r) for r in source.execute("SELECT * FROM products")]
        categories = {p["name"]: p["category"] for p in products}
        deleted = {p["id"] for p in products if p.get("deleted")}
        products = [p for p in products if p["id"] not in deleted]
        for p in products:
            p.pop("deleted", None)
            if "product_images" in tables:
                image = source.execute(
                    "SELECT content,version FROM product_images WHERE product_id=?",
                    (p["id"],),
                ).fetchone()
                if image:
                    p["image"] = base64.b64encode(image["content"]).decode("ascii")
                    p["image_version"] = image["version"]
        orders = [dict(r) for r in source.execute("SELECT * FROM orders ORDER BY id")]
        for order in orders:
            order["request"] = order.get("request") or f"legacy-{order['id']}"
            order["session_id"] = 0
            order["items"] = [
                dict(r)
                for r in source.execute(
                    "SELECT * FROM items WHERE order_id=?", (order["id"],)
                )
            ]
            for item in order["items"]:
                item["category"] = categories.get(
                    item["name"], "Напої" if item["route"] == "bar" else "Їжа"
                )
            order["events"] = [
                dict(r)
                for r in source.execute(
                    "SELECT * FROM events WHERE order_id=?", (order["id"],)
                )
            ]
        dates = [o["created"] for o in orders]
        data = {
            "format": "minicafe-android-1",
            "products": products,
            "orders": orders,
            "nextProduct": source.execute(
                "SELECT COALESCE(MAX(id),0)+1 FROM products"
            ).fetchone()[0],
            "nextOrder": source.execute(
                "SELECT COALESCE(MAX(id),0)+1 FROM orders"
            ).fetchone()[0],
            "nextItem": source.execute(
                "SELECT COALESCE(MAX(id),0)+1 FROM items"
            ).fetchone()[0],
            "nextSession": 1,
            "active_session": 0,
            "require_session_start": False,
            "sessions": (
                [
                    {
                        "id": 0,
                        "name": "Історія до оновлення",
                        "started": min(dates),
                        "ended": max(dates),
                        "legacy": True,
                    }
                ]
                if dates
                else []
            ),
        }
        # Preserve intentionally empty menus: never replace them with demonstration defaults.
        data["base_menu_version"] = 1
        data["test_food_added"] = True
        temporary = target.with_suffix(".migration.tmp")
        with temporary.open("wb") as output:
            output.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    return True


class DesktopEngine:
    def __init__(self, root, key, port=8765):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.key, self.port = key, port
        self.process = None

    def start(self):
        migrate_legacy(self.root)
        base = (
            Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
            / "desktop"
            / "dist"
        )
        pointer = Path(__file__).resolve().parents[1] / "desktop" / "current-dist.txt"
        if not getattr(sys, "frozen", False) and pointer.exists():
            base = Path(pointer.read_text(encoding="utf-8-sig").strip())
        java = base / "runtime" / "bin" / "java.exe"
        classpath = os.pathsep.join(
            str(base / name)
            for name in ["minicafe-engine.jar", "android-json.jar", "nanohttpd.jar"]
        )
        self.process = subprocess.Popen(
            [
                str(java),
                "-cp",
                classpath,
                "DesktopServer",
                str(self.root),
                str(self.port),
                self.key,
                str(base / "assets"),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        process = self.process
        ready = queue.Queue()
        threading.Thread(
            target=lambda: ready.put(process.stdout.readline()), daemon=True
        ).start()
        # A freshly extracted one-file EXE may start its bundled Java slowly
        # while Windows scans the runtime. Readiness still requires the READY line.
        startup_timeout = 45 if getattr(sys, "frozen", False) else 15
        try:
            line = ready.get(timeout=startup_timeout)
        except queue.Empty:
            self.stop()
            raise RuntimeError(f"Сервер не запустився за {startup_timeout} секунд")
        if line.startswith(b"READY "):
            return self
        process.wait(timeout=5)
        message = process.stderr.read().decode("utf-8", errors="replace")[-2000:]
        self.stop()
        raise RuntimeError(message or "Не вдалося запустити сервер")

    def request(self, path, payload=None):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/{path}",
            data=None if payload is None else json.dumps(payload).encode("utf-8"),
            headers={"X-Cafe-Key": self.key, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def stop(self):
        process, self.process = self.process, None
        if not process:
            return
        if process.stdin:
            process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
        for stream in [process.stdout, process.stderr]:
            if stream:
                stream.close()
