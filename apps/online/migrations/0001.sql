CREATE TABLE IF NOT EXISTS metadata (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data))
);
INSERT OR IGNORE INTO metadata VALUES (1, 0, '{"nextProduct":12,"nextOrder":1,"nextItem":1,"nextSession":1,"active_session":0,"expenses_version":0,"issue_undo":{},"versions":{"products":0,"orders":0,"sessions":0,"expenses":0}}');
CREATE TABLE IF NOT EXISTS mutation_guard (ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY, version TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, request TEXT UNIQUE NOT NULL,
  session_id INTEGER NOT NULL, created TEXT NOT NULL,
  pending INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS orders_session ON orders(session_id,id DESC);
CREATE INDEX IF NOT EXISTS orders_pending ON orders(pending,id DESC);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created,id DESC);
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
