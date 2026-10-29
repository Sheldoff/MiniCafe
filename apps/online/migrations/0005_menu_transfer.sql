CREATE TABLE menu_transfer (
 token_hash TEXT PRIMARY KEY,
 session_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
 creator TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('upload','download')),
 products_version INTEGER NOT NULL,
 expires INTEGER NOT NULL
);
CREATE INDEX menu_transfer_expires ON menu_transfer(expires);
