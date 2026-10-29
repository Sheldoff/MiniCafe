import sqlite3
from pathlib import Path
from desktop_engine import DesktopEngine


def migration_test(root, port):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    old = root / "cafe.sqlite3"
    with sqlite3.connect(old) as db:
        db.executescript(
            """CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,price INTEGER,route TEXT,active INTEGER,deleted INTEGER DEFAULT 0);
CREATE TABLE product_images(product_id INTEGER PRIMARY KEY,content BLOB,version TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,request TEXT,guest TEXT,place TEXT,created TEXT);
CREATE TABLE items(id INTEGER PRIMARY KEY,order_id INTEGER,name TEXT,price INTEGER,qty INTEGER,note TEXT,route TEXT,status TEXT);
CREATE TABLE events(id INTEGER PRIMARY KEY,order_id INTEGER,message TEXT,created TEXT);
INSERT INTO products VALUES(1,'Старе лате','Напої',5500,'bar',1,0);
INSERT INTO orders VALUES(1,'old-order','Марія','','2026-10-18 11:00:00');
INSERT INTO items VALUES(1,1,'Старе лате',5000,1,'Без цукру','bar','new');"""
        )
    engine = DesktopEngine(root, "migration-key", port)
    try:
        engine.start()
        state = engine.request("state")
        assert state["products"][0]["name"] == "Старе лате"
        assert state["orders"][0]["items"][0]["price"] == 5000
        assert state["orders"][0]["guest"] == "Марія"
        assert engine.request("stats?session=0")["unknown"] == 5000
        assert old.exists() and (root / "cafe-before-3.28.sqlite3").exists()
    finally:
        engine.stop()
    print(
        "PASS desktop legacy SQLite migration: original/backup preserved, guest/notes/price history/unknown payments retained"
    )
