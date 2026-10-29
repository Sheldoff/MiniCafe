CREATE TABLE IF NOT EXISTS auth_flows (
  state TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, verifier TEXT NOT NULL,
  nonce TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_flows_expires ON auth_flows(expires);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, display_name TEXT NOT NULL,
  csrf TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions(expires);
CREATE TABLE IF NOT EXISTS staff_access (
  telegram_id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('service','cash','bar','delivery')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS public_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
  accepting INTEGER NOT NULL DEFAULT 0 CHECK(accepting IN (0,1)), revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO public_settings(id) VALUES (1);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires ON rate_limits(expires);
