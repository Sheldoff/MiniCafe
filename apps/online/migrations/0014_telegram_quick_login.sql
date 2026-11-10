-- Browser proof never appears in the QR/deep link. Only hashes are stored.
CREATE TABLE telegram_login_links (
  ticket_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL UNIQUE,
  match_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','denied')),
  telegram_id TEXT,
  expires INTEGER NOT NULL
);
CREATE INDEX telegram_login_expiry ON telegram_login_links(expires);
