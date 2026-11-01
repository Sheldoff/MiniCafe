CREATE TABLE mono_payments (
  id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
  total INTEGER NOT NULL CHECK(total>0), created INTEGER NOT NULL,
  expires INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
  transaction_id TEXT UNIQUE, order_id INTEGER
);
CREATE INDEX mono_payments_pending ON mono_payments(status,created);
CREATE TABLE mono_sync (id INTEGER PRIMARY KEY CHECK(id=1), next_poll INTEGER NOT NULL, checked INTEGER NOT NULL DEFAULT 0);
INSERT INTO mono_sync(id,next_poll) VALUES(1,0);
