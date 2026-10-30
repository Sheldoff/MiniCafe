CREATE TABLE telegram_profiles (
 telegram_id TEXT PRIMARY KEY, username TEXT, name TEXT NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE access_requests (
 telegram_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, profile TEXT NOT NULL,
 phone TEXT, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 version INTEGER NOT NULL DEFAULT 1, submitted INTEGER NOT NULL,
 resolved INTEGER, resolved_by TEXT
);
CREATE INDEX access_requests_pending ON access_requests(status,submitted);
CREATE TABLE telegram_updates (id INTEGER PRIMARY KEY,expires INTEGER NOT NULL);
CREATE INDEX telegram_updates_expiry ON telegram_updates(expires);
CREATE TABLE auth_flow_returns (state TEXT PRIMARY KEY,destination TEXT NOT NULL CHECK(destination='menu-transfer'),expires INTEGER NOT NULL);
CREATE INDEX auth_flow_returns_expiry ON auth_flow_returns(expires);
